import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Web builds (Docker/Capacitor) use base '/'
// Electron builds use base './' (set via VITE_ELECTRON=true)
const isElectron = process.env.VITE_ELECTRON === 'true'

export default defineConfig({
  plugins: [react()],
  base: isElectron ? './' : '/',
  server: { port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true },
})
