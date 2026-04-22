'use client'
import { useState, useEffect, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiKey {
  key_name: string
  description: string
  group_name: string
  is_sensitive: boolean
  has_value: boolean
  updated_at: string | null
  updated_by: string | null
}

// ── Group ordering ────────────────────────────────────────────────────────────

const GROUP_ORDER = ['Stripe', 'SumUp', 'PayPal', 'Microsoft', 'AI', 'Email', 'Google', 'WhatsApp', 'HMRC', 'Address', 'Other']
const GROUP_ICONS: Record<string, string> = {
  Stripe:    '💳',
  SumUp:     '🟦',
  PayPal:    '🅿️',
  Microsoft: '🔷',
  AI:        '🤖',
  Email:     '✉️',
  Google:    '🔍',
  WhatsApp:  '💬',
  HMRC:      '🏛️',
  Address:   '📮',
  Other:     '🔑',
}

// ── PIN entry overlay ─────────────────────────────────────────────────────────

function PinOverlay({ onVerified }: { onVerified: (pin: string) => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetDone, setResetDone] = useState(false)

  async function handleReset() {
    setResetting(true); setError('')
    try {
      const token = localStorage.getItem('shital_access_token') || ''
      const res = await fetch(`${API}/settings/api-keys/reset-pin`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.ok) {
        setResetDone(true)
        setError('')
      } else {
        setError(data.detail || 'Reset failed. SUPER_ADMIN role required.')
      }
    } catch {
      setError('Unable to reset PIN')
    } finally { setResetting(false) }
  }

  async function handleVerify() {
    if (pin.length < 4) { setError('PIN must be at least 4 digits'); return }
    setLoading(true); setError('')
    try {
      const token = localStorage.getItem('shital_access_token') || ''
      const res = await fetch(`${API}/settings/api-keys/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pin }),
      })
      const data = await res.json()
      if (data.ok) {
        onVerified(pin)
      } else {
        setError('Incorrect PIN. Default PIN is 1234 on first use.')
      }
    } catch {
      setError('Unable to verify PIN')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
      <div className="glass rounded-3xl p-8 w-full max-w-sm text-center space-y-6" style={{ border: '1px solid rgba(185,28,28,0.3)' }}>
        <div className="text-5xl">🔐</div>
        <div>
          <h2 className="text-white font-black text-xl">Admin PIN Required</h2>
          <p className="text-white/40 text-sm mt-1">Enter your PIN to access API key management</p>
        </div>
        <input
          type="password"
          inputMode="numeric"
          maxLength={8}
          placeholder="Enter PIN"
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={e => e.key === 'Enter' && handleVerify()}
          className="w-full text-center text-2xl tracking-[0.5em] bg-white/5 border border-white/10 rounded-2xl px-4 py-4 text-white outline-none focus:border-red-700/50"
          autoFocus
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {resetDone && <p className="text-green-400 text-sm">PIN reset to 1234. You can now log in.</p>}
        <button
          onClick={handleVerify}
          disabled={loading}
          className="w-full py-3.5 rounded-2xl font-black text-white text-base disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #b91c1c, #991b1b)' }}
        >
          {loading ? 'Verifying…' : 'Unlock'}
        </button>
        <button
          onClick={handleReset}
          disabled={resetting}
          className="text-white/30 text-xs underline hover:text-white/60 transition-colors disabled:opacity-40"
        >
          {resetting ? 'Resetting…' : 'Forgot PIN? Reset to 1234 (SUPER_ADMIN only)'}
        </button>
      </div>
    </div>
  )
}

// ── Key row ───────────────────────────────────────────────────────────────────

function KeyRow({
  k, pin, onSaved,
}: {
  k: ApiKey
  pin: string
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [newValue, setNewValue] = useState('')
  const [revealedValue, setRevealedValue] = useState('')
  const [loadingReveal, setLoadingReveal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  const token = typeof window !== 'undefined' ? (localStorage.getItem('shital_access_token') || '') : ''

  async function reveal() {
    setLoadingReveal(true); setErr('')
    try {
      const res = await fetch(`${API}/settings/api-keys/${k.key_name}/value`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Admin-Pin': pin },
      })
      const data = await res.json()
      if (data.value !== undefined) setRevealedValue(data.value)
      else setErr(data.detail || 'Failed to load')
    } catch { setErr('Network error') }
    finally { setLoadingReveal(false) }
  }

  async function save() {
    if (!newValue.trim()) { setErr('Value cannot be empty'); return }
    setSaving(true); setErr('')
    try {
      const res = await fetch(`${API}/settings/api-keys/${k.key_name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Admin-Pin': pin },
        body: JSON.stringify({ value: newValue.trim() }),
      })
      const data = await res.json()
      if (data.updated) {
        setSaved(true); setEditing(false); setNewValue(''); setRevealedValue('')
        setTimeout(() => setSaved(false), 2500)
        onSaved()
      } else {
        setErr(data.detail || 'Save failed')
      }
    } catch { setErr('Network error') }
    finally { setSaving(false) }
  }

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold text-white/90">{k.key_name}</span>
            {k.has_value ? (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: 'rgba(22,163,74,0.15)', color: '#4ade80', border: '1px solid rgba(22,163,74,0.3)' }}>Set</span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>Missing</span>
            )}
            {saved && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}>Saved!</span>
            )}
          </div>
          <p className="text-white/40 text-xs mt-0.5 truncate">{k.description}</p>
          {k.updated_at && k.updated_by && (
            <p className="text-white/20 text-xs mt-0.5">
              Updated by {k.updated_by} · {new Date(k.updated_at).toLocaleDateString('en-GB')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!editing && (
            <>
              {k.has_value && (
                <button
                  onClick={revealedValue ? () => setRevealedValue('') : reveal}
                  disabled={loadingReveal}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold text-white/60 border border-white/10 hover:border-white/20 disabled:opacity-40 transition-colors"
                >
                  {loadingReveal ? '…' : revealedValue ? 'Hide' : 'Reveal'}
                </button>
              )}
              <button
                onClick={() => { setEditing(true); setErr('') }}
                className="px-3 py-1.5 rounded-xl text-xs font-bold transition-colors"
                style={{ background: 'rgba(185,28,28,0.15)', color: '#fca5a5', border: '1px solid rgba(185,28,28,0.25)' }}
              >
                {k.has_value ? 'Update' : 'Set value'}
              </button>
            </>
          )}
        </div>
      </div>

      {revealedValue && !editing && (
        <div className="font-mono text-xs break-all rounded-xl px-3 py-2.5" style={{ background: 'rgba(0,0,0,0.3)', color: '#a3e635', border: '1px solid rgba(163,230,53,0.15)' }}>
          {revealedValue}
        </div>
      )}

      {editing && (
        <div className="space-y-2">
          <input
            type={k.is_sensitive ? 'password' : 'text'}
            placeholder={`Enter new value for ${k.key_name}`}
            value={newValue}
            onChange={e => setNewValue(e.target.value)}
            className="w-full font-mono text-sm bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-white outline-none focus:border-red-700/40"
            autoFocus
          />
          {err && <p className="text-red-400 text-xs">{err}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => { setEditing(false); setNewValue(''); setErr('') }}
              className="px-4 py-2 rounded-xl text-xs font-bold text-white/50 border border-white/10 hover:border-white/20"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-black text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #b91c1c, #991b1b)' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Change PIN modal ──────────────────────────────────────────────────────────

function ChangePinModal({ pin, onClose }: { pin: string; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleChange() {
    if (newPin !== confirm) { setErr('PINs do not match'); return }
    if (newPin.length < 4) { setErr('PIN must be at least 4 digits'); return }
    setLoading(true); setErr('')
    const token = localStorage.getItem('shital_access_token') || ''
    try {
      const res = await fetch(`${API}/settings/api-keys/change-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_pin: current, new_pin: newPin }),
      })
      const data = await res.json()
      if (data.changed) setDone(true)
      else setErr(data.detail || 'Failed to change PIN')
    } catch { setErr('Network error') }
    finally { setLoading(false) }
  }

  const inp = 'w-full text-center tracking-[0.3em] bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-red-700/40 text-lg'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
      <div className="glass rounded-3xl p-8 w-full max-w-sm space-y-5" style={{ border: '1px solid rgba(185,28,28,0.3)' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-white font-black text-lg">Change Admin PIN</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl">×</button>
        </div>
        {done ? (
          <div className="text-center py-6 space-y-3">
            <div className="text-5xl">✅</div>
            <p className="text-green-400 font-bold">PIN changed successfully</p>
            <button onClick={onClose} className="w-full py-3 rounded-2xl text-white font-bold" style={{ background: 'rgba(22,163,74,0.2)', border: '1px solid rgba(22,163,74,0.3)' }}>Close</button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1 block">Current PIN</label>
                <input type="password" inputMode="numeric" maxLength={8} placeholder="••••" value={current} onChange={e => setCurrent(e.target.value.replace(/\D/g, ''))} className={inp} />
              </div>
              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1 block">New PIN</label>
                <input type="password" inputMode="numeric" maxLength={8} placeholder="••••" value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))} className={inp} />
              </div>
              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1 block">Confirm New PIN</label>
                <input type="password" inputMode="numeric" maxLength={8} placeholder="••••" value={confirm} onChange={e => setConfirm(e.target.value.replace(/\D/g, ''))} className={inp} />
              </div>
            </div>
            {err && <p className="text-red-400 text-sm">{err}</p>}
            <button onClick={handleChange} disabled={loading} className="w-full py-3.5 rounded-2xl font-black text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg, #b91c1c, #991b1b)' }}>
              {loading ? 'Changing…' : 'Change PIN'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Add New Key modal ─────────────────────────────────────────────────────────

function AddKeyModal({ pin, onClose, onSaved, existingGroups }: { pin: string; onClose: () => void; onSaved: () => void; existingGroups: string[] }) {
  const [keyName, setKeyName] = useState('')
  const [value, setValue] = useState('')
  const [description, setDescription] = useState('')
  const [groupName, setGroupName] = useState('Other')
  const [customGroup, setCustomGroup] = useState('')
  const [useCustomGroup, setUseCustomGroup] = useState(false)
  const [isSensitive, setIsSensitive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const token = typeof window !== 'undefined' ? (localStorage.getItem('shital_access_token') || '') : ''

  const allGroups = [...new Set([...GROUP_ORDER, ...existingGroups])]
  const resolvedGroup = useCustomGroup ? customGroup.trim() || 'Other' : groupName

  async function handleSave() {
    if (!keyName.trim()) { setErr('Key name is required'); return }
    if (!value.trim()) { setErr('Value is required'); return }
    if (useCustomGroup && !customGroup.trim()) { setErr('Group name is required'); return }
    const name = keyName.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
    setSaving(true); setErr('')
    try {
      const res = await fetch(`${API}/settings/api-keys/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Admin-Pin': pin },
        body: JSON.stringify({ value: value.trim(), description: description.trim(), group_name: resolvedGroup, is_sensitive: isSensitive }),
      })
      const data = await res.json()
      if (data.updated) { onSaved(); onClose() }
      else setErr(data.detail || 'Save failed')
    } catch { setErr('Network error') }
    finally { setSaving(false) }
  }

  const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-red-700/40'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
      <div className="glass rounded-3xl p-8 w-full max-w-md space-y-5" style={{ border: '1px solid rgba(185,28,28,0.3)' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-white font-black text-lg">Add New API Key</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl">×</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1 block">Key Name</label>
            <input className={inp} placeholder="e.g. MY_API_KEY" value={keyName}
              onChange={e => setKeyName(e.target.value)} autoFocus />
            <p className="text-white/20 text-xs mt-1">Auto-uppercased, spaces → underscores</p>
          </div>
          <div>
            <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1 block">Value</label>
            <input className={inp} type={isSensitive ? 'password' : 'text'} placeholder="Enter key value"
              value={value} onChange={e => setValue(e.target.value)} />
          </div>
          <div>
            <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1 block">Description</label>
            <input className={inp} placeholder="What this key is for" value={description}
              onChange={e => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1 block">Group</label>
            <div className="flex gap-2 mb-2">
              <button onClick={() => setUseCustomGroup(false)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${!useCustomGroup ? 'text-white' : 'text-white/40'}`}
                style={!useCustomGroup ? { background: 'rgba(185,28,28,0.25)', border: '1px solid rgba(185,28,28,0.4)' } : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                Existing
              </button>
              <button onClick={() => setUseCustomGroup(true)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${useCustomGroup ? 'text-white' : 'text-white/40'}`}
                style={useCustomGroup ? { background: 'rgba(185,28,28,0.25)', border: '1px solid rgba(185,28,28,0.4)' } : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                + New Group
              </button>
            </div>
            {useCustomGroup ? (
              <input className={inp} placeholder="e.g. Twilio, AWS, Custom" value={customGroup}
                onChange={e => setCustomGroup(e.target.value)} autoFocus />
            ) : (
              <select className={inp} value={groupName} onChange={e => setGroupName(e.target.value)}>
                {allGroups.map(g => (
                  <option key={g} value={g} style={{ background: '#1a1a1a' }}>{g}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1 block">Sensitive</label>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={isSensitive} onChange={e => setIsSensitive(e.target.checked)}
                className="w-4 h-4 accent-red-700" />
              <span className="text-white/50 text-sm">Hide value (recommended for secrets)</span>
            </div>
          </div>
        </div>
        {err && <p className="text-red-400 text-sm">{err}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl text-sm font-bold text-white/50 border border-white/10">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #b91c1c, #991b1b)' }}>
            {saving ? 'Saving…' : 'Add Key'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ApiKeysPage() {
  const [unlocked, setUnlocked] = useState(false)
  const [pin, setPin] = useState('')
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(false)
  const [showChangePinModal, setShowChangePinModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [activeGroup, setActiveGroup] = useState<string>('all')

  const token = typeof window !== 'undefined' ? (localStorage.getItem('shital_access_token') || '') : ''

  const loadKeys = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/settings/api-keys`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      setKeys(data.keys || [])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => {
    if (unlocked) loadKeys()
  }, [unlocked, loadKeys])

  function handlePinVerified(verifiedPin: string) {
    setPin(verifiedPin)
    setUnlocked(true)
  }

  // Group keys
  const grouped = keys.reduce((acc: Record<string, ApiKey[]>, k) => {
    const g = k.group_name || 'Other'
    ;(acc[g] = acc[g] || []).push(k)
    return acc
  }, {})

  const allGroups = GROUP_ORDER.filter(g => grouped[g])
  const filtered = activeGroup === 'all' ? keys : (grouped[activeGroup] || [])
  const filteredGrouped = activeGroup === 'all' ? grouped : { [activeGroup]: filtered }
  const filteredGroupOrder = activeGroup === 'all' ? allGroups : allGroups.filter(g => g === activeGroup)

  const totalMissing = keys.filter(k => !k.has_value).length
  const totalSet = keys.filter(k => k.has_value).length

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white">🔑 API Key Management</h1>
          <p className="text-white/40 mt-1 text-sm">
            Encrypted secrets stored in the database. Changes take effect immediately — no deployment needed.
          </p>
        </div>
        {unlocked && (
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 rounded-xl text-sm font-black text-white transition-colors"
              style={{ background: 'linear-gradient(135deg, #b91c1c, #991b1b)' }}
            >
              + Add Key
            </button>
            <button
              onClick={() => setShowChangePinModal(true)}
              className="px-4 py-2 rounded-xl text-sm font-bold text-white/60 border border-white/10 hover:border-white/20 transition-colors"
            >
              Change PIN
            </button>
          </div>
        )}
      </div>

      {/* Stats bar */}
      {unlocked && !loading && (
        <div className="flex gap-4">
          <div className="flex-1 glass rounded-2xl p-4 text-center">
            <div className="text-2xl font-black text-green-400">{totalSet}</div>
            <div className="text-white/40 text-xs mt-0.5">Keys Set</div>
          </div>
          <div className="flex-1 glass rounded-2xl p-4 text-center">
            <div className="text-2xl font-black text-red-400">{totalMissing}</div>
            <div className="text-white/40 text-xs mt-0.5">Missing</div>
          </div>
          <div className="flex-1 glass rounded-2xl p-4 text-center">
            <div className="text-2xl font-black text-white/80">{keys.length}</div>
            <div className="text-white/40 text-xs mt-0.5">Total Keys</div>
          </div>
        </div>
      )}

      {/* Security notice */}
      <div className="rounded-2xl px-4 py-3 flex gap-3 items-start" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
        <span className="text-yellow-400 text-lg flex-shrink-0 mt-0.5">⚠️</span>
        <div>
          <p className="text-yellow-300/80 text-sm font-semibold">Values are encrypted with AES-256 in the database</p>
          <p className="text-yellow-300/50 text-xs mt-0.5">Only SUPER_ADMIN and ADMIN users can access this page. A PIN is required to reveal or update values. Never share your PIN.</p>
        </div>
      </div>

      {/* PIN overlay */}
      {!unlocked && <PinOverlay onVerified={(p) => { setPin(p); setUnlocked(true) }} />}

      {/* Group filter tabs */}
      {unlocked && allGroups.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveGroup('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${activeGroup === 'all' ? 'text-white' : 'text-white/40 hover:text-white/70'}`}
            style={activeGroup === 'all' ? { background: 'rgba(185,28,28,0.25)', border: '1px solid rgba(185,28,28,0.35)' } : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            All
          </button>
          {allGroups.map(g => (
            <button
              key={g}
              onClick={() => setActiveGroup(g)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${activeGroup === g ? 'text-white' : 'text-white/40 hover:text-white/70'}`}
              style={activeGroup === g ? { background: 'rgba(185,28,28,0.25)', border: '1px solid rgba(185,28,28,0.35)' } : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {GROUP_ICONS[g] || '🔑'} {g}
              {(grouped[g] || []).some(k => !k.has_value) && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-red-400 text-[10px] font-black" style={{ background: 'rgba(239,68,68,0.15)' }}>
                  {(grouped[g] || []).filter(k => !k.has_value).length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Key groups */}
      {unlocked && (
        loading ? (
          <div className="text-center py-12 text-white/30">Loading keys…</div>
        ) : (
          filteredGroupOrder.map(group => (
            <section key={group} className="glass rounded-2xl p-5 space-y-3">
              <h2 className="text-white font-black text-base flex items-center gap-2">
                <span>{GROUP_ICONS[group] || '🔑'}</span>
                <span>{group}</span>
                <span className="text-white/30 font-normal text-sm">
                  · {(filteredGrouped[group] || []).filter(k => k.has_value).length}/{(filteredGrouped[group] || []).length} set
                </span>
              </h2>
              <div className="space-y-2">
                {(filteredGrouped[group] || []).map(k => (
                  <KeyRow key={k.key_name} k={k} pin={pin} onSaved={loadKeys} />
                ))}
              </div>
            </section>
          ))
        )
      )}

      {/* Add Key modal */}
      {showAddModal && (
        <AddKeyModal pin={pin} onClose={() => setShowAddModal(false)} onSaved={loadKeys} existingGroups={allGroups} />
      )}

      {/* Change PIN modal */}
      {showChangePinModal && (
        <ChangePinModal pin={pin} onClose={() => setShowChangePinModal(false)} />
      )}
    </div>
  )
}
