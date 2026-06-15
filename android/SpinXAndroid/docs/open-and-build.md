# Opening and Building SpinX Android

## Emulator

1. Open `C:\AndroidProjects\SpinXAndroid` in Android Studio.
2. Let Gradle Sync complete.
3. Open **Device Manager**.
4. Create or start an Android emulator.
5. Click **Run**.

## Physical Phone

1. Enable **Developer options** on the Android phone.
2. Enable **USB debugging**.
3. Connect the phone with USB.
4. Accept the debugging prompt on the phone.
5. Select the phone in Android Studio.
6. Click **Run**.

## Debug APK

```powershell
cd C:\AndroidProjects\SpinXAndroid
.\gradlew.bat :app:assembleDebug
```

Installable debug APK:

```text
C:\AndroidProjects\SpinXAndroid\app\build\outputs\apk\debug\app-debug.apk
```

## Git Branch Safety

Android work should happen on:

```text
android/kotlin-app
```

Do not merge this branch into `main` until the Android app has been tested and approved.
