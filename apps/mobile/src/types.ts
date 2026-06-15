import type {
  AttendanceStatus,
  BookingStatus,
  ClassStatus,
  MemberStatus,
  PaymentStatus,
  Role,
} from '@spinx/shared';

export interface User {
  id: string;
  email: string;
  role: Role;
  status: MemberStatus;
  firstName: string;
  lastName: string;
  mobile: string;
  emergencyContact: string;
  profilePhotoUrl?: string | null;
  emailVerifiedAt?: string | null;
  acceptedAgreementVersion?: string | null;
  agreementAcceptedAt?: string | null;
  signatureSignedAt?: string | null;
  contractSignedOffline: boolean;
  bookingBlocked: boolean;
  noShowCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  userId: string;
  month: string;
  dueDate: string;
  paidAt?: string | null;
  status: PaymentStatus;
  notes?: string | null;
}

export interface ClassSession {
  id: string;
  title: string;
  description?: string | null;
  instructorId?: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  status: ClassStatus;
  bookedCount: number;
  waitlistCount: number;
  availableBikes: number[];
  myBooking?: Booking | null;
}

export interface Booking {
  id: string;
  userId: string;
  classSessionId: string;
  bikeNumber?: number | null;
  status: BookingStatus;
  waitlistRank?: number | null;
  createdAt: string;
  cancelledAt?: string | null;
  classSession?: ClassSession;
  attendance?: {
    id: string;
    status: AttendanceStatus;
    markedAt: string;
  } | null;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt?: string | null;
  createdAt: string;
}

export interface DashboardData {
  totals: {
    totalMembers: number;
    activeMembers: number;
    inactiveMembers: number;
    pendingApprovalMembers: number;
    paidMembers: number;
    unpaidMembers: number;
    weeklyAttendance: number;
    monthlyAttendance: number;
    bookingCount: number;
    waitingListCount: number;
    noShowCount: number;
  };
  upcomingClasses: Array<{
    id: string;
    title: string;
    startsAt: string;
    occupancy: number;
    capacity: number;
    instructor: string;
  }>;
}
