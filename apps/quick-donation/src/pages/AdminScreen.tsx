import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

interface Reader { id: string; label: string; device_type: string; status: string }

interface LoginResponse {
  authenticated: boolean
  error?: string
  user?: { name: string; email: string }
  branch?: { id: string; name: string }
  profile?: { profile_name: string; stripe_reader_id: string; device_label: string } | null
  stripe_reader_id?: string | null
  reader_label?: string | null
  show_monthly_giving?: boolean
  enable_gift_aid?: boolean
  tap_and_go?: boolean
}

interface AzureConfig { client_id: string; authority: string }

export function AdminScreen() {
  const {
    branchId, stripeReaderId, stripeReaderLabel,
    setBranchId, setReader, setDeviceFlags, setScreen,
  } = useDonationStore()

  const [readers, setReaders] = useState<Reader[]>([])
  const [loading, setLoading] = useState(false)

  const [loggedInName, setLoggedInName] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [azureEnabled, setAzureEnabled] = useState(false)
  const [azureConfig, setAzureConfig] = useState<AzureConfig | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/auth/azure/config`)
      .then(r => r.json())
      .then(d => { if (d.enabled && d.client_id) { setAzureEnabled(true); setAzureConfig({ client_id: d.client_id, authority: d.authority }) } })
      .catch(() => {})
  }, [])

  function applyLogin(data: LoginResponse) {
    if (!data.branch) return
    setBranchId(data.branch.id)
    const readerId = data.stripe_reader_id || data.profile?.stripe_reader_id || ''
    const readerLabel = data.reader_label || data.profile?.device_label || readerId
    if (readerId) setReader(readerId, readerLabel)
    setDeviceFlags({
      showMonthlyGiving: data.show_monthly_giving ?? false,
      enableGiftAid: data.enable_gift_aid ?? false,
      tapAndGo: data.tap_and_go ?? true,
    })
    setLoggedInName(data.user?.name || username)
    setLoggedIn(true)
    loadReaders()
  }

  async function handleLogin() {
    if (!username.trim() || !password.trim()) return
    setLoginLoading(true); setLoginError('')
    try {
      const res = await fetch(`${API_BASE}/kiosk/quick-donation/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: username.trim(), password }),
      })
      if (!res.ok && res.status >= 500) {
        setLoginError(`Server error (${res.status}) — try again in a moment.`)
        return
      }
      const data: LoginResponse = await res.json()
      if (data.authenticated) applyLogin(data)
      else setLoginError(data.error || 'Login failed')
    } catch (err) {
      setLoginError(err instanceof TypeError ? 'Cannot reach server — check network.' : 'Login failed. Please try again.')
    } finally { setLoginLoading(false) }
  }

  async function handleAzureLogin() {
    if (!azureConfig) return
    setLoginLoading(true); setLoginError('')
    const w = 500, h = 600
    const left = window.screenX + (window.innerWidth - w) / 2
    const top  = window.screenY + (window.innerHeight - h) / 2
    const redirectUri = `${window.location.origin}/auth-callback`
    const url = `${azureConfig.authority}/oauth2/v2.0/authorize?client_id=${azureConfig.client_id}&response_type=id_token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('openid profile email')}&response_mode=fragment&nonce=${Date.now()}`
    const popup = window.open(url, 'AzureAD', `width=${w},height=${h},left=${left},top=${top}`)
    const poll = setInterval(async () => {
      try {
        if (!popup || popup.closed) { clearInterval(poll); setLoginLoading(false); return }
        const hash = popup.location.hash
        if (hash?.includes('id_token=')) {
          clearInterval(poll); popup.close()
          const idToken = new URLSearchParams(hash.substring(1)).get('id_token')
          if (!idToken) { setLoginError('No token from Azure AD'); setLoginLoading(false); return }
          const res = await fetch(`${API_BASE}/kiosk/quick-donation/login-azure`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_token: idToken }),
          })
          const data: LoginResponse = await res.json()
          if (data.authenticated) applyLogin(data)
          else setLoginError(data.error || 'Azure login failed')
          setLoginLoading(false)
        }
      } catch { /* cross-origin polling */ }
    }, 500)
  }

  async function loadReaders() {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/kiosk/terminal/readers`)
      const data = await res.json()
      setReaders(data.readers || [])
    } catch { setReaders([]) }
    setLoading(false)
  }

  async function handleAssignReader(readerId: string, readerLabel: string) {
    setReader(readerId, readerLabel)
  }

  useEffect(() => { if (loggedIn) loadReaders() }, [loggedIn])

  // ── Login screen (kiosk-style dark theme) ──────────────────────────────────
  if (!loggedIn) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center px-8"
        style={{ background: 'linear-gradient(160deg,#1a0a00 0%,#2d1200 100%)' }}>
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm">

          <div className="text-center mb-8">
            <div className="text-5xl mb-3">💳</div>
            <h1 className="text-2xl font-black mb-1" style={{ color: '#D4AF37' }}>Device Login</h1>
            <p className="text-sm" style={{ color: 'rgba(255,248,220,0.45)' }}>
              Sign in to configure this Quick Donation terminal
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                style={{ color: 'rgba(212,175,55,0.6)' }}>Username</label>
              <input
                type="text" value={username} onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="e.g. wembley-1"
                className="w-full px-4 py-3 rounded-xl text-sm border outline-none"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#fff',
                  border: '1px solid rgba(212,175,55,0.25)', caretColor: '#D4AF37' }}
                autoComplete="username" autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                style={{ color: 'rgba(212,175,55,0.6)' }}>Password</label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-xl text-sm border outline-none"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#fff',
                  border: '1px solid rgba(212,175,55,0.25)', caretColor: '#D4AF37' }}
                autoComplete="current-password"
              />
            </div>

            {loginError && (
              <p className="text-sm rounded-xl px-4 py-2.5 font-medium"
                style={{ background: 'rgba(198,40,40,0.18)', color: '#f87171',
                  border: '1px solid rgba(198,40,40,0.3)' }}>{loginError}</p>
            )}

            <button
              onClick={handleLogin} disabled={loginLoading || !username.trim() || !password.trim()}
              className="w-full py-3.5 rounded-xl font-black text-base disabled:opacity-40 transition-all active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#1a0000' }}
            >
              {loginLoading ? 'Signing in…' : 'Sign In →'}
            </button>

            {azureEnabled && (
              <button
                onClick={handleAzureLogin} disabled={loginLoading}
                className="w-full py-3 rounded-xl font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,248,220,0.7)',
                  border: '1px solid rgba(255,255,255,0.12)' }}
              >
                <svg className="w-4 h-4" viewBox="0 0 21 21" fill="currentColor">
                  <path d="M0 0h10v10H0zM11 0h10v10H11zM0 11h10v10H0zM11 11h10v10H11z" />
                </svg>
                Sign in with Microsoft
              </button>
            )}
          </div>

          <p className="text-center text-xs mt-6" style={{ color: 'rgba(255,248,220,0.2)' }}>
            Quick Donation Terminal · Contact admin for access
          </p>
        </motion.div>
      </div>
    )
  }

  // ── Settings screen (post-login) ──────────────────────────────────────────
  return (
    <div className="w-screen h-screen flex flex-col px-8 py-8 kiosk-scroll"
      style={{ background: 'linear-gradient(160deg,#1a0a00 0%,#2d1200 100%)', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm mx-auto">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-black" style={{ color: '#D4AF37' }}>Device Settings</h1>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,248,220,0.45)' }}>
              Logged in as <span className="font-bold">{loggedInName}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setLoggedIn(false); setUsername(''); setPassword('') }}
              className="px-3 py-2 rounded-xl text-xs font-bold"
              style={{ background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.25)' }}>
              Logout
            </button>
            <button onClick={() => setScreen('idle')}
              className="px-3 py-2 rounded-xl text-xs font-bold"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
              ← Done
            </button>
          </div>
        </div>

        {/* Active reader */}
        {stripeReaderId && (
          <div className="mb-5 px-4 py-3 rounded-xl"
            style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)' }}>
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(212,175,55,0.6)' }}>Active Card Reader</p>
            <p className="font-black text-sm mt-0.5" style={{ color: '#D4AF37' }}>{stripeReaderLabel}</p>
            <p className="text-[10px] font-mono mt-0.5" style={{ color: 'rgba(212,175,55,0.4)' }}>{stripeReaderId}</p>
          </div>
        )}

        {/* Reader list */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(255,248,220,0.35)' }}>Assign Card Reader</p>
            <button onClick={loadReaders} disabled={loading}
              className="text-[10px] font-bold px-2 py-1 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.4)' }}>
              {loading ? '…' : 'Refresh'}
            </button>
          </div>
          <div className="space-y-2">
            {readers.map(r => (
              <button key={r.id} onClick={() => handleAssignReader(r.id, r.label)}
                className="w-full text-left px-4 py-3 rounded-xl transition-all active:scale-[0.98]"
                style={{
                  background: stripeReaderId === r.id ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${stripeReaderId === r.id ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.08)'}`,
                }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-sm" style={{ color: stripeReaderId === r.id ? '#D4AF37' : 'rgba(255,248,220,0.7)' }}>{r.label}</p>
                    <p className="text-[10px] font-mono mt-0.5" style={{ color: 'rgba(255,248,220,0.3)' }}>{r.id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {stripeReaderId === r.id && (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(212,175,55,0.2)', color: '#D4AF37' }}>ACTIVE</span>
                    )}
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: r.status === 'online' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.07)',
                        color: r.status === 'online' ? '#4ade80' : 'rgba(255,248,220,0.3)' }}>
                      {r.status}
                    </span>
                  </div>
                </div>
              </button>
            ))}
            {!loading && readers.length === 0 && (
              <p className="text-center text-xs py-4" style={{ color: 'rgba(255,248,220,0.25)' }}>
                No readers found. Ensure Stripe Terminal is configured.
              </p>
            )}
          </div>
        </div>

        {/* Branch info */}
        <div className="px-4 py-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(255,248,220,0.25)' }}>Branch</p>
          <p className="text-sm font-bold mt-0.5" style={{ color: 'rgba(255,248,220,0.5)' }}>{branchId}</p>
        </div>

        <p className="text-center text-[10px] mt-6" style={{ color: 'rgba(255,248,220,0.15)' }}>
          API: {API_BASE}
        </p>
      </motion.div>
    </div>
  )
}
