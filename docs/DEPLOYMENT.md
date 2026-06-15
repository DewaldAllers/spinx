# Deployment

## Supabase Backend

SpinX v1 uses Supabase as the backend host. Supabase provides Auth, Postgres, Row Level Security, private signature storage, and Edge Functions.

1. Create a Supabase project.
2. Apply Prisma migrations to the Supabase database:

```bash
npm run prisma:deploy -w @spinx/api
```

3. Deploy the admin Edge Function after logging in to the Supabase CLI:

```bash
npx supabase login
npx supabase functions deploy admin-create-user --project-ref sqeqtogelbkijxvthvhj
```

4. Confirm these Supabase features are enabled:
   - Email/password Auth
   - Data API
   - Row Level Security policies from the migrations
   - Private `signatures` Storage bucket

The Fastify API remains in the repo as a legacy/export path and schema-management helper, but the mobile app does not need separate API hosting for v1.

## Mobile

1. Install EAS CLI and authenticate:

```bash
npm install -g eas-cli
eas login
```

2. Confirm Supabase values in `apps/mobile/app.json` or environment variables:

```bash
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

3. Build:

```bash
cd apps/mobile
eas build --platform ios --profile production
eas build --platform android --profile production
```

4. Submit:

```bash
eas submit --platform ios --profile production
eas submit --platform android --profile production
```

## Operational Checklist

- Confirm the first admin can sign in through Supabase Auth.
- Deploy `admin-create-user` before testing manual member/instructor creation.
- Keep the service role key only inside Supabase Edge Functions or trusted server environments.
- Do not put database passwords or service role keys in the mobile app.
- Enable Supabase backups before real member data is used.
- Test member registration, admin approval, booking, waitlist promotion, payment confirmation, and attendance before publishing.
