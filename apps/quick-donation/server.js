/**
 * QuickDonation Kiosk — Production server (no Docker required).
 *
 * Usage:
 *   npm run build && npm start
 *
 * Environment variables:
 *   PORT     — server port (default: 8080)
 *   API_URL  — backend API base URL (default: http://127.0.0.1:8000)
 */
import express from 'express'
import http from 'http'
import { URL } from 'url'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, 'dist')
const PORT = process.env.PORT || 8080
const API_URL = process.env.API_URL || 'http://127.0.0.1:8000'

const app = express()

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'quick-donation-kiosk', port: PORT })
})

// Proxy /api/* to backend
app.use('/api', (req, res) => {
  const target = new URL(API_URL)
  const options = {
    hostname: target.hostname,
    port: target.port,
    path: '/api' + req.url,
    method: req.method,
    headers: { ...req.headers, host: target.host },
  }

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(res, { end: true })
  })

  proxyReq.on('error', (err) => {
    res.status(502).json({ error: 'Backend unavailable', detail: err.message })
  })

  req.pipe(proxyReq, { end: true })
})

// Serve static files with caching
app.use(express.static(distDir, {
  maxAge: '1y',
  immutable: true,
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache')
    }
  },
}))

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(join(distDir, 'index.html'))
})

app.listen(PORT, () => {
  console.log(``)
  console.log(`  🙏 QuickDonation Kiosk running on http://localhost:${PORT}`)
  console.log(`  📡 API proxy → ${API_URL}`)
  console.log(``)
})
