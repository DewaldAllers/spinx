begin;

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

  select klass.* into class_record
  from public.spinx_classes as klass
  where klass.id = p_class_id;

  if class_record.id is null or class_record.status <> 'active' then
    raise exception 'Class is not available';
  end if;

  select prospect.id into visitor_id
  from public.spinx_prospective_members as prospect
  where lower(prospect.email) = lower(trim(p_email))
    and prospect.status = 'prospective'
  order by prospect.created_at
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
    update public.spinx_prospective_members as prospect
    set first_name = trim(p_first_name),
        last_name = trim(p_last_name),
        phone = trim(p_phone),
        updated_at = now()
    where prospect.id = visitor_id;
  end if;

  if exists (
    select 1
    from public.spinx_prospective_bookings as prospect_booking
    where prospect_booking.class_id = p_class_id
      and prospect_booking.prospective_member_id = visitor_id
      and prospect_booking.status = 'booked'
  ) then
    raise exception 'This prospective member already has a spot in the class';
  end if;

  select bike.number into available_bike
  from generate_series(1, 9) as bike(number)
  where not exists (
    select 1
    from public.spinx_bookings as member_booking
    where member_booking.class_id = p_class_id
      and member_booking.bike_number = bike.number
      and member_booking.status = 'booked'
  )
  and not exists (
    select 1
    from public.spinx_prospective_bookings as prospect_booking
    where prospect_booking.class_id = p_class_id
      and prospect_booking.bike_number = bike.number
      and prospect_booking.status = 'booked'
  )
  order by bike.number
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

  return query
  select
    visitor_id as prospective_member_id,
    booking_id as prospective_booking_id,
    agreement_id as indemnity_id,
    available_bike as bike_number;
end;
$$;

revoke all on function public.spinx_admin_book_prospective(uuid, text, text, text, text, text, text, timestamptz) from public;
grant execute on function public.spinx_admin_book_prospective(uuid, text, text, text, text, text, text, timestamptz) to authenticated;

commit;
