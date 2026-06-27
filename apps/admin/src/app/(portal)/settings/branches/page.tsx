'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Branch {
  id: string
  branch_id: string
  internal_ref: string
  name: string
  city: string
  postcode: string
  address: string
  phone: string
  email: string
  established: string
  is_active: boolean
  manager_name: string
  manager_email: string
  notes: string
}

const EMPTY: Omit<Branch, 'id' | 'branch_id'> = {
  internal_ref: '',
  name: '', city: '', postcode: '', address: '', phone: '', email: '',
  established: '', is_active: true, manager_name: '', manager_email: '', notes: '',
}

interface BranchDashboard {
  branch: Branch
  donations: { total_count: number; completed_count: number; pending_count: number; failed_count: number; total_amount: number; today_amount: number; week_amount: number; month_amount: number; today_count: number }
  donations_by_provider: { provider: string; count: number; amount: number }[]
  devices: { id: string; name: string; device_type: string; presence: string; reader_label: string | null; reader_provider: string | null; last_seen_at: string | null }[]
  readers: { id: string; label: string; provider: string; status: string }[]
  recurring_giving: { active_count: number; active_monthly: number; pending_count: number }
  gift_aid: { eligible_count: number; eligible_amount: number }
  staff_count: number
  alerts: { severity: string; kind: string; message: string; items?: string[] }[]
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

// Seed the 4 known branches if DB is empty
const DEFAULT_BRANCHES = [
  { internal_ref: 'WEM', name: 'Wembley Main', city: 'London', postcode: 'HA9 0AA', address: '1 Temple Road, Wembley', phone: '+44 20 0000 0000', email: 'wembley@shital.org', established: '1987', is_active: true, manager_name: '', manager_email: '', notes: '' },
  { internal_ref: 'LEI', name: 'Leicester Branch', city: 'Leicester', postcode: 'LE1 1AA', address: '15 Temple Street, Leicester', phone: '+44 116 000 0000', email: 'leicester@shital.org', established: '2005', is_active: true, manager_name: '', manager_email: '', notes: '' },
  { internal_ref: 'RDG', name: 'Reading Branch', city: 'Reading', postcode: 'RG1 1AA', address: '8 Temple Lane, Reading', phone: '+44 118 000 0000', email: 'reading@shital.org', established: '2012', is_active: true, manager_name: '', manager_email: '', notes: '' },
  { internal_ref: 'MK', name: 'Milton Keynes Branch', city: 'Milton Keynes', postcode: 'MK1 1AA', address: '3 Temple Way, Milton Keynes', phone: '+44 1908 000 000', email: 'mk@shital.org', established: '2018', is_active: true, manager_name: '', manager_email: '', notes: '' },
]

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Branch | null>(null)
  const [form, setForm] = useState<Omit<Branch, 'id' | 'branch_id'>>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [dash, setDash] = useState<BranchDashboard | null>(null)
  const [dashLoading, setDashLoading] = useState<string | null>(null)

  const openDashboard = async (b: Branch) => {
    setDashLoading(b.branch_id)
    try {
      const d = await apiFetch<BranchDashboard>(`/branches/${b.branch_id}/dashboard`)
      setDash(d)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally { setDashLoading(null) }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<{ branches: Branch[] }>('/branches')
      const list = data.branches || []
      // Seed defaults if empty
      if (list.length === 0) {
        for (const b of DEFAULT_BRANCHES) {
          await apiFetch('/branches', { method: 'POST', body: JSON.stringify(b) }).catch(() => {})
        }
        const data2 = await apiFetch<{ branches: Branch[] }>('/branches')
        setBranches(data2.branches || [])
      } else {
        setBranches(list)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load branches')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openNew = () => { setEditing(null); setForm(EMPTY); setShowForm(true) }
  const openEdit = (b: Branch) => {
    setEditing(b)
    setForm({ internal_ref: b.internal_ref || '', name: b.name, city: b.city, postcode: b.postcode, address: b.address,
      phone: b.phone, email: b.email, established: b.established, is_active: b.is_active,
      manager_name: b.manager_name, manager_email: b.manager_email, notes: b.notes })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editing) {
        await apiFetch(`/branches/${editing.branch_id}`, { method: 'PUT', body: JSON.stringify(form) })
      } else {
        await apiFetch('/branches', { method: 'POST', body: JSON.stringify(form) })
      }
      setShowForm(false)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  const remove = async (b: Branch) => {
    if (!confirm(`Delete "${b.name}"? This cannot be undone.`)) return
    setDeleting(b.branch_id)
    try {
      await apiFetch(`/branches/${b.branch_id}`, { method: 'DELETE' })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally { setDeleting(null) }
  }

  const f = <K extends keyof typeof EMPTY>(k: K, v: typeof EMPTY[K]) =>
    setForm(p => ({ ...p, [k]: v }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Branches</h1>
          <p className="text-white/40 mt-1">Temple branch locations — {branches.length} configured</p>
        </div>
        <button onClick={openNew}
          className="px-5 py-2.5 rounded-xl text-white text-sm font-black transition-all hover:scale-105 active:scale-95"
          style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
          + Add Branch
        </button>
      </div>

      {error && (
        <div className="bg-red-500/15 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {[1,2,3,4].map(i => (
            <div key={i} className="glass rounded-2xl p-6 animate-pulse h-48 border border-temple-border" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {branches.map((b, i) => (
            <motion.div key={b.branch_id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="glass rounded-2xl p-6 border border-temple-border hover:border-saffron-400/20 transition-all">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-xl flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
                    🛕
                  </div>
                  <div>
                    <h3 className="text-white font-black text-lg leading-tight">{b.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      {b.internal_ref && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-saffron-400/15 text-saffron-300 border border-saffron-400/20" title="Internal reference">
                          {b.internal_ref}
                        </span>
                      )}
                      <p className="text-white/40 text-xs">{b.city}{b.established ? ` · Est. ${b.established}` : ''}</p>
                    </div>
                  </div>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                  b.is_active ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'
                }`}>
                  {b.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="space-y-1.5 text-sm mb-4">
                {b.address && (
                  <div className="flex items-start gap-2 text-white/50">
                    <span className="flex-shrink-0 mt-0.5">📍</span>
                    <span>{b.address}{b.postcode ? `, ${b.postcode}` : ''}</span>
                  </div>
                )}
                {b.phone && (
                  <div className="flex items-center gap-2 text-white/50">
                    <span>📞</span><span>{b.phone}</span>
                  </div>
                )}
                {b.email && (
                  <div className="flex items-center gap-2 text-white/50">
                    <span>✉️</span><span>{b.email}</span>
                  </div>
                )}
                {b.manager_name && (
                  <div className="flex items-center gap-2 text-white/50">
                    <span>👤</span><span>{b.manager_name}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button onClick={() => openDashboard(b)} disabled={dashLoading === b.branch_id}
                  className="flex-1 py-2 rounded-xl text-white text-sm font-black transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#0891B2,#0E7490)' }}>
                  {dashLoading === b.branch_id ? '…' : '📊 Dashboard'}
                </button>
                <button onClick={() => openEdit(b)}
                  className="px-4 py-2 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/5 transition-all">
                  Edit
                </button>
                <button onClick={() => remove(b)} disabled={deleting === b.branch_id}
                  className="px-4 py-2 rounded-xl border border-red-500/20 text-red-400/60 text-sm hover:bg-red-500/10 hover:text-red-400 transition-all disabled:opacity-40">
                  {deleting === b.branch_id ? '…' : 'Delete'}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Slide-over drawer */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-[500px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editing ? 'Edit Branch' : 'Add Branch'}</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {error && <div className="bg-red-500/15 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl">{error}</div>}

                <div>
                  <label className={lbl}>Public Display Name *</label>
                  <input value={form.name} onChange={e => f('name', e.target.value)} placeholder="e.g. Shirdi Saibaba Temple - Birmingham" className={inp} />
                  <p className="text-white/30 text-[11px] mt-1">Shown to donors on the donation portal, receipts & kiosk.</p>
                </div>

                <div>
                  <label className={lbl}>Internal Reference {!editing && '*'}</label>
                  <input value={form.internal_ref}
                    onChange={e => f('internal_ref', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                    placeholder="e.g. BHAM" className={inp + ' font-mono uppercase'} maxLength={30} />
                  <p className="text-white/30 text-[11px] mt-1">Short code used everywhere internally (reports, devices, attribution). Letters/numbers only.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>City</label>
                    <input value={form.city} onChange={e => f('city', e.target.value)} placeholder="Birmingham" className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Postcode</label>
                    <input value={form.postcode} onChange={e => f('postcode', e.target.value)} placeholder="B1 1AA" className={inp} />
                  </div>
                </div>

                <div>
                  <label className={lbl}>Address</label>
                  <input value={form.address} onChange={e => f('address', e.target.value)} placeholder="1 Temple Road, Birmingham" className={inp} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Phone</label>
                    <input value={form.phone} onChange={e => f('phone', e.target.value)} placeholder="+44 121 000 0000" className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Email</label>
                    <input type="email" value={form.email} onChange={e => f('email', e.target.value)} placeholder="bham@shital.org" className={inp} />
                  </div>
                </div>

                <div>
                  <label className={lbl}>Year Established</label>
                  <input value={form.established} onChange={e => f('established', e.target.value)} placeholder="2024" className={inp} />
                </div>

                <div>
                  <label className={lbl}>Manager Name</label>
                  <input value={form.manager_name} onChange={e => f('manager_name', e.target.value)} placeholder="Priya Patel" className={inp} />
                </div>

                <div>
                  <label className={lbl}>Manager Email</label>
                  <input type="email" value={form.manager_email} onChange={e => f('manager_email', e.target.value)} placeholder="priya@shital.org" className={inp} />
                </div>

                <div>
                  <label className={lbl}>Notes</label>
                  <textarea value={form.notes} onChange={e => f('notes', e.target.value)}
                    rows={3} className={inp + ' resize-none'} placeholder="Any notes about this branch..." />
                </div>

                <div className="flex items-center gap-3">
                  <button onClick={() => f('is_active', !form.is_active)}
                    className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ${form.is_active ? 'bg-green-500' : 'bg-white/10'}`}>
                    <span className={`block w-5 h-5 rounded-full bg-white shadow transition-all mx-0.5 ${form.is_active ? 'translate-x-5' : ''}`} />
                  </button>
                  <span className="text-white/60 text-sm">Branch is active</span>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">
                  Cancel
                </button>
                <button onClick={save} disabled={saving || !form.name.trim()}
                  className="flex-[2] py-3 rounded-xl text-white font-black text-sm disabled:opacity-50 transition-all hover:scale-105 active:scale-95"
                  style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Branch'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Smart Dashboard modal */}
      <AnimatePresence>
        {dash && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setDash(null)} className="fixed inset-0 bg-black/70 z-40" />
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
              className="fixed inset-4 sm:inset-x-[8%] sm:inset-y-[6%] bg-temple-deep border border-temple-border rounded-2xl z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-white font-black text-xl">{dash.branch.name}</h2>
                    {dash.branch.internal_ref && (
                      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-saffron-400/15 text-saffron-300 border border-saffron-400/20">{dash.branch.internal_ref}</span>
                    )}
                  </div>
                  <p className="text-white/40 text-xs mt-0.5">Smart Dashboard · {dash.branch.city}</p>
                </div>
                <button onClick={() => setDash(null)} className="text-white/40 hover:text-white text-2xl">✕</button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Alerts */}
                {dash.alerts.length > 0 && (
                  <div className="space-y-2">
                    {dash.alerts.map((a, i) => (
                      <div key={i} className={`px-4 py-2.5 rounded-xl text-sm border flex items-start gap-2 ${
                        a.severity === 'warning' ? 'bg-amber-500/10 text-amber-300 border-amber-500/20' : 'bg-sky-500/10 text-sky-300 border-sky-500/20'}`}>
                        <span>{a.severity === 'warning' ? '⚠️' : 'ℹ️'}</span>
                        <span>{a.message}{a.items && a.items.length ? ` — ${a.items.join(', ')}` : ''}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Money KPIs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Today', val: dash.donations.today_amount, sub: `${dash.donations.today_count} donations` },
                    { label: 'This Week', val: dash.donations.week_amount },
                    { label: 'This Month', val: dash.donations.month_amount },
                    { label: 'All-time', val: dash.donations.total_amount, sub: `${dash.donations.completed_count} completed` },
                  ].map((k, i) => (
                    <div key={i} className="glass rounded-2xl p-4 border border-temple-border">
                      <p className="text-white/40 text-xs font-semibold uppercase tracking-wide">{k.label}</p>
                      <p className="text-white font-black text-2xl mt-1">£{Number(k.val).toFixed(2)}</p>
                      {k.sub && <p className="text-white/30 text-[11px] mt-0.5">{k.sub}</p>}
                    </div>
                  ))}
                </div>

                {/* Status + recurring + gift aid + staff */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="glass rounded-2xl p-4 border border-temple-border">
                    <p className="text-white/40 text-xs uppercase">Pending / Failed</p>
                    <p className="text-white font-black text-lg mt-1">
                      <span className="text-amber-400">{dash.donations.pending_count}</span> / <span className="text-red-400">{dash.donations.failed_count}</span>
                    </p>
                  </div>
                  <div className="glass rounded-2xl p-4 border border-temple-border">
                    <p className="text-white/40 text-xs uppercase">Monthly Giving</p>
                    <p className="text-white font-black text-lg mt-1">{dash.recurring_giving.active_count} <span className="text-white/40 text-sm">· £{Number(dash.recurring_giving.active_monthly).toFixed(0)}/mo</span></p>
                  </div>
                  <div className="glass rounded-2xl p-4 border border-temple-border">
                    <p className="text-white/40 text-xs uppercase">Gift Aid Eligible</p>
                    <p className="text-white font-black text-lg mt-1">{dash.gift_aid.eligible_count} <span className="text-white/40 text-sm">· £{Number(dash.gift_aid.eligible_amount).toFixed(0)}</span></p>
                  </div>
                  <div className="glass rounded-2xl p-4 border border-temple-border">
                    <p className="text-white/40 text-xs uppercase">Staff</p>
                    <p className="text-white font-black text-lg mt-1">{dash.staff_count}</p>
                  </div>
                </div>

                {/* By provider */}
                {dash.donations_by_provider.length > 0 && (
                  <div>
                    <h3 className="text-white/60 text-sm font-bold mb-2">This month by provider</h3>
                    <div className="flex flex-wrap gap-2">
                      {dash.donations_by_provider.map((p, i) => (
                        <div key={i} className="glass rounded-xl px-4 py-2 border border-temple-border">
                          <span className="text-white/50 text-xs">{p.provider}</span>
                          <span className="text-white font-bold ml-2">£{Number(p.amount).toFixed(2)}</span>
                          <span className="text-white/30 text-xs ml-1">({p.count})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Devices */}
                <div>
                  <h3 className="text-white/60 text-sm font-bold mb-2">Devices ({dash.devices.length})</h3>
                  <div className="space-y-2">
                    {dash.devices.length === 0 && <p className="text-white/30 text-sm">No devices at this branch.</p>}
                    {dash.devices.map(d => (
                      <div key={d.id} className="glass rounded-xl px-4 py-3 border border-temple-border flex items-center justify-between">
                        <div>
                          <span className="text-white font-semibold text-sm">{d.name}</span>
                          <span className="text-white/30 text-xs ml-2">{d.device_type}</span>
                          {d.reader_label && <span className="text-white/40 text-xs ml-2">💳 {d.reader_label} ({d.reader_provider})</span>}
                        </div>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          d.presence === 'ONLINE' ? 'bg-green-500/20 text-green-400' :
                          d.presence === 'STALE'  ? 'bg-amber-500/20 text-amber-400' :
                          'bg-red-500/20 text-red-400'}`}>{d.presence}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Readers */}
                <div>
                  <h3 className="text-white/60 text-sm font-bold mb-2">Card Readers ({dash.readers.length})</h3>
                  <div className="space-y-2">
                    {dash.readers.length === 0 && <p className="text-amber-400/70 text-sm">⚠️ No card readers registered to this branch.</p>}
                    {dash.readers.map(r => (
                      <div key={r.id} className="glass rounded-xl px-4 py-3 border border-temple-border flex items-center justify-between">
                        <div>
                          <span className="text-white font-semibold text-sm">{r.label}</span>
                          <span className="text-white/30 text-xs ml-2">{r.provider}</span>
                        </div>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          (r.status || '').toLowerCase() === 'online' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                          {r.status || 'unknown'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
