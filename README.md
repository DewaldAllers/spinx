# SpinX Web

Small web-only version of SpinX for a single spinning studio.

This project has no Android, iPhone, Expo, Gradle, or native build files. It is a simple static web app:

- `index.html`
- `styles.css`
- `app.js`
- `supabase/schema.sql`

## Setup

1. Open Supabase.
2. Go to SQL Editor.
3. Paste and run `supabase/schema.sql`.
4. Register your owner/admin account in the web app.
5. In Supabase SQL Editor, make that account the admin:

```sql
update public.spinx_profiles
set role = 'admin',
    status = 'active',
    payment_status = 'paid'
where email = 'your-email@example.com';
```

6. Open `index.html` in a browser, or host the folder on Netlify, Vercel, GitHub Pages, or Supabase Storage.

## What It Does

- Member self-registration
- Pending approval
- Admin member approval, Auth confirmation, and role changes
- Instructor role
- Calendar-first booking
- Class creation, moving, duplication, cancellation, and simple weekly repeats
- 9-bike booking grid
- Waiting list
- Attendance marking
- No-show counts
- Payment status
- CSV reports

## Current Branch

The active working branch for the improved UI/admin workflow work is:

```bash
codex/ui-admin-workflows
```

It is safe to test locally. Nothing from this branch should be pushed or merged until approved.

## Supabase

The app uses the Supabase browser client directly. No separate backend server is required.

The public Supabase URL/key are in `index.html`. If you create a new Supabase project later, replace:

```js
window.SPINX_SUPABASE_URL = "...";
window.SPINX_SUPABASE_KEY = "...";
```

## Local Use

You can open `index.html` directly in your browser.

For a local web server, from this folder you can run:

```bash
python -m http.server 5173
```

Then open:

```text
http://localhost:5173
```
