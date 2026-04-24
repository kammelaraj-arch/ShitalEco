import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

interface Reader { id: string; label: string; device_type: string; status: string }
interface SumUpReader { id: string; serial: string; name: string; status: string }

interface LoginResponse {
  authenticated: boolean
  error?: string
  user?: { name: string; email: string }
  branch?: { id: string; name: string }
  profile?: { profile_name: string; stripe_reader_id: string; device_label: string } | null
  stripe_reader_id?: string | null
  reader_label?: string | null
  reader_provider?: string | null
  sumup_reader_serial?: string | null
  show_monthly_giving?: boolean
  enable_gift_aid?: boolean
  tap_and_go?: boolean
  donate_title?: string
  monthly_giving_text?: string
  monthly_giving_amount?: number
}

interface AzureConfig { client_id: string; authority: string }

export function AdminScreen() {
  const {
    branchId, stripeReaderId, stripeReaderLabel, readerProvider, sumupReaderId,
    isDeviceLoggedIn, loggedInName, loggedInUsername,
    setBranchId, setReader, setDeviceFlags, setDeviceLoggedIn, setScreen,
  } = useDonationStore()

  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<'idle' | 'ok' | 'fail'>('idle')

  const [readers, setReaders] = useState<Reader[]>([])
  const [loading, setLoading] = useState(false)

  // SumUp state
  const [sumupReaders, setSumupReaders]     = useState<SumUpReader[]>([])
  const [sumupSerial, setSumupSerial]       = useState(sumupReaderId || '')
  const [sumupLoading, setSumupLoading]     = useState(false)
  const [sumupTestResult, setSumupTestResult] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [sumupError, setSumupError]         = useState('')

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

  // Auto-load readers when already logged in (e.g. after reboot)
  useEffect(() => {
    if (isDeviceLoggedIn) loadReaders()
  }, [isDeviceLoggedIn]) // eslint-disable-line react-hooks/exhaustive-deps

  function applyLogin(data: LoginResponse, enteredUsername: string) {
    if (!data.branch) return
    setBranchId(data.branch.id)
    const readerId = data.stripe_reader_id || data.profile?.stripe_reader_id || ''
    const readerLabel = data.reader_label || data.profile?.device_label || readerId
    const sumupSerial = data.sumup_reader_serial || ''
    // If backend returns a SumUp serial, it's always a SumUp device regardless of provider field in DB
    const provider = (sumupSerial ? 'sumup' : (data.reader_provider || 'stripe_terminal')) as import('../store/donation.store').ReaderProvider
    if (readerId || sumupSerial) setReader(readerId, readerLabel, provider, sumupSerial)
    setDeviceFlags({
      showMonthlyGiving: data.show_monthly_giving ?? false,
      enableGiftAid: data.enable_gift_aid ?? false,
      tapAndGo: data.tap_and_go ?? true,
      donateTitle: data.donate_title ?? 'Tap & Donate',
      monthlyGivingText: data.monthly_giving_text ?? 'Make a big impact from just £5/month',
      monthlyGivingAmount: data.monthly_giving_amount ?? 5,
    })
    // Persist login — survives reboots until explicit logout
    setDeviceLoggedIn(true, data.user?.name || enteredUsername, enteredUsername)
    loadReaders()
    setScreen('donate')
  }

  async function handleSync() {
    if (!loggedInUsername) return
    setSyncing(true); setSyncResult('idle')
    try {
      const res = await fetch(`${API_BASE}/kiosk/quick-donation/refresh-config?username=${encodeURIComponent(loggedInUsername)}`)
      const data = await res.json()
      if (!data.ok) { setSyncResult('fail'); return }
      setBranchId(data.branch.id)
      const syncSerial = data.sumup_reader_serial || ''
      const provider = (syncSerial ? 'sumup' : (data.reader_provider || 'stripe_terminal')) as import('../store/donation.store').ReaderProvider
      if (data.stripe_reader_id || syncSerial) {
        setReader(data.stripe_reader_id || '', data.reader_label || '', provider, syncSerial)
      }
      setDeviceFlags({
        showMonthlyGiving: data.show_monthly_giving ?? false,
        enableGiftAid: data.enable_gift_aid ?? false,
        tapAndGo: data.tap_and_go ?? true,
        donateTitle: data.donate_title ?? 'Tap & Donate',
        monthlyGivingText: data.monthly_giving_text ?? 'Make a big impact from just £5/month',
        monthlyGivingAmount: data.monthly_giving_amount ?? 5,
      })
      setSyncResult('ok')
      setTimeout(() => setSyncResult('idle'), 3000)
    } catch { setSyncResult('fail') }
    finally { setSyncing(false) }
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
      if (data.authenticated) applyLogin(data, username.trim())
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
          if (data.authenticated) applyLogin(data, '')
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

  async function loadSumUpReaders() {
    setSumupLoading(true); setSumupError(''); setSumupTestResult('idle')
    try {
      const res = await fetch(`${API_BASE}/kiosk/sumup/readers`)
      const data = await res.json()
      if (data.error) { setSumupError(data.error); setSumupReaders([]); return }
      setSumupReaders(data.readers || [])
    } catch { setSumupError('Could not reach server.') }
    finally { setSumupLoading(false) }
  }

  async function testSumUpReader() {
    const serial = sumupSerial.trim()
    if (!serial) return
    setSumupLoading(true); setSumupTestResult('idle'); setSumupError('')
    try {
      const res = await fetch(`${API_BASE}/kiosk/sumup/readers`)
      const data = await res.json()
      const found = (data.readers || []).some((r: SumUpReader) => r.serial === serial)
      setSumupTestResult(found ? 'ok' : 'fail')
      if (!found) setSumupError(`Serial ${serial} not found in your SumUp account.`)
    } catch { setSumupTestResult('fail'); setSumupError('Test failed — check network.') }
    finally { setSumupLoading(false) }
  }

  function assignSumUp(apiId = '') {
    const serial = sumupSerial.trim()
    if (!serial) return
    setReader('', `SumUp Solo ${serial}`, 'sumup', serial, apiId)
  }

  function handleLogout() {
    setDeviceLoggedIn(false, '')
    setUsername('')
    setPassword('')
  }

  // ── Login screen — only shown on first use or after explicit logout ──────────
  if (!isDeviceLoggedIn) {
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
                placeholder="e.g. qkk1"
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
            <button onClick={handleSync} disabled={syncing || !loggedInUsername}
              className="px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-40 transition-all active:scale-[0.97]"
              style={syncResult === 'ok'
                ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }
                : syncResult === 'fail'
                ? { background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.25)' }
                : { background: 'rgba(212,175,55,0.1)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.25)' }}>
              {syncing ? '…' : syncResult === 'ok' ? '✓ Synced' : syncResult === 'fail' ? '✗ Failed' : '↻ Sync'}
            </button>
            <button onClick={handleLogout}
              className="px-3 py-2 rounded-xl text-xs font-bold"
              style={{ background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.25)' }}>
              Logout
            </button>
            <button onClick={() => setScreen('donate')}
              className="px-3 py-2 rounded-xl text-xs font-bold"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
              ← Done
            </button>
          </div>
        </div>

        {/* Active reader badge */}
        {(stripeReaderId || sumupReaderId) && (
          <div className="mb-5 px-4 py-3 rounded-xl"
            style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)' }}>
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(212,175,55,0.6)' }}>
              Active Card Reader · {readerProvider === 'sumup' ? 'SumUp' : 'Stripe Terminal'}
            </p>
            <p className="font-black text-sm mt-0.5" style={{ color: '#D4AF37' }}>{stripeReaderLabel}</p>
            <p className="text-[10px] font-mono mt-0.5" style={{ color: 'rgba(212,175,55,0.4)' }}>
              {readerProvider === 'sumup' ? sumupReaderId : stripeReaderId}
            </p>
          </div>
        )}

        {/* ── SumUp Solo section ──────────────────────────────────────────── */}
        {readerProvider === 'sumup' || (!readerProvider && !stripeReaderId) ? (
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(255,248,220,0.35)' }}>
              💳 SumUp Solo Reader
            </p>

            {/* Serial input row */}
            <div className="flex gap-2 mb-2">
              <input
                value={sumupSerial}
                onChange={e => { setSumupSerial(e.target.value); setSumupTestResult('idle') }}
                placeholder="Serial number e.g. 200101578509"
                className="flex-1 px-3 py-2.5 rounded-xl text-xs font-mono outline-none"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#fff', border: '1px solid rgba(212,175,55,0.25)' }}
              />
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 mb-2">
              <button onClick={testSumUpReader} disabled={sumupLoading || !sumupSerial.trim()}
                className="flex-1 py-2.5 rounded-xl text-xs font-black disabled:opacity-40 transition-all active:scale-[0.97]"
                style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.25)' }}>
                {sumupLoading ? '…' : '⚡ Test'}
              </button>
              <button onClick={loadSumUpReaders} disabled={sumupLoading}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold disabled:opacity-40 transition-all active:scale-[0.97]"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.4)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {sumupLoading ? '…' : 'Fetch List'}
              </button>
              <button onClick={() => assignSumUp()} disabled={!sumupSerial.trim()}
                className="flex-1 py-2.5 rounded-xl text-xs font-black disabled:opacity-40 transition-all active:scale-[0.97]"
                style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#1a0000' }}>
                Assign
              </button>
            </div>

            {/* Test result */}
            {sumupTestResult === 'ok' && (
              <p className="text-xs px-3 py-2 rounded-lg font-bold" style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)' }}>
                ✓ Reader found in your SumUp account
              </p>
            )}
            {sumupTestResult === 'fail' && (
              <p className="text-xs px-3 py-2 rounded-lg font-bold" style={{ background: 'rgba(198,40,40,0.12)', color: '#f87171', border: '1px solid rgba(198,40,40,0.25)' }}>
                ✗ {sumupError || 'Reader not found'}
              </p>
            )}
            {sumupError && sumupTestResult === 'idle' && (
              <p className="text-xs mt-1" style={{ color: '#f87171' }}>{sumupError}</p>
            )}

            {/* Reader list from API */}
            {sumupReaders.length > 0 && (
              <div className="space-y-1.5 mt-3">
                {sumupReaders.map(r => (
                  <button key={r.serial} onClick={() => { setSumupSerial(r.serial); setSumupTestResult('idle'); assignSumUp(r.id) }}
                    className="w-full text-left px-4 py-3 rounded-xl transition-all active:scale-[0.98]"
                    style={{
                      background: sumupSerial === r.serial ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${sumupSerial === r.serial ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-sm" style={{ color: sumupSerial === r.serial ? '#D4AF37' : 'rgba(255,248,220,0.7)' }}>{r.name || r.serial}</p>
                        <p className="text-[10px] font-mono mt-0.5" style={{ color: 'rgba(255,248,220,0.3)' }}>{r.serial} · ID: {r.id}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: r.status === 'available' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.07)',
                          color: r.status === 'available' ? '#4ade80' : 'rgba(255,248,220,0.3)' }}>
                        {r.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── Stripe Terminal section ──────────────────────────────────── */
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(255,248,220,0.35)' }}>⚡ Assign Card Reader</p>
              <button onClick={loadReaders} disabled={loading}
                className="text-[10px] font-bold px-2 py-1 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.4)' }}>
                {loading ? '…' : 'Refresh'}
              </button>
            </div>
            <div className="space-y-2">
              {readers.map(r => (
                <button key={r.id} onClick={() => setReader(r.id, r.label)}
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
        )}

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
