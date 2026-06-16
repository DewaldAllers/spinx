# SpinX Android

Native Android app for SpinX Studio, built with Kotlin for Android Studio.

This project is separate from the SpinX web app. It uses the same Supabase project, tables, auth users, Row Level Security rules, and RPC functions as the web app.

## Open in Android Studio

1. Open Android Studio.
2. Select **Open**.
3. Choose `C:\AndroidProjects\SpinXAndroid`.
4. Wait for Gradle Sync to finish.
5. Run the `app` configuration on an emulator or Android phone.

## Build Debug APK

From this folder:

```powershell
.\gradlew.bat :app:assembleDebug
```

APK output:

```text
app\build\outputs\apk\debug\app-debug.apk
```

## Supabase Config

The Android app uses the same public Supabase URL and anon key as the web app.

Config location:

```text
app\build.gradle.kts
```

Only the public anon key is used. Do not add the Supabase service role key to this Android project.

## Current Features

- Login and self-registration.
- Pending approval handling.
- Role-based navigation for admin, instructor, and member.
- Member calendar, booking, waiting list, cancellation, booking history, and profile.
- Admin member approval, delete/decline, payment status update, status update, and instructor promotion.
- Staff class planner with one-off and weekly recurring classes.
- Staff class cancellation/reopening for one class or future matching classes.
- Admin booking a member into a class.
- Staff booking overview by class.
- Attendance register with present/absent marking.
- Basic report sharing as CSV text.

## Safe Backend Rules

- This app does not create, drop, reset, or migrate Supabase tables.
- It calls existing `spinx_` tables and RPC functions.
- The web app and Android app share the same live data.
- Keep schema changes backward-compatible with the web app.

## Release APK Later

Debug APKs are for testing only. For release:

1. Create a signing key in Android Studio.
2. Add signing config through Android Studio or local Gradle properties.
3. Build **Generate Signed Bundle / APK**.
4. Never commit signing passwords or private keys.
