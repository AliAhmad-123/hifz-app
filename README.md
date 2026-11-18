# Hifz Tracker – Android app (Capacitor)

## APK cloud par banwana (Android Studio ke baghair)
1. GitHub par naya repo banayein aur is folder ki saari files push karein.
2. Repo > Actions > "Build Android APK" > Run workflow.
3. Complete hone par "hifz-tracker-apk" artifact download karein, zip kholein, `app-debug.apk` phone par install karein.

## Local build (Android Studio ke sath)
    npm install
    npx cap add android
    npx cap sync android
    npx cap open android      # Build > Build APK(s)

## Data
- Data phone ke local storage mein save hota hai (internet nahi chahiye).
- Export: JSON/PDF ban kar Share sheet khulti hai (Files/Drive/WhatsApp mein save karein).
- Import: purani .json backup file select karein.
- App uninstall / Clear data par data delete hota hai, isliye time to time Export karein.

## HTML update karna
`www/index.html` edit karein, phir `npx cap sync android` (ya GitHub par push) aur dobara build.
