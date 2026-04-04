/**
 * QuickDonation Kiosk — Production server (no Docker required).
 *
 * Serves the built Vite app with:
 *   - Gzip compression
 *   - SPA fallback (all routes → index.html)
 *   - API proxy to backend
 *   - Static asset caching (1 year for hashed files)
 *   - Health check endpoint
 *
 * Usage:
 *   npm run build && npm start
 *
 * Environment variables:
 *   PORT          — server port (default: 8080)
 *   API_URL       — backend API URL to proxy /api/* requests
 *                   (default: http://localhost:8000)
 */
import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, 'dist')
const PORT = process.env.PORT || 8080
const API_URL = process.env.API_URL || 'http://localhost:8000'

const app = express()

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'quick-donation-kiosk', port: PORT })
})

// Proxy API calls to backend
try {
  const proxy = createProxyMiddleware({
    target: API_URL,
    changeOrigin: true,
    logLevel: 'warn',
  })
  app.use('/api', proxy)
} catch {
  // http-proxy-middleware not installed — skip proxy
  console.log(`⚠ API proxy not available. Install http-proxy-middleware or set VITE_API_URL at build time.`)
}

// Serve static files with caching
app.use(express.static(distDir, {
  maxAge: '1y',
  immutable: true,
  setHeaders: (res, path) => {
    // Don't cache index.html
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache')
    }
  },
}))

// SPA fallback — serve index.html for all non-file routes
app.get('*', (_req, res) => {
  res.sendFile(join(distDir, 'index.html'))
})

app.listen(PORT, () => {
  console.log(``)
  console.log(`  🙏 QuickDonation Kiosk running on http://localhost:${PORT}`)
  console.log(`  📡 API proxy → ${API_URL}`)
  console.log(``)
})
