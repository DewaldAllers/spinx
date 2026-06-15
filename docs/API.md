# SpinX API Summary

All protected endpoints require:

```http
Authorization: Bearer <jwt>
```

## Authentication

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/verify-email?token=...`
- `GET /auth/me`

## Admin

- `GET /admin/dashboard`
- `GET /members`
- `POST /members`
- `GET /members/:id`
- `PATCH /members/:id`
- `POST /members/:id/approve`
- `DELETE /members/:id/decline`
- `POST /members/:id/status`
- `POST /members/:id/reset-no-shows`
- `GET /settings`
- `PATCH /settings`

## Payments

- `GET /payments/me`
- `GET /payments?month=YYYY-MM`
- `POST /payments/generate-monthly`
- `POST /payments/:id/confirm`
- `POST /payments/:id/waive`

## Classes And Bookings

- `GET /classes?from=<iso>&to=<iso>`
- `GET /classes/:id`
- `POST /classes`
- `POST /classes/recurring`
- `PATCH /classes/:id`
- `POST /classes/:id/cancel`
- `POST /classes/:id/bookings`
- `GET /classes/:id/bookings`
- `GET /bookings/me`
- `DELETE /bookings/:id`

## Attendance

- `GET /classes/:id/attendance`
- `POST /classes/:id/attendance`

## Notifications

- `GET /notifications`
- `POST /notifications/:id/read`
- `POST /push-tokens`

## Reports

- `GET /reports/:type?format=csv|pdf|xlsx`

Report types: `membership`, `payment`, `attendance`, `booking`, `waiting-list`, `no-show`.
