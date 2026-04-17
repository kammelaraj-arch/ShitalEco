import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron builds use base './'  (local file:// protocol)
// Web-at-subpath builds use VITE_BASE (e.g. '/kiosk/')
// Plain web / Capacitor builds use '/'
const isElectron = process.env.VITE_ELECTRON === 'true'
const base = isElectron ? './' : (process.env.VITE_BASE || '/')

export default defineConfig({
  plugins: [react()],
  base,
  server: { port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true },
})
