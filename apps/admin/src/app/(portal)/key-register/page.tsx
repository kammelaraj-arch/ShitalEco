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
  owner_employee_id: string | null
  owner_name: string | null
  physical_location: string
  serial_number: string
  copies_count: number
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
  description: string
  holder_employee_id: string
  holder_name: string
  owner_employee_id: string
  owner_name: string
  physical_location: string
  serial_number: string
  copies_count: number
  vault_reference: string
  access_url: string
  username_hint: string
  provider: string
  issued_date: string
  expiry_date: string
  notes: string
}

const EMPTY: KeyForm = {
  name: '', key_type: 'PHYSICAL_KEY', description: '',
  holder_employee_id: '', holder_name: '',
  owner_employee_id: '', owner_name: '',
  physical_location: '', serial_number: '', copies_count: 1,
  vault_reference: '', access_url: '', username_hint: '', provider: '',
  issued_date: '', expiry_date: '', notes: '',
}

const TYPE_LABEL: Record<string, string> = {
  PHYSICAL_KEY:        '🔑 Physical key',
  DIGITAL_CREDENTIAL:  '🔐 Digital credential',
  DOMAIN:              '🌐 Domain',
  SSL_CERTIFICATE:     '📜 SSL certificate',
  HOSTING_ACCOUNT:     '☁️ Hosting account',
  SAAS_SUBSCRIPTION:   '🧰 SaaS subscription',
  CRYPTO_KEY:          '🔏 Crypto / signing key',
  API_KEY:             '🗝️ API key (reference)',
  OTHER:               '📎 Other',
}

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
      name: k.name, key_type: k.key_type, description: k.description,
      holder_employee_id: k.holder_employee_id || '',
      holder_name: k.holder_name || '',
      owner_employee_id: k.owner_employee_id || '',
      owner_name: k.owner_name || '',
      physical_location: k.physical_location, serial_number: k.serial_number,
      copies_count: k.copies_count || 1,
      vault_reference: k.vault_reference, access_url: k.access_url,
      username_hint: k.username_hint, provider: k.provider,
      issued_date: k.issued_date || '', expiry_date: k.expiry_date || '',
      notes: k.notes,
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

  const isDigital = form.key_type !== 'PHYSICAL_KEY' && form.key_type !== 'OTHER'

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
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">Type *</label>
                <select
                  value={form.key_type}
                  onChange={e => setForm(p => ({ ...p, key_type: e.target.value }))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
                >
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Name *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder={form.key_type === 'PHYSICAL_KEY' ? 'Front door key' : 'shital.org.uk PayPal admin'}
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
            {form.key_type === 'PHYSICAL_KEY' && (
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
