'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

const CATEGORIES = ['PUJA', 'HAVAN', 'CLASS', 'HALL_HIRE', 'FESTIVAL', 'DONATION', 'OTHER']
const CATEGORY_COLORS: Record<string, string> = {
  PUJA: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  HAVAN: 'bg-red-500/20 text-red-300 border-red-500/30',
  CLASS: 'bg-green-500/20 text-green-300 border-green-500/30',
  HALL_HIRE: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  FESTIVAL: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  DONATION: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  OTHER: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
}

interface Service {
  id: string
  name: string
  name_gu: string | null
  name_hi: string | null
  description: string | null
  category: string
  price: number
  currency: string
  duration: number | null
  capacity: number | null
  image_url: string | null
  is_active: boolean
  branch_id: string
  start_date: string | null
  end_date: string | null
}

const EMPTY: Omit<Service, 'id' | 'currency' | 'is_active'> = {
  name: '', name_gu: '', name_hi: '', description: '',
  category: 'PUJA', price: 0, duration: null, capacity: null,
  image_url: '', branch_id: 'main',
  start_date: null, end_date: null,
}

export default function KioskServicesPage() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('ALL')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Service | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/kiosk/services?branch_id=main`)
      const data = await res.json()
      setServices(data.services || [])
    } catch {
      setError('Failed to load services')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openNew = () => { setEditing(null); setForm(EMPTY); setShowForm(true) }
  const openEdit = (s: Service) => {
    setEditing(s)
    setForm({ name: s.name, name_gu: s.name_gu || '', name_hi: s.name_hi || '',
      description: s.description || '', category: s.category, price: s.price,
      duration: s.duration, capacity: s.capacity, image_url: s.image_url || '',
      branch_id: s.branch_id,
      start_date: s.start_date ? s.start_date.slice(0, 10) : null,
      end_date: s.end_date ? s.end_date.slice(0, 10) : null,
    })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name.trim() || form.price < 0) return
    setSaving(true)
    try {
      const url = editing ? `${API}/admin/services/${editing.id}` : `${API}/admin/services`
      const method = editing ? 'PUT' : 'POST'
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, price: Number(form.price) }),
      })
      setShowForm(false)
      await load()
    } catch {
      setError('Failed to save service')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (s: Service) => {
    try {
      await fetch(`${API}/admin/services/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !s.is_active }),
      })
      setServices(prev => prev.map(x => x.id === s.id ? { ...x, is_active: !x.is_active } : x))
    } catch { setError('Failed to update service') }
  }

  const filtered = services.filter(s =>
    (catFilter === 'ALL' || s.category === catFilter) &&
    (s.name.toLowerCase().includes(search.toLowerCase()) ||
     (s.description || '').toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Kiosk Services</h1>
          <p className="text-white/40 mt-1">Manage puja, havan, and other temple services shown on the kiosk</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90 transition-opacity">
          + Add Service
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search services…"
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-white/30 outline-none focus:border-saffron-400/50 w-full sm:w-64" />
        <div className="flex gap-2 flex-wrap">
          {['ALL', ...CATEGORIES].map(c => (
            <button key={c} onClick={() => setCatFilter(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                catFilter === c ? 'bg-saffron-400/20 text-saffron-400 border-saffron-400/40' : 'border-white/10 text-white/40 hover:text-white/70'
              }`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-20 text-white/30">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-white/30">
          <p className="text-4xl mb-3">🛕</p>
          <p>No services found. Add your first service.</p>
        </div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden border border-temple-border">
          <div className="overflow-x-auto"><table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-5 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Service</th>
                <th className="text-left px-5 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Category</th>
                <th className="text-left px-5 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Price</th>
                <th className="text-left px-5 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Branch</th>
                <th className="text-left px-5 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <motion.tr key={s.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-5 py-4">
                    <p className="text-white font-semibold text-sm">{s.name}</p>
                    {s.description && <p className="text-white/30 text-xs mt-0.5 truncate max-w-xs">{s.description}</p>}
                    {(s.name_gu || s.name_hi) && (
                      <p className="text-white/20 text-xs mt-0.5">{[s.name_gu, s.name_hi].filter(Boolean).join(' · ')}</p>
                    )}
                    {(s.start_date || s.end_date) && (
                      <p className="text-amber-400/70 text-[11px] mt-0.5">
                        {s.start_date && `From ${s.start_date.slice(0, 10)}`}
                        {s.start_date && s.end_date && ' → '}
                        {s.end_date && `Until ${s.end_date.slice(0, 10)}`}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${CATEGORY_COLORS[s.category] || CATEGORY_COLORS.OTHER}`}>
                      {s.category}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-white font-bold">£{s.price.toFixed(2)}</td>
                  <td className="px-5 py-4 text-white/50 text-sm capitalize">{s.branch_id}</td>
                  <td className="px-5 py-4">
                    <button onClick={() => toggle(s)}
                      className={`w-11 h-6 rounded-full transition-all relative ${s.is_active ? 'bg-green-500' : 'bg-white/10'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${s.is_active ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button onClick={() => openEdit(s)}
                      className="text-white/40 hover:text-saffron-400 text-sm font-medium transition-colors px-3 py-1">
                      Edit
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {/* Slide-over form */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)}
              className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full max-w-[480px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editing ? 'Edit Service' : 'New Service'}</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Name (English) *</label>
                  <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Ganesh Puja"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Gujarati</label>
                    <input value={form.name_gu || ''} onChange={e => setForm(p => ({ ...p, name_gu: e.target.value }))}
                      placeholder="ગણેશ પૂજા"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50" />
                  </div>
                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Hindi</label>
                    <input value={form.name_hi || ''} onChange={e => setForm(p => ({ ...p, name_hi: e.target.value }))}
                      placeholder="गणेश पूजा"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50" />
                  </div>
                </div>
                {/* Category & Price */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Category *</label>
                    <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50">
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Price (£) *</label>
                    <input type="number" min="0" step="0.01" value={form.price}
                      onChange={e => setForm(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50" />
                  </div>
                </div>
                {/* Description */}
                <div>
                  <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Description</label>
                  <textarea value={form.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    rows={3} placeholder="Brief description shown on the kiosk…"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50 resize-none" />
                </div>
                {/* Duration & Capacity */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Duration (mins)</label>
                    <input type="number" min="0" value={form.duration || ''}
                      onChange={e => setForm(p => ({ ...p, duration: e.target.value ? parseInt(e.target.value) : null }))}
                      placeholder="e.g. 60"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50" />
                  </div>
                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Capacity</label>
                    <input type="number" min="0" value={form.capacity || ''}
                      onChange={e => setForm(p => ({ ...p, capacity: e.target.value ? parseInt(e.target.value) : null }))}
                      placeholder="Max people"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50" />
                  </div>
                </div>
                {/* Branch */}
                <div>
                  <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Branch</label>
                  <input value={form.branch_id} onChange={e => setForm(p => ({ ...p, branch_id: e.target.value }))}
                    placeholder="main"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50" />
                </div>
                {/* Date restrictions */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Start Date</label>
                    <input type="date" value={form.start_date || ''}
                      onChange={e => setForm(p => ({ ...p, start_date: e.target.value || null }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50" />
                    <p className="text-white/25 text-[11px] mt-1">Leave blank = always available</p>
                  </div>
                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">End Date</label>
                    <input type="date" value={form.end_date || ''}
                      onChange={e => setForm(p => ({ ...p, end_date: e.target.value || null }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50" />
                    <p className="text-white/25 text-[11px] mt-1">Leave blank = no end restriction</p>
                  </div>
                </div>
                {/* Image URL */}
                <div>
                  <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Image URL</label>
                  <input value={form.image_url || ''} onChange={e => setForm(p => ({ ...p, image_url: e.target.value }))}
                    placeholder="https://images.unsplash.com/..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50" />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm hover:bg-white/5 transition-all">
                  Cancel
                </button>
                <button onClick={save} disabled={saving || !form.name.trim()}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm shadow-saffron hover:opacity-90 transition-opacity disabled:opacity-40">
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Service'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
