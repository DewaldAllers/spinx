import { z } from 'zod';

export const BIKE_COUNT = 9;

export const roles = ['ADMIN', 'INSTRUCTOR', 'MEMBER'] as const;
export const memberStatuses = ['PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export const paymentStatuses = ['PENDING', 'PAID', 'OVERDUE', 'WAIVED'] as const;
export const classStatuses = ['SCHEDULED', 'CANCELLED'] as const;
export const bookingStatuses = ['BOOKED', 'CANCELLED', 'WAITLISTED', 'PROMOTED'] as const;
export const attendanceStatuses = ['PRESENT', 'ABSENT'] as const;

export type Role = (typeof roles)[number];
export type MemberStatus = (typeof memberStatuses)[number];
export type PaymentStatus = (typeof paymentStatuses)[number];
export type ClassStatus = (typeof classStatuses)[number];
export type BookingStatus = (typeof bookingStatuses)[number];
export type AttendanceStatus = (typeof attendanceStatuses)[number];

export const emailSchema = z.string().trim().email().max(320).toLowerCase();
export const passwordSchema = z.string().min(8).max(128);
export const phoneSchema = z.string().trim().min(7).max(32);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  mobile: phoneSchema,
  emergencyContact: z.string().trim().min(3).max(160),
  acceptedAgreementVersion: z.string().trim().min(1).max(40),
  signatureDataUrl: z.string().startsWith('data:image/').max(2_500_000),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const createMemberSchema = z.object({
  email: emailSchema,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  mobile: phoneSchema,
  emergencyContact: z.string().trim().min(3).max(160),
  role: z.enum(['MEMBER', 'INSTRUCTOR']).default('MEMBER'),
  status: z.enum(memberStatuses).default('ACTIVE'),
  contractSignedOffline: z.boolean().default(false),
});

export const updateMemberSchema = createMemberSchema.partial().extend({
  profilePhotoUrl: z.string().url().optional().nullable(),
  bookingBlocked: z.boolean().optional(),
});

export const createClassSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  instructorId: z.string().uuid().optional().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  capacity: z.number().int().min(1).max(BIKE_COUNT).default(BIKE_COUNT),
});

export const recurringClassSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  instructorId: z.string().uuid().optional().nullable(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.number().int().min(15).max(240),
  effectiveFrom: z.string().datetime(),
  effectiveUntil: z.string().datetime().optional().nullable(),
});

export const updateClassSchema = createClassSchema.partial().extend({
  status: z.enum(classStatuses).optional(),
});

export const createBookingSchema = z.object({
  bikeNumber: z.number().int().min(1).max(BIKE_COUNT).optional(),
});

export const attendanceEntrySchema = z.object({
  bookingId: z.string().uuid(),
  status: z.enum(attendanceStatuses),
});

export const attendanceSchema = z.object({
  entries: z.array(attendanceEntrySchema).min(1).max(BIKE_COUNT),
});

export const paymentConfirmSchema = z.object({
  paidAt: z.string().datetime().optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const settingsSchema = z.object({
  noShowThreshold: z.number().int().min(1).max(50).optional(),
  paymentGraceDays: z.number().int().min(0).max(15).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CreateClassInput = z.infer<typeof createClassSchema>;
export type RecurringClassInput = z.infer<typeof recurringClassSchema>;
export type UpdateClassInput = z.infer<typeof updateClassSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type AttendanceInput = z.infer<typeof attendanceSchema>;
export type PaymentConfirmInput = z.infer<typeof paymentConfirmSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  status: MemberStatus;
  firstName: string;
  lastName: string;
  bookingBlocked: boolean;
}

export interface ApiEnvelope<T> {
  data: T;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
