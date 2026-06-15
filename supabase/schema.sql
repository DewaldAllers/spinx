-- SpinX Web clean schema.
-- Paste this into Supabase SQL Editor and run it.
-- It only drops/recreates tables and functions with the spinx_ prefix.

create extension if not exists pgcrypto;

drop trigger if exists spinx_on_auth_user_created on auth.users;
drop function if exists public.spinx_handle_new_user() cascade;
drop function if exists public.spinx_is_admin() cascade;
drop function if exists public.spinx_is_staff() cascade;
drop function if exists public.spinx_update_my_profile(text, text, text, text) cascade;
drop function if exists public.spinx_book_bike(uuid, int) cascade;
drop function if exists public.spinx_cancel_booking(uuid) cascade;
drop function if exists public.spinx_join_waitlist(uuid) cascade;
drop function if exists public.spinx_mark_attendance(uuid, uuid, text) cascade;
drop function if exists public.spinx_approve_member(uuid) cascade;
drop function if exists public.spinx_approve_member(text) cascade;
drop function if exists public.spinx_decline_member(uuid) cascade;

drop table if exists public.spinx_payments cascade;
drop table if exists public.spinx_attendance cascade;
drop table if exists public.spinx_waitlist cascade;
drop table if exists public.spinx_bookings cascade;
drop table if exists public.spinx_classes cascade;
drop table if exists public.spinx_profiles cascade;
drop table if exists public.spinx_settings cascade;

drop type if exists public.spinx_role;
drop type if exists public.spinx_member_status;
drop type if exists public.spinx_payment_status;
drop type if exists public.spinx_class_status;
drop type if exists public.spinx_booking_status;
drop type if exists public.spinx_waitlist_status;
drop type if exists public.spinx_attendance_status;

create type public.spinx_role as enum ('admin', 'instructor', 'member');
create type public.spinx_member_status as enum ('pending_approval', 'active', 'inactive', 'suspended');
create type public.spinx_payment_status as enum ('paid', 'unpaid');
create type public.spinx_class_status as enum ('active', 'cancelled');
create type public.spinx_booking_status as enum ('booked', 'cancelled');
create type public.spinx_waitlist_status as enum ('waiting', 'promoted', 'cancelled');
create type public.spinx_attendance_status as enum ('present', 'absent');

create table public.spinx_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  first_name text not null default '',
  last_name text not null default '',
  mobile text not null default '',
  emergency_contact text not null default '',
  role public.spinx_role not null default 'member',
  status public.spinx_member_status not null default 'pending_approval',
  payment_status public.spinx_payment_status not null default 'unpaid',
  no_show_count int not null default 0,
  signature_text text,
  agreement_signed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.spinx_classes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  starts_at timestamptz not null,
  duration_minutes int not null default 45,
  instructor_id uuid references public.spinx_profiles(id) on delete set null,
  status public.spinx_class_status not null default 'active',
  notes text,
  created_at timestamptz not null default now()
);

create table public.spinx_bookings (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.spinx_classes(id) on delete cascade,
  user_id uuid not null references public.spinx_profiles(id) on delete cascade,
  bike_number int not null check (bike_number between 1 and 9),
  status public.spinx_booking_status not null default 'booked',
  created_at timestamptz not null default now()
);

create unique index spinx_one_bike_per_class
  on public.spinx_bookings(class_id, bike_number)
  where status = 'booked';

create unique index spinx_one_booking_per_member_per_class
  on public.spinx_bookings(class_id, user_id)
  where status = 'booked';

create table public.spinx_waitlist (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.spinx_classes(id) on delete cascade,
  user_id uuid not null references public.spinx_profiles(id) on delete cascade,
  status public.spinx_waitlist_status not null default 'waiting',
  created_at timestamptz not null default now()
);

create unique index spinx_one_waiting_entry
  on public.spinx_waitlist(class_id, user_id)
  where status = 'waiting';

create table public.spinx_attendance (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.spinx_classes(id) on delete cascade,
  user_id uuid not null references public.spinx_profiles(id) on delete cascade,
  status public.spinx_attendance_status not null,
  marked_by uuid references public.spinx_profiles(id) on delete set null,
  marked_at timestamptz not null default now(),
  unique (class_id, user_id)
);

create table public.spinx_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.spinx_profiles(id) on delete cascade,
  due_month date not null,
  status public.spinx_payment_status not null default 'unpaid',
  confirmed_by uuid references public.spinx_profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, due_month)
);

create table public.spinx_settings (
  key text primary key,
  value text not null
);

insert into public.spinx_settings(key, value) values ('no_show_threshold', '3');

create or replace function public.spinx_is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.spinx_profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.spinx_is_staff()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.spinx_profiles
    where id = auth.uid()
      and role in ('admin', 'instructor')
  );
$$;

create or replace function public.spinx_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.spinx_profiles (
    id,
    email,
    first_name,
    last_name,
    mobile,
    emergency_contact,
    signature_text,
    agreement_signed_at
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    coalesce(new.raw_user_meta_data->>'mobile', ''),
    coalesce(new.raw_user_meta_data->>'emergency_contact', ''),
    coalesce(new.raw_user_meta_data->>'signature_text', ''),
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger spinx_on_auth_user_created
after insert on auth.users
for each row execute function public.spinx_handle_new_user();

create or replace function public.spinx_update_my_profile(
  p_first_name text,
  p_last_name text,
  p_mobile text,
  p_emergency_contact text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.spinx_profiles
  set first_name = p_first_name,
      last_name = p_last_name,
      mobile = p_mobile,
      emergency_contact = p_emergency_contact
  where id = auth.uid();
end;
$$;

create or replace function public.spinx_book_bike(p_class_id uuid, p_bike_number int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  member_record public.spinx_profiles;
  class_record public.spinx_classes;
begin
  select * into member_record from public.spinx_profiles where id = auth.uid();
  if member_record.id is null then
    raise exception 'Profile not found';
  end if;
  if member_record.role = 'member' and (member_record.status <> 'active' or member_record.payment_status <> 'paid') then
    raise exception 'Bookings are disabled until the member is active and paid';
  end if;
  if p_bike_number < 1 or p_bike_number > 9 then
    raise exception 'Bike must be between 1 and 9';
  end if;
  select * into class_record from public.spinx_classes where id = p_class_id;
  if class_record.id is null or class_record.status <> 'active' then
    raise exception 'Class is not available';
  end if;
  insert into public.spinx_bookings(class_id, user_id, bike_number)
  values (p_class_id, auth.uid(), p_bike_number);
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
  if member_record.role = 'member' and (member_record.status <> 'active' or member_record.payment_status <> 'paid') then
    raise exception 'Waiting list is disabled until the member is active and paid';
  end if;
  if exists (select 1 from public.spinx_bookings where class_id = p_class_id and user_id = auth.uid() and status = 'booked') then
    raise exception 'You already have a booking for this class';
  end if;
  select count(*) into booked_count from public.spinx_bookings where class_id = p_class_id and status = 'booked';
  if booked_count < 9 then
    raise exception 'A bike is still available. Please book a bike instead';
  end if;
  insert into public.spinx_waitlist(class_id, user_id)
  values (p_class_id, auth.uid())
  on conflict do nothing;
end;
$$;

create or replace function public.spinx_cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_record public.spinx_bookings;
  next_waiting public.spinx_waitlist;
begin
  select * into booking_record from public.spinx_bookings where id = p_booking_id and status = 'booked';
  if booking_record.id is null then
    raise exception 'Booking not found';
  end if;
  if booking_record.user_id <> auth.uid() and not public.spinx_is_staff() then
    raise exception 'You cannot cancel this booking';
  end if;
  update public.spinx_bookings set status = 'cancelled' where id = p_booking_id;

  select * into next_waiting
  from public.spinx_waitlist
  where class_id = booking_record.class_id
    and status = 'waiting'
  order by created_at
  limit 1;

  if next_waiting.id is not null then
    insert into public.spinx_bookings(class_id, user_id, bike_number)
    values (booking_record.class_id, next_waiting.user_id, booking_record.bike_number);
    update public.spinx_waitlist set status = 'promoted' where id = next_waiting.id;
  end if;
end;
$$;

create or replace function public.spinx_mark_attendance(p_class_id uuid, p_user_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_status public.spinx_attendance_status;
begin
  if not public.spinx_is_staff() then
    raise exception 'Only admin or instructors can mark attendance';
  end if;
  if p_status not in ('present', 'absent') then
    raise exception 'Invalid attendance status';
  end if;

  select status into previous_status
  from public.spinx_attendance
  where class_id = p_class_id
    and user_id = p_user_id;

  insert into public.spinx_attendance(class_id, user_id, status, marked_by, marked_at)
  values (p_class_id, p_user_id, p_status::public.spinx_attendance_status, auth.uid(), now())
  on conflict (class_id, user_id)
  do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = now();

  if p_status = 'absent' and coalesce(previous_status::text, '') <> 'absent' then
    update public.spinx_profiles set no_show_count = no_show_count + 1 where id = p_user_id;
  elsif p_status = 'present' and previous_status = 'absent' then
    update public.spinx_profiles set no_show_count = greatest(no_show_count - 1, 0) where id = p_user_id;
  end if;
end;
$$;

create or replace function public.spinx_approve_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.spinx_is_admin() then
    raise exception 'Only admins can approve members';
  end if;

  update public.spinx_profiles
  set status = 'active'
  where id = p_user_id;

  update auth.users
  set email_confirmed_at = coalesce(email_confirmed_at, now()),
      confirmation_token = '',
      recovery_token = '',
      updated_at = now()
  where id = p_user_id;
end;
$$;

create or replace function public.spinx_decline_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.spinx_is_admin() then
    raise exception 'Only admins can decline members';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot delete your own admin account';
  end if;
  delete from auth.users where id = p_user_id;
end;
$$;

alter table public.spinx_profiles enable row level security;
alter table public.spinx_classes enable row level security;
alter table public.spinx_bookings enable row level security;
alter table public.spinx_waitlist enable row level security;
alter table public.spinx_attendance enable row level security;
alter table public.spinx_payments enable row level security;
alter table public.spinx_settings enable row level security;

create policy "profiles select own or staff" on public.spinx_profiles
for select using (id = auth.uid() or public.spinx_is_staff());

create policy "profiles insert own pending member" on public.spinx_profiles
for insert with check (id = auth.uid() and role = 'member' and status = 'pending_approval');

create policy "profiles update by admin" on public.spinx_profiles
for update using (public.spinx_is_admin()) with check (public.spinx_is_admin());

create policy "classes select authenticated" on public.spinx_classes
for select using (auth.role() = 'authenticated');

create policy "classes manage staff" on public.spinx_classes
for all using (public.spinx_is_staff()) with check (public.spinx_is_staff());

create policy "bookings select authenticated" on public.spinx_bookings
for select using (auth.role() = 'authenticated');

create policy "bookings manage staff" on public.spinx_bookings
for update using (public.spinx_is_staff()) with check (public.spinx_is_staff());

create policy "waitlist select authenticated" on public.spinx_waitlist
for select using (auth.role() = 'authenticated');

create policy "waitlist manage staff" on public.spinx_waitlist
for update using (public.spinx_is_staff()) with check (public.spinx_is_staff());

create policy "attendance select own or staff" on public.spinx_attendance
for select using (user_id = auth.uid() or public.spinx_is_staff());

create policy "attendance manage staff" on public.spinx_attendance
for all using (public.spinx_is_staff()) with check (public.spinx_is_staff());

create policy "payments select own or admin" on public.spinx_payments
for select using (user_id = auth.uid() or public.spinx_is_admin());

create policy "payments manage admin" on public.spinx_payments
for all using (public.spinx_is_admin()) with check (public.spinx_is_admin());

create policy "settings select authenticated" on public.spinx_settings
for select using (auth.role() = 'authenticated');
