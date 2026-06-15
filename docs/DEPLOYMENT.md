# Deployment

## API

1. Provision PostgreSQL.
2. Configure secrets:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `PUBLIC_API_URL`
   - `SIGNATURE_STORAGE_DIR` or a production object-storage replacement
   - `EXPO_ACCESS_TOKEN`
   - SMTP credentials
3. Build the API image:

```bash
docker build -f apps/api/Dockerfile -t spinx-api .
```

4. Run database migrations:

```bash
npm run prisma:deploy -w @spinx/api
```

5. Start the API:

```bash
npm run start -w @spinx/api
```

## Mobile

1. Install EAS CLI and authenticate:

```bash
npm install -g eas-cli
eas login
```

2. Set the production API URL in `apps/mobile/eas.json`.
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

- Rotate seed admin password.
- Enforce HTTPS on the API.
- Enable managed database backups.
- Configure SMTP and Expo credentials.
- Move signature storage to private durable storage before multi-instance deployment.
- Confirm the initial Prisma migration has run successfully before opening bookings.
- Configure monitoring for API latency, error rate, database saturation, and failed push notification delivery.
