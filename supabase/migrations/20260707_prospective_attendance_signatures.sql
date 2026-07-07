begin;

create table if not exists public.spinx_prospective_attendance (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.spinx_classes(id) on delete cascade,
  prospective_member_id uuid not null references public.spinx_prospective_members(id) on delete cascade,
  status public.spinx_attendance_status not null,
  marked_by uuid not null references public.spinx_profiles(id) on delete restrict,
  marked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists spinx_one_prospective_attendance_per_class
  on public.spinx_prospective_attendance(class_id, prospective_member_id);

alter table public.spinx_prospective_attendance enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'spinx_prospective_members'
      and policyname = 'prospective members staff read'
  ) then
    execute 'create policy "prospective members staff read" on public.spinx_prospective_members for select using (public.spinx_is_staff())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'spinx_prospective_bookings'
      and policyname = 'prospective bookings staff read'
  ) then
    execute 'create policy "prospective bookings staff read" on public.spinx_prospective_bookings for select using (public.spinx_is_staff())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'spinx_indemnities'
      and policyname = 'indemnities staff read'
  ) then
    execute 'create policy "indemnities staff read" on public.spinx_indemnities for select using (public.spinx_is_staff())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'spinx_prospective_attendance'
      and policyname = 'prospective attendance staff access'
  ) then
    execute 'create policy "prospective attendance staff access" on public.spinx_prospective_attendance for all using (public.spinx_is_staff()) with check (public.spinx_is_staff())';
  end if;
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

  if nullif(trim(coalesce(p_indemnity_text, '')), '') is not null
     and nullif(trim(coalesce(p_signature_data_url, '')), '') is not null then
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
  end if;

  return query select visitor_id, booking_id, agreement_id, available_bike;
end;
$$;

create or replace function public.spinx_mark_prospective_attendance(
  p_class_id uuid,
  p_prospective_member_id uuid,
  p_status text,
  p_indemnity_text text default null,
  p_signature_data_url text default null,
  p_signed_at timestamptz default null,
  p_pdf_file_name text default null
)
returns table(
  prospective_attendance_id uuid,
  indemnity_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  class_record public.spinx_classes;
  booking_record public.spinx_prospective_bookings;
  attendance_id uuid;
  agreement_id uuid;
  pdf_name text;
begin
  if not public.spinx_is_staff() then
    raise exception 'Only admin or instructors can mark prospective attendance';
  end if;

  if p_status not in ('present', 'absent') then
    raise exception 'Invalid attendance status';
  end if;

  select * into class_record
  from public.spinx_classes
  where id = p_class_id;

  if class_record.id is null then
    raise exception 'Class not found';
  end if;

  if not public.spinx_is_admin()
     and class_record.instructor_id is distinct from auth.uid() then
    raise exception 'Instructors can only mark attendance for their own classes';
  end if;

  select * into booking_record
  from public.spinx_prospective_bookings
  where class_id = p_class_id
    and prospective_member_id = p_prospective_member_id
    and status = 'booked';

  if booking_record.id is null then
    raise exception 'Prospective booking not found';
  end if;

  select id into agreement_id
  from public.spinx_indemnities
  where class_id = p_class_id
    and prospective_member_id = p_prospective_member_id
  order by signed_at desc
  limit 1;

  if p_status = 'present' and agreement_id is null then
    if nullif(trim(coalesce(p_indemnity_text, '')), '') is null
       or nullif(trim(coalesce(p_signature_data_url, '')), '') is null then
      raise exception 'Signature is required before marking a prospective member present';
    end if;

    pdf_name := nullif(trim(coalesce(p_pdf_file_name, '')), '');

    insert into public.spinx_indemnities(
      prospective_member_id,
      class_id,
      indemnity_text,
      signature_data_url,
      signed_at,
      pdf_file_name,
      pdf_generated_at,
      created_by
    )
    values (
      p_prospective_member_id,
      p_class_id,
      p_indemnity_text,
      p_signature_data_url,
      coalesce(p_signed_at, now()),
      pdf_name,
      case when pdf_name is null then null else now() end,
      auth.uid()
    )
    returning id into agreement_id;
  end if;

  insert into public.spinx_prospective_attendance(
    class_id,
    prospective_member_id,
    status,
    marked_by,
    marked_at
  )
  values (
    p_class_id,
    p_prospective_member_id,
    p_status::public.spinx_attendance_status,
    auth.uid(),
    now()
  )
  on conflict (class_id, prospective_member_id)
  do update set
    status = excluded.status,
    marked_by = excluded.marked_by,
    marked_at = excluded.marked_at
  returning id into attendance_id;

  return query select attendance_id, agreement_id;
end;
$$;

revoke all on function public.spinx_admin_book_prospective(uuid, text, text, text, text, text, text, timestamptz) from public;
revoke all on function public.spinx_mark_prospective_attendance(uuid, uuid, text, text, text, timestamptz, text) from public;

grant execute on function public.spinx_admin_book_prospective(uuid, text, text, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.spinx_mark_prospective_attendance(uuid, uuid, text, text, text, timestamptz, text) to authenticated;

commit;
