import type { CapacitorConfig } from '@capacitor/cli'

// The Quick Donation Android APK is a thin Capacitor wrapper that loads the
// live web app from https://donate.shital.org.uk/donate/. Keeps the device in
// sync with web deploys automatically — no APK re-flash needed when we ship UI
// changes. To build a fully-offline APK (rare; only useful for venues with
// poor connectivity), unset QD_LIVE_URL and the build will bundle the local
// dist/ instead.
const liveUrl = process.env.QD_LIVE_URL || 'https://donate.shital.org.uk/donate/'

const config: CapacitorConfig = {
  appId: 'org.shital.quickdonation',
  appName: 'Shital Donate',
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
      backgroundColor: '#FF6B00',
      showSpinner: false,
    },
    // Route fetch()/XHR through Android's native HTTP stack so the donation
    // form's POST /kiosk/quick-donation/* calls don't hit a CORS preflight
    // against https://localhost (the WebView's default origin). Same fix
    // we use in the Kiosk app.
    CapacitorHttp: {
      enabled: true,
    },
  },
}

export default config
