'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Branch {
  id: string
  branch_id: string
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
  name: '', city: '', postcode: '', address: '', phone: '', email: '',
  established: '', is_active: true, manager_name: '', manager_email: '', notes: '',
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

// Seed the 4 known branches if DB is empty
const DEFAULT_BRANCHES = [
  { name: 'Wembley Main', city: 'London', postcode: 'HA9 0AA', address: '1 Temple Road, Wembley', phone: '+44 20 0000 0000', email: 'wembley@shital.org', established: '1987', is_active: true, manager_name: '', manager_email: '', notes: '' },
  { name: 'Leicester Branch', city: 'Leicester', postcode: 'LE1 1AA', address: '15 Temple Street, Leicester', phone: '+44 116 000 0000', email: 'leicester@shital.org', established: '2005', is_active: true, manager_name: '', manager_email: '', notes: '' },
  { name: 'Reading Branch', city: 'Reading', postcode: 'RG1 1AA', address: '8 Temple Lane, Reading', phone: '+44 118 000 0000', email: 'reading@shital.org', established: '2012', is_active: true, manager_name: '', manager_email: '', notes: '' },
  { name: 'Milton Keynes Branch', city: 'Milton Keynes', postcode: 'MK1 1AA', address: '3 Temple Way, Milton Keynes', phone: '+44 1908 000 000', email: 'mk@shital.org', established: '2018', is_active: true, manager_name: '', manager_email: '', notes: '' },
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
    setForm({ name: b.name, city: b.city, postcode: b.postcode, address: b.address,
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
                    <p className="text-white/40 text-xs mt-0.5">{b.city}{b.established ? ` · Est. ${b.established}` : ''}</p>
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
                <button onClick={() => openEdit(b)}
                  className="flex-1 py-2 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/5 transition-all">
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
              className="fixed right-0 top-0 h-full w-full max-w-[500px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editing ? 'Edit Branch' : 'Add Branch'}</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {error && <div className="bg-red-500/15 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl">{error}</div>}

                <div>
                  <label className={lbl}>Branch Name *</label>
                  <input value={form.name} onChange={e => f('name', e.target.value)} placeholder="e.g. Birmingham Branch" className={inp} />
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
    </div>
  )
}
