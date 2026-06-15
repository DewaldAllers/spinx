import type { AttendanceStatus, MemberStatus } from '@spinx/shared';
import type { Booking, ClassSession, DashboardData, NotificationItem, Payment, User } from '../types';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

type RequestBody = Record<string, unknown>;

const activeBookingStatuses = ['BOOKED', 'PROMOTED'];
const liveBookingStatuses = ['BOOKED', 'PROMOTED', 'WAITLISTED'];

function raise(message: string, code?: string): never {
  throw new ApiError(message, 400, code);
}

function unwrap<T>(result: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (result.error) {
    throw new ApiError(result.error.message, 400, result.error.code);
  }
  return result.data as T;
}

function parseBody(init: RequestInit): RequestBody {
  if (!init.body || typeof init.body !== 'string') {
    return {};
  }
  return JSON.parse(init.body) as RequestBody;
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function firstDayOfMonth(month: string) {
  return `${month}-01T00:00:00.000Z`;
}

async function currentAuthId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new ApiError('Please sign in again.', 401, 'UNAUTHENTICATED');
  }
  return data.user.id;
}

export async function getToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function setToken(_token: string | null) {
  // Kept for compatibility with the old API-backed auth layer.
}

async function getMyProfile() {
  const userId = await currentAuthId();
  const user = unwrap(
    await supabase.from('User').select('*').eq('id', userId).is('deletedAt', null).single<User>(),
  );
  const bookingRights = unwrap(await supabase.rpc('spinx_has_booking_rights', { p_user_id: user.id }));
  return { user, bookingRights: Boolean(bookingRights) };
}

async function uploadSignature(signatureDataUrl: string) {
  const match = /^data:(image\/(?:png|jpeg|jpg));base64,/i.exec(signatureDataUrl);
  if (!match) {
    raise('Signature must be saved before registration.');
  }

  const mimeType = match[1] ?? 'image/png';
  const contentType = mimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mimeType.toLowerCase();
  const extension = contentType === 'image/png' ? 'png' : 'jpg';
  const key = `pending/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const blob = await (await fetch(signatureDataUrl)).blob();
  const { error } = await supabase.storage.from('signatures').upload(key, blob, {
    contentType,
    upsert: false,
  });
  if (error) {
    throw new ApiError(error.message, 400, error.name);
  }
  return key;
}

export async function registerMember(input: {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  emergencyContact: string;
  password: string;
  acceptedAgreementVersion: string;
  signatureDataUrl: string;
}) {
  const now = new Date().toISOString();
  const signatureAssetKey = await uploadSignature(input.signatureDataUrl);
  const { error } = await supabase.auth.signUp({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    options: {
      data: {
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        mobile: input.mobile.trim(),
        emergencyContact: input.emergencyContact.trim(),
        acceptedAgreementVersion: input.acceptedAgreementVersion,
        agreementAcceptedAt: now,
        signatureAssetKey,
        signatureSignedAt: now,
        status: 'PENDING_APPROVAL',
        role: 'MEMBER',
      },
    },
  });
  if (error) {
    throw new ApiError(error.message, 400, error.name);
  }

  await supabase.auth.signOut();
  return {};
}

async function registerPushToken(body: RequestBody) {
  const userId = await currentAuthId();
  const token = String(body.token ?? '');
  const platform = String(body.platform ?? '');
  if (!token || !platform) {
    raise('Token and platform are required');
  }
  return unwrap(
    await supabase
      .from('PushToken')
      .upsert({ token, platform, userId }, { onConflict: 'token' })
      .select()
      .single(),
  );
}

async function getClasses(from: string, to: string): Promise<ClassSession[]> {
  const userId = await currentAuthId();
  const profile = unwrap(await supabase.from('User').select('role').eq('id', userId).single<{ role: User['role'] }>());
  let query = supabase
    .from('ClassSession')
    .select('*')
    .gte('startsAt', from)
    .lte('startsAt', to)
    .order('startsAt', { ascending: true });

  if (profile.role === 'INSTRUCTOR') {
    query = query.or(`instructorId.is.null,instructorId.eq.${userId}`);
  }

  const sessions = unwrap(await query) as ClassSession[];
  if (sessions.length === 0) {
    return [];
  }

  const classIds = sessions.map((session) => session.id);
  const bookings = unwrap(await supabase.from('Booking').select('*').in('classSessionId', classIds)) as Booking[];

  return sessions.map((session) => {
    const sessionBookings = bookings.filter((booking) => booking.classSessionId === session.id);
    const active = sessionBookings.filter((booking) => activeBookingStatuses.includes(booking.status));
    const waitlist = sessionBookings.filter((booking) => booking.status === 'WAITLISTED');
    const occupied = new Set(active.map((booking) => booking.bikeNumber).filter(Boolean));
    return {
      ...session,
      bookedCount: active.length,
      waitlistCount: waitlist.length,
      availableBikes: Array.from({ length: 9 }, (_, index) => index + 1).filter((bike) => !occupied.has(bike)),
      myBooking:
        sessionBookings.find((booking) => booking.userId === userId && liveBookingStatuses.includes(booking.status)) ??
        null,
    };
  });
}

async function createClass(body: RequestBody) {
  return unwrap(
    await supabase.rpc('spinx_create_class', {
      p_title: body.title,
      p_description: body.description ?? null,
      p_instructor_id: body.instructorId ?? null,
      p_starts_at: body.startsAt,
      p_ends_at: body.endsAt,
      p_capacity: body.capacity ?? 9,
    }),
  );
}

async function createRecurringClass(body: RequestBody) {
  return unwrap(
    await supabase.rpc('spinx_create_recurring_classes', {
      p_title: body.title,
      p_description: body.description ?? null,
      p_instructor_id: body.instructorId ?? null,
      p_day_of_week: body.dayOfWeek,
      p_start_time: body.startTime,
      p_duration_minutes: body.durationMinutes,
      p_effective_from: body.effectiveFrom,
      p_effective_until: body.effectiveUntil ?? null,
    }),
  );
}

async function createBooking(classId: string, body: RequestBody) {
  return unwrap(
    await supabase.rpc('spinx_create_booking', {
      p_class_session_id: classId,
      p_bike_number: body.bikeNumber ?? null,
    }),
  );
}

async function getMyBookings(): Promise<Booking[]> {
  const userId = await currentAuthId();
  const bookings = unwrap(
    await supabase.from('Booking').select('*').eq('userId', userId).order('createdAt', { ascending: false }).limit(100),
  ) as Booking[];

  if (bookings.length === 0) {
    return [];
  }

  const classIds = Array.from(new Set(bookings.map((booking) => booking.classSessionId)));
  const bookingIds = bookings.map((booking) => booking.id);
  const classes = unwrap(await supabase.from('ClassSession').select('*').in('id', classIds)) as ClassSession[];
  const attendance = unwrap(await supabase.from('Attendance').select('*').in('bookingId', bookingIds)) as Array<{
    id: string;
    bookingId: string;
    status: AttendanceStatus;
    markedAt: string;
  }>;

  return bookings.map((booking) => ({
    ...booking,
    classSession: classes.find((session) => session.id === booking.classSessionId),
    attendance: attendance.find((entry) => entry.bookingId === booking.id) ?? null,
  }));
}

async function cancelBooking(id: string) {
  return unwrap(await supabase.rpc('spinx_cancel_booking', { p_booking_id: id }));
}

async function getAttendance(classId: string) {
  const bookings = unwrap(
    await supabase
      .from('Booking')
      .select('*')
      .eq('classSessionId', classId)
      .in('status', activeBookingStatuses)
      .order('bikeNumber', { ascending: true }),
  ) as Booking[];
  const capacity = 9;

  if (bookings.length === 0) {
    return { bookedCount: 0, capacity, entries: [] };
  }

  const userIds = Array.from(new Set(bookings.map((booking) => booking.userId)));
  const bookingIds = bookings.map((booking) => booking.id);
  const users = unwrap(await supabase.from('User').select('*').in('id', userIds)) as User[];
  const attendance = unwrap(await supabase.from('Attendance').select('*').in('bookingId', bookingIds)) as Array<{
    bookingId: string;
    status: AttendanceStatus;
  }>;

  return {
    bookedCount: bookings.length,
    capacity,
    entries: bookings.map((booking) => {
      const member = users.find((user) => user.id === booking.userId);
      return {
        bookingId: booking.id,
        memberName: member ? `${member.firstName} ${member.lastName}` : 'Member',
        bikeNumber: booking.bikeNumber ?? 0,
        status: attendance.find((entry) => entry.bookingId === booking.id)?.status ?? null,
      };
    }),
  };
}

async function saveAttendance(classId: string, body: RequestBody) {
  return unwrap(
    await supabase.rpc('spinx_save_attendance', {
      p_class_session_id: classId,
      p_entries: body.entries ?? [],
    }),
  );
}

async function getMembers(search?: string): Promise<User[]> {
  const users = unwrap(
    await supabase
      .from('User')
      .select('*')
      .in('role', ['MEMBER', 'INSTRUCTOR'])
      .is('deletedAt', null)
      .order('status', { ascending: true })
      .order('lastName', { ascending: true })
      .limit(200),
  ) as User[];

  if (!search?.trim()) {
    return users;
  }

  const needle = search.trim().toLowerCase();
  return users.filter((user) =>
    [user.firstName, user.lastName, user.email, user.mobile].some((value) => value.toLowerCase().includes(needle)),
  );
}

async function createMember(body: RequestBody) {
  const { data, error } = await supabase.functions.invoke('admin-create-user', {
    body,
  });
  if (error) {
    throw new ApiError(
      `${error.message}. Deploy the Supabase Edge Function "admin-create-user" before using manual member creation.`,
      400,
      error.name,
    );
  }
  return data;
}

async function getPayments(month: string) {
  const payments = unwrap(
    await supabase.from('MembershipPayment').select('*').eq('month', month).order('status', { ascending: true }),
  ) as Payment[];
  if (payments.length === 0) {
    return [];
  }

  const users = unwrap(
    await supabase.from('User').select('id, firstName, lastName, email').in(
      'id',
      Array.from(new Set(payments.map((payment) => payment.userId))),
    ),
  ) as Array<Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>>;

  return payments.map((payment) => ({
    ...payment,
    user: users.find((user) => user.id === payment.userId) ?? {
      firstName: 'Member',
      lastName: '',
      email: '',
    },
  }));
}

async function getMyPayments() {
  const userId = await currentAuthId();
  const current = unwrap(await supabase.rpc('spinx_ensure_current_payment', { p_user_id: userId })) as Payment;
  const payments = unwrap(
    await supabase
      .from('MembershipPayment')
      .select('*')
      .eq('userId', userId)
      .order('dueDate', { ascending: false })
      .limit(24),
  ) as Payment[];
  const bookingRights = unwrap(await supabase.rpc('spinx_has_booking_rights', { p_user_id: userId }));
  return { current, payments, bookingRights: Boolean(bookingRights) };
}

async function getDashboard(): Promise<DashboardData> {
  const now = new Date();
  const currentMonth = monthKey(now);
  const weekFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthFrom = firstDayOfMonth(currentMonth);
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

  const [
    totalMembers,
    activeMembers,
    inactiveMembers,
    pendingApprovalMembers,
    paidMembers,
    unpaidMembers,
    weeklyAttendance,
    monthlyAttendance,
    bookingCount,
    waitingListCount,
    noShowCount,
    upcomingClasses,
  ] = await Promise.all([
    supabase.from('User').select('id', { count: 'exact', head: true }).eq('role', 'MEMBER').is('deletedAt', null),
    supabase.from('User').select('id', { count: 'exact', head: true }).eq('role', 'MEMBER').eq('status', 'ACTIVE').is('deletedAt', null),
    supabase.from('User').select('id', { count: 'exact', head: true }).eq('role', 'MEMBER').eq('status', 'INACTIVE').is('deletedAt', null),
    supabase.from('User').select('id', { count: 'exact', head: true }).eq('role', 'MEMBER').eq('status', 'PENDING_APPROVAL').is('deletedAt', null),
    supabase.from('MembershipPayment').select('id', { count: 'exact', head: true }).eq('month', currentMonth).in('status', ['PAID', 'WAIVED']),
    supabase.from('MembershipPayment').select('id', { count: 'exact', head: true }).eq('month', currentMonth).in('status', ['PENDING', 'OVERDUE']),
    supabase.from('Attendance').select('id', { count: 'exact', head: true }).eq('status', 'PRESENT').gte('markedAt', weekFrom),
    supabase.from('Attendance').select('id', { count: 'exact', head: true }).eq('status', 'PRESENT').gte('markedAt', monthFrom).lt('markedAt', nextMonth),
    supabase.from('Booking').select('id', { count: 'exact', head: true }).gte('createdAt', monthFrom).lt('createdAt', nextMonth).in('status', activeBookingStatuses),
    supabase.from('Booking').select('id', { count: 'exact', head: true }).eq('status', 'WAITLISTED'),
    supabase.from('Attendance').select('id', { count: 'exact', head: true }).eq('status', 'ABSENT').gte('markedAt', monthFrom).lt('markedAt', nextMonth),
    supabase
      .from('ClassSession')
      .select('*')
      .gte('startsAt', now.toISOString())
      .eq('status', 'SCHEDULED')
      .order('startsAt', { ascending: true })
      .limit(8),
  ]);

  const upcoming = unwrap(upcomingClasses) as ClassSession[];
  const classIds = upcoming.map((session) => session.id);
  const instructorIds = upcoming.map((session) => session.instructorId).filter(Boolean) as string[];
  const [bookings, instructors] = await Promise.all([
    classIds.length
      ? supabase.from('Booking').select('*').in('classSessionId', classIds).in('status', activeBookingStatuses)
      : Promise.resolve({ data: [], error: null }),
    instructorIds.length
      ? supabase.from('User').select('id, firstName, lastName').in('id', instructorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const bookingRows = unwrap(bookings) as Booking[];
  const instructorRows = unwrap(instructors) as Array<Pick<User, 'id' | 'firstName' | 'lastName'>>;

  return {
    totals: {
      totalMembers: totalMembers.count ?? 0,
      activeMembers: activeMembers.count ?? 0,
      inactiveMembers: inactiveMembers.count ?? 0,
      pendingApprovalMembers: pendingApprovalMembers.count ?? 0,
      paidMembers: paidMembers.count ?? 0,
      unpaidMembers: unpaidMembers.count ?? 0,
      weeklyAttendance: weeklyAttendance.count ?? 0,
      monthlyAttendance: monthlyAttendance.count ?? 0,
      bookingCount: bookingCount.count ?? 0,
      waitingListCount: waitingListCount.count ?? 0,
      noShowCount: noShowCount.count ?? 0,
    },
    upcomingClasses: upcoming.map((session) => {
      const instructor = instructorRows.find((row) => row.id === session.instructorId);
      return {
        id: session.id,
        title: session.title,
        startsAt: session.startsAt,
        occupancy: bookingRows.filter((booking) => booking.classSessionId === session.id).length,
        capacity: session.capacity,
        instructor: instructor ? `${instructor.firstName} ${instructor.lastName}` : 'Unassigned',
      };
    }),
  };
}

async function getNotifications(): Promise<NotificationItem[]> {
  const userId = await currentAuthId();
  return unwrap(
    await supabase
      .from('Notification')
      .select('*')
      .eq('userId', userId)
      .order('createdAt', { ascending: false })
      .limit(100),
  ) as NotificationItem[];
}

async function markNotificationRead(id: string) {
  return unwrap(await supabase.from('Notification').update({ readAt: new Date().toISOString() }).eq('id', id).select().single());
}

export async function exportReportRows(type: string) {
  if (type === 'membership') {
    return getMembers();
  }
  if (type === 'payment') {
    return getPayments(monthKey());
  }
  if (type === 'booking' || type === 'waiting-list') {
    const query = supabase.from('Booking').select('*').order('createdAt', { ascending: false }).limit(500);
    if (type === 'waiting-list') {
      query.eq('status', 'WAITLISTED');
    }
    return unwrap(await query);
  }
  if (type === 'attendance' || type === 'no-show') {
    const query = supabase.from('Attendance').select('*').order('markedAt', { ascending: false }).limit(500);
    if (type === 'no-show') {
      query.eq('status', 'ABSENT');
    }
    return unwrap(await query);
  }
  return [];
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const url = new URL(path, 'https://spinx.local');
  const body = parseBody(init);
  const parts = url.pathname.split('/').filter(Boolean);

  if (url.pathname === '/auth/me') return (await getMyProfile()) as T;
  if (url.pathname === '/push-tokens' && method === 'POST') return (await registerPushToken(body)) as T;
  if (url.pathname === '/classes' && method === 'GET') return (await getClasses(url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '')) as T;
  if (url.pathname === '/classes' && method === 'POST') return (await createClass(body)) as T;
  if (url.pathname === '/classes/recurring' && method === 'POST') return (await createRecurringClass(body)) as T;
  if (url.pathname === '/bookings/me') return (await getMyBookings()) as T;
  if (url.pathname === '/members' && method === 'GET') return (await getMembers(url.searchParams.get('search') ?? undefined)) as T;
  if (url.pathname === '/members' && method === 'POST') return (await createMember(body)) as T;
  if (url.pathname === '/payments/me') return (await getMyPayments()) as T;
  if (url.pathname === '/payments' && method === 'GET') return (await getPayments(url.searchParams.get('month') ?? monthKey())) as T;
  if (url.pathname === '/payments/generate-monthly' && method === 'POST') {
    return unwrap(await supabase.rpc('spinx_generate_monthly_payments', { p_month: body.month })) as T;
  }
  if (url.pathname === '/admin/dashboard') return (await getDashboard()) as T;
  if (url.pathname === '/notifications') return (await getNotifications()) as T;

  if (parts[0] === 'classes' && parts[1] && parts[2] === 'bookings' && method === 'POST') {
    return (await createBooking(parts[1], body)) as T;
  }
  if (parts[0] === 'classes' && parts[1] && parts[2] === 'cancel' && method === 'POST') {
    return unwrap(await supabase.rpc('spinx_cancel_class', { p_class_session_id: parts[1] })) as T;
  }
  if (parts[0] === 'classes' && parts[1] && parts[2] === 'attendance' && method === 'GET') {
    return (await getAttendance(parts[1])) as T;
  }
  if (parts[0] === 'classes' && parts[1] && parts[2] === 'attendance' && method === 'POST') {
    return (await saveAttendance(parts[1], body)) as T;
  }
  if (parts[0] === 'bookings' && parts[1] && method === 'DELETE') {
    return (await cancelBooking(parts[1])) as T;
  }
  if (parts[0] === 'members' && parts[1] && parts[2] === 'approve' && method === 'POST') {
    return unwrap(await supabase.rpc('spinx_approve_member', { p_user_id: parts[1] })) as T;
  }
  if (parts[0] === 'members' && parts[1] && parts[2] === 'decline' && method === 'DELETE') {
    return unwrap(await supabase.rpc('spinx_decline_member', { p_user_id: parts[1] })) as T;
  }
  if (parts[0] === 'members' && parts[1] && parts[2] === 'status' && method === 'POST') {
    return unwrap(
      await supabase.rpc('spinx_update_member_status', {
        p_user_id: parts[1],
        p_status: body.status as MemberStatus,
        p_booking_blocked: body.bookingBlocked ?? null,
      }),
    ) as T;
  }
  if (parts[0] === 'members' && parts[1] && parts[2] === 'reset-no-shows' && method === 'POST') {
    return unwrap(await supabase.rpc('spinx_reset_no_shows', { p_user_id: parts[1] })) as T;
  }
  if (parts[0] === 'payments' && parts[1] && parts[2] === 'confirm' && method === 'POST') {
    return unwrap(
      await supabase.rpc('spinx_confirm_payment', {
        p_payment_id: parts[1],
        p_paid_at: body.paidAt ?? new Date().toISOString(),
        p_notes: body.notes ?? null,
      }),
    ) as T;
  }
  if (parts[0] === 'payments' && parts[1] && parts[2] === 'waive' && method === 'POST') {
    return unwrap(
      await supabase.rpc('spinx_waive_payment', {
        p_payment_id: parts[1],
        p_notes: body.notes ?? 'Admin override',
      }),
    ) as T;
  }
  if (parts[0] === 'notifications' && parts[1] && parts[2] === 'read' && method === 'POST') {
    return (await markNotificationRead(parts[1])) as T;
  }

  throw new ApiError(`Unsupported Supabase route: ${method} ${url.pathname}`, 404, 'NOT_FOUND');
}
