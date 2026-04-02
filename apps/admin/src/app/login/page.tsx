'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

// ─── Storage helpers ──────────────────────────────────────────────────────────

function saveSession(data: any) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem('shital_access_token', data.access_token)
  sessionStorage.setItem('shital_refresh_token', data.refresh_token)
  sessionStorage.setItem('shital_user', JSON.stringify(data.user))
}

// ─── Login page ───────────────────────────────────────────────────────────────

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [msLoading, setMsLoading] = useState(false)
  const [error, setError] = useState('')

  // ── Email/password login ──────────────────────────────────────────────────

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || 'Invalid credentials')
      }
      const data = await res.json()
      saveSession(data)
      window.location.href = '/dashboard'
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  // ── Microsoft SSO ─────────────────────────────────────────────────────────

  async function handleMicrosoftLogin() {
    setError('')
    setMsLoading(true)
    try {
      const { signInWithMicrosoft } = await import('@/lib/msal')
      const data = await signInWithMicrosoft()
      saveSession(data)
      window.location.href = '/dashboard'
    } catch (err: any) {
      setError(err.message || 'Microsoft sign-in failed')
    } finally {
      setMsLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(135deg, #0f0f1a 0%, #1a0a2e 50%, #0f0f1a 100%)' }}
    >
      {/* Background pattern */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-orange-500/5 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-indigo-500/5 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm relative z-10"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4 shadow-2xl"
            style={{ background: 'linear-gradient(135deg, #d97706, #ea580c)' }}
          >
            🕉️
          </div>
          <h1 className="text-white font-black text-2xl tracking-tight">Shital Admin</h1>
          <p className="text-white/40 text-sm mt-1">Temple ERP Management Portal</p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-7 shadow-2xl"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 bg-red-500/15 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl"
            >
              {error}
            </motion.div>
          )}

          {/* Microsoft SSO button */}
          <button
            onClick={handleMicrosoftLogin}
            disabled={msLoading}
            className="w-full flex items-center justify-center gap-3 py-3 rounded-xl font-semibold text-sm transition-all mb-5 disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: '#2563eb',
              color: 'white',
              boxShadow: '0 4px 20px rgba(37,99,235,0.35)',
            }}
          >
            {msLoading ? (
              <span className="animate-spin">⌛</span>
            ) : (
              <MicrosoftLogo />
            )}
            {msLoading ? 'Signing in…' : 'Sign in with Microsoft 365'}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-white/8" />
            <span className="text-white/25 text-xs font-medium">or continue with email</span>
            <div className="flex-1 h-px bg-white/8" />
          </div>

          {/* Email/password form */}
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <label className="block text-white/50 text-xs font-semibold mb-1.5 uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="admin@shital.org"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none focus:border-orange-400/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-semibold mb-1.5 uppercase tracking-wider">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none focus:border-orange-400/50 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-black text-sm text-white transition-all disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98] mt-1"
              style={{ background: 'linear-gradient(135deg, #d97706, #ea580c)', boxShadow: '0 4px 20px rgba(217,119,6,0.35)' }}
            >
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
          </form>
        </div>

        <p className="text-center text-white/20 text-xs mt-6">
          Shital Temple ERP • UK Registered Charity
        </p>
      </motion.div>
    </div>
  )
}

// ─── Microsoft Logo SVG ───────────────────────────────────────────────────────

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
      <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
    </svg>
  )
}
