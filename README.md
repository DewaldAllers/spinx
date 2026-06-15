# SpinX

SpinX is a production-oriented mobile booking system for a single spinning studio. The repository contains:

- `apps/mobile`: Expo React Native app for Android and iPhone.
- `apps/api`: legacy Fastify/Prisma API plus Prisma migrations used to manage the Supabase database schema.
- `supabase/functions`: Supabase Edge Functions for admin-only server actions.
- `packages/shared`: shared validation schemas, role/status types, and business constants.

## Stack

- Mobile: Expo SDK 56, React Native 0.86, React Navigation, TanStack Query, Supabase JS, Expo Notifications.
- Backend v1: Supabase Auth, Supabase Postgres, Row Level Security, Storage, Postgres RPC functions, and Edge Functions.
- Database management: Prisma migrations applied to the Supabase Postgres database.
- Reports: CSV/PDF export from the mobile admin screen.

## Local Setup

1. Install Node.js 22 or newer.
2. Install dependencies:

```bash
npm install
```

3. Copy `.env.example` to `.env` if you want to override the Supabase project values.
4. Apply database migrations to Supabase when schema changes:

```bash
npm run prisma:deploy -w @spinx/api
```

5. Start the mobile app:

```bash
npm run dev:mobile
```

Supabase project values are configured in `apps/mobile/app.json` and can be overridden with:

```bash
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Initial admin:

- Email: `allersdewald@gmail.com`
- Password: use the temporary password supplied during setup, then change it.

If Supabase email confirmation is enabled, confirm the admin email before signing in.

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
npm run prisma:deploy -w @spinx/api
npx supabase functions deploy admin-create-user --project-ref sqeqtogelbkijxvthvhj
```

## Production Notes

- Supabase is the v1 backend host: Auth, database, RLS policies, Storage, and Edge Functions.
- Store signatures in the private Supabase `signatures` bucket.
- Deploy the `admin-create-user` Edge Function before using manual admin-created members/instructors.
- Run `prisma migrate deploy` when database schema changes.
- Build mobile binaries with EAS using the `production` profile in `apps/mobile/eas.json`.
