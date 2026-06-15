-- Supabase-first runtime support.
-- This keeps the existing SpinX tables, but makes Supabase Auth, RLS, Storage,
-- and Postgres RPC functions the production backend for the mobile app.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "User" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "passwordHash" SET DEFAULT '';
ALTER TABLE "User" ALTER COLUMN "updatedAt" SET DEFAULT now();

ALTER TABLE "RecurringClassRule" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "RecurringClassRule" ALTER COLUMN "updatedAt" SET DEFAULT now();

ALTER TABLE "ClassSession" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "ClassSession" ALTER COLUMN "updatedAt" SET DEFAULT now();

ALTER TABLE "Booking" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "Booking" ALTER COLUMN "updatedAt" SET DEFAULT now();

ALTER TABLE "Attendance" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "Attendance" ALTER COLUMN "updatedAt" SET DEFAULT now();

ALTER TABLE "MembershipPayment" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "MembershipPayment" ALTER COLUMN "updatedAt" SET DEFAULT now();

ALTER TABLE "Notification" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

ALTER TABLE "PushToken" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "PushToken" ALTER COLUMN "updatedAt" SET DEFAULT now();

ALTER TABLE "AppSetting" ALTER COLUMN "updatedAt" SET DEFAULT now();

ALTER TABLE "AuditLog" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

CREATE OR REPLACE FUNCTION public.spinx_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT table_name
    FROM (VALUES
      ('User'),
      ('RecurringClassRule'),
      ('ClassSession'),
      ('Booking'),
      ('Attendance'),
      ('MembershipPayment'),
      ('PushToken')
    ) AS tables(table_name)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS spinx_touch_updated_at ON public.%I', item.table_name);
    EXECUTE format(
      'CREATE TRIGGER spinx_touch_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.spinx_touch_updated_at()',
      item.table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.spinx_role()
RETURNS "Role"
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.role
  FROM public."User" u
  WHERE u.id = auth.uid()::text
    AND u."deletedAt" IS NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.spinx_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.spinx_role() = 'ADMIN'::"Role", false)
$$;

CREATE OR REPLACE FUNCTION public.spinx_is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.spinx_role() IN ('ADMIN'::"Role", 'INSTRUCTOR'::"Role"), false)
$$;

CREATE OR REPLACE FUNCTION public.spinx_setting_int(p_key text, p_fallback integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN jsonb_typeof(value) = 'number' THEN value::text::integer
        WHEN jsonb_typeof(value) = 'string' THEN trim(both '"' from value::text)::integer
        ELSE NULL
      END
      FROM public."AppSetting"
      WHERE key = p_key
    ),
    p_fallback
  )
$$;

CREATE OR REPLACE FUNCTION public.spinx_month_due_date(p_month text)
RETURNS timestamp
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_date(p_month || '-01', 'YYYY-MM-DD')::timestamp
$$;

CREATE OR REPLACE FUNCTION public.spinx_current_month()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT to_char(now(), 'YYYY-MM')
$$;

CREATE OR REPLACE FUNCTION public.spinx_notify_user(
  p_user_id text,
  p_type "NotificationType",
  p_title text,
  p_body text,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public."Notification" ("userId", type, title, body, data)
  VALUES (p_user_id, p_type, p_title, p_body, p_data);
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_notify_admins(
  p_type "NotificationType",
  p_title text,
  p_body text,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_row record;
BEGIN
  FOR admin_row IN
    SELECT id FROM public."User"
    WHERE role = 'ADMIN'::"Role"
      AND status = 'ACTIVE'::"MemberStatus"
      AND "deletedAt" IS NULL
  LOOP
    PERFORM public.spinx_notify_user(admin_row.id, p_type, p_title, p_body, p_data);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_audit(
  p_action text,
  p_entity text,
  p_entity_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public."AuditLog" ("actorId", action, entity, "entityId", metadata)
  VALUES (auth.uid()::text, p_action, p_entity, p_entity_id, p_metadata);
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  metadata jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
BEGIN
  INSERT INTO public."User" (
    id,
    email,
    "passwordHash",
    role,
    status,
    "firstName",
    "lastName",
    mobile,
    "emergencyContact",
    "emailVerifiedAt",
    "acceptedAgreementVersion",
    "agreementAcceptedAt",
    "signatureAssetKey",
    "signatureSignedAt",
    "contractSignedOffline",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    NEW.id::text,
    lower(COALESCE(NEW.email, '')),
    '',
    COALESCE((metadata->>'role')::"Role", 'MEMBER'::"Role"),
    COALESCE((metadata->>'status')::"MemberStatus", 'PENDING_APPROVAL'::"MemberStatus"),
    COALESCE(metadata->>'firstName', ''),
    COALESCE(metadata->>'lastName', ''),
    COALESCE(metadata->>'mobile', ''),
    COALESCE(metadata->>'emergencyContact', ''),
    NEW.email_confirmed_at,
    metadata->>'acceptedAgreementVersion',
    CASE WHEN metadata ? 'agreementAcceptedAt' THEN (metadata->>'agreementAcceptedAt')::timestamp ELSE now() END,
    metadata->>'signatureAssetKey',
    CASE WHEN metadata ? 'signatureSignedAt' THEN (metadata->>'signatureSignedAt')::timestamp ELSE NULL END,
    COALESCE((metadata->>'contractSignedOffline')::boolean, false),
    now(),
    now()
  )
  ON CONFLICT (email) DO UPDATE
  SET
    id = EXCLUDED.id,
    "emailVerifiedAt" = COALESCE(public."User"."emailVerifiedAt", EXCLUDED."emailVerifiedAt"),
    "updatedAt" = now();

  PERFORM public.spinx_notify_admins(
    'ADMIN_REGISTRATION_PENDING'::"NotificationType",
    'New member awaiting approval',
    trim(COALESCE(metadata->>'firstName', '') || ' ' || COALESCE(metadata->>'lastName', '')) || ' completed registration.',
    jsonb_build_object('userId', NEW.id::text)
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_sync_auth_user_email_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public."User"
  SET "emailVerifiedAt" = NEW.email_confirmed_at,
      "updatedAt" = now()
  WHERE id = NEW.id::text
    AND NEW.email_confirmed_at IS NOT NULL
    AND "emailVerifiedAt" IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spinx_handle_new_auth_user ON auth.users;
CREATE TRIGGER spinx_handle_new_auth_user
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.spinx_handle_new_auth_user();

DROP TRIGGER IF EXISTS spinx_sync_auth_user_email_status ON auth.users;
CREATE TRIGGER spinx_sync_auth_user_email_status
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.spinx_sync_auth_user_email_status();

CREATE OR REPLACE FUNCTION public.spinx_ensure_current_payment(p_user_id text DEFAULT auth.uid()::text)
RETURNS public."MembershipPayment"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month text := public.spinx_current_month();
  v_payment public."MembershipPayment";
BEGIN
  INSERT INTO public."MembershipPayment" ("userId", month, "dueDate", status)
  VALUES (p_user_id, v_month, public.spinx_month_due_date(v_month), 'PENDING'::"PaymentStatus")
  ON CONFLICT ("userId", month) DO NOTHING;

  SELECT * INTO v_payment
  FROM public."MembershipPayment"
  WHERE "userId" = p_user_id
    AND month = v_month;

  RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_has_booking_rights(p_user_id text DEFAULT auth.uid()::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public."User";
  v_payment public."MembershipPayment";
  v_grace integer;
BEGIN
  SELECT * INTO v_user
  FROM public."User"
  WHERE id = p_user_id
    AND "deletedAt" IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_user.role <> 'MEMBER'::"Role" THEN
    RETURN true;
  END IF;

  IF v_user.status <> 'ACTIVE'::"MemberStatus"
     OR v_user."bookingBlocked"
     OR v_user."emailVerifiedAt" IS NULL THEN
    RETURN false;
  END IF;

  v_payment := public.spinx_ensure_current_payment(p_user_id);

  IF v_payment.status IN ('PAID'::"PaymentStatus", 'WAIVED'::"PaymentStatus") THEN
    RETURN true;
  END IF;

  v_grace := public.spinx_setting_int('paymentGraceDays', 3);

  IF now()::date > (v_payment."dueDate"::date + v_grace) THEN
    UPDATE public."MembershipPayment"
    SET status = 'OVERDUE'::"PaymentStatus",
        "updatedAt" = now()
    WHERE id = v_payment.id
      AND status = 'PENDING'::"PaymentStatus";
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_approve_member(p_user_id text)
RETURNS public."User"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public."User";
BEGIN
  IF NOT public.spinx_is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve members';
  END IF;

  UPDATE public."User"
  SET status = 'ACTIVE'::"MemberStatus",
      "updatedAt" = now()
  WHERE id = p_user_id
    AND "deletedAt" IS NULL
  RETURNING * INTO v_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  PERFORM public.spinx_notify_user(
    v_user.id,
    'REGISTRATION_APPROVED'::"NotificationType",
    'Registration approved',
    'Your SpinX account has been approved.'
  );
  PERFORM public.spinx_audit('APPROVE_MEMBER', 'User', v_user.id);

  RETURN v_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_decline_member(p_user_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.spinx_is_admin() THEN
    RAISE EXCEPTION 'Only admins can decline members';
  END IF;

  DELETE FROM public."User"
  WHERE id = p_user_id
    AND status = 'PENDING_APPROVAL'::"MemberStatus";

  PERFORM public.spinx_audit('DECLINE_MEMBER', 'User', p_user_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_update_member_status(
  p_user_id text,
  p_status "MemberStatus",
  p_booking_blocked boolean DEFAULT NULL
)
RETURNS public."User"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public."User";
BEGIN
  IF NOT public.spinx_is_admin() THEN
    RAISE EXCEPTION 'Only admins can update member status';
  END IF;

  UPDATE public."User"
  SET status = p_status,
      "bookingBlocked" = COALESCE(p_booking_blocked, "bookingBlocked"),
      "updatedAt" = now()
  WHERE id = p_user_id
    AND "deletedAt" IS NULL
  RETURNING * INTO v_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  PERFORM public.spinx_audit('UPDATE_MEMBER_STATUS', 'User', v_user.id, jsonb_build_object('status', p_status));
  RETURN v_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_reset_no_shows(p_user_id text)
RETURNS public."User"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public."User";
BEGIN
  IF NOT public.spinx_is_admin() THEN
    RAISE EXCEPTION 'Only admins can reset no-shows';
  END IF;

  UPDATE public."User"
  SET "noShowCount" = 0,
      "updatedAt" = now()
  WHERE id = p_user_id
  RETURNING * INTO v_user;

  PERFORM public.spinx_audit('RESET_NO_SHOWS', 'User', p_user_id);
  RETURN v_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_create_class(
  p_title text,
  p_description text,
  p_instructor_id text,
  p_starts_at timestamp,
  p_ends_at timestamp,
  p_capacity integer DEFAULT 9
)
RETURNS public."ClassSession"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public."User";
  v_class public."ClassSession";
BEGIN
  SELECT * INTO v_actor FROM public."User" WHERE id = auth.uid()::text AND "deletedAt" IS NULL;
  IF v_actor.role NOT IN ('ADMIN'::"Role", 'INSTRUCTOR'::"Role") THEN
    RAISE EXCEPTION 'Only admins and instructors can create classes';
  END IF;
  IF p_starts_at >= p_ends_at THEN
    RAISE EXCEPTION 'Class start must be before class end';
  END IF;

  INSERT INTO public."ClassSession" (
    title, description, "instructorId", "creatorId", "startsAt", "endsAt", capacity, status
  )
  VALUES (
    p_title,
    p_description,
    CASE WHEN v_actor.role = 'INSTRUCTOR'::"Role" THEN v_actor.id ELSE p_instructor_id END,
    v_actor.id,
    p_starts_at,
    p_ends_at,
    LEAST(GREATEST(COALESCE(p_capacity, 9), 1), 9),
    'SCHEDULED'::"ClassStatus"
  )
  RETURNING * INTO v_class;

  PERFORM public.spinx_audit('CREATE_CLASS', 'ClassSession', v_class.id);
  RETURN v_class;
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_create_recurring_classes(
  p_title text,
  p_description text,
  p_instructor_id text,
  p_day_of_week integer,
  p_start_time text,
  p_duration_minutes integer,
  p_effective_from timestamp,
  p_effective_until timestamp DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public."User";
  v_rule public."RecurringClassRule";
  v_until timestamp := COALESCE(p_effective_until, p_effective_from + interval '90 days');
  v_day date := p_effective_from::date;
  v_start timestamp;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_actor FROM public."User" WHERE id = auth.uid()::text AND "deletedAt" IS NULL;
  IF v_actor.role NOT IN ('ADMIN'::"Role", 'INSTRUCTOR'::"Role") THEN
    RAISE EXCEPTION 'Only admins and instructors can create recurring classes';
  END IF;

  INSERT INTO public."RecurringClassRule" (
    title, description, "instructorId", "dayOfWeek", "startTime", "durationMinutes",
    "effectiveFrom", "effectiveUntil", active
  )
  VALUES (
    p_title,
    p_description,
    CASE WHEN v_actor.role = 'INSTRUCTOR'::"Role" THEN v_actor.id ELSE p_instructor_id END,
    p_day_of_week,
    p_start_time,
    p_duration_minutes,
    p_effective_from,
    v_until,
    true
  )
  RETURNING * INTO v_rule;

  WHILE v_day <= v_until::date LOOP
    IF EXTRACT(DOW FROM v_day)::integer = p_day_of_week THEN
      v_start := (v_day::text || ' ' || p_start_time)::timestamp;
      INSERT INTO public."ClassSession" (
        title, description, "instructorId", "creatorId", "startsAt", "endsAt", capacity, status, "recurringId"
      )
      VALUES (
        p_title,
        p_description,
        v_rule."instructorId",
        v_actor.id,
        v_start,
        v_start + make_interval(mins => p_duration_minutes),
        9,
        'SCHEDULED'::"ClassStatus",
        v_rule.id
      );
      v_count := v_count + 1;
    END IF;
    v_day := v_day + 1;
  END LOOP;

  PERFORM public.spinx_audit('CREATE_RECURRING_CLASS', 'RecurringClassRule', v_rule.id, jsonb_build_object('generatedSessions', v_count));
  RETURN jsonb_build_object('ruleId', v_rule.id, 'generatedSessions', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_cancel_class(p_class_session_id text)
RETURNS public."ClassSession"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public."User";
  v_class public."ClassSession";
BEGIN
  SELECT * INTO v_actor FROM public."User" WHERE id = auth.uid()::text AND "deletedAt" IS NULL;
  SELECT * INTO v_class FROM public."ClassSession" WHERE id = p_class_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Class not found';
  END IF;
  IF v_actor.role <> 'ADMIN'::"Role"
     AND NOT (v_actor.role = 'INSTRUCTOR'::"Role" AND (v_class."instructorId" IS NULL OR v_class."instructorId" = v_actor.id)) THEN
    RAISE EXCEPTION 'Only the assigned instructor or an admin can cancel this class';
  END IF;

  UPDATE public."ClassSession"
  SET status = 'CANCELLED'::"ClassStatus", "updatedAt" = now()
  WHERE id = p_class_session_id
  RETURNING * INTO v_class;

  UPDATE public."Booking"
  SET status = 'CANCELLED'::"BookingStatus",
      "cancelledAt" = now(),
      "updatedAt" = now()
  WHERE "classSessionId" = p_class_session_id
    AND status IN ('BOOKED'::"BookingStatus", 'PROMOTED'::"BookingStatus", 'WAITLISTED'::"BookingStatus");

  PERFORM public.spinx_audit('CANCEL_CLASS', 'ClassSession', v_class.id);
  RETURN v_class;
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_create_booking(
  p_class_session_id text,
  p_bike_number integer DEFAULT NULL
)
RETURNS public."Booking"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public."User";
  v_class public."ClassSession";
  v_active_count integer;
  v_wait_rank integer;
  v_booking public."Booking";
BEGIN
  SELECT * INTO v_user FROM public."User" WHERE id = auth.uid()::text AND "deletedAt" IS NULL;
  IF v_user.role <> 'MEMBER'::"Role" THEN
    RAISE EXCEPTION 'Only members can book classes';
  END IF;
  IF NOT public.spinx_has_booking_rights(v_user.id) THEN
    RAISE EXCEPTION 'Booking is disabled until account approval and payment are current';
  END IF;

  SELECT * INTO v_class
  FROM public."ClassSession"
  WHERE id = p_class_session_id
  FOR UPDATE;

  IF NOT FOUND OR v_class.status <> 'SCHEDULED'::"ClassStatus" THEN
    RAISE EXCEPTION 'Class not found or not bookable';
  END IF;
  IF v_class."startsAt" <= now() THEN
    RAISE EXCEPTION 'Cannot book a past class';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public."Booking"
    WHERE "classSessionId" = p_class_session_id
      AND "userId" = v_user.id
      AND status IN ('BOOKED'::"BookingStatus", 'PROMOTED'::"BookingStatus", 'WAITLISTED'::"BookingStatus")
  ) THEN
    RAISE EXCEPTION 'You already have a booking or waiting-list entry for this class';
  END IF;

  SELECT COUNT(*) INTO v_active_count
  FROM public."Booking"
  WHERE "classSessionId" = p_class_session_id
    AND status IN ('BOOKED'::"BookingStatus", 'PROMOTED'::"BookingStatus");

  IF v_active_count >= v_class.capacity THEN
    SELECT COUNT(*) + 1 INTO v_wait_rank
    FROM public."Booking"
    WHERE "classSessionId" = p_class_session_id
      AND status = 'WAITLISTED'::"BookingStatus";

    INSERT INTO public."Booking" ("userId", "classSessionId", status, "waitlistRank")
    VALUES (v_user.id, p_class_session_id, 'WAITLISTED'::"BookingStatus", v_wait_rank)
    RETURNING * INTO v_booking;

    PERFORM public.spinx_notify_user(v_user.id, 'WAITLIST_JOINED'::"NotificationType", 'Waiting list joined', 'You joined the waiting list for this class.', jsonb_build_object('bookingId', v_booking.id, 'classSessionId', p_class_session_id));
    RETURN v_booking;
  END IF;

  IF p_bike_number IS NULL OR p_bike_number < 1 OR p_bike_number > 9 THEN
    RAISE EXCEPTION 'A valid bike number is required while bikes are available';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."Booking"
    WHERE "classSessionId" = p_class_session_id
      AND "bikeNumber" = p_bike_number
      AND status IN ('BOOKED'::"BookingStatus", 'PROMOTED'::"BookingStatus")
  ) THEN
    RAISE EXCEPTION 'Selected bike is no longer available';
  END IF;

  INSERT INTO public."Booking" ("userId", "classSessionId", "bikeNumber", status)
  VALUES (v_user.id, p_class_session_id, p_bike_number, 'BOOKED'::"BookingStatus")
  RETURNING * INTO v_booking;

  PERFORM public.spinx_notify_user(v_user.id, 'BOOKING_CONFIRMED'::"NotificationType", 'Booking confirmed', 'Bike ' || p_bike_number || ' is booked for you.', jsonb_build_object('bookingId', v_booking.id, 'classSessionId', p_class_session_id));
  PERFORM public.spinx_audit('CREATE_BOOKING', 'Booking', v_booking.id, jsonb_build_object('status', v_booking.status));
  RETURN v_booking;
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_cancel_booking(p_booking_id text)
RETURNS public."Booking"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public."User";
  v_booking public."Booking";
  v_class public."ClassSession";
  v_previous_bike integer;
  v_promoted public."Booking";
BEGIN
  SELECT * INTO v_actor FROM public."User" WHERE id = auth.uid()::text AND "deletedAt" IS NULL;
  SELECT * INTO v_booking FROM public."Booking" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;
  SELECT * INTO v_class FROM public."ClassSession" WHERE id = v_booking."classSessionId";

  IF v_actor.role = 'MEMBER'::"Role" AND v_booking."userId" <> v_actor.id THEN
    RAISE EXCEPTION 'Members may only cancel their own bookings';
  END IF;
  IF v_actor.role = 'INSTRUCTOR'::"Role"
     AND v_class."instructorId" IS NOT NULL
     AND v_class."instructorId" <> v_actor.id THEN
    RAISE EXCEPTION 'Only the assigned instructor or an admin can cancel this booking';
  END IF;

  v_previous_bike := v_booking."bikeNumber";

  UPDATE public."Booking"
  SET status = 'CANCELLED'::"BookingStatus",
      "cancelledAt" = now(),
      "updatedAt" = now()
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  IF v_previous_bike IS NOT NULL THEN
    SELECT * INTO v_promoted
    FROM public."Booking"
    WHERE "classSessionId" = v_booking."classSessionId"
      AND status = 'WAITLISTED'::"BookingStatus"
    ORDER BY "waitlistRank" ASC, "createdAt" ASC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public."Booking"
      SET status = 'PROMOTED'::"BookingStatus",
          "bikeNumber" = v_previous_bike,
          "waitlistRank" = NULL,
          "promotedAt" = now(),
          "updatedAt" = now()
      WHERE id = v_promoted.id
      RETURNING * INTO v_promoted;

      PERFORM public.spinx_notify_user(v_promoted."userId", 'WAITLIST_PROMOTED'::"NotificationType", 'Bike assigned', 'You have been moved from the waiting list to Bike ' || v_previous_bike || '.', jsonb_build_object('bookingId', v_promoted.id, 'classSessionId', v_booking."classSessionId", 'bikeNumber', v_previous_bike));
    END IF;
  END IF;

  PERFORM public.spinx_notify_user(v_booking."userId", 'BOOKING_CANCELLED'::"NotificationType", 'Booking cancelled', 'Your SpinX booking has been cancelled.', jsonb_build_object('bookingId', v_booking.id, 'classSessionId', v_booking."classSessionId"));
  PERFORM public.spinx_audit('CANCEL_BOOKING', 'Booking', v_booking.id);
  RETURN v_booking;
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_save_attendance(
  p_class_session_id text,
  p_entries jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public."User";
  v_class public."ClassSession";
  v_entry jsonb;
  v_booking public."Booking";
  v_previous "AttendanceStatus";
  v_status "AttendanceStatus";
  v_threshold integer := public.spinx_setting_int('noShowThreshold', 3);
  v_member public."User";
  v_count integer := 0;
BEGIN
  SELECT * INTO v_actor FROM public."User" WHERE id = auth.uid()::text AND "deletedAt" IS NULL;
  SELECT * INTO v_class FROM public."ClassSession" WHERE id = p_class_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Class not found';
  END IF;
  IF v_actor.role <> 'ADMIN'::"Role"
     AND NOT (v_actor.role = 'INSTRUCTOR'::"Role" AND (v_class."instructorId" IS NULL OR v_class."instructorId" = v_actor.id)) THEN
    RAISE EXCEPTION 'Only the assigned instructor or an admin can mark attendance';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    v_status := (v_entry->>'status')::"AttendanceStatus";

    SELECT b.* INTO v_booking
    FROM public."Booking" b
    WHERE b.id = v_entry->>'bookingId'
      AND b."classSessionId" = p_class_session_id
      AND b.status IN ('BOOKED'::"BookingStatus", 'PROMOTED'::"BookingStatus");

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Booking is not valid for this class';
    END IF;

    SELECT a.status INTO v_previous
    FROM public."Attendance" a
    WHERE a."bookingId" = v_booking.id;

    INSERT INTO public."Attendance" ("bookingId", status, "markedById", "markedAt")
    VALUES (v_booking.id, v_status, v_actor.id, now())
    ON CONFLICT ("bookingId") DO UPDATE
    SET status = EXCLUDED.status,
        "markedById" = EXCLUDED."markedById",
        "markedAt" = now(),
        "updatedAt" = now();

    IF v_status = 'ABSENT'::"AttendanceStatus" AND COALESCE(v_previous::text, '') <> 'ABSENT' THEN
      UPDATE public."User"
      SET "noShowCount" = "noShowCount" + 1,
          "updatedAt" = now()
      WHERE id = v_booking."userId"
      RETURNING * INTO v_member;

      IF v_member."noShowCount" >= v_threshold THEN
        PERFORM public.spinx_notify_admins('NO_SHOW_WARNING'::"NotificationType", 'No-show threshold reached', v_member."firstName" || ' ' || v_member."lastName" || ' has ' || v_member."noShowCount" || ' no-shows.', jsonb_build_object('userId', v_member.id, 'noShowCount', v_member."noShowCount"));
      END IF;
    ELSIF v_status = 'PRESENT'::"AttendanceStatus" AND v_previous = 'ABSENT'::"AttendanceStatus" THEN
      UPDATE public."User"
      SET "noShowCount" = GREATEST("noShowCount" - 1, 0),
          "updatedAt" = now()
      WHERE id = v_booking."userId";
    END IF;

    v_count := v_count + 1;
  END LOOP;

  PERFORM public.spinx_audit('MARK_ATTENDANCE', 'ClassSession', p_class_session_id, jsonb_build_object('count', v_count));
  RETURN jsonb_build_object('updated', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_generate_monthly_payments(p_month text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.spinx_is_admin() THEN
    RAISE EXCEPTION 'Only admins can generate payments';
  END IF;

  INSERT INTO public."MembershipPayment" ("userId", month, "dueDate", status)
  SELECT id, p_month, public.spinx_month_due_date(p_month), 'PENDING'::"PaymentStatus"
  FROM public."User"
  WHERE role = 'MEMBER'::"Role"
    AND status = 'ACTIVE'::"MemberStatus"
    AND "deletedAt" IS NULL
  ON CONFLICT ("userId", month) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM public.spinx_audit('GENERATE_MONTHLY_PAYMENTS', 'MembershipPayment', NULL, jsonb_build_object('month', p_month, 'count', v_count));
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_confirm_payment(p_payment_id text, p_paid_at timestamp DEFAULT now(), p_notes text DEFAULT NULL)
RETURNS public."MembershipPayment"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public."MembershipPayment";
BEGIN
  IF NOT public.spinx_is_admin() THEN
    RAISE EXCEPTION 'Only admins can confirm payments';
  END IF;

  UPDATE public."MembershipPayment"
  SET status = 'PAID'::"PaymentStatus",
      "paidAt" = COALESCE(p_paid_at, now()),
      "confirmedById" = auth.uid()::text,
      "manualOverride" = true,
      notes = p_notes,
      "updatedAt" = now()
  WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  PERFORM public.spinx_notify_user(v_payment."userId", 'PAYMENT_CONFIRMED'::"NotificationType", 'Payment confirmed', 'Your membership payment has been confirmed.', jsonb_build_object('paymentId', v_payment.id));
  PERFORM public.spinx_audit('CONFIRM_PAYMENT', 'MembershipPayment', v_payment.id);
  RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION public.spinx_waive_payment(p_payment_id text, p_notes text DEFAULT 'Admin override')
RETURNS public."MembershipPayment"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public."MembershipPayment";
BEGIN
  IF NOT public.spinx_is_admin() THEN
    RAISE EXCEPTION 'Only admins can waive payments';
  END IF;

  UPDATE public."MembershipPayment"
  SET status = 'WAIVED'::"PaymentStatus",
      "confirmedById" = auth.uid()::text,
      "manualOverride" = true,
      notes = p_notes,
      "updatedAt" = now()
  WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  PERFORM public.spinx_audit('WAIVE_PAYMENT', 'MembershipPayment', v_payment.id);
  RETURN v_payment;
END;
$$;

INSERT INTO public."AppSetting" (key, value)
VALUES ('noShowThreshold', '3'::jsonb), ('paymentGraceDays', '3'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecurringClassRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClassSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Booking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MembershipPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "User" FROM anon, authenticated;
REVOKE ALL ON "RecurringClassRule" FROM anon, authenticated;
REVOKE ALL ON "ClassSession" FROM anon, authenticated;
REVOKE ALL ON "Booking" FROM anon, authenticated;
REVOKE ALL ON "Attendance" FROM anon, authenticated;
REVOKE ALL ON "MembershipPayment" FROM anon, authenticated;
REVOKE ALL ON "Notification" FROM anon, authenticated;
REVOKE ALL ON "PushToken" FROM anon, authenticated;
REVOKE ALL ON "AppSetting" FROM anon, authenticated;
REVOKE ALL ON "AuditLog" FROM anon, authenticated;

GRANT SELECT ON "User", "RecurringClassRule", "ClassSession", "Booking", "Attendance",
  "MembershipPayment", "Notification", "AppSetting", "AuditLog" TO authenticated;
GRANT INSERT, UPDATE ON "PushToken" TO authenticated;
GRANT UPDATE ("readAt") ON "Notification" TO authenticated;

DROP POLICY IF EXISTS "users_select_self_staff" ON "User";
CREATE POLICY "users_select_self_staff" ON "User"
FOR SELECT TO authenticated
USING (id = auth.uid()::text OR public.spinx_is_staff());

DROP POLICY IF EXISTS "classes_select_authenticated" ON "ClassSession";
CREATE POLICY "classes_select_authenticated" ON "ClassSession"
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "recurring_select_staff" ON "RecurringClassRule";
CREATE POLICY "recurring_select_staff" ON "RecurringClassRule"
FOR SELECT TO authenticated
USING (public.spinx_is_staff());

DROP POLICY IF EXISTS "bookings_select_authenticated" ON "Booking";
CREATE POLICY "bookings_select_authenticated" ON "Booking"
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "attendance_select_related" ON "Attendance";
CREATE POLICY "attendance_select_related" ON "Attendance"
FOR SELECT TO authenticated
USING (
  public.spinx_is_staff()
  OR EXISTS (
    SELECT 1 FROM "Booking" b
    WHERE b.id = "Attendance"."bookingId"
      AND b."userId" = auth.uid()::text
  )
);

DROP POLICY IF EXISTS "payments_select_self_admin" ON "MembershipPayment";
CREATE POLICY "payments_select_self_admin" ON "MembershipPayment"
FOR SELECT TO authenticated
USING ("userId" = auth.uid()::text OR public.spinx_is_admin());

DROP POLICY IF EXISTS "notifications_select_self" ON "Notification";
CREATE POLICY "notifications_select_self" ON "Notification"
FOR SELECT TO authenticated
USING ("userId" = auth.uid()::text);

DROP POLICY IF EXISTS "notifications_mark_self_read" ON "Notification";
CREATE POLICY "notifications_mark_self_read" ON "Notification"
FOR UPDATE TO authenticated
USING ("userId" = auth.uid()::text)
WITH CHECK ("userId" = auth.uid()::text);

DROP POLICY IF EXISTS "push_tokens_self" ON "PushToken";
CREATE POLICY "push_tokens_self" ON "PushToken"
FOR ALL TO authenticated
USING ("userId" = auth.uid()::text)
WITH CHECK ("userId" = auth.uid()::text);

DROP POLICY IF EXISTS "settings_select_admin" ON "AppSetting";
CREATE POLICY "settings_select_admin" ON "AppSetting"
FOR SELECT TO authenticated
USING (public.spinx_is_admin());

DROP POLICY IF EXISTS "audit_select_admin" ON "AuditLog";
CREATE POLICY "audit_select_admin" ON "AuditLog"
FOR SELECT TO authenticated
USING (public.spinx_is_admin());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signatures', 'signatures', false, 1500000, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 1500000,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg'];

DROP POLICY IF EXISTS "anon_upload_pending_signatures" ON storage.objects;
CREATE POLICY "anon_upload_pending_signatures" ON storage.objects
FOR INSERT TO anon
WITH CHECK (bucket_id = 'signatures' AND name LIKE 'pending/%');

DROP POLICY IF EXISTS "staff_read_signatures" ON storage.objects;
CREATE POLICY "staff_read_signatures" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'signatures' AND public.spinx_is_staff());

GRANT EXECUTE ON FUNCTION public.spinx_ensure_current_payment(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinx_has_booking_rights(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinx_approve_member(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinx_decline_member(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinx_update_member_status(text, "MemberStatus", boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinx_reset_no_shows(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinx_create_class(text, text, text, timestamp, timestamp, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinx_create_recurring_classes(text, text, text, integer, text, integer, timestamp, timestamp) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinx_cancel_class(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinx_create_booking(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinx_cancel_booking(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinx_save_attendance(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinx_generate_monthly_payments(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinx_confirm_payment(text, timestamp, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinx_waive_payment(text, text) TO authenticated;
