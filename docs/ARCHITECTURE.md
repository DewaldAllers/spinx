# SpinX Architecture

## Boundaries

The API is the source of truth for all business rules. The mobile app renders fast role-specific workflows, but it does not decide whether a member may book, whether a bike is available, or whether a wait-list promotion should happen.

## Domain Model

- `User`: admin, instructor, or member. Members move through `PENDING_APPROVAL`, `ACTIVE`, `INACTIVE`, and `SUSPENDED`.
- `MembershipPayment`: monthly EFT/manual payment row. Booking rights depend on account status, current month payment status, grace period, and admin overrides.
- `ClassSession`: concrete bookable class. Recurring rules materialize into sessions.
- `Booking`: one member booking, cancellation, or waiting-list record.
- `Attendance`: present/absent mark linked to a booking.
- `Notification` and `PushToken`: dashboard notifications plus Expo push delivery.
- `AppSetting`: configurable no-show threshold and payment grace period.
- `AuditLog`: administrative and membership workflow traceability.

## Security

- Passwords are hashed with bcrypt.
- Mobile auth uses JWT access tokens stored in Expo SecureStore.
- API routes reload the user from the database on every authenticated request.
- Admin and instructor routes enforce role-based access control.
- Members may only book for themselves and cancel their own bookings.
- Pending, inactive, suspended, unpaid, unverified, or booking-blocked members cannot create bookings.
- Signature images are stored outside the database and referenced by key.
- Helmet, CORS, and rate limiting are enabled on the API.

## Booking Consistency

Class booking uses a serializable Prisma transaction:

- Rejects duplicate active bookings for the same member and class.
- Rejects occupied bikes.
- Creates a waiting-list entry when the class is full.
- Promotes the first waiting-list entry when a booked bike is cancelled.

The initial migration includes a PostgreSQL partial unique index on active booked seats:

```sql
CREATE UNIQUE INDEX booking_active_bike_unique
ON "Booking" ("classSessionId", "bikeNumber")
WHERE "status" IN ('BOOKED', 'PROMOTED') AND "bikeNumber" IS NOT NULL;
```

## Push Notifications

The app registers Expo push tokens after login. The API writes every notification to the database first, then attempts Expo delivery. Failed push sends do not block the business transaction; the notification remains visible in-app.

## Reporting

Reports are generated server-side from the canonical database and streamed as:

- `GET /reports/membership?format=csv|pdf|xlsx`
- `GET /reports/payment?format=csv|pdf|xlsx`
- `GET /reports/attendance?format=csv|pdf|xlsx`
- `GET /reports/booking?format=csv|pdf|xlsx`
- `GET /reports/waiting-list?format=csv|pdf|xlsx`
- `GET /reports/no-show?format=csv|pdf|xlsx`

## Deployment Shape

Recommended production layout:

- API: containerized Node.js service on Render, Fly.io, AWS ECS/Fargate, Google Cloud Run, Azure Container Apps, or Kubernetes.
- Database: managed PostgreSQL.
- Object storage: private S3-compatible bucket for signatures and profile photos.
- Email: SMTP provider or transactional email service.
- Mobile: EAS Build for Android App Bundle and iOS IPA, then Play Console and App Store Connect submission.
