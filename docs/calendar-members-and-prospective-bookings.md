# Calendar, Member Numbers, and Prospective Bookings

These changes are staged on `web/mobile-nav-layout-fix`. They do not require a database reset and must be reviewed before anything is merged to `main`.

## Web Changes

- Mobile logout is available in the header.
- Login and registration password fields have show/hide controls.
- The admin Calendar includes filters and expandable class details for bookings, open bikes, attendance, cancellations, no-shows, unpaid members, and waiting lists.
- Class actions are grouped in a compact expandable menu.
- Admins can book a prospective member after collecting contact details, indemnity acceptance, and a drawn signature.
- The Members page displays and searches stable member numbers.

## Safe Database Migration

The migration is:

```text
supabase/migrations/20260622_member_numbers_and_prospective_members.sql
```

It is additive and does not drop, truncate, delete, or recreate existing data. It adds:

- `spinx_profiles.member_number`
- `spinx_member_number_seq`
- `spinx_prospective_members`
- `spinx_prospective_bookings`
- `spinx_indemnities`
- RLS policies and narrowly scoped RPC functions for prospective occupancy, booking, cancellation, and class status changes

Existing non-pending members are backfilled in creation order. Future members receive a number when they leave `pending_approval`. Assigned numbers cannot be changed.

The migration also updates existing booking allocation functions so registered and prospective bookings cannot receive the same bike.

## Review and Apply

Do not run the migration against the live project until the branch and SQL have been reviewed.

When approved:

1. Open Supabase SQL Editor for the existing SpinX project.
2. Paste the complete migration file into a new query.
3. Confirm the query targets the existing project.
4. Run it once.
5. Check that existing members, classes, bookings, payments, and attendance still load.

## Test Checklist

1. Test admin and member login.
2. Toggle password visibility on login and registration.
3. Log out from a narrow mobile viewport.
4. Exercise every Calendar filter and expandable summary.
5. Book and cancel an existing member.
6. Book a prospective member, draw a signature, and verify the PDF download.
7. Confirm the prospective booking occupies exactly one of the nine bikes.
8. Cancel the prospective booking and verify waitlist promotion when applicable.
9. Approve a pending member and verify a unique member number appears.
10. Search Members by padded number such as `0001`.
11. Cancel an instructor-owned class and verify its active bookings and waiting list entries are cancelled for everyone.
12. Recheck the mobile layout for horizontal overflow.

The web code handles an unapplied migration gracefully for read-only startup, but prospective booking and member-number persistence require the migration.
