begin;

-- Stable member numbers for approved/active member profiles.
alter table public.spinx_profiles
  add column if not exists member_number bigint;

create sequence if not exists public.spinx_member_number_seq;
alter sequence public.spinx_member_number_seq owned by public.spinx_profiles.member_number;

do $$
declare
  current_max bigint;
  profile_id uuid;
begin
  select coalesce(max(member_number), 0)
  into current_max
  from public.spinx_profiles;

  perform setval(
    'public.spinx_member_number_seq',
    greatest(current_max, 1),
    current_max > 0
  );

  for profile_id in
    select id
    from public.spinx_profiles
    where role = 'member'
      and status <> 'pending_approval'
      and member_number is null
    order by created_at, id
  loop
    update public.spinx_profiles
    set member_number = nextval('public.spinx_member_number_seq')
    where id = profile_id
      and member_number is null;
  end loop;
end;
$$;

create unique index if not exists spinx_profiles_member_number_unique
  on public.spinx_profiles(member_number)
  where member_number is not null;

create or replace function public.spinx_assign_member_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.member_number is not null
       and new.member_number is distinct from old.member_number then
      raise exception 'Member numbers cannot be changed after assignment';
    end if;
  end if;

  if new.role = 'member'
     and new.status <> 'pending_approval'
     and new.member_number is null then
    new.member_number := nextval('public.spinx_member_number_seq');
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'spinx_assign_member_number_trigger'
      and tgrelid = 'public.spinx_profiles'::regclass
      and not tgisinternal
  ) then
    create trigger spinx_assign_member_number_trigger
    before insert or update of role, status, member_number on public.spinx_profiles
    for each row execute function public.spinx_assign_member_number();
  end if;
end;
$$;

-- Prospective visitors stay separate from authenticated member profiles.
create table if not exists public.spinx_prospective_members (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  phone text not null,
  email text not null,
  status text not null default 'prospective'
    check (status in ('prospective', 'converted', 'inactive')),
  converted_member_id uuid references public.spinx_profiles(id) on delete set null,
  created_by uuid not null references public.spinx_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spinx_prospective_members_email_index
  on public.spinx_prospective_members(lower(email));

create table if not exists public.spinx_prospective_bookings (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.spinx_classes(id) on delete cascade,
  prospective_member_id uuid not null references public.spinx_prospective_members(id) on delete cascade,
  bike_number int not null check (bike_number between 1 and 9),
  status public.spinx_booking_status not null default 'booked',
  created_by uuid not null references public.spinx_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index if not exists spinx_one_prospective_bike_per_class
  on public.spinx_prospective_bookings(class_id, bike_number)
  where status = 'booked';

create unique index if not exists spinx_one_prospective_booking_per_class
  on public.spinx_prospective_bookings(class_id, prospective_member_id)
  where status = 'booked';

create table if not exists public.spinx_indemnities (
  id uuid primary key default gen_random_uuid(),
  prospective_member_id uuid not null references public.spinx_prospective_members(id) on delete cascade,
  class_id uuid references public.spinx_classes(id) on delete set null,
  indemnity_text text not null,
  signature_data_url text not null,
  signed_at timestamptz not null,
  pdf_file_name text,
  pdf_generated_at timestamptz,
  created_by uuid not null references public.spinx_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists spinx_indemnities_prospective_member_index
  on public.spinx_indemnities(prospective_member_id, signed_at desc);

alter table public.spinx_prospective_members enable row level security;
alter table public.spinx_prospective_bookings enable row level security;
alter table public.spinx_indemnities enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'spinx_prospective_members'
      and policyname = 'prospective members admin access'
  ) then
    execute 'create policy "prospective members admin access" on public.spinx_prospective_members for all using (public.spinx_is_admin()) with check (public.spinx_is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'spinx_prospective_bookings'
      and policyname = 'prospective bookings admin access'
  ) then
    execute 'create policy "prospective bookings admin access" on public.spinx_prospective_bookings for all using (public.spinx_is_admin()) with check (public.spinx_is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'spinx_indemnities'
      and policyname = 'indemnities admin access'
  ) then
    execute 'create policy "indemnities admin access" on public.spinx_indemnities for all using (public.spinx_is_admin()) with check (public.spinx_is_admin())';
  end if;
end;
$$;

-- Members can read occupied prospective bike numbers without seeing visitor PII.
create or replace function public.spinx_prospective_occupancy()
returns table(class_id uuid, bike_number int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  return query
  select booking.class_id, booking.bike_number
  from public.spinx_prospective_bookings booking
  where booking.status = 'booked';
end;
$$;

-- Keep normal member booking allocation aware of prospective bookings.
create or replace function public.spinx_book_next_bike(p_class_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  available_bike int;
  member_record public.spinx_profiles;
  class_record public.spinx_classes;
begin
  perform pg_advisory_xact_lock(hashtext(p_class_id::text));

  select * into member_record from public.spinx_profiles where id = auth.uid();
  if member_record.id is null then
    raise exception 'Profile not found';
  end if;
  if member_record.role <> 'member' then
    raise exception 'Only members can book bikes';
  end if;
  if member_record.status <> 'active' or member_record.payment_status <> 'paid' then
    raise exception 'Bookings are disabled until the member is active and paid';
  end if;

  select * into class_record from public.spinx_classes where id = p_class_id;
  if class_record.id is null or class_record.status <> 'active' then
    raise exception 'Class is not available';
  end if;

  if exists (
    select 1 from public.spinx_bookings
    where class_id = p_class_id
      and user_id = auth.uid()
      and status = 'booked'
  ) then
    raise exception 'You already have a booking for this class';
  end if;

  select bike into available_bike
  from generate_series(1, 9) as bike
  where not exists (
    select 1 from public.spinx_bookings
    where class_id = p_class_id
      and bike_number = bike
      and status = 'booked'
  )
  and not exists (
    select 1 from public.spinx_prospective_bookings
    where class_id = p_class_id
      and bike_number = bike
      and status = 'booked'
  )
  order by bike
  limit 1;

  if available_bike is null then
    raise exception 'Class is full';
  end if;

  insert into public.spinx_bookings(class_id, user_id, bike_number)
  values (p_class_id, auth.uid(), available_bike);
end;
$$;

create or replace function public.spinx_admin_book_member(p_class_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  available_bike int;
  member_record public.spinx_profiles;
  class_record public.spinx_classes;
begin
  if not public.spinx_is_admin() then
    raise exception 'Only admins can book members into classes';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_class_id::text));

  select * into member_record from public.spinx_profiles where id = p_user_id;
  if member_record.id is null or member_record.role <> 'member' then
    raise exception 'Member profile not found';
  end if;

  select * into class_record from public.spinx_classes where id = p_class_id;
  if class_record.id is null or class_record.status <> 'active' then
    raise exception 'Class is not available';
  end if;

  if exists (
    select 1 from public.spinx_bookings
    where class_id = p_class_id
      and user_id = p_user_id
      and status = 'booked'
  ) then
    raise exception 'Member already has a spot in this class';
  end if;

  select bike into available_bike
  from generate_series(1, 9) as bike
  where not exists (
    select 1 from public.spinx_bookings
    where class_id = p_class_id
      and bike_number = bike
      and status = 'booked'
  )
  and not exists (
    select 1 from public.spinx_prospective_bookings
    where class_id = p_class_id
      and bike_number = bike
      and status = 'booked'
  )
  order by bike
  limit 1;

  if available_bike is null then
    raise exception 'Class is full';
  end if;

  insert into public.spinx_bookings(class_id, user_id, bike_number)
  values (p_class_id, p_user_id, available_bike);
end;
$$;

create or replace function public.spinx_join_waitlist(p_class_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  booked_count int;
  member_record public.spinx_profiles;
begin
  select * into member_record from public.spinx_profiles where id = auth.uid();
  if member_record.role <> 'member' then
    raise exception 'Only members can join the waiting list';
  end if;
  if member_record.status <> 'active' or member_record.payment_status <> 'paid' then
    raise exception 'Waiting list is disabled until the member is active and paid';
  end if;
  if exists (
    select 1 from public.spinx_bookings
    where class_id = p_class_id
      and user_id = auth.uid()
      and status = 'booked'
  ) then
    raise exception 'You already have a booking for this class';
  end if;

  select
    (select count(*) from public.spinx_bookings where class_id = p_class_id and status = 'booked')
    +
    (select count(*) from public.spinx_prospective_bookings where class_id = p_class_id and status = 'booked')
  into booked_count;

  if booked_count < 9 then
    raise exception 'A bike is still available. Please book a bike instead';
  end if;

  insert into public.spinx_waitlist(class_id, user_id)
  values (p_class_id, auth.uid())
  on conflict do nothing;
end;
$$;

create or replace function public.spinx_admin_book_prospective(
  p_class_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_indemnity_text text,
  p_signature_data_url text,
  p_signed_at timestamptz
)
returns table(
  prospective_member_id uuid,
  prospective_booking_id uuid,
  indemnity_id uuid,
  bike_number int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  visitor_id uuid;
  booking_id uuid;
  agreement_id uuid;
  available_bike int;
  class_record public.spinx_classes;
begin
  if not public.spinx_is_admin() then
    raise exception 'Only admins can book prospective members';
  end if;

  if nullif(trim(p_first_name), '') is null
     or nullif(trim(p_last_name), '') is null
     or nullif(trim(p_phone), '') is null
     or nullif(trim(p_email), '') is null then
    raise exception 'Prospective member contact details are required';
  end if;

  if nullif(trim(p_indemnity_text), '') is null
     or nullif(trim(p_signature_data_url), '') is null then
    raise exception 'Accepted indemnity and signature are required';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_class_id::text));

  select * into class_record from public.spinx_classes where id = p_class_id;
  if class_record.id is null or class_record.status <> 'active' then
    raise exception 'Class is not available';
  end if;

  select id into visitor_id
  from public.spinx_prospective_members
  where lower(email) = lower(trim(p_email))
    and status = 'prospective'
  order by created_at
  limit 1;

  if visitor_id is null then
    insert into public.spinx_prospective_members(
      first_name, last_name, phone, email, created_by
    )
    values (
      trim(p_first_name), trim(p_last_name), trim(p_phone), lower(trim(p_email)), auth.uid()
    )
    returning id into visitor_id;
  else
    update public.spinx_prospective_members
    set first_name = trim(p_first_name),
        last_name = trim(p_last_name),
        phone = trim(p_phone),
        updated_at = now()
    where id = visitor_id;
  end if;

  if exists (
    select 1 from public.spinx_prospective_bookings
    where class_id = p_class_id
      and prospective_member_id = visitor_id
      and status = 'booked'
  ) then
    raise exception 'This prospective member already has a spot in the class';
  end if;

  select bike into available_bike
  from generate_series(1, 9) as bike
  where not exists (
    select 1 from public.spinx_bookings
    where class_id = p_class_id
      and bike_number = bike
      and status = 'booked'
  )
  and not exists (
    select 1 from public.spinx_prospective_bookings
    where class_id = p_class_id
      and bike_number = bike
      and status = 'booked'
  )
  order by bike
  limit 1;

  if available_bike is null then
    raise exception 'Class is full';
  end if;

  insert into public.spinx_prospective_bookings(
    class_id, prospective_member_id, bike_number, created_by
  )
  values (p_class_id, visitor_id, available_bike, auth.uid())
  returning id into booking_id;

  insert into public.spinx_indemnities(
    prospective_member_id,
    class_id,
    indemnity_text,
    signature_data_url,
    signed_at,
    created_by
  )
  values (
    visitor_id,
    p_class_id,
    p_indemnity_text,
    p_signature_data_url,
    coalesce(p_signed_at, now()),
    auth.uid()
  )
  returning id into agreement_id;

  return query select visitor_id, booking_id, agreement_id, available_bike;
end;
$$;

create or replace function public.spinx_cancel_prospective_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_record public.spinx_prospective_bookings;
  next_waiting public.spinx_waitlist;
begin
  if not public.spinx_is_admin() then
    raise exception 'Only admins can cancel prospective bookings';
  end if;

  select * into booking_record
  from public.spinx_prospective_bookings
  where id = p_booking_id
    and status = 'booked';

  if booking_record.id is null then
    raise exception 'Prospective booking not found';
  end if;

  update public.spinx_prospective_bookings
  set status = 'cancelled'
  where id = p_booking_id;

  select * into next_waiting
  from public.spinx_waitlist
  where class_id = booking_record.class_id
    and status = 'waiting'
  order by created_at
  limit 1;

  if next_waiting.id is not null then
    update public.spinx_waitlist
    set status = 'promoted'
    where id = next_waiting.id;

    insert into public.spinx_bookings(class_id, user_id, bike_number)
    values (booking_record.class_id, next_waiting.user_id, booking_record.bike_number)
    on conflict (class_id, user_id) where status = 'booked' do nothing;
  end if;
end;
$$;

create or replace function public.spinx_set_class_status(
  p_class_ids uuid[],
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.spinx_is_staff() then
    raise exception 'Only admin or instructors can update classes';
  end if;
  if not public.spinx_is_admin() and exists (
    select 1
    from public.spinx_classes
    where id = any(p_class_ids)
      and instructor_id is distinct from auth.uid()
  ) then
    raise exception 'Instructors can only update their own classes';
  end if;
  if p_status not in ('active', 'cancelled') then
    raise exception 'Invalid class status';
  end if;
  if coalesce(array_length(p_class_ids, 1), 0) = 0 then
    raise exception 'No classes selected';
  end if;

  update public.spinx_classes
  set status = p_status::public.spinx_class_status
  where id = any(p_class_ids);

  if p_status = 'cancelled' then
    update public.spinx_bookings
    set status = 'cancelled'
    where class_id = any(p_class_ids)
      and status = 'booked';

    update public.spinx_waitlist
    set status = 'cancelled'
    where class_id = any(p_class_ids)
      and status = 'waiting';

    update public.spinx_prospective_bookings
    set status = 'cancelled'
    where class_id = any(p_class_ids)
      and status = 'booked';
  end if;
end;
$$;

revoke all on function public.spinx_prospective_occupancy() from public;
revoke all on function public.spinx_admin_book_prospective(uuid, text, text, text, text, text, text, timestamptz) from public;
revoke all on function public.spinx_cancel_prospective_booking(uuid) from public;
revoke all on function public.spinx_set_class_status(uuid[], text) from public;

grant execute on function public.spinx_prospective_occupancy() to authenticated;
grant execute on function public.spinx_admin_book_prospective(uuid, text, text, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.spinx_cancel_prospective_booking(uuid) to authenticated;
grant execute on function public.spinx_set_class_status(uuid[], text) to authenticated;

commit;
