# SpinX Android Kotlin App

The SpinX repository now keeps the existing web app and the new native Android app side by side.

## Folder Structure

```text
spinx/
  index.html
  app.js
  styles.css
  assets/
  supabase/
  docs/
  android/
    SpinXAndroid/
```

## Web App

The web app still lives in the repository root. These files remain the Vercel web app:

```text
index.html
app.js
styles.css
assets/
supabase/
```

Deploy the web app to Vercel exactly as before. The Android app does not need to be deployed to Vercel.

## Android App

The native Android app lives here:

```text
android/SpinXAndroid/
```

Local Android Studio working copy:

```text
C:\AndroidProjects\SpinXAndroid
```

Open either folder in Android Studio. The local folder is convenient for development; the repo folder is what gets committed.

## Shared Supabase Backend

Both apps use the same Supabase backend:

- Same Supabase Auth users.
- Same `spinx_profiles` table.
- Same classes, bookings, waitlist, attendance, payments, and settings tables.
- Same RPC functions such as `spinx_book_next_bike`, `spinx_cancel_booking`, `spinx_admin_book_member`, and `spinx_mark_attendance`.

The Android app uses only the public anon key from the web app. Do not add the Supabase service role key to Android.

## Build Android Debug APK

```powershell
cd C:\AndroidProjects\SpinXAndroid
.\gradlew.bat :app:assembleDebug
```

Debug APK:

```text
C:\AndroidProjects\SpinXAndroid\app\build\outputs\apk\debug\app-debug.apk
```

## Run on an Emulator

1. Open `C:\AndroidProjects\SpinXAndroid` in Android Studio.
2. Wait for Gradle Sync.
3. Start an emulator in Device Manager.
4. Click **Run**.

## Run on a Physical Android Phone

1. Enable Developer options.
2. Enable USB debugging.
3. Connect the phone with USB.
4. Accept the phone debugging prompt.
5. Select the phone in Android Studio.
6. Click **Run**.

## Branch Safety

Android work is on:

```text
android/kotlin-app
```

Do not work directly on `main` for Android changes. When ready:

1. Test the Android branch.
2. Review the changed files.
3. Merge `android/kotlin-app` into `main` only after approval.

## Safe Schema Rules

Do not reset or recreate Supabase. Do not drop tables. Any future SQL must be backward-compatible with the web app and must preserve existing users, members, classes, bookings, payments, attendance, and settings.
