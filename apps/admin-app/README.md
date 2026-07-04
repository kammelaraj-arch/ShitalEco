# Shital Admin — Android app

A thin **Capacitor** wrapper that live-loads the production admin panel at
`https://admin.shital.org.uk/`. It is the same hybrid pattern used by the
Quick Donation and Kiosk apps: the APK is just a WebView shell pointing at the
live URL, so the device always runs the latest admin UI **without re-flashing**
when we ship web changes.

- **App id:** `org.shital.admin` · **Name:** Shital Admin
- Staff log in inside the app (JWT persists in the WebView's localStorage).
- `CapacitorHttp` routes API calls through the native HTTP stack (avoids the
  WebView CORS preflight against `https://localhost`).
- `dist/index.html` is only a connecting/offline splash — normally the
  Capacitor `server.url` takes over and loads the live panel.

## Build (CI)

`.github/workflows/build-kiosk.yml` → job **`build-admin-android`** builds a
debug APK and the **`publish-installers`** job attaches it to the rolling
`kiosk-latest` GitHub Release as `shital-admin-latest.apk`.

Stable download:
`https://github.com/kammelaraj-arch/ShitalEco/releases/download/kiosk-latest/shital-admin-latest.apk`
(also linked from the public Software Downloads page, `shital.org.uk/downloads/`).

## Build locally

```bash
cd apps/admin-app
pnpm install --ignore-scripts
npx cap add android
npx cap sync android --inline
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Override the loaded URL with `ADMIN_LIVE_URL` (e.g. to point at dev).
