import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

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
  clover_device_id?: string | null
  kiosk_device_id?: string | null
  show_monthly_giving?: boolean
  enable_gift_aid?: boolean
  tap_and_go?: boolean
  donate_title?: string
  monthly_giving_text?: string
  monthly_giving_amount?: number
  confirmation_text?: string
  kiosk_theme?: string
  org_logo_url?: string
  org_name?: string
  bg_color?: string
}

interface AzureConfig { client_id: string; authority: string }

export function AdminScreen() {
  const {
    branchId, stripeReaderId, stripeReaderLabel, readerProvider, sumupReaderId, cloverDeviceId,
    isDeviceLoggedIn, loggedInName, loggedInUsername,
    setBranchId, setReader, setKioskDeviceId, setDeviceFlags, setDeviceLoggedIn, setScreen,
  } = useDonationStore()

  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<'idle' | 'ok' | 'fail'>('idle')

  // Reader pairing state was removed 23 Oct 2026 — pairings are now
  // admin-only. The device only reads sumupReaderId (etc.) from the store,
  // which is populated by handleSync / applyLogin from the server.

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

  // Formerly auto-loaded the Stripe reader list for the pairing tab —
  // removed when pairings moved admin-only (23 Oct). The device reads its
  // reader from the login response and never fetches the full list.

  function applyLogin(data: LoginResponse, enteredUsername: string) {
    if (!data.branch) return
    setBranchId(data.branch.id)

    // DB is the single source of truth for reader config.
    // Always apply — clears stale localStorage if device has no reader assigned.
    const readerId = data.stripe_reader_id || ''
    const sumupSerial = data.sumup_reader_serial || ''
    const cloverId = data.clover_device_id || ''
    const readerLabel = data.reader_label || readerId || sumupSerial || cloverId
    const provider = (sumupSerial ? 'sumup' : cloverId ? 'clover' : (data.reader_provider || 'stripe_terminal')) as import('../store/donation.store').ReaderProvider
    setReader(readerId, readerLabel, provider, sumupSerial, '', cloverId)
    setKioskDeviceId(data.kiosk_device_id || '')

    setDeviceFlags({
      showMonthlyGiving: data.show_monthly_giving ?? false,
      enableGiftAid: data.enable_gift_aid ?? false,
      tapAndGo: data.tap_and_go ?? true,
      donateTitle: data.donate_title ?? 'Tap & Donate',
      monthlyGivingText: data.monthly_giving_text ?? 'Make a big impact from just £5/month',
      monthlyGivingAmount: data.monthly_giving_amount ?? 5,
      confirmationText: data.confirmation_text ?? '',
      kioskTheme: data.kiosk_theme ?? 'saffron',
      orgLogoUrl: data.org_logo_url ?? '',
      orgName: data.org_name ?? '',
      bgColor: data.bg_color ?? '',
    })
    // Persist login — survives reboots until explicit logout
    setDeviceLoggedIn(true, data.user?.name || enteredUsername, enteredUsername)
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
      // Always overwrite reader from DB — same rule as login
      const syncSerial = data.sumup_reader_serial || ''
      const syncClover = data.clover_device_id || ''
      const provider = (syncSerial ? 'sumup' : syncClover ? 'clover' : (data.reader_provider || 'stripe_terminal')) as import('../store/donation.store').ReaderProvider
      setReader(data.stripe_reader_id || '', data.reader_label || data.stripe_reader_id || syncSerial || syncClover, provider, syncSerial, '', syncClover)
      setKioskDeviceId(data.kiosk_device_id || '')
      setDeviceFlags({
        showMonthlyGiving: data.show_monthly_giving ?? false,
        enableGiftAid: data.enable_gift_aid ?? false,
        tapAndGo: data.tap_and_go ?? true,
        donateTitle: data.donate_title ?? 'Tap & Donate',
        monthlyGivingText: data.monthly_giving_text ?? 'Make a big impact from just £5/month',
        monthlyGivingAmount: data.monthly_giving_amount ?? 5,
        confirmationText: data.confirmation_text ?? '',
        kioskTheme: data.kiosk_theme ?? 'saffron',
        orgLogoUrl: data.org_logo_url ?? '',
        orgName: data.org_name ?? '',
        bgColor: data.bg_color ?? '',
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

  // Removed 23 Oct 2026: all client-side reader-pairing helpers
  // (loadReaders, loadSumUpReaders, testSumUpReader, loadCloverDevices,
  // assignClover) deleted when pairings moved admin-only. The device no
  // longer discovers or picks readers — it reads its single paired
  // reader from the login/refresh-config response and displays it
  // read-only. See the "Card Reader (set by admin)" block below.


  // Removed 23 Oct 2026: persistReaderToBackend() and assignSumUp() used
  // to POST to /kiosk/quick-donation/assign-reader so the device itself
  // could set its own paired reader. That endpoint is now retired (returns
  // 410 Gone) because device-side writes were the root cause of the
  // Wembley SumUp -> Stripe silent-flip incident. Pairings live in the
  // admin DB and are the single source of truth; the device reads them
  // on login via POST /kiosk/quick-donation/login and never writes them.

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
        {(stripeReaderId || sumupReaderId || cloverDeviceId) && (
          <div className="mb-5 px-4 py-3 rounded-xl"
            style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)' }}>
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(212,175,55,0.6)' }}>
              Active Card Reader · {readerProvider === 'sumup' ? 'SumUp Solo' : readerProvider === 'clover' ? 'Clover Flex' : 'Stripe Terminal'}
            </p>
            <p className="font-black text-sm mt-0.5" style={{ color: '#D4AF37' }}>{stripeReaderLabel}</p>
            <p className="text-[10px] font-mono mt-0.5" style={{ color: 'rgba(212,175,55,0.4)' }}>
              {readerProvider === 'sumup' ? sumupReaderId : readerProvider === 'clover' ? cloverDeviceId : stripeReaderId}
            </p>
          </div>
        )}

        {/* ── Card Reader (READ-ONLY — admin-paired only) ───────────────────
            Pairings are the admin's source of truth, never written from the
            device. If no reader is paired yet, the device shows an
            instruction to go to Admin → Devices. This closes the whole
            class of "silent flip" bugs that caused the 23 Oct Wembley
            incident: the device literally cannot overwrite its own pairing.
            See /kiosk/quick-donation/assign-reader (now 410 Gone). */}
        <div className="mb-6 px-4 py-3 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,248,220,0.35)' }}>
            💳 Card Reader (set by admin)
          </p>
          {sumupReaderId ? (
            <>
              <p className="font-black text-sm" style={{ color: '#D4AF37' }}>
                SumUp Solo
              </p>
              <p className="text-[11px] font-mono mt-0.5" style={{ color: 'rgba(255,248,220,0.45)' }}>
                Serial: {sumupReaderId}
              </p>
              <p className="text-[10px] mt-2 italic" style={{ color: 'rgba(255,248,220,0.3)' }}>
                To change the reader, ask an admin to update this device in
                Admin → Devices. The device itself cannot pair readers.
              </p>
            </>
          ) : (
            <>
              <p className="font-black text-sm" style={{ color: '#f87171' }}>
                ⚠ No reader paired
              </p>
              <p className="text-[11px] mt-1" style={{ color: 'rgba(255,248,220,0.55)' }}>
                This device has no card reader assigned. Ask an admin to
                pair a SumUp Solo in Admin → Devices → Edit, then press
                &quot;Sync from server&quot; above.
              </p>
            </>
          )}
        </div>

        {/* Stripe + Clover pairing sections removed on 23 Oct 2026 — Quick
            Donation is SumUp-only (per operator rule). Those sections were
            the vector of the Wembley silent-flip incident where staff
            tapping the Stripe tab inadvertently rewrote SumUp rows to
            provider=stripe_terminal. The backend endpoint also now rejects
            provider != 'sumup' so a stale frontend cannot re-introduce the
            same bug. Stripe + Clover readers register under the Admin app's
            Card Readers page, not here. */}

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
