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
    // NOTE: CapacitorHttp is intentionally NOT enabled. The admin panel is a
    // Next.js app served from admin.shital.org.uk, and its API calls to
    // /api/v1/* are SAME-ORIGIN (the WebView origin is admin.shital.org.uk via
    // server.url), so there's no CORS preflight to bypass. Enabling
    // CapacitorHttp patches window.fetch/XHR, which breaks Next.js's
    // client-side data / RSC fetches → "a client-side exception has occurred"
    // on load. (Quick Donation needs it only because it calls a cross-origin
    // API from a different origin — not the case here.)
  },
}

export default config
