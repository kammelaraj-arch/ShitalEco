import React, { useState } from 'react'
import { useKioskStore, type KioskTheme } from '../store/kiosk.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

export function SetupScreen() {
  const { setBranchId, setTheme, setOrgName, setOrgLogoUrl, setCardDevice, setDeviceToken, setDeviceConfigured, setScreen } = useKioskStore()
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handlePair() {
    if (!token.trim()) { setError('Enter a device token'); return }
    setLoading(true); setError('')
    try {
      const r = await fetch(`${API_BASE}/kiosk-devices/by-token/${encodeURIComponent(token.trim())}`)
      if (!r.ok) { setError('Invalid token — check Admin > Devices for the correct token'); setLoading(false); return }
      const cfg = await r.json()
      if (cfg.branch_id)    setBranchId(cfg.branch_id)
      if (cfg.kiosk_theme)  setTheme(cfg.kiosk_theme as KioskTheme)
      if (cfg.org_name)     setOrgName(cfg.org_name)
      if (cfg.org_logo_url) setOrgLogoUrl(cfg.org_logo_url)
      if (cfg.stripe_reader_id) setCardDevice('stripe_terminal', cfg.stripe_reader_id, cfg.reader_label || cfg.stripe_reader_id)
      setDeviceToken(token.trim())
      setDeviceConfigured(true)
      setScreen('idle')
    } catch {
      setError('Cannot reach server. Check network connection.')
    } finally { setLoading(false) }
  }

  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-stone-900 px-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="text-6xl mb-4">🕉</div>
          <h1 className="text-2xl font-black text-amber-400 mb-1">Device Setup</h1>
          <p className="text-sm text-stone-400">Enter the device token from Admin → Devices</p>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            value={token}
            onChange={e => setToken(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePair()}
            placeholder="Paste device token here"
            className="w-full px-4 py-3 rounded-xl bg-stone-800 text-white border border-stone-600 focus:border-amber-400 outline-none text-sm font-mono"
            autoFocus
          />

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            onClick={handlePair}
            disabled={loading || !token.trim()}
            className="w-full py-3.5 rounded-xl font-black text-base disabled:opacity-40 transition-all active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#1a0000' }}
          >
            {loading ? 'Pairing…' : 'Pair This Device →'}
          </button>
        </div>

        <p className="text-center text-xs text-stone-600">
          Go to Admin → Devices → copy the token for this device
        </p>
      </div>
    </div>
  )
}
