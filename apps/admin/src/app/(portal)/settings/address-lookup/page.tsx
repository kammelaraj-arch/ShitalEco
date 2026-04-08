'use client'
import { useState, useEffect } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

type Provider = 'getaddress' | 'ideal_postcodes'

const PROVIDERS = [
  {
    id: 'getaddress' as Provider,
    name: 'GetAddress.io',
    icon: '🏠',
    description: 'Simple UK postcode lookup. Free tier available.',
    keyName: 'GETADDRESS_API_KEY',
    docsUrl: 'https://getaddress.io',
    placeholder: 'xxxxxxxxxx',
  },
  {
    id: 'ideal_postcodes' as Provider,
    name: 'Ideal Postcodes',
    icon: '📮',
    description: 'High-quality UK address data including PAF.',
    keyName: 'IDEAL_POSTCODES_API_KEY',
    docsUrl: 'https://account.ideal-postcodes.co.uk/account',
    placeholder: 'ak_xxxxxxxxxxxx',
  },
]

export default function AddressLookupPage() {
  const [provider, setProvider] = useState<Provider | null>(null)
  const [keyStatuses, setKeyStatuses] = useState<Record<string, boolean>>({})
  const [pin, setPin] = useState('')
  const [pinVerified, setPinVerified] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [saving, setSaving] = useState(false)
  const [testPostcode, setTestPostcode] = useState('SW1A 1AA')
  const [testResult, setTestResult] = useState<string[] | null>(null)
  const [testing, setTesting] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const token = typeof window !== 'undefined' ? sessionStorage.getItem('shital_access_token') || '' : ''

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    try {
      const res = await fetch(`${API}/settings/api-keys`, { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      const keys: Record<string, boolean> = {}
      for (const k of (data.keys || [])) {
        keys[k.key_name] = k.has_value
      }
      setKeyStatuses(keys)
      // Read provider setting from app_settings
      const res2 = await fetch(`${API}/settings/address-provider`, { headers: { Authorization: `Bearer ${token}` } })
      if (res2.ok) {
        const d = await res2.json()
        setProvider(d.provider || 'getaddress')
      } else {
        setProvider('getaddress')
      }
    } catch { setProvider('getaddress') }
  }

  async function verifyPin() {
    if (pinInput.length < 4) { setPinError('PIN must be at least 4 digits'); return }
    try {
      const res = await fetch(`${API}/settings/api-keys/verify-pin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pin: pinInput }),
      })
      const d = await res.json()
      if (d.ok) { setPin(pinInput); setPinVerified(true); setPinError('') }
      else setPinError('Incorrect PIN')
    } catch { setPinError('Network error') }
  }

  async function saveProvider(p: Provider) {
    setProvider(p)
    setSaving(true)
    try {
      await fetch(`${API}/settings/address-provider`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider: p }),
      })
      setSaveMsg('Provider saved')
      setTimeout(() => setSaveMsg(''), 2000)
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  async function testLookup() {
    if (!testPostcode.trim()) return
    setTesting(true); setTestResult(null)
    try {
      const clean = testPostcode.trim().replace(/\s+/g, '%20')
      const res = await fetch(`${API}/kiosk/postcode/${encodeURIComponent(testPostcode.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const d = await res.json()
      setTestResult(d.addresses || [d.error || 'No results'])
    } catch { setTestResult(['Network error']) }
    finally { setTesting(false) }
  }

  const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-red-700/40'

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-black text-white">📮 Address Lookup</h1>
        <p className="text-white/40 mt-1 text-sm">Configure which provider to use for UK postcode lookups in Gift Aid and donation forms.</p>
      </div>

      {/* Provider selection */}
      <div className="glass rounded-2xl p-6 space-y-4">
        <h2 className="text-white font-black text-base">Active Provider</h2>
        <div className="grid grid-cols-2 gap-3">
          {PROVIDERS.map(p => {
            const active = provider === p.id
            const hasKey = keyStatuses[p.keyName]
            return (
              <button
                key={p.id}
                onClick={() => saveProvider(p.id)}
                disabled={saving}
                className="rounded-2xl p-4 text-left transition-all active:scale-95 space-y-2"
                style={{
                  background: active ? 'rgba(185,28,28,0.15)' : 'rgba(255,255,255,0.04)',
                  border: active ? '2px solid rgba(185,28,28,0.5)' : '2px solid rgba(255,255,255,0.08)',
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{p.icon}</span>
                  {active && <span className="text-xs font-black px-2 py-0.5 rounded-full" style={{ background: 'rgba(185,28,28,0.2)', color: '#fca5a5' }}>Active</span>}
                </div>
                <p className="text-white font-black text-sm">{p.name}</p>
                <p className="text-white/40 text-xs">{p.description}</p>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${hasKey ? 'bg-green-400' : 'bg-red-400'}`} />
                  <span className="text-xs" style={{ color: hasKey ? '#4ade80' : '#f87171' }}>
                    {hasKey ? 'API key set' : 'API key missing'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
        {saveMsg && <p className="text-green-400 text-sm font-bold">{saveMsg}</p>}
      </div>

      {/* API Keys — PIN-gated */}
      <div className="glass rounded-2xl p-6 space-y-4">
        <h2 className="text-white font-black text-base">API Keys</h2>
        {!pinVerified ? (
          <div className="space-y-3">
            <p className="text-white/40 text-sm">Enter your admin PIN to view or update keys.</p>
            <input type="password" inputMode="numeric" maxLength={8} placeholder="Admin PIN"
              value={pinInput} onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => e.key === 'Enter' && verifyPin()}
              className={inp} />
            {pinError && <p className="text-red-400 text-sm">{pinError}</p>}
            <button onClick={verifyPin}
              className="px-6 py-2.5 rounded-xl text-white font-black text-sm"
              style={{ background: 'linear-gradient(135deg,#b91c1c,#991b1b)' }}>
              Unlock
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {PROVIDERS.map(p => (
              <KeyRow key={p.id} keyName={p.keyName} label={`${p.icon} ${p.name} API Key`}
                placeholder={p.placeholder} docsUrl={p.docsUrl}
                pin={pin} token={token} hasValue={keyStatuses[p.keyName]}
                onSaved={loadSettings} />
            ))}
          </div>
        )}
      </div>

      {/* Test */}
      <div className="glass rounded-2xl p-6 space-y-4">
        <h2 className="text-white font-black text-base">Test Lookup</h2>
        <div className="flex gap-2">
          <input className={`${inp} flex-1`} value={testPostcode}
            onChange={e => setTestPostcode(e.target.value.toUpperCase())}
            placeholder="e.g. SW1A 1AA" />
          <button onClick={testLookup} disabled={testing}
            className="px-5 py-2.5 rounded-xl text-white font-black text-sm disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#b91c1c,#991b1b)' }}>
            {testing ? '…' : 'Test'}
          </button>
        </div>
        {testResult && (
          <div className="rounded-xl p-3 space-y-1" style={{ background: 'rgba(0,0,0,0.3)' }}>
            {testResult.slice(0, 8).map((a, i) => (
              <p key={i} className="text-white/70 text-xs font-mono">{a}</p>
            ))}
            {testResult.length > 8 && <p className="text-white/30 text-xs">+{testResult.length - 8} more</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function KeyRow({ keyName, label, placeholder, docsUrl, pin, token, hasValue, onSaved }: {
  keyName: string; label: string; placeholder: string; docsUrl: string
  pin: string; token: string; hasValue: boolean; onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)

  async function save() {
    if (!value.trim()) return
    setSaving(true); setErr('')
    try {
      const res = await fetch(`${API}/settings/api-keys/${keyName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Admin-Pin': pin },
        body: JSON.stringify({ value: value.trim() }),
      })
      const d = await res.json()
      if (d.updated) { setSaved(true); setEditing(false); setValue(''); setTimeout(() => setSaved(false), 2000); onSaved() }
      else setErr(d.detail || 'Save failed')
    } catch { setErr('Network error') }
    finally { setSaving(false) }
  }

  const inp = 'flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-red-700/40 font-mono'

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-white/80 text-sm font-bold">{label}</p>
          <p className="text-white/30 text-xs font-mono">{keyName}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold`}
            style={hasValue ? { background: 'rgba(22,163,74,0.15)', color: '#4ade80' } : { background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>
            {hasValue ? 'Set' : 'Missing'}
          </span>
          {saved && <span className="text-green-400 text-xs font-bold">Saved!</span>}
          <button onClick={() => setEditing(!editing)}
            className="px-3 py-1 rounded-lg text-xs font-bold"
            style={{ background: 'rgba(185,28,28,0.15)', color: '#fca5a5', border: '1px solid rgba(185,28,28,0.25)' }}>
            {hasValue ? 'Update' : 'Set'}
          </button>
        </div>
      </div>
      {editing && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input type="password" className={inp} placeholder={placeholder}
              value={value} onChange={e => setValue(e.target.value)} autoFocus />
            <button onClick={save} disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-black text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#b91c1c,#991b1b)' }}>
              {saving ? '…' : 'Save'}
            </button>
            <button onClick={() => { setEditing(false); setValue('') }}
              className="px-3 py-2 rounded-xl text-xs font-bold text-white/40 border border-white/10">
              ✕
            </button>
          </div>
          {err && <p className="text-red-400 text-xs">{err}</p>}
          <a href={docsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline">
            Get API key →
          </a>
        </div>
      )}
    </div>
  )
}
