import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: (process.env.VITE_BASE as string) || '/',
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          paypal: ['@paypal/react-paypal-js'],
          vendor: ['react', 'react-dom', 'zustand', 'framer-motion'],
        },
      },
    },
  },
})
