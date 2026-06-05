'use client'
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

interface KeyRow {
  id: string
  branch_id: string
  name: string
  key_type: string
  description: string
  holder_employee_id: string | null
  holder_name: string | null
  holder_email: string | null
  holder_phone: string | null
  holder_address: string | null
  holder_employee_number: string | null
  holder_job_title: string | null
  owner_employee_id: string | null
  owner_name: string | null
  owner_email: string | null
  owner_phone: string | null
  physical_location: string
  serial_number: string
  copies_count: number
  total_sets: number
  sets_in_vault: number
  vault_reference: string
  access_url: string
  username_hint: string
  provider: string
  status: string
  issued_date: string | null
  returned_date: string | null
  expiry_date: string | null
  last_rotated_date: string | null
  notes: string
  undertaking_required: boolean
  undertaking_signed_at: string | null
  undertaking_signed_name: string
  undertaking_pdf_url: string
  undertaking_sent_at: string | null
  created_at: string
  updated_at: string
}

interface KeyEvent {
  id: string
  event_type: string
  actor_name: string
  from_holder_name: string | null
  to_holder_name: string | null
  notes: string
  created_at: string
}

interface KeysResponse {
  keys: KeyRow[]
  total: number
  by_type: Record<string, number>
  expiring_soon: number
}

interface EmployeeOption {
  id: string
  full_name: string
}

interface KeyForm {
  name: string
  key_type: string
  branch_id: string
  description: string
  holder_employee_id: string
  holder_name: string
  owner_employee_id: string
  owner_name: string
  physical_location: string
  serial_number: string
  copies_count: number
  total_sets: number
  sets_in_vault: number
  vault_reference: string
  access_url: string
  username_hint: string
  provider: string
  issued_date: string
  expiry_date: string
  notes: string
  undertaking_required: boolean
}

const EMPTY: KeyForm = {
  name: '', key_type: 'PROPERTY_KEY', branch_id: 'main', description: '',
  holder_employee_id: '', holder_name: '',
  owner_employee_id: '', owner_name: '',
  physical_location: '', serial_number: '', copies_count: 1,
  total_sets: 1, sets_in_vault: 0,
  vault_reference: '', access_url: '', username_hint: '', provider: '',
  issued_date: '', expiry_date: '', notes: '',
  undertaking_required: true,
}

const TYPE_LABEL: Record<string, string> = {
  // Physical — what they unlock
  PROPERTY_KEY:        '🏛️ Property / building key',
  ROOM_KEY:            '🚪 Room key',
  OFFICE_KEY:          '🏢 Office key',
  SHRINE_KEY:          '🕉️ Shrine / sanctum key',
  DONATION_BOX_KEY:    '💰 Donation / hundi box key',
  CUPBOARD_KEY:        '🗄️ Cupboard key',
  LOCKER_KEY:          '🔒 Locker key',
  DRAWER_KEY:          '🗃️ Drawer key',
  SAFE_KEY:            '🛡️ Safe key',
  VAULT_KEY:           '🏦 Vault key',
  CCTV_ROOM_KEY:       '📹 CCTV room key',
  STORAGE_KEY:         '📦 Storage room key',
  GATE_KEY:            '🚧 Gate key',
  PADLOCK_KEY:         '🔐 Padlock key',
  VEHICLE_KEY:         '🚗 Vehicle key',
  MAILBOX_KEY:         '📮 Mailbox key',
  PHYSICAL_KEY:        '🔑 Other physical key',
  // Digital
  DIGITAL_CREDENTIAL:  '🔐 Digital credential',
  DOMAIN:              '🌐 Domain',
  SSL_CERTIFICATE:     '📜 SSL certificate',
  HOSTING_ACCOUNT:     '☁️ Hosting account',
  SAAS_SUBSCRIPTION:   '🧰 SaaS subscription',
  CRYPTO_KEY:          '🔏 Crypto / signing key',
  API_KEY:             '🗝️ API key (reference)',
  OTHER:               '📎 Other',
}

// Used by the type dropdown to render <optgroup> sections so the list of
// 25+ types is browsable instead of one long flat list.
const TYPE_GROUPS: Array<{ label: string; types: string[] }> = [
  { label: 'Physical — Property & Rooms',
    types: ['PROPERTY_KEY', 'ROOM_KEY', 'OFFICE_KEY', 'SHRINE_KEY', 'CCTV_ROOM_KEY', 'STORAGE_KEY', 'GATE_KEY'] },
  { label: 'Physical — Containers',
    types: ['DONATION_BOX_KEY', 'CUPBOARD_KEY', 'LOCKER_KEY', 'DRAWER_KEY', 'SAFE_KEY', 'VAULT_KEY', 'PADLOCK_KEY', 'MAILBOX_KEY'] },
  { label: 'Physical — Other',
    types: ['VEHICLE_KEY', 'PHYSICAL_KEY'] },
  { label: 'Digital credentials',
    types: ['DIGITAL_CREDENTIAL', 'DOMAIN', 'SSL_CERTIFICATE', 'HOSTING_ACCOUNT', 'SAAS_SUBSCRIPTION', 'CRYPTO_KEY', 'API_KEY'] },
  { label: 'Other',
    types: ['OTHER'] },
]

// Which types are "physical" — drives form-field visibility and the
// "undertaking required" default.
const PHYSICAL_TYPES = new Set([
  'PROPERTY_KEY', 'ROOM_KEY', 'OFFICE_KEY', 'SHRINE_KEY', 'DONATION_BOX_KEY',
  'CUPBOARD_KEY', 'LOCKER_KEY', 'DRAWER_KEY', 'SAFE_KEY', 'VAULT_KEY',
  'CCTV_ROOM_KEY', 'STORAGE_KEY', 'GATE_KEY', 'PADLOCK_KEY', 'VEHICLE_KEY',
  'MAILBOX_KEY', 'PHYSICAL_KEY',
])

const STATUS_COLOR: Record<string, string> = {
  ACTIVE:   'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  RETURNED: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
  LOST:     'bg-red-500/15 text-red-300 border-red-500/40',
  REVOKED:  'bg-orange-500/15 text-orange-300 border-orange-500/40',
  EXPIRED:  'bg-yellow-500/15 text-yellow-300 border-yellow-500/40',
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.round((d.getTime() - Date.now()) / 86400000)
}

export default function KeyRegisterPage() {
  const [data, setData] = useState<KeysResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<KeyRow | null>(null)
  const [form, setForm] = useState<KeyForm>(EMPTY)
  const [saving, setSaving] = useState(false)

  // Employee picker for holder/owner
  const [empSearch, setEmpSearch] = useState('')
  const [empResults, setEmpResults] = useState<EmployeeOption[]>([])
  const [pickerFor, setPickerFor] = useState<'holder' | 'owner' | null>(null)

  // Event log
  const [showEvents, setShowEvents] = useState<KeyRow | null>(null)
  const [events, setEvents] = useState<KeyEvent[]>([])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams()
      if (filterType)   qs.set('key_type', filterType)
      if (filterStatus) qs.set('status', filterStatus)
      const r = await apiFetch(`/key-register${qs.toString() ? '?' + qs.toString() : ''}`)
      setData(r as KeysResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filterType, filterStatus])

  useEffect(() => { load() }, [load])

  // Typeahead employee search — debounced
  useEffect(() => {
    if (!pickerFor) return
    if (empSearch.length < 2) { setEmpResults([]); return }
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch(`/hr/employees/search?q=${encodeURIComponent(empSearch)}`)
        setEmpResults(((r as { items?: EmployeeOption[] }).items) || [])
      } catch { setEmpResults([]) }
    }, 200)
    return () => clearTimeout(t)
  }, [empSearch, pickerFor])

  const openCreate = () => {
    setEditing(null); setForm(EMPTY); setShowForm(true); setEmpSearch('')
  }

  const openEdit = (k: KeyRow) => {
    setEditing(k)
    setForm({
      name: k.name, key_type: k.key_type,
      branch_id: k.branch_id || 'main',
      description: k.description,
      holder_employee_id: k.holder_employee_id || '',
      holder_name: k.holder_name || '',
      owner_employee_id: k.owner_employee_id || '',
      owner_name: k.owner_name || '',
      physical_location: k.physical_location, serial_number: k.serial_number,
      copies_count: k.copies_count || 1,
      total_sets: k.total_sets || 1,
      sets_in_vault: k.sets_in_vault || 0,
      vault_reference: k.vault_reference, access_url: k.access_url,
      username_hint: k.username_hint, provider: k.provider,
      issued_date: k.issued_date || '', expiry_date: k.expiry_date || '',
      notes: k.notes,
      undertaking_required: k.undertaking_required !== false,
    })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')
    try {
      const body = { ...form }
      if (editing) {
        await apiFetch(`/key-register/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      } else {
        await apiFetch('/key-register', { method: 'POST', body: JSON.stringify(body) })
      }
      setShowForm(false)
      setForm(EMPTY)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const doAction = async (k: KeyRow, action: string, opts: { to_holder_id?: string; notes?: string } = {}) => {
    try {
      await apiFetch(`/key-register/${k.id}/${action}`, {
        method: 'POST', body: JSON.stringify(opts),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${action}`)
    }
  }

  const handleReturn = (k: KeyRow) => {
    if (!confirm(`Mark "${k.name}" as returned by ${k.holder_name || 'current holder'}?`)) return
    doAction(k, 'return')
  }

  const handleMarkLost = (k: KeyRow) => {
    const notes = prompt(`Mark "${k.name}" as LOST. Add notes (incident details, when noticed missing):`)
    if (notes === null) return
    doAction(k, 'mark-lost', { notes })
  }

  const handleRotate = (k: KeyRow) => {
    const notes = prompt(`Mark "${k.name}" as rotated. Confirm the new secret has been stored in ${k.vault_reference || 'the vault'}. Notes:`)
    if (notes === null) return
    doAction(k, 'rotate', { notes })
  }

  const handleDelete = async (k: KeyRow) => {
    if (!confirm(`Remove "${k.name}" from the register? (Soft-delete — audit log preserved.)`)) return
    try {
      await apiFetch(`/key-register/${k.id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  const openEvents = async (k: KeyRow) => {
    setShowEvents(k); setEvents([])
    try {
      const r = await apiFetch(`/key-register/${k.id}`)
      setEvents(((r as { events?: KeyEvent[] }).events) || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events')
    }
  }

  const isDigital = !PHYSICAL_TYPES.has(form.key_type) && form.key_type !== 'OTHER'

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">🔐 Key Register</h1>
          <p className="text-white/60 text-sm mt-1">
            Custody of physical keys and digital access. Sensitive values
            live in your vault — this register tracks <em>who holds what</em>,
            <em> who&apos;s accountable</em>, and <em>when it expires</em>.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium"
        >
          + Add Key
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/15 border border-red-500/40 text-red-200 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Summary chips */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
            <div className="text-2xl font-bold text-white">{data.total}</div>
            <div className="text-xs text-white/60 mt-1">Total tracked</div>
          </div>
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/40 rounded-lg">
            <div className="text-2xl font-bold text-yellow-300">{data.expiring_soon}</div>
            <div className="text-xs text-yellow-200/80 mt-1">Expiring in 30 days</div>
          </div>
          {Object.entries(data.by_type).slice(0, 3).map(([t, n]) => (
            <div key={t} className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <div className="text-2xl font-bold text-white">{n}</div>
              <div className="text-xs text-white/60 mt-1 truncate">{TYPE_LABEL[t] || t}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm"
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="RETURNED">Returned</option>
          <option value="LOST">Lost</option>
          <option value="REVOKED">Revoked</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-white/60 text-center py-12">Loading…</div>
      ) : !data || data.keys.length === 0 ? (
        <div className="text-white/60 text-center py-12 border border-dashed border-white/10 rounded-lg">
          No keys registered yet. Click <strong>+ Add Key</strong> to start.
        </div>
      ) : (
        <div className="space-y-2">
          {data.keys.map(k => {
            const exp = daysUntil(k.expiry_date)
            const expWarn = exp !== null && exp <= 30
            const expCrit = exp !== null && exp <= 7
            return (
              <div
                key={k.id}
                className="p-4 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-white/50">{TYPE_LABEL[k.key_type] || k.key_type}</span>
                      <span className={`px-2 py-0.5 text-xs rounded border ${STATUS_COLOR[k.status] || ''}`}>
                        {k.status}
                      </span>
                      {expWarn && (
                        <span className={`px-2 py-0.5 text-xs rounded border ${
                          expCrit
                            ? 'bg-red-500/15 text-red-300 border-red-500/40'
                            : 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40'
                        }`}>
                          {exp! < 0 ? `Expired ${-exp!}d ago` : `Expires in ${exp}d`}
                        </span>
                      )}
                    </div>
                    <h3 className="text-white font-medium mt-1 truncate">{k.name}</h3>
                    <div className="text-xs text-white/60 mt-1 space-y-0.5">
                      {k.holder_name && <div>👤 Held by <strong>{k.holder_name}</strong></div>}
                      {k.owner_name && <div>🛡️ Owner: {k.owner_name}</div>}
                      {k.physical_location && <div>📍 {k.physical_location}</div>}
                      {k.vault_reference && <div>🗄️ Vault: {k.vault_reference}</div>}
                      {k.access_url && (
                        <div>🔗 <a
                          href={k.access_url}
                          target="_blank" rel="noopener noreferrer"
                          className="text-indigo-300 hover:underline"
                        >{k.access_url}</a></div>
                      )}
                      {k.provider && <div>🏢 {k.provider}</div>}
                      {k.last_rotated_date && <div>🔄 Last rotated: {k.last_rotated_date}</div>}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-wrap justify-end">
                    <button
                      onClick={() => openEvents(k)}
                      className="px-2 py-1 text-xs bg-white/5 hover:bg-white/15 text-white/80 rounded"
                      title="View audit log"
                    >📜 Log</button>
                    <button
                      onClick={() => openEdit(k)}
                      className="px-2 py-1 text-xs bg-white/5 hover:bg-white/15 text-white/80 rounded"
                    >Edit</button>
                    {k.status === 'ACTIVE' && k.holder_employee_id && (
                      <button
                        onClick={() => handleReturn(k)}
                        className="px-2 py-1 text-xs bg-slate-500/20 hover:bg-slate-500/30 text-slate-200 rounded"
                      >Return</button>
                    )}
                    {(k.key_type !== 'PHYSICAL_KEY' && k.status === 'ACTIVE') && (
                      <button
                        onClick={() => handleRotate(k)}
                        className="px-2 py-1 text-xs bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 rounded"
                        title="Record that the secret has been rotated in your vault"
                      >🔄 Rotate</button>
                    )}
                    {k.status !== 'LOST' && (
                      <button
                        onClick={() => handleMarkLost(k)}
                        className="px-2 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-200 rounded"
                      >Lost</button>
                    )}
                    <button
                      onClick={() => handleDelete(k)}
                      className="px-2 py-1 text-xs bg-white/5 hover:bg-red-500/20 text-white/40 hover:text-red-200 rounded"
                      title="Soft-delete (audit log preserved)"
                    >🗑️</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create/Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start md:items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-white/10 rounded-xl p-6 max-w-2xl w-full my-4">
            <h2 className="text-xl font-bold text-white mb-4">
              {editing ? 'Edit Key' : 'Add Key to Register'}
            </h2>

            {/* Type & name */}
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="col-span-1">
                <label className="block text-xs text-white/60 mb-1">Type *</label>
                <select
                  value={form.key_type}
                  onChange={e => {
                    const nt = e.target.value
                    setForm(p => ({
                      ...p, key_type: nt,
                      // Default-on undertaking for physical keys, off for digital
                      undertaking_required: PHYSICAL_TYPES.has(nt) ? p.undertaking_required : false,
                    }))
                  }}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                >
                  {TYPE_GROUPS.map(g => (
                    <optgroup key={g.label} label={g.label}>
                      {g.types.map(t => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Branch *</label>
                <input
                  value={form.branch_id}
                  onChange={e => setForm(p => ({ ...p, branch_id: e.target.value }))}
                  placeholder="main, leicester, reading, mk"
                  list="branch-list"
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                />
                <datalist id="branch-list">
                  <option value="main" />
                  <option value="leicester" />
                  <option value="reading" />
                  <option value="mk" />
                </datalist>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Name *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder={PHYSICAL_TYPES.has(form.key_type) ? 'e.g. Main shrine — front door' : 'shital.org.uk PayPal admin'}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs text-white/60 mb-1">Description</label>
              <input
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
              />
            </div>

            {/* Holder / owner */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">Currently held by</label>
                <div className="flex gap-2">
                  <input
                    value={form.holder_name || form.holder_employee_id}
                    onChange={e => { setEmpSearch(e.target.value); setPickerFor('holder') }}
                    onFocus={() => { setPickerFor('holder'); setEmpSearch(form.holder_name || '') }}
                    placeholder="Search employee…"
                    className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                  />
                  {form.holder_employee_id && (
                    <button
                      onClick={() => setForm(p => ({ ...p, holder_employee_id: '', holder_name: '' }))}
                      className="px-2 text-white/40 hover:text-white"
                    >×</button>
                  )}
                </div>
                {pickerFor === 'holder' && empResults.length > 0 && (
                  <div className="mt-1 max-h-40 overflow-y-auto bg-slate-800 border border-white/10 rounded">
                    {empResults.map(e => (
                      <button
                        key={e.id}
                        onClick={() => {
                          setForm(p => ({ ...p, holder_employee_id: e.id, holder_name: e.full_name }))
                          setPickerFor(null); setEmpResults([])
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/10"
                      >{e.full_name}</button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Accountable owner</label>
                <div className="flex gap-2">
                  <input
                    value={form.owner_name || form.owner_employee_id}
                    onChange={e => { setEmpSearch(e.target.value); setPickerFor('owner') }}
                    onFocus={() => { setPickerFor('owner'); setEmpSearch(form.owner_name || '') }}
                    placeholder="Search employee…"
                    className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                  />
                  {form.owner_employee_id && (
                    <button
                      onClick={() => setForm(p => ({ ...p, owner_employee_id: '', owner_name: '' }))}
                      className="px-2 text-white/40 hover:text-white"
                    >×</button>
                  )}
                </div>
                {pickerFor === 'owner' && empResults.length > 0 && (
                  <div className="mt-1 max-h-40 overflow-y-auto bg-slate-800 border border-white/10 rounded">
                    {empResults.map(e => (
                      <button
                        key={e.id}
                        onClick={() => {
                          setForm(p => ({ ...p, owner_employee_id: e.id, owner_name: e.full_name }))
                          setPickerFor(null); setEmpResults([])
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/10"
                      >{e.full_name}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Physical fields */}
            {PHYSICAL_TYPES.has(form.key_type) && (
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="col-span-2">
                  <label className="block text-xs text-white/60 mb-1">Physical location</label>
                  <input
                    value={form.physical_location}
                    onChange={e => setForm(p => ({ ...p, physical_location: e.target.value }))}
                    placeholder="e.g. Office cabinet drawer 3, on holder's keyring"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Serial / key number</label>
                  <input
                    value={form.serial_number}
                    onChange={e => setForm(p => ({ ...p, serial_number: e.target.value }))}
                    placeholder="stamped on the key"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Copies in circulation</label>
                  <input
                    type="number" min={1}
                    value={form.copies_count}
                    onChange={e => setForm(p => ({ ...p, copies_count: parseInt(e.target.value) || 1 }))}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Total sets owned</label>
                  <input
                    type="number" min={1}
                    value={form.total_sets}
                    onChange={e => setForm(p => ({ ...p, total_sets: parseInt(e.target.value) || 1 }))}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                  />
                  <p className="text-[10px] text-white/40 mt-1">e.g. 5 if we own 5 physical copies</p>
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Sets in vault / unissued</label>
                  <input
                    type="number" min={0}
                    value={form.sets_in_vault}
                    onChange={e => setForm(p => ({ ...p, sets_in_vault: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                  />
                  <p className="text-[10px] text-white/40 mt-1">spare copies sitting in the safe</p>
                </div>

                {/* Holder contact card — shown inline when a person is selected */}
                {form.holder_employee_id && (
                  <div className="col-span-2 rounded-lg p-3 bg-white/5 border border-white/10">
                    <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Holder contact (from employee record)</p>
                    <p className="text-white font-semibold text-sm">{form.holder_name}</p>
                    <p className="text-white/60 text-xs">Employee details auto-populated. Edit on the Employees page if anything's out of date.</p>
                  </div>
                )}

                {/* Undertaking */}
                <div className="col-span-2 rounded-lg p-3 bg-saffron-500/10 border border-saffron-400/30">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.undertaking_required}
                      onChange={e => setForm(p => ({ ...p, undertaking_required: e.target.checked }))}
                      className="mt-0.5"
                    />
                    <span className="text-white/80 text-sm">
                      <span className="font-bold">Require signed undertaking</span> — generate a printable
                      undertaking the holder signs before taking the key. The status will
                      show "Undertaking pending" until you mark it signed.
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* Digital fields */}
            {isDigital && (
              <div className="space-y-3 mb-3">
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-200">
                  <strong>Never paste passwords or API keys here.</strong> Only record
                  <em> where</em> the actual secret lives (1Password vault name, sealed
                  envelope in safe, etc.) — so the next person knows where to look.
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-white/60 mb-1">Provider</label>
                    <input
                      value={form.provider}
                      onChange={e => setForm(p => ({ ...p, provider: e.target.value }))}
                      placeholder="HSBC, Microsoft, Vultr, Stripe"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/60 mb-1">Username hint (not full)</label>
                    <input
                      value={form.username_hint}
                      onChange={e => setForm(p => ({ ...p, username_hint: e.target.value }))}
                      placeholder="admin@shital.org.uk"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Access URL</label>
                  <input
                    value={form.access_url}
                    onChange={e => setForm(p => ({ ...p, access_url: e.target.value }))}
                    placeholder="https://login.microsoftonline.com/..."
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Vault reference — WHERE the secret is stored</label>
                  <input
                    value={form.vault_reference}
                    onChange={e => setForm(p => ({ ...p, vault_reference: e.target.value }))}
                    placeholder="1Password: 'PayPal Admin' (Trustees vault) / Sealed envelope, safe shelf 2"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                  />
                </div>
              </div>
            )}

            {/* Lifecycle */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">Issued / acquired date</label>
                <input
                  type="date"
                  value={form.issued_date}
                  onChange={e => setForm(p => ({ ...p, issued_date: e.target.value }))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Expires / renew by</label>
                <input
                  type="date"
                  value={form.expiry_date}
                  onChange={e => setForm(p => ({ ...p, expiry_date: e.target.value }))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-white/60 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
              />
            </div>

            {/* Per-set holdings — only relevant when editing an existing
                physical key (need the key_id to attach holdings to). */}
            {editing && PHYSICAL_TYPES.has(form.key_type) && (
              <HoldingsManager keyId={editing.id} />
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowForm(false); setForm(EMPTY) }}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded text-sm"
              >Cancel</button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-sm font-medium"
              >{saving ? 'Saving…' : (editing ? 'Save changes' : 'Add to register')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Event log modal */}
      {showEvents && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start md:items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-white/10 rounded-xl p-6 max-w-xl w-full">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">📜 Audit log</h2>
                <p className="text-xs text-white/60 mt-0.5">{showEvents.name}</p>
              </div>
              <button
                onClick={() => setShowEvents(null)}
                className="text-white/60 hover:text-white text-xl"
              >×</button>
            </div>
            {events.length === 0 ? (
              <div className="text-white/60 text-center py-8">No events recorded.</div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {events.map(ev => (
                  <div key={ev.id} className="p-3 bg-white/5 border border-white/10 rounded text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-white">{ev.event_type}</span>
                      <span className="text-xs text-white/50">{new Date(ev.created_at).toLocaleString('en-GB')}</span>
                    </div>
                    <div className="text-xs text-white/60 mt-1">
                      by {ev.actor_name || 'unknown'}
                      {ev.from_holder_name && <> · from <strong>{ev.from_holder_name}</strong></>}
                      {ev.to_holder_name && <> · to <strong>{ev.to_holder_name}</strong></>}
                    </div>
                    {ev.notes && <div className="text-xs text-white/80 mt-1 italic">&quot;{ev.notes}&quot;</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Per-set Holdings Manager ────────────────────────────────────────────────
// Renders inside the Edit Key drawer. Lists all sets of the key, who's holding
// each one, undertaking status, and lets the operator issue / return / mark-lost
// each one individually. Same employee picker as the main holder field.

interface Holding {
  id: string
  set_number: number
  holder_employee_id: string | null
  holder_name: string | null
  holder_email: string | null
  holder_phone: string | null
  holder_address: string | null
  holder_employee_number: string | null
  holder_job_title: string | null
  issued_date: string | null
  returned_date: string | null
  expected_return_date: string | null
  status: string
  undertaking_required: boolean
  undertaking_sent_at: string | null
  undertaking_signed_at: string | null
  undertaking_signed_name: string
  undertaking_pdf_url: string
  notes: string
  created_at: string
}

function HoldingsManager({ keyId }: { keyId: string }) {
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [empQuery, setEmpQuery] = useState('')
  const [empResults, setEmpResults] = useState<EmployeeOption[]>([])
  const [pick, setPick] = useState<EmployeeOption | null>(null)
  const [setNumber, setSetNumber] = useState(1)
  const [issuedDate, setIssuedDate] = useState('')
  const [expectedReturnDate, setExpectedReturnDate] = useState('')
  const [requireUndertaking, setRequireUndertaking] = useState(true)
  const [notes, setNotes] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<{ items: Holding[] }>(`/key-register/${keyId}/holdings`)
      setHoldings(data.items || [])
    } catch { setHoldings([]) } finally { setLoading(false) }
  }, [keyId])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (empQuery.trim().length < 2) { setEmpResults([]); return }
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch<{ items?: EmployeeOption[] }>(
          `/hr/employees/search?q=${encodeURIComponent(empQuery.trim())}`)
        setEmpResults(r.items || [])
      } catch { setEmpResults([]) }
    }, 200)
    return () => clearTimeout(t)
  }, [empQuery])

  async function addHolding() {
    if (!pick) { alert('Pick a person first'); return }
    try {
      await apiFetch(`/key-register/${keyId}/holdings`, {
        method: 'POST',
        body: JSON.stringify({
          holder_employee_id: pick.id,
          set_number: setNumber,
          issued_date: issuedDate,
          expected_return_date: expectedReturnDate,
          undertaking_required: requireUndertaking,
          notes,
        }),
      })
      setAdding(false); setPick(null); setEmpQuery(''); setSetNumber(setNumber + 1)
      setIssuedDate(''); setExpectedReturnDate(''); setNotes('')
      load()
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed') }
  }
  async function markReturned(h: Holding) {
    const note = prompt('Optional note for return (e.g. condition):') || ''
    try {
      await apiFetch(`/key-register/${keyId}/holdings/${h.id}/return`, {
        method: 'POST', body: JSON.stringify({ returned_date: new Date().toISOString().slice(0,10), notes: note }),
      })
      load()
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed') }
  }
  async function markLost(h: Holding) {
    const note = prompt('Loss circumstances:') || ''
    if (!note) return
    try {
      await apiFetch(`/key-register/${keyId}/holdings/${h.id}/mark-lost`, {
        method: 'POST', body: JSON.stringify({ notes: note }),
      })
      load()
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed') }
  }
  async function markSigned(h: Holding) {
    // Manual override — only used when the holder physically signed paper.
    // Preferred path is sendUndertakingEmail() which lets them e-sign online.
    const name = prompt(`Holder's printed name (${h.holder_name || 'the holder'} signs):`, h.holder_name || '') || ''
    if (!name) return
    const url = prompt('Optional URL to scanned PDF (SharePoint / Drive):') || ''
    try {
      await apiFetch(`/key-register/${keyId}/holdings/${h.id}/undertaking/mark-signed`, {
        method: 'POST', body: JSON.stringify({ signed_by_name: name, pdf_url: url }),
      })
      load()
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed') }
  }
  async function sendUndertakingEmail(h: Holding) {
    if (!h.holder_email) {
      const o = prompt('No email on file for this holder. Type the email to send the undertaking link to:')
      if (!o) return
      const note = prompt('Optional message to include in the email (or leave blank):') || ''
      try {
        const r = await apiFetch<{ ok: boolean; sent_to?: string; error?: string }>(
          `/key-register/${keyId}/holdings/${h.id}/undertaking/send-email`,
          { method: 'POST', body: JSON.stringify({ custom_message: note, override_email: o }) })
        if (r.ok) alert(`Email sent to ${r.sent_to}`); else alert(r.error || 'Send failed')
        load()
      } catch (e) { alert(e instanceof Error ? e.message : 'Failed') }
      return
    }
    if (!confirm(`Email the undertaking link to ${h.holder_email}? They will sign online.`)) return
    const note = prompt('Optional message to include in the email (or leave blank):') || ''
    try {
      const r = await apiFetch<{ ok: boolean; sent_to?: string; error?: string }>(
        `/key-register/${keyId}/holdings/${h.id}/undertaking/send-email`,
        { method: 'POST', body: JSON.stringify({ custom_message: note }) })
      if (r.ok) alert(`Email sent to ${r.sent_to}. They'll receive a secure link to sign.`)
      else alert(r.error || 'Send failed')
      load()
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed') }
  }
  async function removeHolding(h: Holding) {
    if (!confirm('Remove this holding row (only if created in error — audit history will be lost)?')) return
    try {
      await apiFetch(`/key-register/${keyId}/holdings/${h.id}`, { method: 'DELETE' })
      load()
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed') }
  }

  const active = holdings.filter(h => h.status === 'ACTIVE')
  const past = holdings.filter(h => h.status !== 'ACTIVE')

  return (
    <div className="mt-5 rounded-lg p-4 bg-white/3 border border-white/10 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-white font-bold text-sm">👥 Holders ({active.length} active)</h3>
          <p className="text-white/40 text-[10px]">Each set has its own holder, issue date and undertaking.</p>
        </div>
        <button
          onClick={() => setAdding(s => !s)}
          className="px-3 py-1.5 rounded-lg bg-saffron-gradient text-white text-xs font-bold"
        >{adding ? 'Cancel' : '+ Add holder'}</button>
      </div>

      {adding && (
        <div className="rounded-lg p-3 bg-white/5 border border-white/10 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1">Person</label>
              {pick ? (
                <div className="flex items-center gap-2 bg-white/5 border border-saffron-400/40 rounded px-2 py-1.5">
                  <span className="text-white text-sm flex-1">{pick.full_name}</span>
                  <button onClick={() => setPick(null)} className="text-white/40 hover:text-red-400">×</button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    value={empQuery}
                    onChange={e => setEmpQuery(e.target.value)}
                    placeholder="Search employee…"
                    className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm"
                  />
                  {empResults.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full bg-slate-800 border border-white/10 rounded max-h-40 overflow-y-auto">
                      {empResults.map(e => (
                        <button key={e.id} onClick={() => { setPick(e); setEmpQuery(''); setEmpResults([]) }}
                          className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/10">
                          {e.full_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1">Set #</label>
              <input type="number" min={1} value={setNumber} onChange={e => setSetNumber(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1">Issued date</label>
              <input type="date" value={issuedDate} onChange={e => setIssuedDate(e.target.value)}
                className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1">Expected return</label>
              <input type="date" value={expectedReturnDate} onChange={e => setExpectedReturnDate(e.target.value)}
                className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-white/70 text-xs">
            <input type="checkbox" checked={requireUndertaking} onChange={e => setRequireUndertaking(e.target.checked)} />
            Require signed undertaking from this holder
          </label>
          <input value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional) — e.g. handed over by Anil at trustee meeting"
            className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm" />
          <button onClick={addHolding} className="px-3 py-1.5 rounded bg-saffron-gradient text-white text-xs font-bold">
            Assign holder
          </button>
        </div>
      )}

      {loading && <p className="text-white/30 text-xs text-center py-3">Loading holders…</p>}

      {!loading && active.length === 0 && !adding && (
        <p className="text-white/30 text-xs text-center py-3">No active holders. Click "+ Add holder" to assign a set.</p>
      )}

      {active.map(h => (
        <HoldingRow key={h.id} h={h}
          onReturn={() => markReturned(h)}
          onLost={() => markLost(h)}
          onMarkSigned={() => markSigned(h)}
          onSendEmail={() => sendUndertakingEmail(h)}
          onDelete={() => removeHolding(h)}
        />
      ))}

      {past.length > 0 && (
        <details>
          <summary className="text-white/50 text-xs cursor-pointer hover:text-white">
            📦 Past holdings ({past.length})
          </summary>
          <div className="space-y-2 mt-2">
            {past.map(h => <HoldingRow key={h.id} h={h} historical />)}
          </div>
        </details>
      )}
    </div>
  )
}

function HoldingRow({ h, onReturn, onLost, onMarkSigned, onSendEmail, onDelete, historical }: {
  h: Holding
  onReturn?: () => void
  onLost?: () => void
  onMarkSigned?: () => void
  onSendEmail?: () => void
  onDelete?: () => void
  historical?: boolean
}) {
  const underPending = h.undertaking_required && !h.undertaking_signed_at
  const overdue = h.expected_return_date && h.status === 'ACTIVE' &&
                  new Date(h.expected_return_date) < new Date()
  return (
    <div className={`rounded-lg p-3 border ${historical ? 'bg-white/3 border-white/5' : underPending ? 'bg-amber-500/5 border-amber-500/30' : 'bg-white/5 border-white/10'}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-saffron-300 text-xs font-mono">Set #{h.set_number}</span>
            <span className="text-white text-sm font-semibold">{h.holder_name || 'No holder'}</span>
            {h.holder_job_title && <span className="text-white/40 text-[10px]">· {h.holder_job_title}</span>}
            <StatusPill status={h.status} />
            {underPending && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                {h.undertaking_sent_at ? '✉ Email sent — awaiting sign' : 'Undertaking pending'}
              </span>
            )}
            {h.undertaking_signed_at && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-300 border border-green-500/30">
                ✓ Signed
              </span>
            )}
            {overdue && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">
                ⚠ Overdue return
              </span>
            )}
          </div>
          <div className="text-white/50 text-[10px] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {h.holder_email && <span>📧 {h.holder_email}</span>}
            {h.holder_phone && <span>📞 {h.holder_phone}</span>}
            {h.issued_date && <span>📅 Issued {h.issued_date}</span>}
            {h.expected_return_date && <span>↩ Expected back {h.expected_return_date}</span>}
            {h.returned_date && <span>✓ Returned {h.returned_date}</span>}
          </div>
          {h.holder_address && (
            <p className="text-white/40 text-[10px] mt-1">🏠 {h.holder_address}</p>
          )}
          {h.notes && <p className="text-white/50 text-xs mt-1 italic">{h.notes}</p>}
        </div>
        {!historical && (
          <div className="flex gap-1 flex-shrink-0">
            {underPending && onSendEmail && (
              <button onClick={onSendEmail} title="Email a secure online-sign link to the holder"
                className="px-2 py-1 text-[10px] rounded bg-saffron-500/15 text-saffron-300 border border-saffron-400/30 hover:bg-saffron-500/25">
                {h.undertaking_sent_at ? '↻ Re-send link' : '✉ Email to sign'}
              </button>
            )}
            {underPending && onMarkSigned && (
              <button onClick={onMarkSigned} title="Manual override — only use when the holder signed paper"
                className="px-2 py-1 text-[10px] rounded bg-white/5 text-white/60 border border-white/10 hover:bg-white/10">
                Mark signed (paper)
              </button>
            )}
            {onReturn && <button onClick={onReturn} className="px-2 py-1 text-[10px] rounded bg-white/5 text-white/70 border border-white/10 hover:bg-white/10">Return</button>}
            {onLost && <button onClick={onLost} className="px-2 py-1 text-[10px] rounded bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25">Mark lost</button>}
            {onDelete && <button onClick={onDelete} className="px-2 py-1 text-[10px] rounded text-white/40 hover:text-red-400">×</button>}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone = status === 'ACTIVE'   ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
             : status === 'RETURNED' ? 'bg-white/5 text-white/50 border-white/10'
             : status === 'LOST'     ? 'bg-red-500/15 text-red-300 border-red-500/30'
             : 'bg-white/5 text-white/50 border-white/10'
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${tone}`}>
      {status}
    </span>
  )
}
