# SpinX

SpinX is a production-oriented mobile booking system for a single spinning studio. The repository contains:

- `apps/mobile`: Expo React Native app for Android and iPhone.
- `apps/api`: Fastify TypeScript API with Prisma and PostgreSQL.
- `packages/shared`: shared validation schemas, role/status types, and business constants.

## Stack

- Mobile: Expo SDK 56, React Native 0.86, React Navigation, TanStack Query, SecureStore, Expo Notifications.
- API: Fastify 5, Prisma 6, PostgreSQL, JWT auth, bcrypt password hashing, rate limiting, Helmet, CORS.
- Reports: CSV, PDF, and XLSX export endpoints.
- Push: Expo push token registration and server-side push delivery.

## Local Setup

1. Install Node.js 22 or newer.
2. Copy `.env.example` to `.env` and set `JWT_SECRET` to a strong value.
3. Start PostgreSQL:

```bash
docker compose up -d
```

4. Install dependencies:

```bash
npm install
```

5. Generate Prisma client and migrate:

```bash
npm run prisma:generate -w @spinx/api
npm run prisma:migrate -w @spinx/api
npm run seed -w @spinx/api
```

6. Start the API:

```bash
npm run dev:api
```

7. Start the mobile app:

```bash
npm run dev:mobile
```

For Android emulators, set `EXPO_PUBLIC_API_URL=http://10.0.2.2:4000`. For a physical phone, use your machine LAN IP, for example `http://192.168.1.20:4000`.

Seed admin:

- Email: `admin@spinx.local`
- Password: `ChangeMe123!`

Change these values before production.

## Core Workflows

- Members self-register, accept the agreement, sign electronically, verify email, then wait for admin approval.
- Admins can approve or permanently decline pending registrations.
- Admins can manually create members and mark offline contracts as signed.
- Monthly membership rows are generated for active members and manually confirmed by admins.
- Members can view the calendar, book one of exactly 9 bikes, cancel their own bookings, or join a waiting list.
- When a bike is cancelled, the first waiting-list member is promoted automatically.
- Admins and instructors can create, move, edit, cancel, and repeat classes.
- Attendance is marked present/absent by admin or instructor. No-show counts are tracked and admins are notified at the configured threshold.
- Admin reports export as CSV, PDF, and XLSX.

## Useful Commands

```bash
npm run typecheck
npm run build
npm run prisma:migrate -w @spinx/api
npm run prisma:deploy -w @spinx/api
npm run seed -w @spinx/api
```

## Production Notes

- Use a managed PostgreSQL database with daily backups and point-in-time recovery.
- Set `JWT_SECRET`, SMTP credentials, Expo access token, and API URL through your cloud secret manager.
- Store signature uploads on durable private object storage in production. The local filesystem storage is suitable for development and single-node deployments only.
- Run `prisma migrate deploy` during API deployment.
- Build mobile binaries with EAS using the `production` profile in `apps/mobile/eas.json`.
