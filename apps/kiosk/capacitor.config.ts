import type { CapacitorConfig } from '@capacitor/cli'

// Set KIOSK_LIVE_URL=https://shital.org.uk/kiosk/ before `cap sync` to build a
// thin loader that pulls the SPA from the live web deploy (so UI updates ship
// without re-flashing every kiosk). Leave unset to bundle the local `dist/`
// build into the APK — works offline for the UI but needs `cap sync` after
// every SPA change.
const liveUrl = process.env.KIOSK_LIVE_URL || ''

const config: CapacitorConfig = {
  appId: 'org.shital.kiosk',
  appName: 'Shital Kiosk',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    ...(liveUrl ? { url: liveUrl, cleartext: false } : {}),
    // No hostname/IP allowlist — the SPA talks to api.shital.org.uk over HTTPS.
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
    // Allow the WebView to use modern features Stripe Terminal needs (Permissions
    // API for camera/NFC, mixed-content blocked for safety).
    allowMixedContent: false,
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#FF6B00',
      showSpinner: false,
    },
    // Route fetch()/XHR through Android's native HTTP stack so requests come
    // from the app process (not the WebView's https://localhost origin) — the
    // backend sees them as plain server-to-server calls and CORS preflight is
    // not involved. Without this, every cross-origin API call fails with
    // TypeError ("Cannot reach server") unless every kiosk WebView origin is
    // explicitly listed in the backend's CORS_ORIGINS.
    CapacitorHttp: {
      enabled: true,
    },
    // Keep screen on while the kiosk is in lock-task mode (handled by
    // FLAG_KEEP_SCREEN_ON in MainActivity — plugin not required).
  },
}

export default config
