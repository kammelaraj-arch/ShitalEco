import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'org.shital.kiosk',
  appName: 'Shital Kiosk',
  webDir: 'dist',
  server: {
    // In development, point to local backend
    // In production APK, uses bundled dist/ which calls VITE_API_URL
    androidScheme: 'https',
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#FF6B00',
      showSpinner: false,
    },
  },
}

export default config
