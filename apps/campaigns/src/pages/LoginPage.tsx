// Email + password login. Reuses the backend admin JWT via /api/v1/auth/login.
// SSO across admin.shital.org.uk and campaigns.shital.org.uk is a Phase 1c
// job; this page gets us productive today without infrastructure changes.

import { useState } from 'react'
import { api, HttpError } from '../api'
import { useAuth } from '../store'

export function LoginPage() {
  const setAuth = useAuth((s) => s.setAuth)
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const r = await api.login(email.trim(), password)
      setAuth(r.access_token, r.user.email, r.user.role)
    } catch (err) {
      setError(err instanceof HttpError ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl p-6 border border-white/10 bg-white/5">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-black">Shital Campaigns</h1>
          <p className="text-sm opacity-60 mt-1">Marketing hub · admin login</p>
        </div>
        <label className="block mb-3">
          <span className="text-xs opacity-70 uppercase tracking-wider">Email</span>
          <input type="email" required autoFocus value={email}
            onChange={e => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg px-3 py-2 bg-black/40 border border-white/10 outline-none focus:border-yellow-500" />
        </label>
        <label className="block mb-5">
          <span className="text-xs opacity-70 uppercase tracking-wider">Password</span>
          <input type="password" required value={password}
            onChange={e => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg px-3 py-2 bg-black/40 border border-white/10 outline-none focus:border-yellow-500" />
        </label>
        {error && <p className="text-sm mb-4" style={{ color: '#fca5a5' }}>{error}</p>}
        <button type="submit" disabled={busy}
          className="w-full py-2.5 rounded-lg font-bold bg-yellow-500 text-black disabled:opacity-60">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-center text-xs opacity-50 mt-6">
          Same credentials as admin.shital.org.uk
        </p>
      </form>
    </div>
  )
}
