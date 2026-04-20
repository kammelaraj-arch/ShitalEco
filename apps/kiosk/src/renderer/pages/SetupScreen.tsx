import React, { useState, useEffect } from 'react'
import { useKioskStore, type KioskTheme } from '../store/kiosk.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

interface LoginResponse {
  authenticated: boolean
  error?: string
  user?: { name: string; email: string }
  branch?: { id: string; name: string }
  profile?: { theme?: string; idle_timeout_secs?: number; preset_amounts?: number[] } | null
  stripe_reader_id?: string | null
  reader_label?: string | null
}

interface AzureConfig { client_id: string; authority: string }

export function SetupScreen() {
  const {
    setBranchId, setTheme, setOrgName, setOrgLogoUrl,
    setCardDevice, setDeviceConfigured, setLoggedInUser, setScreen,
  } = useKioskStore()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [azureEnabled, setAzureEnabled] = useState(false)
  const [azureConfig, setAzureConfig]   = useState<AzureConfig | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/kiosk/quick-donation/azure-config`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.enabled && d.client_id) { setAzureEnabled(true); setAzureConfig({ client_id: d.client_id, authority: d.authority }) } })
      .catch(() => {})
  }, [])

  function applyProfile(data: LoginResponse) {
    if (!data.branch || !data.user) return
    setBranchId(data.branch.id)
    setOrgName(data.branch.name)
    if (data.profile?.theme) setTheme(data.profile.theme as KioskTheme)
    if (data.stripe_reader_id) setCardDevice('stripe_terminal', data.stripe_reader_id, data.reader_label || data.stripe_reader_id)
    setLoggedInUser({ name: data.user.name, email: data.user.email, branch: data.branch.name })
    setDeviceConfigured(true)
    setScreen('idle')
  }

  async function handleLogin() {
    if (!username.trim() || !password.trim()) { setError('Enter username and password'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API_BASE}/kiosk/quick-donation/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: username.trim(), password }),
      })
      const data: LoginResponse = await res.json()
      if (data.authenticated) {
        applyProfile(data)
      } else {
        setError(data.error || 'Login failed. Check your credentials.')
      }
    } catch {
      setError('Cannot reach server. Check network connection.')
    } finally { setLoading(false) }
  }

  async function handleAzureLogin() {
    if (!azureConfig) return
    setLoading(true); setError('')
    const w = 500, h = 600
    const left = window.screenX + (window.innerWidth - w) / 2
    const top  = window.screenY + (window.innerHeight - h) / 2
    const redirectUri = `${window.location.origin}/auth-callback`
    const url = `${azureConfig.authority}/oauth2/v2.0/authorize?client_id=${azureConfig.client_id}&response_type=id_token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('openid profile email')}&response_mode=fragment&nonce=${Date.now()}`
    const popup = window.open(url, 'AzureAD', `width=${w},height=${h},left=${left},top=${top}`)
    const poll = setInterval(async () => {
      try {
        if (!popup || popup.closed) { clearInterval(poll); setLoading(false); return }
        const hash = popup.location.hash
        if (hash?.includes('id_token=')) {
          clearInterval(poll); popup.close()
          const idToken = new URLSearchParams(hash.substring(1)).get('id_token')
          if (!idToken) { setError('No token from Azure AD'); setLoading(false); return }
          const res = await fetch(`${API_BASE}/kiosk/quick-donation/login-azure`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_token: idToken }),
          })
          const data: LoginResponse = await res.json()
          if (data.authenticated) applyProfile(data)
          else setError(data.error || 'Azure login failed')
          setLoading(false)
        }
      } catch { /* cross-origin — keep polling */ }
    }, 500)
  }

  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center px-8"
      style={{ background: 'linear-gradient(160deg,#1a0a00 0%,#2d1200 100%)' }}>
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🕉</div>
          <h1 className="text-2xl font-black mb-1" style={{ color: '#D4AF37' }}>Device Login</h1>
          <p className="text-sm" style={{ color: 'rgba(255,248,220,0.45)' }}>
            Sign in to configure this kiosk
          </p>
        </div>

        {/* Form */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
              style={{ color: 'rgba(212,175,55,0.6)' }}>Username</label>
            <input
              type="text" value={username} onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="kiosk-wembley-1"
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

          {error && (
            <p className="text-sm rounded-xl px-4 py-2.5 font-medium"
              style={{ background: 'rgba(198,40,40,0.18)', color: '#f87171',
                border: '1px solid rgba(198,40,40,0.3)' }}>{error}</p>
          )}

          <button
            onClick={handleLogin} disabled={loading}
            className="w-full py-3.5 rounded-xl font-black text-base disabled:opacity-40 transition-all active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#1a0000' }}
          >
            {loading ? 'Signing in…' : 'Sign In →'}
          </button>

          {azureEnabled && (
            <button
              onClick={handleAzureLogin} disabled={loading}
              className="w-full py-3 rounded-xl font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,248,220,0.7)',
                border: '1px solid rgba(255,255,255,0.12)' }}
            >
              <img src="https://authjs.dev/img/providers/azure.svg" className="w-4 h-4" alt="" />
              Sign in with Microsoft
            </button>
          )}
        </div>

        <p className="text-center text-xs mt-6" style={{ color: 'rgba(255,248,220,0.2)' }}>
          Use your SHITAL kiosk account · Contact admin if you need access
        </p>
      </div>
    </div>
  )
}
