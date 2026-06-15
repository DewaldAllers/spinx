import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { Prisma, PrismaClient, type Role, type User } from '@prisma/client';
import {
  attendanceSchema,
  BIKE_COUNT,
  createBookingSchema,
  createClassSchema,
  createMemberSchema,
  loginSchema,
  paymentConfirmSchema,
  recurringClassSchema,
  registerSchema,
  settingsSchema,
  updateClassSchema,
  updateMemberSchema,
} from '@spinx/shared';
import { addDays, addMinutes, eachDayOfInterval, format, isBefore, parseISO } from 'date-fns';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError, type ZodSchema } from 'zod';
import { env } from './config/env.js';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from './lib/errors.js';
import { createOpaqueToken, hashPassword, hashToken, storeSignatureDataUrl, verifyPassword } from './lib/security.js';
import { firstDayOfMonth, isPastGracePeriod, monthKey, monthRange, parseDateParam } from './lib/time.js';
import { sendEmail } from './services/email.js';
import { notifyAdmins, notifyUser } from './services/notifications.js';
import { toCsv, toPdf, toXlsx, type ReportRow } from './services/reporting.js';

type AuthenticatedUser = User & { role: Role };

function parseBody<T>(schema: ZodSchema<T>, value: unknown): T {
  return schema.parse(value);
}

function serializeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    firstName: user.firstName,
    lastName: user.lastName,
    mobile: user.mobile,
    emergencyContact: user.emergencyContact,
    profilePhotoUrl: user.profilePhotoUrl,
    emailVerifiedAt: user.emailVerifiedAt,
    acceptedAgreementVersion: user.acceptedAgreementVersion,
    agreementAcceptedAt: user.agreementAcceptedAt,
    signatureSignedAt: user.signatureSignedAt,
    contractSignedOffline: user.contractSignedOffline,
    bookingBlocked: user.bookingBlocked,
    noShowCount: user.noShowCount,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function getUserFromRequest(request: FastifyRequest, allowedRoles?: Role[]) {
  try {
    await request.jwtVerify();
  } catch {
    throw unauthorized();
  }

  const user = await request.server.prisma.user.findFirst({
    where: { id: request.user.sub, deletedAt: null },
  });
  if (!user) {
    throw unauthorized('Account no longer exists');
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    throw forbidden();
  }
  return user as AuthenticatedUser;
}

async function audit(
  prisma: PrismaClient,
  actorId: string | null,
  action: string,
  entity: string,
  entityId?: string | null,
  metadata?: Record<string, unknown>,
) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      entity,
      entityId,
      metadata: (metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

async function getNumberSetting(prisma: PrismaClient, key: string, fallback: number) {
  const setting = await prisma.appSetting.findUnique({ where: { key } });
  return typeof setting?.value === 'number' ? setting.value : fallback;
}

async function ensureCurrentPayment(prisma: PrismaClient, userId: string) {
  const month = monthKey();
  return prisma.membershipPayment.upsert({
    where: { userId_month: { userId, month } },
    update: {},
    create: {
      userId,
      month,
      dueDate: firstDayOfMonth(),
      status: 'PENDING',
    },
  });
}

async function hasBookingRights(prisma: PrismaClient, user: User) {
  if (user.role !== 'MEMBER') {
    return true;
  }
  if (user.status !== 'ACTIVE' || user.bookingBlocked || !user.emailVerifiedAt) {
    return false;
  }

  const payment = await ensureCurrentPayment(prisma, user.id);
  if (payment.status === 'PAID' || payment.status === 'WAIVED') {
    return true;
  }

  const graceDays = await getNumberSetting(prisma, 'paymentGraceDays', 3);
  if (isPastGracePeriod(payment.dueDate, graceDays)) {
    await prisma.membershipPayment.update({
      where: { id: payment.id },
      data: { status: 'OVERDUE' },
    });
    return false;
  }
  return true;
}

function selectedDateRange(query: unknown) {
  const q = query as { from?: string; to?: string } | undefined;
  const now = new Date();
  const month = monthRange(now);
  return {
    from: parseDateParam(q?.from, month.from),
    to: parseDateParam(q?.to, month.to),
  };
}

async function promoteWaitlistedMember(prisma: PrismaClient, classSessionId: string, bikeNumber: number) {
  const next = await prisma.booking.findFirst({
    where: { classSessionId, status: 'WAITLISTED' },
    orderBy: [{ waitlistRank: 'asc' }, { createdAt: 'asc' }],
    include: { user: true, classSession: true },
  });

  if (!next) {
    return null;
  }

  const promoted = await prisma.booking.update({
    where: { id: next.id },
    data: {
      status: 'PROMOTED',
      bikeNumber,
      promotedAt: new Date(),
      waitlistRank: null,
    },
    include: { user: true, classSession: true },
  });

  await notifyUser(prisma, {
    userId: promoted.userId,
    type: 'WAITLIST_PROMOTED',
    title: 'Bike assigned',
    body: `You have been moved from the waiting list to Bike ${bikeNumber}.`,
    data: { classSessionId, bookingId: promoted.id, bikeNumber },
  });

  return promoted;
}

function assertInstructorCanManageClass(user: User, classSession: { instructorId: string | null }) {
  if (user.role === 'ADMIN') {
    return;
  }
  if (user.role === 'INSTRUCTOR' && (!classSession.instructorId || classSession.instructorId === user.id)) {
    return;
  }
  throw forbidden('Only the assigned instructor or an admin can manage this class');
}

async function rowsForReport(prisma: PrismaClient, type: string, from: Date, to: Date): Promise<ReportRow[]> {
  if (type === 'membership') {
    const users = await prisma.user.findMany({
      where: { role: { in: ['MEMBER', 'INSTRUCTOR'] }, deletedAt: null },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return users.map((user) => ({
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      role: user.role,
      status: user.status,
      mobile: user.mobile,
      noShowCount: user.noShowCount,
      bookingBlocked: user.bookingBlocked,
      createdAt: user.createdAt,
    }));
  }

  if (type === 'payment') {
    const payments = await prisma.membershipPayment.findMany({
      where: { dueDate: { gte: from, lte: to } },
      include: { user: true, confirmedBy: true },
      orderBy: [{ dueDate: 'desc' }, { user: { lastName: 'asc' } }],
    });
    return payments.map((payment) => ({
      member: `${payment.user.firstName} ${payment.user.lastName}`,
      email: payment.user.email,
      month: payment.month,
      status: payment.status,
      dueDate: payment.dueDate,
      paidAt: payment.paidAt,
      confirmedBy: payment.confirmedBy
        ? `${payment.confirmedBy.firstName} ${payment.confirmedBy.lastName}`
        : '',
      notes: payment.notes ?? '',
    }));
  }

  if (type === 'attendance' || type === 'no-show') {
    const attendance = await prisma.attendance.findMany({
      where: {
        booking: { classSession: { startsAt: { gte: from, lte: to } } },
        ...(type === 'no-show' ? { status: 'ABSENT' } : {}),
      },
      include: { booking: { include: { user: true, classSession: true } }, markedBy: true },
      orderBy: { markedAt: 'desc' },
    });
    return attendance.map((entry) => ({
      member: `${entry.booking.user.firstName} ${entry.booking.user.lastName}`,
      email: entry.booking.user.email,
      class: entry.booking.classSession.title,
      classStart: entry.booking.classSession.startsAt,
      bikeNumber: entry.booking.bikeNumber ?? '',
      status: entry.status,
      markedAt: entry.markedAt,
      markedBy: `${entry.markedBy.firstName} ${entry.markedBy.lastName}`,
    }));
  }

  const status = type === 'waiting-list' ? 'WAITLISTED' : undefined;
  const bookings = await prisma.booking.findMany({
    where: {
      classSession: { startsAt: { gte: from, lte: to } },
      ...(status ? { status } : {}),
    },
    include: { user: true, classSession: true },
    orderBy: { createdAt: 'desc' },
  });
  return bookings.map((booking) => ({
    member: `${booking.user.firstName} ${booking.user.lastName}`,
    email: booking.user.email,
    class: booking.classSession.title,
    classStart: booking.classSession.startsAt,
    bikeNumber: booking.bikeNumber ?? '',
    status: booking.status,
    waitlistRank: booking.waitlistRank ?? '',
    createdAt: booking.createdAt,
    cancelledAt: booking.cancelledAt,
  }));
}

export function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });
  const prisma = new PrismaClient();

  app.decorate('prisma', prisma);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details: error.flatten() },
      });
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected server error' },
    });
  });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  app.register(helmet);
  app.register(cors, {
    origin: true,
    credentials: true,
  });
  app.register(rateLimit, {
    max: 240,
    timeWindow: '1 minute',
  });
  app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: '12h' },
  });

  app.get('/health', async () => ({ data: { ok: true, service: 'spinx-api' } }));

  app.post('/auth/register', async (request, reply) => {
    const input = parseBody(registerSchema, request.body);
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw conflict('An account with this email already exists');
    }

    const verificationToken = createOpaqueToken();
    const passwordHash = await hashPassword(input.password);
    const now = new Date();

    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        mobile: input.mobile,
        emergencyContact: input.emergencyContact,
        role: 'MEMBER',
        status: 'PENDING_APPROVAL',
        emailVerificationTokenHash: hashToken(verificationToken),
        acceptedAgreementVersion: input.acceptedAgreementVersion,
        agreementAcceptedAt: now,
        signatureSignedAt: now,
      },
    });

    const signatureAssetKey = await storeSignatureDataUrl(user.id, input.signatureDataUrl);
    await prisma.user.update({ where: { id: user.id }, data: { signatureAssetKey } });

    await notifyAdmins(prisma, {
      type: 'ADMIN_REGISTRATION_PENDING',
      title: 'New member awaiting approval',
      body: `${user.firstName} ${user.lastName} completed registration.`,
      data: { userId: user.id },
    });

    await sendEmail({
      to: user.email,
      subject: 'Verify your SpinX email',
      text: `Use this verification link: ${env.PUBLIC_API_URL}/auth/verify-email?token=${verificationToken}`,
    });

    await audit(prisma, user.id, 'REGISTER_SELF', 'User', user.id);

    return reply.status(201).send({
      data: {
        user: serializeUser({ ...user, signatureAssetKey }),
        verificationToken: env.NODE_ENV === 'production' ? undefined : verificationToken,
      },
    });
  });

  app.post('/auth/login', async (request) => {
    const input = parseBody(loginSchema, request.body);
    const user = await prisma.user.findFirst({ where: { email: input.email, deletedAt: null } });
    if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
      throw unauthorized('Invalid email or password');
    }

    const token = app.jwt.sign({ sub: user.id, role: user.role, status: user.status });
    return { data: { token, user: serializeUser(user) } };
  });

  app.get('/auth/verify-email', async (request, reply) => {
    const token = (request.query as { token?: string }).token;
    if (!token) {
      throw badRequest('Verification token is required');
    }
    const tokenHash = hashToken(token);
    const user = await prisma.user.findFirst({ where: { emailVerificationTokenHash: tokenHash } });
    if (!user) {
      throw notFound('Verification token is invalid or expired');
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), emailVerificationTokenHash: null },
    });
    await audit(prisma, updated.id, 'VERIFY_EMAIL', 'User', updated.id);
    return reply.send({ data: { user: serializeUser(updated) } });
  });

  app.get('/auth/me', async (request) => {
    const user = await getUserFromRequest(request);
    const bookingRights = await hasBookingRights(prisma, user);
    return { data: { user: serializeUser(user), bookingRights } };
  });

  app.get('/admin/dashboard', async (request) => {
    await getUserFromRequest(request, ['ADMIN']);
    const now = new Date();
    const weekFrom = addDays(now, -7);
    const month = monthRange(now);

    const [
      totalMembers,
      activeMembers,
      inactiveMembers,
      pendingApprovalMembers,
      paidMembers,
      unpaidMembers,
      upcomingClasses,
      weeklyAttendance,
      monthlyAttendance,
      waitingListCount,
      noShowCount,
      bookingCount,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'MEMBER', deletedAt: null } }),
      prisma.user.count({ where: { role: 'MEMBER', status: 'ACTIVE', deletedAt: null } }),
      prisma.user.count({ where: { role: 'MEMBER', status: 'INACTIVE', deletedAt: null } }),
      prisma.user.count({ where: { role: 'MEMBER', status: 'PENDING_APPROVAL', deletedAt: null } }),
      prisma.membershipPayment.count({ where: { month: monthKey(), status: { in: ['PAID', 'WAIVED'] } } }),
      prisma.membershipPayment.count({ where: { month: monthKey(), status: { in: ['PENDING', 'OVERDUE'] } } }),
      prisma.classSession.findMany({
        where: { startsAt: { gte: now }, status: 'SCHEDULED' },
        take: 8,
        orderBy: { startsAt: 'asc' },
        include: { bookings: true, instructor: true },
      }),
      prisma.attendance.count({
        where: { status: 'PRESENT', booking: { classSession: { startsAt: { gte: weekFrom, lte: now } } } },
      }),
      prisma.attendance.count({
        where: { status: 'PRESENT', booking: { classSession: { startsAt: { gte: month.from, lte: month.to } } } },
      }),
      prisma.booking.count({ where: { status: 'WAITLISTED' } }),
      prisma.attendance.count({
        where: { status: 'ABSENT', booking: { classSession: { startsAt: { gte: month.from, lte: month.to } } } },
      }),
      prisma.booking.count({ where: { createdAt: { gte: month.from, lte: month.to }, status: { in: ['BOOKED', 'PROMOTED'] } } }),
    ]);

    return {
      data: {
        totals: {
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
        },
        upcomingClasses: upcomingClasses.map((session) => ({
          id: session.id,
          title: session.title,
          startsAt: session.startsAt,
          occupancy: session.bookings.filter((booking) => ['BOOKED', 'PROMOTED'].includes(booking.status)).length,
          capacity: session.capacity,
          instructor: session.instructor
            ? `${session.instructor.firstName} ${session.instructor.lastName}`
            : 'Unassigned',
        })),
      },
    };
  });

  app.get('/members', async (request) => {
    await getUserFromRequest(request, ['ADMIN']);
    const query = request.query as { status?: string; search?: string };
    const search = query.search?.trim();
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        role: { in: ['MEMBER', 'INSTRUCTOR'] },
        ...(query.status ? { status: query.status as never } : {}),
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { mobile: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ status: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
      take: 200,
    });
    return { data: users.map(serializeUser) };
  });

  app.post('/members', async (request, reply) => {
    const actor = await getUserFromRequest(request, ['ADMIN']);
    const input = parseBody(createMemberSchema, request.body);
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw conflict('A member with this email already exists');
    }

    const temporaryPassword = createOpaqueToken().slice(0, 14);
    const now = new Date();
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash: await hashPassword(temporaryPassword),
        role: input.role,
        status: input.status,
        firstName: input.firstName,
        lastName: input.lastName,
        mobile: input.mobile,
        emergencyContact: input.emergencyContact,
        emailVerifiedAt: now,
        acceptedAgreementVersion: input.contractSignedOffline ? 'offline-v1' : null,
        agreementAcceptedAt: input.contractSignedOffline ? now : null,
        signatureSignedAt: input.contractSignedOffline ? now : null,
        contractSignedOffline: input.contractSignedOffline,
      },
    });

    await audit(prisma, actor.id, 'CREATE_MEMBER', 'User', user.id);
    await sendEmail({
      to: user.email,
      subject: 'Your SpinX account',
      text: `Your SpinX account has been created. Temporary password: ${temporaryPassword}`,
    });

    return reply.status(201).send({
      data: {
        user: serializeUser(user),
        temporaryPassword: env.NODE_ENV === 'production' ? undefined : temporaryPassword,
      },
    });
  });

  app.get('/members/:id', async (request) => {
    await getUserFromRequest(request, ['ADMIN']);
    const id = (request.params as { id: string }).id;
    const user = await prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        payments: { orderBy: { dueDate: 'desc' }, take: 12 },
        bookings: { include: { classSession: true, attendance: true }, orderBy: { createdAt: 'desc' }, take: 25 },
      },
    });
    if (!user) {
      throw notFound('Member not found');
    }
    return { data: { user: serializeUser(user), payments: user.payments, bookings: user.bookings } };
  });

  app.patch('/members/:id', async (request) => {
    const actor = await getUserFromRequest(request, ['ADMIN']);
    const id = (request.params as { id: string }).id;
    const input = parseBody(updateMemberSchema, request.body);
    const user = await prisma.user.update({
      where: { id },
      data: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        mobile: input.mobile,
        emergencyContact: input.emergencyContact,
        profilePhotoUrl: input.profilePhotoUrl,
        role: input.role,
        status: input.status,
        bookingBlocked: input.bookingBlocked,
      },
    });
    await audit(prisma, actor.id, 'UPDATE_MEMBER', 'User', user.id);
    return { data: { user: serializeUser(user) } };
  });

  app.post('/members/:id/approve', async (request) => {
    const actor = await getUserFromRequest(request, ['ADMIN']);
    const id = (request.params as { id: string }).id;
    const pending = await prisma.user.findFirst({ where: { id, status: 'PENDING_APPROVAL', deletedAt: null } });
    if (!pending) {
      throw notFound('Pending registration not found');
    }
    if (!pending.emailVerifiedAt) {
      throw conflict('Member must verify email before approval');
    }
    const user = await prisma.user.update({ where: { id }, data: { status: 'ACTIVE' } });
    await ensureCurrentPayment(prisma, user.id);
    await notifyUser(prisma, {
      userId: user.id,
      type: 'REGISTRATION_APPROVED',
      title: 'Registration approved',
      body: 'Your SpinX account is active.',
      data: { userId: user.id },
    });
    await audit(prisma, actor.id, 'APPROVE_MEMBER', 'User', user.id);
    return { data: { user: serializeUser(user) } };
  });

  app.delete('/members/:id/decline', async (request) => {
    const actor = await getUserFromRequest(request, ['ADMIN']);
    const id = (request.params as { id: string }).id;
    const pending = await prisma.user.findFirst({ where: { id, status: 'PENDING_APPROVAL' } });
    if (!pending) {
      throw notFound('Pending registration not found');
    }
    await prisma.user.delete({ where: { id } });
    await audit(prisma, actor.id, 'DECLINE_MEMBER_DELETE', 'User', id);
    return { data: { deleted: true } };
  });

  app.post('/members/:id/status', async (request) => {
    const actor = await getUserFromRequest(request, ['ADMIN']);
    const id = (request.params as { id: string }).id;
    const body = request.body as { status?: string; bookingBlocked?: boolean };
    if (!['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_APPROVAL'].includes(body.status ?? '')) {
      throw badRequest('Valid status is required');
    }
    const user = await prisma.user.update({
      where: { id },
      data: { status: body.status as never, bookingBlocked: body.bookingBlocked },
    });
    await audit(prisma, actor.id, 'CHANGE_MEMBER_STATUS', 'User', user.id, {
      status: body.status,
      bookingBlocked: body.bookingBlocked,
    });
    return { data: { user: serializeUser(user) } };
  });

  app.get('/payments/me', async (request) => {
    const user = await getUserFromRequest(request);
    const current = await ensureCurrentPayment(prisma, user.id);
    const payments = await prisma.membershipPayment.findMany({
      where: { userId: user.id },
      orderBy: { dueDate: 'desc' },
      take: 24,
    });
    const bookingRights = await hasBookingRights(prisma, user);
    return { data: { current, payments, bookingRights } };
  });

  app.get('/payments', async (request) => {
    await getUserFromRequest(request, ['ADMIN']);
    const query = request.query as { month?: string; status?: string };
    const month = query.month ?? monthKey();
    const payments = await prisma.membershipPayment.findMany({
      where: { month, ...(query.status ? { status: query.status as never } : {}) },
      include: { user: true, confirmedBy: true },
      orderBy: [{ status: 'asc' }, { user: { lastName: 'asc' } }],
    });
    return { data: payments };
  });

  app.post('/payments/generate-monthly', async (request) => {
    const actor = await getUserFromRequest(request, ['ADMIN']);
    const body = request.body as { month?: string };
    const base = body.month ? parseISO(`${body.month}-01T00:00:00.000Z`) : new Date();
    const month = monthKey(base);
    const dueDate = firstDayOfMonth(base);
    const members = await prisma.user.findMany({
      where: { role: 'MEMBER', status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });

    await Promise.all(
      members.map((member) =>
        prisma.membershipPayment.upsert({
          where: { userId_month: { userId: member.id, month } },
          update: {},
          create: { userId: member.id, month, dueDate, status: 'PENDING' },
        }),
      ),
    );
    await audit(prisma, actor.id, 'GENERATE_MONTHLY_PAYMENTS', 'MembershipPayment', month);
    return { data: { month, createdOrExisting: members.length } };
  });

  app.post('/payments/:id/confirm', async (request) => {
    const actor = await getUserFromRequest(request, ['ADMIN']);
    const id = (request.params as { id: string }).id;
    const input = parseBody(paymentConfirmSchema, request.body);
    const payment = await prisma.membershipPayment.update({
      where: { id },
      data: {
        status: 'PAID',
        paidAt: input.paidAt ? parseISO(input.paidAt) : new Date(),
        confirmedById: actor.id,
        manualOverride: true,
        notes: input.notes,
      },
      include: { user: true },
    });
    await audit(prisma, actor.id, 'CONFIRM_PAYMENT', 'MembershipPayment', payment.id);
    await notifyUser(prisma, {
      userId: payment.userId,
      type: 'PAYMENT_CONFIRMED',
      title: 'Payment confirmed',
      body: `Your ${payment.month} membership payment has been confirmed.`,
      data: { paymentId: payment.id },
    });
    return { data: payment };
  });

  app.post('/payments/:id/waive', async (request) => {
    const actor = await getUserFromRequest(request, ['ADMIN']);
    const id = (request.params as { id: string }).id;
    const body = request.body as { notes?: string };
    const payment = await prisma.membershipPayment.update({
      where: { id },
      data: { status: 'WAIVED', confirmedById: actor.id, manualOverride: true, notes: body.notes },
    });
    await audit(prisma, actor.id, 'WAIVE_PAYMENT', 'MembershipPayment', payment.id);
    return { data: payment };
  });

  app.get('/classes', async (request) => {
    const user = await getUserFromRequest(request);
    const { from, to } = selectedDateRange(request.query);
    const sessions = await prisma.classSession.findMany({
      where: {
        startsAt: { gte: from, lte: to },
        ...(user.role === 'INSTRUCTOR' ? { OR: [{ instructorId: user.id }, { instructorId: null }] } : {}),
      },
      include: {
        instructor: true,
        bookings: { include: { user: true } },
      },
      orderBy: { startsAt: 'asc' },
    });

    return {
      data: sessions.map((session) => {
        const activeBookings = session.bookings.filter((booking) =>
          ['BOOKED', 'PROMOTED'].includes(booking.status),
        );
        const waitlist = session.bookings.filter((booking) => booking.status === 'WAITLISTED');
        return {
          ...session,
          bookedCount: activeBookings.length,
          waitlistCount: waitlist.length,
          availableBikes: Array.from({ length: BIKE_COUNT }, (_, index) => index + 1).filter(
            (bike) => !activeBookings.some((booking) => booking.bikeNumber === bike),
          ),
          myBooking: session.bookings.find(
            (booking) => booking.userId === user.id && ['BOOKED', 'PROMOTED', 'WAITLISTED'].includes(booking.status),
          ),
        };
      }),
    };
  });

  app.get('/classes/:id', async (request) => {
    const user = await getUserFromRequest(request);
    const id = (request.params as { id: string }).id;
    const session = await prisma.classSession.findUnique({
      where: { id },
      include: { instructor: true, bookings: { include: { user: true, attendance: true } } },
    });
    if (!session) {
      throw notFound('Class not found');
    }
    if (user.role === 'INSTRUCTOR' && session.instructorId && session.instructorId !== user.id) {
      throw forbidden();
    }
    return { data: session };
  });

  app.post('/classes', async (request, reply) => {
    const actor = await getUserFromRequest(request, ['ADMIN', 'INSTRUCTOR']);
    const input = parseBody(createClassSchema, request.body);
    const startsAt = parseISO(input.startsAt);
    const endsAt = parseISO(input.endsAt);
    if (!isBefore(startsAt, endsAt)) {
      throw badRequest('Class start must be before end');
    }
    const session = await prisma.classSession.create({
      data: {
        title: input.title,
        description: input.description,
        instructorId: actor.role === 'INSTRUCTOR' ? actor.id : input.instructorId,
        creatorId: actor.id,
        startsAt,
        endsAt,
        capacity: input.capacity,
      },
    });
    await audit(prisma, actor.id, 'CREATE_CLASS', 'ClassSession', session.id);
    return reply.status(201).send({ data: session });
  });

  app.post('/classes/recurring', async (request, reply) => {
    const actor = await getUserFromRequest(request, ['ADMIN', 'INSTRUCTOR']);
    const input = parseBody(recurringClassSchema, request.body);
    const rule = await prisma.recurringClassRule.create({
      data: {
        title: input.title,
        description: input.description,
        instructorId: actor.role === 'INSTRUCTOR' ? actor.id : input.instructorId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        durationMinutes: input.durationMinutes,
        effectiveFrom: parseISO(input.effectiveFrom),
        effectiveUntil: input.effectiveUntil ? parseISO(input.effectiveUntil) : addDays(new Date(), 90),
      },
    });

    const until = rule.effectiveUntil ?? addDays(rule.effectiveFrom, 90);
    const [hour, minute] = rule.startTime.split(':').map(Number);
    const days = eachDayOfInterval({ start: rule.effectiveFrom, end: until }).filter(
      (day) => day.getDay() === rule.dayOfWeek,
    );
    const sessions = await Promise.all(
      days.map((day) => {
        const startsAt = new Date(day);
        startsAt.setHours(hour ?? 0, minute ?? 0, 0, 0);
        return prisma.classSession.create({
          data: {
            title: rule.title,
            description: rule.description,
            instructorId: rule.instructorId,
            creatorId: actor.id,
            startsAt,
            endsAt: addMinutes(startsAt, rule.durationMinutes),
            capacity: BIKE_COUNT,
            recurringId: rule.id,
          },
        });
      }),
    );
    await audit(prisma, actor.id, 'CREATE_RECURRING_CLASS', 'RecurringClassRule', rule.id, {
      generatedSessions: sessions.length,
    });
    return reply.status(201).send({ data: { rule, generatedSessions: sessions.length } });
  });

  app.patch('/classes/:id', async (request) => {
    const actor = await getUserFromRequest(request, ['ADMIN', 'INSTRUCTOR']);
    const id = (request.params as { id: string }).id;
    const existing = await prisma.classSession.findUnique({ where: { id } });
    if (!existing) {
      throw notFound('Class not found');
    }
    assertInstructorCanManageClass(actor, existing);
    const input = parseBody(updateClassSchema, request.body);
    const startsAt = input.startsAt ? parseISO(input.startsAt) : undefined;
    const endsAt = input.endsAt ? parseISO(input.endsAt) : undefined;
    const session = await prisma.classSession.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        instructorId: actor.role === 'ADMIN' ? input.instructorId : undefined,
        startsAt,
        endsAt,
        capacity: input.capacity,
        status: input.status,
      },
    });
    await audit(prisma, actor.id, 'UPDATE_CLASS', 'ClassSession', session.id);
    return { data: session };
  });

  app.post('/classes/:id/cancel', async (request) => {
    const actor = await getUserFromRequest(request, ['ADMIN', 'INSTRUCTOR']);
    const id = (request.params as { id: string }).id;
    const existing = await prisma.classSession.findUnique({ where: { id } });
    if (!existing) {
      throw notFound('Class not found');
    }
    assertInstructorCanManageClass(actor, existing);
    const session = await prisma.classSession.update({ where: { id }, data: { status: 'CANCELLED' } });
    await prisma.booking.updateMany({
      where: { classSessionId: id, status: { in: ['BOOKED', 'PROMOTED', 'WAITLISTED'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await audit(prisma, actor.id, 'CANCEL_CLASS', 'ClassSession', session.id);
    return { data: session };
  });

  app.post('/classes/:id/bookings', async (request, reply) => {
    const user = await getUserFromRequest(request, ['MEMBER']);
    const id = (request.params as { id: string }).id;
    const input = parseBody(createBookingSchema, request.body);
    if (!(await hasBookingRights(prisma, user))) {
      throw forbidden('Booking is disabled until your account and current payment are active');
    }

    const booking = await prisma.$transaction(
      async (tx) => {
        const session = await tx.classSession.findUnique({ where: { id }, include: { bookings: true } });
        if (!session || session.status !== 'SCHEDULED') {
          throw notFound('Class not found or not bookable');
        }
        if (isBefore(session.startsAt, new Date())) {
          throw conflict('Cannot book a past class');
        }
        const existing = session.bookings.find(
          (item) =>
            item.userId === user.id && ['BOOKED', 'PROMOTED', 'WAITLISTED'].includes(item.status),
        );
        if (existing) {
          throw conflict('You already have a booking or waiting-list entry for this class');
        }

        const activeBookings = session.bookings.filter((item) =>
          ['BOOKED', 'PROMOTED'].includes(item.status),
        );
        const occupiedBikeNumbers = activeBookings
          .map((item) => item.bikeNumber)
          .filter((bike): bike is number => typeof bike === 'number');

        if (activeBookings.length >= session.capacity) {
          const rank =
            (await tx.booking.count({ where: { classSessionId: id, status: 'WAITLISTED' } })) + 1;
          return tx.booking.create({
            data: {
              userId: user.id,
              classSessionId: id,
              status: 'WAITLISTED',
              waitlistRank: rank,
            },
          });
        }

        if (!input.bikeNumber) {
          throw badRequest('A bike number is required while bikes are available');
        }
        if (occupiedBikeNumbers.includes(input.bikeNumber)) {
          throw conflict('Selected bike is no longer available');
        }

        return tx.booking.create({
          data: {
            userId: user.id,
            classSessionId: id,
            bikeNumber: input.bikeNumber,
            status: 'BOOKED',
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await notifyUser(prisma, {
      userId: user.id,
      type: booking.status === 'WAITLISTED' ? 'WAITLIST_JOINED' : 'BOOKING_CONFIRMED',
      title: booking.status === 'WAITLISTED' ? 'Waiting list joined' : 'Booking confirmed',
      body:
        booking.status === 'WAITLISTED'
          ? 'You have joined the waiting list for this class.'
          : `Bike ${booking.bikeNumber} is booked for you.`,
      data: { bookingId: booking.id, classSessionId: id },
    });
    await audit(prisma, user.id, 'CREATE_BOOKING', 'Booking', booking.id, { status: booking.status });
    return reply.status(201).send({ data: booking });
  });

  app.get('/bookings/me', async (request) => {
    const user = await getUserFromRequest(request);
    const bookings = await prisma.booking.findMany({
      where: { userId: user.id },
      include: { classSession: true, attendance: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { data: bookings };
  });

  app.get('/classes/:id/bookings', async (request) => {
    const user = await getUserFromRequest(request, ['ADMIN', 'INSTRUCTOR']);
    const id = (request.params as { id: string }).id;
    const session = await prisma.classSession.findUnique({ where: { id } });
    if (!session) {
      throw notFound('Class not found');
    }
    assertInstructorCanManageClass(user, session);
    const bookings = await prisma.booking.findMany({
      where: { classSessionId: id },
      include: { user: true, attendance: true },
      orderBy: [{ status: 'asc' }, { bikeNumber: 'asc' }, { waitlistRank: 'asc' }],
    });
    return { data: bookings };
  });

  app.delete('/bookings/:id', async (request) => {
    const actor = await getUserFromRequest(request);
    const id = (request.params as { id: string }).id;
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { classSession: true, user: true },
    });
    if (!booking) {
      throw notFound('Booking not found');
    }
    if (actor.role === 'MEMBER' && booking.userId !== actor.id) {
      throw forbidden('Members may only cancel their own bookings');
    }
    if (actor.role === 'INSTRUCTOR') {
      assertInstructorCanManageClass(actor, booking.classSession);
    }

    const previousBikeNumber = booking.bikeNumber;
    const cancelled = await prisma.booking.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    if (previousBikeNumber && ['BOOKED', 'PROMOTED'].includes(booking.status)) {
      await promoteWaitlistedMember(prisma, booking.classSessionId, previousBikeNumber);
    }

    await notifyUser(prisma, {
      userId: booking.userId,
      type: 'BOOKING_CANCELLED',
      title: 'Booking cancelled',
      body: `Your booking for ${booking.classSession.title} has been cancelled.`,
      data: { bookingId: booking.id, classSessionId: booking.classSessionId },
    });
    await audit(prisma, actor.id, 'CANCEL_BOOKING', 'Booking', booking.id);
    return { data: cancelled };
  });

  app.get('/classes/:id/attendance', async (request) => {
    const actor = await getUserFromRequest(request, ['ADMIN', 'INSTRUCTOR']);
    const id = (request.params as { id: string }).id;
    const session = await prisma.classSession.findUnique({ where: { id } });
    if (!session) {
      throw notFound('Class not found');
    }
    assertInstructorCanManageClass(actor, session);
    const bookings = await prisma.booking.findMany({
      where: { classSessionId: id, status: { in: ['BOOKED', 'PROMOTED'] } },
      include: { user: true, attendance: true },
      orderBy: { bikeNumber: 'asc' },
    });
    return {
      data: {
        bookedCount: bookings.length,
        capacity: BIKE_COUNT,
        entries: bookings.map((booking) => ({
          bookingId: booking.id,
          memberName: `${booking.user.firstName} ${booking.user.lastName}`,
          bikeNumber: booking.bikeNumber,
          status: booking.attendance?.status ?? null,
        })),
      },
    };
  });

  app.post('/classes/:id/attendance', async (request) => {
    const actor = await getUserFromRequest(request, ['ADMIN', 'INSTRUCTOR']);
    const id = (request.params as { id: string }).id;
    const input = parseBody(attendanceSchema, request.body);
    const session = await prisma.classSession.findUnique({ where: { id } });
    if (!session) {
      throw notFound('Class not found');
    }
    assertInstructorCanManageClass(actor, session);
    const threshold = await getNumberSetting(prisma, 'noShowThreshold', 3);

    const results = [];
    for (const entry of input.entries) {
      const booking = await prisma.booking.findFirst({
        where: { id: entry.bookingId, classSessionId: id, status: { in: ['BOOKED', 'PROMOTED'] } },
        include: { attendance: true, user: true },
      });
      if (!booking) {
        throw badRequest(`Booking ${entry.bookingId} is not valid for this class`);
      }

      const previous = booking.attendance?.status;
      const attendance = await prisma.attendance.upsert({
        where: { bookingId: booking.id },
        update: { status: entry.status, markedById: actor.id, markedAt: new Date() },
        create: { bookingId: booking.id, status: entry.status, markedById: actor.id },
      });

      if (entry.status === 'ABSENT' && previous !== 'ABSENT') {
        const updatedMember = await prisma.user.update({
          where: { id: booking.userId },
          data: { noShowCount: { increment: 1 } },
        });
        if (updatedMember.noShowCount >= threshold) {
          await notifyAdmins(prisma, {
            type: 'NO_SHOW_WARNING',
            title: 'No-show threshold reached',
            body: `${updatedMember.firstName} ${updatedMember.lastName} has ${updatedMember.noShowCount} no-shows.`,
            data: { userId: updatedMember.id, noShowCount: updatedMember.noShowCount },
          });
        }
      }

      if (entry.status === 'PRESENT' && previous === 'ABSENT') {
        await prisma.user.update({
          where: { id: booking.userId },
          data: { noShowCount: { decrement: 1 } },
        });
      }

      results.push(attendance);
    }

    await audit(prisma, actor.id, 'MARK_ATTENDANCE', 'ClassSession', id, { count: results.length });
    return { data: results };
  });

  app.post('/members/:id/reset-no-shows', async (request) => {
    const actor = await getUserFromRequest(request, ['ADMIN']);
    const id = (request.params as { id: string }).id;
    const user = await prisma.user.update({ where: { id }, data: { noShowCount: 0 } });
    await audit(prisma, actor.id, 'RESET_NO_SHOWS', 'User', id);
    return { data: { user: serializeUser(user) } };
  });

  app.get('/notifications', async (request) => {
    const user = await getUserFromRequest(request);
    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { data: notifications };
  });

  app.post('/notifications/:id/read', async (request) => {
    const user = await getUserFromRequest(request);
    const id = (request.params as { id: string }).id;
    const existing = await prisma.notification.findFirst({ where: { id, userId: user.id } });
    if (!existing) {
      throw notFound('Notification not found');
    }
    const notification = await prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return { data: notification };
  });

  app.post('/push-tokens', async (request, reply) => {
    const user = await getUserFromRequest(request);
    const body = request.body as { token?: string; platform?: string };
    if (!body.token || !body.platform) {
      throw badRequest('Token and platform are required');
    }
    const token = await prisma.pushToken.upsert({
      where: { token: body.token },
      update: { userId: user.id, platform: body.platform },
      create: { token: body.token, platform: body.platform, userId: user.id },
    });
    return reply.status(201).send({ data: token });
  });

  app.get('/settings', async (request) => {
    await getUserFromRequest(request, ['ADMIN']);
    const settings = await prisma.appSetting.findMany();
    return { data: Object.fromEntries(settings.map((setting) => [setting.key, setting.value])) };
  });

  app.patch('/settings', async (request) => {
    const actor = await getUserFromRequest(request, ['ADMIN']);
    const input = parseBody(settingsSchema, request.body);
    await Promise.all(
      Object.entries(input).map(([key, value]) =>
        value === undefined
          ? Promise.resolve()
          : prisma.appSetting.upsert({
              where: { key },
              update: { value },
              create: { key, value },
            }),
      ),
    );
    await audit(prisma, actor.id, 'UPDATE_SETTINGS', 'AppSetting', null, input);
    const settings = await prisma.appSetting.findMany();
    return { data: Object.fromEntries(settings.map((setting) => [setting.key, setting.value])) };
  });

  app.get('/reports/:type', async (request, reply) => {
    await getUserFromRequest(request, ['ADMIN']);
    const type = (request.params as { type: string }).type;
    const formatParam = (request.query as { format?: string }).format ?? 'csv';
    const allowedTypes = ['membership', 'payment', 'attendance', 'booking', 'waiting-list', 'no-show'];
    if (!allowedTypes.includes(type)) {
      throw notFound('Report type not found');
    }
    const { from, to } = selectedDateRange(request.query);
    const rows = await rowsForReport(prisma, type, from, to);
    const fileBase = `spinx-${type}-${format(new Date(), 'yyyyMMdd-HHmm')}`;

    if (formatParam === 'xlsx') {
      const buffer = await toXlsx(rows, type);
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="${fileBase}.xlsx"`)
        .send(buffer);
    }

    if (formatParam === 'pdf') {
      const buffer = await toPdf(rows, `SpinX ${type} report`);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${fileBase}.pdf"`)
        .send(buffer);
    }

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${fileBase}.csv"`)
      .send(toCsv(rows));
  });

  return app;
}
