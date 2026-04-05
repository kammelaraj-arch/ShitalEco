'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TerminalDevice {
  id: string
  branch_id: string
  branch_name: string
  user_id: string | null
  user_name: string
  user_email: string
  label: string
  provider: 'stripe_terminal' | 'square' | 'cash'
  stripe_reader_id: string
  stripe_location_id: string
  square_device_id: string
  device_type: string
  serial_number: string
  status: 'online' | 'offline' | 'busy'
  is_active: boolean
  last_seen_at: string | null
  notes: string
  created_at: string
  updated_at: string
}

interface FormState {
  branch_id: string
  branch_name: string
  label: string
  provider: string
  stripe_reader_id: string
  stripe_location_id: string
  square_device_id: string
  device_type: string
  serial_number: string
  user_id: string
  user_name: string
  user_email: string
  notes: string
}

const DEFAULT_LOCATION_ID = 'tml_Gcuz0gCsvSvQZg'

const EMPTY_FORM: FormState = {
  branch_id: '', branch_name: '', label: '', provider: 'stripe_terminal',
  stripe_reader_id: '', stripe_location_id: DEFAULT_LOCATION_ID, square_device_id: '',
  device_type: '', serial_number: '',
  user_id: '', user_name: '', user_email: '', notes: '',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string, isActive: boolean) {
  if (!isActive) return { dot: 'bg-gray-500', text: 'Inactive', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/20' }
  const map: Record<string, { dot: string; text: string; cls: string }> = {
    online:  { dot: 'bg-green-400 animate-pulse', text: 'Online',  cls: 'bg-green-400/15 text-green-400 border-green-400/20' },
    offline: { dot: 'bg-gray-500',                text: 'Offline', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/20' },
    busy:    { dot: 'bg-yellow-400 animate-pulse', text: 'Busy',   cls: 'bg-yellow-400/15 text-yellow-400 border-yellow-400/20' },
  }
  return map[status] ?? map.offline
}

function providerBadge(provider: string) {
  const map: Record<string, { icon: string; label: string; cls: string }> = {
    stripe_terminal: { icon: '⚡', label: 'Stripe Terminal', cls: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20' },
    square:          { icon: '◼', label: 'Square',          cls: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
    cash:            { icon: '💵', label: 'Cash',            cls: 'bg-green-500/15 text-green-400 border-green-500/20' },
  }
  return map[provider] ?? { icon: '?', label: provider, cls: 'bg-white/10 text-white/50 border-white/10' }
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ─── Add / Edit modal ─────────────────────────────────────────────────────────

function DeviceModal({
  device,
  onClose,
  onSaved,
}: {
  device: TerminalDevice | null   // null = create, non-null = edit
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormState>(
    device
      ? {
          branch_id: device.branch_id,       branch_name: device.branch_name,
          label: device.label,               provider: device.provider,
          stripe_reader_id: device.stripe_reader_id,
          stripe_location_id: device.stripe_location_id,
          square_device_id: device.square_device_id,
          device_type: device.device_type,   serial_number: device.serial_number,
          user_id: device.user_id ?? '',     user_name: device.user_name,
          user_email: device.user_email,     notes: device.notes,
        }
      : { ...EMPTY_FORM }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isEdit = !!device

  const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.label.trim()) { setError('Label is required'); return }
    if (!form.branch_id.trim()) { setError('Branch ID is required'); return }

    setSaving(true)
    setError('')
    try {
      const url = isEdit ? `${API}/terminal-devices/${device!.id}` : `${API}/terminal-devices/`
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error(await res.text())
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const PROVIDERS = [
    { id: 'stripe_terminal', label: 'Stripe Terminal (WisePOS E)', icon: '⚡' },
    { id: 'square',          label: 'Square Terminal',             icon: '◼' },
    { id: 'cash',            label: 'Cash / Manual',              icon: '💵' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
        className="w-full max-w-xl rounded-2xl overflow-hidden"
        style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div>
            <h2 className="text-white font-black text-lg">{isEdit ? 'Edit Device' : 'Register Terminal Device'}</h2>
            <p className="text-white/40 text-xs mt-0.5">{isEdit ? 'Update device details' : 'Link a card reader to a branch'}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 font-bold transition-colors">×</button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="bg-red-500/15 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl">{error}</div>
          )}

          {/* Provider */}
          <div>
            <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">Provider</label>
            <div className="grid grid-cols-3 gap-2">
              {PROVIDERS.map(p => (
                <button
                  key={p.id}
                  onClick={() => set('provider', p.id)}
                  className={`p-3 rounded-xl border text-sm font-semibold transition-all text-center ${
                    form.provider === p.id
                      ? 'bg-saffron-400/15 border-saffron-400/40 text-saffron-400'
                      : 'bg-white/3 border-white/5 text-white/40 hover:border-white/15'
                  }`}
                >
                  <span className="block text-xl mb-1">{p.icon}</span>
                  <span className="text-xs leading-tight">{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Label */}
          <Field label="Device Label *" value={form.label} onChange={v => set('label', v)} placeholder="e.g. Wembley Kiosk 1" />

          {/* Branch */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Branch ID *" value={form.branch_id} onChange={v => set('branch_id', v)} placeholder="wembley" />
            <Field label="Branch Name" value={form.branch_name} onChange={v => set('branch_name', v)} placeholder="Wembley Temple" />
          </div>

          {/* Provider-specific IDs */}
          {form.provider === 'stripe_terminal' && (
            <div className="space-y-3">
              <Field label="Stripe Reader ID" value={form.stripe_reader_id} onChange={v => set('stripe_reader_id', v)} placeholder="tmr_xxxxxxxxxxxxxx" mono />
              <Field label="Stripe Location ID" value={form.stripe_location_id} onChange={v => set('stripe_location_id', v)} placeholder={DEFAULT_LOCATION_ID} mono />
            </div>
          )}
          {form.provider === 'square' && (
            <Field label="Square Device ID" value={form.square_device_id} onChange={v => set('square_device_id', v)} placeholder="device_xxxxxxxxx" mono />
          )}

          {/* Hardware */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Device Type" value={form.device_type} onChange={v => set('device_type', v)} placeholder="bbpos_wisepos_e" />
            <Field label="Serial Number" value={form.serial_number} onChange={v => set('serial_number', v)} placeholder="WSC-XXXXXXXXX" mono />
          </div>

          {/* Assigned user */}
          <div className="pt-1">
            <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">Assigned Staff (optional)</label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="User ID" value={form.user_id} onChange={v => set('user_id', v)} placeholder="UUID or staff ID" mono />
              <Field label="User Name" value={form.user_name} onChange={v => set('user_name', v)} placeholder="Priya Patel" />
            </div>
            <div className="mt-3">
              <Field label="User Email" value={form.user_email} onChange={v => set('user_email', v)} placeholder="priya@shital.org" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-1.5">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Any notes about this device..."
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm placeholder-white/25 resize-none focus:outline-none focus:border-saffron-400/40"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/5">
          <button onClick={onClose} className="px-5 py-2 rounded-xl bg-white/5 text-white/60 text-sm font-semibold hover:bg-white/10 transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-6 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-500 text-white text-sm font-black shadow-lg disabled:opacity-50 transition-all hover:scale-105 active:scale-95"
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Register Device'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function Field({ label, value, onChange, placeholder, mono }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean
}) {
  return (
    <div>
      <label className="block text-white/40 text-xs font-semibold mb-1.5">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-saffron-400/40 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  )
}

// ─── Assign user modal ────────────────────────────────────────────────────────

function AssignUserModal({
  device,
  onClose,
  onSaved,
}: {
  device: TerminalDevice
  onClose: () => void
  onSaved: () => void
}) {
  const [userId, setUserId] = useState(device.user_id ?? '')
  const [userName, setUserName] = useState(device.user_name)
  const [userEmail, setUserEmail] = useState(device.user_email)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!userId.trim()) { setError('User ID is required'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`${API}/terminal-devices/${device.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, user_name: userName, user_email: userEmail }),
      })
      if (!res.ok) throw new Error(await res.text())
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e.message || 'Failed to assign user')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
        className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/5">
          <h2 className="text-white font-black">Assign Staff to Device</h2>
          <p className="text-white/40 text-xs mt-0.5">{device.label}</p>
        </div>
        <div className="px-6 py-5 space-y-3">
          {error && <div className="bg-red-500/15 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl">{error}</div>}
          <Field label="User ID *" value={userId} onChange={setUserId} placeholder="UUID or staff ID" mono />
          <Field label="Full Name" value={userName} onChange={setUserName} placeholder="e.g. Priya Patel" />
          <Field label="Email" value={userEmail} onChange={setUserEmail} placeholder="priya@shital.org" />
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-white/5">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl bg-white/5 text-white/60 text-sm font-semibold">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-500 text-white text-sm font-black disabled:opacity-50">
            {saving ? 'Saving…' : 'Assign'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Sync modal ───────────────────────────────────────────────────────────────

function SyncModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [branchId, setBranchId] = useState('')
  const [locationId, setLocationId] = useState(DEFAULT_LOCATION_ID)
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<{ synced: number; created: number; updated: number } | null>(null)
  const [error, setError] = useState('')

  async function doSync() {
    setSyncing(true)
    setError('')
    setResult(null)
    try {
      const params = new URLSearchParams()
      if (branchId) params.set('branch_id', branchId)
      if (locationId) params.set('location_id', locationId)
      const res = await fetch(`${API}/terminal-devices/sync-stripe?${params}`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setResult(data)
      onDone()
    } catch (e: any) {
      setError(e.message || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
        className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/5">
          <h2 className="text-white font-black">⚡ Sync from Stripe</h2>
          <p className="text-white/40 text-xs mt-0.5">Pull registered readers from the Stripe API</p>
        </div>
        <div className="px-6 py-5 space-y-3">
          {error && <div className="bg-red-500/15 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl">{error}</div>}
          {result && (
            <div className="bg-green-500/15 border border-green-500/20 text-green-400 text-sm px-4 py-3 rounded-xl">
              ✓ Synced {result.synced} readers — {result.created} new, {result.updated} updated
            </div>
          )}
          <Field label="Assign to Branch ID (optional)" value={branchId} onChange={setBranchId} placeholder="wembley" />
          <Field label="Stripe Location ID (optional)" value={locationId} onChange={setLocationId} placeholder={DEFAULT_LOCATION_ID} mono />
          <p className="text-white/25 text-xs">Leave blank to use defaults from server config. New readers will be marked unassigned if no branch is provided.</p>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-white/5">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl bg-white/5 text-white/60 text-sm font-semibold">Close</button>
          <button onClick={doSync} disabled={syncing} className="flex-1 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-500 text-white text-sm font-black disabled:opacity-50">
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TerminalDevicesPage() {
  const [devices, setDevices] = useState<TerminalDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [filterBranch, setFilterBranch] = useState('')
  const [filterProvider, setFilterProvider] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const [modal, setModal] = useState<'create' | 'edit' | 'assign' | 'sync' | null>(null)
  const [selected, setSelected] = useState<TerminalDevice | null>(null)
  const [refreshing, setRefreshing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterBranch) params.set('branch_id', filterBranch)
      if (filterProvider) params.set('provider', filterProvider)
      params.set('active_only', showInactive ? 'false' : 'true')
      const res = await fetch(`${API}/terminal-devices/?${params}`)
      const data = await res.json()
      setDevices(data.devices ?? [])
    } catch {
      setDevices([])
    } finally {
      setLoading(false)
    }
  }, [filterBranch, filterProvider, showInactive])

  useEffect(() => { load() }, [load])

  async function deleteDevice(id: string) {
    if (!confirm('Deactivate this device? It can be re-enabled by editing.')) return
    await fetch(`${API}/terminal-devices/${id}`, { method: 'DELETE' })
    load()
  }

  async function refreshStatus(device: TerminalDevice) {
    setRefreshing(device.id)
    try {
      await fetch(`${API}/terminal-devices/${device.id}/refresh-status`, { method: 'POST' })
      load()
    } finally {
      setRefreshing(null)
    }
  }

  // Unique branches for filter
  const branches = Array.from(new Set(devices.map(d => d.branch_id))).filter(Boolean)

  return (
    <div className="space-y-8 animate-fade-in">

      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">💳 Terminal Devices</h1>
          <p className="text-white/40 mt-1">Manage Stripe & Square card readers across all branches</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setModal('sync')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 text-sm font-semibold hover:bg-indigo-600/30 transition-colors"
          >
            <span>⚡</span> Sync from Stripe
          </button>
          <button
            onClick={() => { setSelected(null); setModal('create') }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-500 text-white text-sm font-black shadow-lg hover:scale-105 active:scale-95 transition-all"
          >
            <span>+</span> Register Device
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Devices', value: devices.length, icon: '🖥️', cls: 'from-amber-600 to-orange-500' },
          { label: 'Online Now',    value: devices.filter(d => d.status === 'online').length, icon: '🟢', cls: 'from-green-600 to-emerald-500' },
          { label: 'Stripe Terminal', value: devices.filter(d => d.provider === 'stripe_terminal').length, icon: '⚡', cls: 'from-indigo-600 to-violet-500' },
          { label: 'Unassigned',    value: devices.filter(d => !d.user_id).length, icon: '👤', cls: 'from-gray-600 to-gray-500' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="glass rounded-2xl p-5 relative overflow-hidden"
          >
            <div className={`absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br ${s.cls} opacity-10 blur-xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.cls} flex items-center justify-center text-lg mb-3 shadow-lg`}>
              {s.icon}
            </div>
            <p className="text-white/40 text-xs font-medium mb-1">{s.label}</p>
            <p className="text-3xl font-black text-white">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="glass rounded-2xl p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-white/40 text-sm font-medium">Branch:</span>
          <select
            value={filterBranch}
            onChange={e => setFilterBranch(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-white text-sm focus:outline-none focus:border-saffron-400/40"
          >
            <option value="">All Branches</option>
            {branches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/40 text-sm font-medium">Provider:</span>
          <select
            value={filterProvider}
            onChange={e => setFilterProvider(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-white text-sm focus:outline-none focus:border-saffron-400/40"
          >
            <option value="">All Providers</option>
            <option value="stripe_terminal">Stripe Terminal</option>
            <option value="square">Square</option>
            <option value="cash">Cash</option>
          </select>
        </div>
        <label className="flex items-center gap-2 cursor-pointer ml-auto">
          <div
            onClick={() => setShowInactive(v => !v)}
            className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${showInactive ? 'bg-saffron-400/80' : 'bg-white/10'}`}
          >
            <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${showInactive ? 'translate-x-5' : 'translate-x-0'}`} />
          </div>
          <span className="text-white/50 text-sm">Show inactive</span>
        </label>
        <button onClick={load} className="px-4 py-1.5 rounded-xl bg-white/5 text-white/50 text-sm hover:bg-white/10 transition-colors">
          ↻ Refresh
        </button>
      </div>

      {/* Device table */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Device', 'Branch', 'Provider', 'Reader ID', 'Assigned To', 'Status', 'Last Seen', 'Actions'].map(h => (
                  <th key={h} className="text-left text-white/30 text-xs font-semibold uppercase tracking-wider px-5 py-3 first:pl-6 last:pr-6">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-6 py-16 text-center text-white/20 text-sm">Loading devices…</td></tr>
              ) : devices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <span className="text-5xl opacity-20">💳</span>
                      <p className="text-white/30 text-sm">No terminal devices registered yet.</p>
                      <button
                        onClick={() => setModal('create')}
                        className="mt-2 px-5 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-500 text-white text-sm font-black"
                      >
                        + Register First Device
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                devices.map((d, i) => {
                  const sb = statusBadge(d.status, d.is_active)
                  const pb = providerBadge(d.provider)
                  return (
                    <motion.tr
                      key={d.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="border-b border-white/3 hover:bg-white/2 transition-colors"
                    >
                      {/* Device */}
                      <td className="px-5 py-4 pl-6">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-lg flex-shrink-0">
                            {d.provider === 'stripe_terminal' ? '⚡' : d.provider === 'square' ? '◼' : '💵'}
                          </div>
                          <div>
                            <p className="text-white font-semibold text-sm">{d.label}</p>
                            {d.device_type && <p className="text-white/30 text-xs">{d.device_type}</p>}
                            {d.serial_number && <p className="text-white/20 text-xs font-mono">{d.serial_number}</p>}
                          </div>
                        </div>
                      </td>

                      {/* Branch */}
                      <td className="px-5 py-4">
                        <p className="text-white/80 text-sm font-medium">{d.branch_name || d.branch_id}</p>
                        <p className="text-white/30 text-xs font-mono">{d.branch_id}</p>
                      </td>

                      {/* Provider */}
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${pb.cls}`}>
                          <span>{pb.icon}</span> {pb.label}
                        </span>
                      </td>

                      {/* Reader ID */}
                      <td className="px-5 py-4">
                        {d.stripe_reader_id ? (
                          <span className="text-white/50 text-xs font-mono bg-white/5 px-2 py-1 rounded-lg">{d.stripe_reader_id}</span>
                        ) : d.square_device_id ? (
                          <span className="text-white/50 text-xs font-mono bg-white/5 px-2 py-1 rounded-lg">{d.square_device_id}</span>
                        ) : (
                          <span className="text-white/20 text-xs">—</span>
                        )}
                      </td>

                      {/* Assigned to */}
                      <td className="px-5 py-4">
                        {d.user_name || d.user_id ? (
                          <div>
                            <p className="text-white/80 text-sm">{d.user_name || d.user_id}</p>
                            {d.user_email && <p className="text-white/30 text-xs">{d.user_email}</p>}
                          </div>
                        ) : (
                          <button
                            onClick={() => { setSelected(d); setModal('assign') }}
                            className="text-xs text-saffron-400/70 hover:text-saffron-400 transition-colors font-medium"
                          >
                            + Assign user
                          </button>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${sb.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sb.dot}`} />
                          {sb.text}
                        </span>
                      </td>

                      {/* Last seen */}
                      <td className="px-5 py-4">
                        <p className="text-white/40 text-xs">{fmtDate(d.last_seen_at)}</p>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 pr-6">
                        <div className="flex items-center gap-2">
                          {d.provider === 'stripe_terminal' && (
                            <button
                              onClick={() => refreshStatus(d)}
                              disabled={refreshing === d.id}
                              className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors text-xs"
                              title="Refresh status from Stripe"
                            >
                              {refreshing === d.id ? '…' : '↻'}
                            </button>
                          )}
                          <button
                            onClick={() => { setSelected(d); setModal('assign') }}
                            className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-indigo-400 hover:bg-indigo-400/10 transition-colors text-xs"
                            title="Assign user"
                          >
                            👤
                          </button>
                          <button
                            onClick={() => { setSelected(d); setModal('edit') }}
                            className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-saffron-400 hover:bg-saffron-400/10 transition-colors text-xs"
                            title="Edit"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => deleteDevice(d.id)}
                            className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-colors text-xs"
                            title="Deactivate"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Setup guide */}
      <div className="glass rounded-2xl p-6">
        <h3 className="text-white font-black text-base mb-4">📋 Setup Guide</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              step: '1', title: 'Register Stripe Location',
              body: `Your Stripe Terminal Location is already configured: ${DEFAULT_LOCATION_ID}. For additional branches, create new locations in the Stripe dashboard.`,
              icon: '🏢',
            },
            {
              step: '2', title: 'Pair WisePOS E Reader',
              body: 'On the WisePOS E device, go to Settings → Generate pairing code. In Stripe, register the reader using the code. Copy the tmr_xxx ID.',
              icon: '⚡',
            },
            {
              step: '3', title: 'Sync & Assign',
              body: 'Click "Sync from Stripe" to pull all readers automatically, then assign each device to a branch and optionally to a staff user.',
              icon: '🔗',
            },
          ].map(s => (
            <div key={s.step} className="bg-white/3 rounded-xl p-4 border border-white/5">
              <div className="flex items-center gap-3 mb-2">
                <span className="w-7 h-7 rounded-full bg-saffron-400/20 text-saffron-400 text-xs font-black flex items-center justify-center">{s.step}</span>
                <span className="text-xl">{s.icon}</span>
                <p className="text-white font-semibold text-sm">{s.title}</p>
              </div>
              <p className="text-white/35 text-xs leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {modal === 'create' && (
          <DeviceModal device={null} onClose={() => setModal(null)} onSaved={load} />
        )}
        {modal === 'edit' && selected && (
          <DeviceModal device={selected} onClose={() => { setModal(null); setSelected(null) }} onSaved={load} />
        )}
        {modal === 'assign' && selected && (
          <AssignUserModal device={selected} onClose={() => { setModal(null); setSelected(null) }} onSaved={load} />
        )}
        {modal === 'sync' && (
          <SyncModal onClose={() => setModal(null)} onDone={load} />
        )}
      </AnimatePresence>
    </div>
  )
}
