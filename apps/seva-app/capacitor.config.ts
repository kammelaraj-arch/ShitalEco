import type { CapacitorConfig } from '@capacitor/cli'

// The Shital Seva Android APK is a thin Capacitor wrapper that live-loads the
// volunteer seva page from https://service.shital.org.uk/?screen=seva.
// Volunteers browse and book open seva slots, and see their own bookings; the
// app stays in sync with web deploys automatically — no APK re-flash.
// Unset SEVA_LIVE_URL to bundle the local dist/ splash instead (offline shell).
const liveUrl = process.env.SEVA_LIVE_URL || 'https://service.shital.org.uk/?screen=seva'

const config: CapacitorConfig = {
  appId: 'org.shital.seva',
  appName: 'Shital Seva',
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
      backgroundColor: '#3B0000',
      showSpinner: false,
    },
    CapacitorHttp: {
      enabled: true,
    },
  },
}

export default config
