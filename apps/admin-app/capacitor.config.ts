import type { CapacitorConfig } from '@capacitor/cli'

// The Shital Admin Android APK is a thin Capacitor wrapper that loads the live
// admin panel from https://admin.shital.org.uk/. Staff log in inside the
// WebView (JWT persists in localStorage) and the app stays in sync with web
// deploys automatically — no APK re-flash when we ship admin UI changes.
// To build a fully-offline shell (rare), unset ADMIN_LIVE_URL and the build
// falls back to the bundled dist/ splash.
const liveUrl = process.env.ADMIN_LIVE_URL || 'https://admin.shital.org.uk/'

const config: CapacitorConfig = {
  appId: 'org.shital.admin',
  appName: 'Shital Admin',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    ...(liveUrl ? { url: liveUrl, cleartext: false } : {}),
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#0B0B0F',
      showSpinner: false,
    },
    // Route fetch()/XHR through Android's native HTTP stack so the admin API
    // calls to https://admin.shital.org.uk/api/v1/* don't hit a CORS preflight
    // against https://localhost (the WebView's default origin). Same fix used
    // by the Kiosk and Quick Donation apps.
    CapacitorHttp: {
      enabled: true,
    },
  },
}

export default config
