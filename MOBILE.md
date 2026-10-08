# Mobile app

Staff phones connect to the GreenCycle server running on the office computer, over the office Wi-Fi.
All data stays on the office server; the phone app only shows it.

## Install

1. On the office computer, double-click **ALLOW-PHONES.bat** once and click **Yes** (opens port 3000 in Windows Firewall).
2. In GreenCycle open **Settings → Mobile App**. It shows a QR code and the server address (e.g. `192.168.1.20:3000`).
3. On the phone (same Wi-Fi), scan the QR code or open `http://<address>/mobile`.
   - **Android:** tap **Download the app**, open the file, allow "install unknown apps" for the browser if asked, tap **Install**.
     Open the app, type the server address, tap **Connect**, sign in.
   - **iPhone:** in Safari tap **Share → Add to Home Screen**.

## Uninstall

- **Android:** in the app, tap your name (top right) → **App settings** → **Uninstall app**; or press and hold the icon → **Uninstall**.
- **iPhone:** press and hold the icon → **Remove App** → **Delete from Home Screen**.

Uninstalling never deletes company data.

## What the Android app adds

| Feature | How |
|---|---|
| Camera photos for collections | Upload buttons offer the camera or gallery |
| GPS location on field collections | Native location (asks permission once) |
| Invoices, slips, reports | Saved to **Downloads/GreenCycle** and opened |
| Print | Android print dialog (printer or PDF) |
| App settings | Change server address, reload, clear data and sign out, uninstall |
| Offline screen | Explains what to check and offers **Try again** / **Change server** |

Requires Android 6.0 or newer.

## Problems

| Problem | Fix |
|---|---|
| "Cannot reach the server" | Phone on office Wi-Fi? Office computer on and START-WINDOWS running? ALLOW-PHONES.bat run once? |
| Worked yesterday, not today | The office computer's address changed. Check Settings → Mobile App, then in the app: your name → App settings → change address. Ask for a fixed IP to stop this. |
| "Install blocked" / "unknown apps" | Phone Settings → Apps → (your browser) → Install unknown apps → Allow. |
| Play Protect warning | Tap **More details → Install anyway**. The app is not on Play Store, so Android shows this once. |
| Location not filled in | Turn on Location in the phone, and allow it: Settings → Apps → GreenCycle ERP → Permissions → Location. |
| "App not installed" when updating | The new APK was signed with a different key. Uninstall the old app first, then install. |

## Building the APK (developers)

The source is in `android/` (plain Java, no Android Studio needed). On Ubuntu/Debian:

```bash
sudo apt install openjdk-17-jdk aapt android-sdk-platform-23 dalvik-exchange apksigner zipalign
KEYSTORE=/safe/place/greencycle-release.jks KEYSTORE_PASS=... android/build.sh
```

The script writes `public/downloads/GreenCycle-ERP.apk`, which the server offers on `/mobile`.
**Always sign with the same keystore**, otherwise phones must uninstall before they can update.
Raise `versionCode` / `versionName` in `android/AndroidManifest.xml` for each release.
