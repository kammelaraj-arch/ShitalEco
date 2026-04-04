import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

interface Reader {
  id: string
  label: string
  device_type: string
  status: string
}

interface LoggedInUser {
  name: string
  email: string
  branch: { id: string; name: string }
}

export function AdminScreen() {
  const {
    branchId, stripeReaderId, stripeReaderLabel,
    setBranchId, setReader, setScreen,
  } = useDonationStore()

  const [readers, setReaders] = useState<Reader[]>([])
  const [loading, setLoading] = useState(false)

  // Login state
  const [loggedIn, setLoggedIn] = useState<LoggedInUser | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  async function handleLogin() {
    if (!email.trim() || !password.trim()) return
    setLoginLoading(true)
    setLoginError('')
    try {
      const res = await fetch(`${API_BASE}/kiosk/quick-donation/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = await res.json()
      if (data.authenticated) {
        setLoggedIn({ name: data.user.name, email: data.user.email, branch: data.branch })
        setBranchId(data.branch.id)
        loadReaders()
      } else {
        setLoginError(data.error || 'Login failed')
      }
    } catch {
      setLoginError('Cannot reach server')
    }
    setLoginLoading(false)
  }

  async function loadReaders() {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/kiosk/terminal/readers`)
      const data = await res.json()
      setReaders(data.readers || [])
    } catch {
      setReaders([])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (loggedIn) loadReaders()
  }, [loggedIn])

  // ── Login Screen ──
  if (!loggedIn) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-white px-8"
        style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm">

          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-black text-gray-900">Kiosk Login</h1>
            <button onClick={() => setScreen('idle')}
              className="px-4 py-2 rounded-xl bg-gray-100 text-gray-600 font-semibold text-sm active:scale-95">
              ← Back
            </button>
          </div>

          <div className="space-y-4 mb-6">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="quickkiosk-wembley@shital.org"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-400"
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-400"
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
              />
            </div>
          </div>

          {loginError && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-red-600 text-sm font-semibold">{loginError}</p>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loginLoading || !email.trim() || !password.trim()}
            className="w-full py-4 rounded-2xl text-white font-black text-base shadow-lg active:scale-[0.98] transition-all disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)' }}
          >
            {loginLoading ? 'Logging in...' : 'Login'}
          </button>

          <p className="text-gray-300 text-xs text-center mt-6">
            QuickDonation Kiosk v1.0.0
          </p>
        </motion.div>
      </div>
    )
  }

  // ── Settings Screen (post-login) ──
  return (
    <div className="w-full h-full flex flex-col bg-white p-8 kiosk-scroll"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black text-gray-900">Quick Donation Settings</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Logged in as <span className="font-bold">{loggedIn.name}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setLoggedIn(null); setEmail(''); setPassword('') }}
              className="px-4 py-2 rounded-xl bg-red-50 text-red-600 font-semibold text-sm active:scale-95">
              Logout
            </button>
            <button onClick={() => setScreen('idle')}
              className="px-4 py-2 rounded-xl bg-gray-100 text-gray-600 font-semibold text-sm active:scale-95">
              ← Done
            </button>
          </div>
        </div>

        {/* Branch info */}
        <div className="mb-6 px-4 py-3 bg-orange-50 border border-orange-200 rounded-xl">
          <p className="text-orange-700 text-sm font-semibold">
            Branch: <span className="font-black">{loggedIn.branch.name}</span>
          </p>
          <p className="text-orange-600 text-xs">{loggedIn.email}</p>
        </div>

        {/* Card Reader Selection */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
              Assign Card Reader
            </h2>
            <button onClick={loadReaders} disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-500 text-xs font-semibold">
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {stripeReaderId && (
            <div className="mb-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
              <p className="text-green-700 text-sm font-semibold">
                Active Reader: <span className="font-black">{stripeReaderLabel}</span>
              </p>
              <p className="text-green-600 text-xs">{stripeReaderId}</p>
            </div>
          )}

          <div className="space-y-2">
            {readers.map(r => (
              <button
                key={r.id}
                onClick={() => setReader(r.id, r.label)}
                className={`w-full text-left px-4 py-3 rounded-xl transition-all active:scale-[0.98] ${
                  stripeReaderId === r.id
                    ? 'bg-orange-50 border-2 border-orange-400'
                    : 'bg-gray-50 border-2 border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-gray-900 text-sm">{r.label}</p>
                    <p className="text-gray-400 text-xs">{r.device_type} - {r.id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {stripeReaderId === r.id && (
                      <span className="text-xs font-black px-2 py-1 rounded-lg bg-orange-100 text-orange-700">
                        ASSIGNED
                      </span>
                    )}
                    <span className={`text-xs font-bold px-2 py-1 rounded-lg ${
                      r.status === 'online' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {r.status}
                    </span>
                  </div>
                </div>
              </button>
            ))}
            {!loading && readers.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-6">
                No readers found. Ensure Stripe Terminal is configured.
              </p>
            )}
          </div>
        </div>

        {/* Manual Reader ID */}
        <div className="mb-8">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
            Manual Reader ID
          </h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={stripeReaderId}
              onChange={e => setReader(e.target.value, stripeReaderLabel)}
              placeholder="tmr_xxxxx"
              className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-400"
            />
            <input
              type="text"
              value={stripeReaderLabel}
              onChange={e => setReader(stripeReaderId, e.target.value)}
              placeholder="Reader label"
              className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-400"
            />
          </div>
        </div>

        {/* API info */}
        <div className="text-center">
          <p className="text-gray-400 text-xs">API: {API_BASE}</p>
          <p className="text-gray-300 text-xs mt-1">QuickDonation Kiosk v1.0.0</p>
        </div>
      </motion.div>
    </div>
  )
}
