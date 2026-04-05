'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Asset {
  id: string
  name: string
  category: string
  description: string
  serial_number: string
  purchase_date: string
  purchase_price: number
  current_value: number
  supplier: string
  warranty_expiry: string
  location: string
  status: string
  assigned_to: string
  notes: string
}

interface AssetsResponse {
  assets: Asset[]
  total: number
  total_value: number
  by_category: Record<string, { count: number; value: number }>
}

interface AssetForm {
  name: string
  category: string
  description: string
  serial_number: string
  purchase_date: string
  purchase_price: string
  supplier: string
  location: string
  warranty_expiry: string
  assigned_to: string
  notes: string
}

const EMPTY_FORM: AssetForm = {
  name: '', category: 'OTHER', description: '', serial_number: '',
  purchase_date: '', purchase_price: '', supplier: '', location: '',
  warranty_expiry: '', assigned_to: '', notes: '',
}

const CATEGORIES = ['ALL', 'FURNITURE', 'IT_EQUIPMENT', 'VEHICLES', 'PROPERTY', 'AV_EQUIPMENT', 'KITCHEN', 'OTHER']

const CAT_COLORS: Record<string, string> = {
  FURNITURE:     'bg-amber-500/20 text-amber-400 border-amber-500/30',
  IT_EQUIPMENT:  'bg-blue-500/20 text-blue-400 border-blue-500/30',
  VEHICLES:      'bg-green-500/20 text-green-400 border-green-500/30',
  PROPERTY:      'bg-purple-500/20 text-purple-400 border-purple-500/30',
  AV_EQUIPMENT:  'bg-pink-500/20 text-pink-400 border-pink-500/30',
  KITCHEN:       'bg-orange-500/20 text-orange-400 border-orange-500/30',
  OTHER:         'bg-white/10 text-white/50 border-white/10',
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:   'bg-green-500/20 text-green-400 border-green-500/30',
  DISPOSED: 'bg-red-500/20 text-red-400 border-red-500/30',
  REPAIR:   'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

export default function AssetsPage() {
  const [data, setData] = useState<AssetsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [catFilter, setCatFilter] = useState('ALL')
  const [showForm, setShowForm] = useState(false)
  const [editAsset, setEditAsset] = useState<Asset | null>(null)
  const [form, setForm] = useState<AssetForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = catFilter !== 'ALL' ? `?category=${catFilter}` : ''
      const res = await apiFetch<AssetsResponse>(`/assets${params}`)
      setData(res)
    } catch {
      setError('Failed to load assets')
    } finally { setLoading(false) }
  }, [catFilter])

  useEffect(() => { load() }, [load])

  const openAdd = () => { setEditAsset(null); setForm(EMPTY_FORM); setShowForm(true) }
  const openEdit = (a: Asset) => {
    setEditAsset(a)
    setForm({
      name: a.name, category: a.category, description: a.description || '',
      serial_number: a.serial_number || '', purchase_date: a.purchase_date ? a.purchase_date.slice(0, 10) : '',
      purchase_price: a.purchase_price ? String(a.purchase_price) : '',
      supplier: a.supplier || '', location: a.location || '',
      warranty_expiry: a.warranty_expiry ? a.warranty_expiry.slice(0, 10) : '',
      assigned_to: a.assigned_to || '', notes: a.notes || '',
    })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editAsset) {
        await apiFetch(`/assets/${editAsset.id}`, { method: 'PATCH', body: JSON.stringify(form) })
      } else {
        await apiFetch('/assets', { method: 'POST', body: JSON.stringify(form) })
      }
      setShowForm(false)
      setForm(EMPTY_FORM)
      setEditAsset(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save asset')
    } finally { setSaving(false) }
  }

  const del = async (id: string) => {
    if (!confirm('Mark this asset as disposed?')) return
    setDeleting(id)
    try {
      await apiFetch(`/assets/${id}`, { method: 'DELETE' })
      await load()
    } catch {
      setError('Failed to delete asset')
    } finally { setDeleting(null) }
  }

  const assets = data?.assets || []
  const totalValue = data?.total_value || 0

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Assets</h1>
          <p className="text-white/40 mt-1">Fixed assets register — live from database</p>
        </div>
        <button onClick={openAdd}
          className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90">
          + Add Asset
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Assets', value: loading ? '—' : String(data?.total || 0), icon: '📋', color: 'from-blue-600 to-indigo-500' },
          { label: 'Total Value', value: loading ? '—' : `£${totalValue.toLocaleString('en-GB', { minimumFractionDigits: 0 })}`, icon: '💰', color: 'from-green-600 to-emerald-500' },
          { label: 'Categories', value: loading ? '—' : String(Object.keys(data?.by_category || {}).length), icon: '🗂️', color: 'from-amber-600 to-orange-500' },
          { label: 'Active Assets', value: loading ? '—' : String(assets.filter(a => a.status === 'ACTIVE').length), icon: '✅', color: 'from-purple-600 to-violet-500' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="glass rounded-2xl p-5 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-lg mb-3`}>{s.icon}</div>
            <p className="text-white/50 text-xs font-medium">{s.label}</p>
            <p className="text-2xl font-black text-white mt-1">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Category filters */}
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map(cat => (
          <button key={cat} onClick={() => setCatFilter(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              catFilter === cat
                ? 'bg-saffron-400/20 text-saffron-400 border-saffron-400/40'
                : 'border-white/10 text-white/40 hover:text-white/70'
            }`}>
            {cat.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Assets table */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="glass rounded-2xl overflow-hidden border border-temple-border">
        {loading ? (
          <div className="text-center py-16 text-white/30">Loading assets…</div>
        ) : assets.length === 0 ? (
          <div className="text-center py-16 text-white/30">
            <p className="text-4xl mb-3">📋</p>
            <p>No assets registered yet.</p>
            <p className="text-xs mt-1 text-white/20">Add your first asset to start tracking your fixed asset register.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Name', 'Category', 'Location', 'Purchase Date', 'Value', 'Status', 'Assigned To', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assets.map((asset, i) => (
                <motion.tr key={asset.id}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                  className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-white font-semibold text-sm">{asset.name}</p>
                    {asset.serial_number && <p className="text-white/30 text-xs">S/N: {asset.serial_number}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${CAT_COLORS[asset.category] || CAT_COLORS.OTHER}`}>
                      {asset.category.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/60 text-sm">{asset.location || '—'}</td>
                  <td className="px-4 py-3 text-white/50 text-sm">
                    {asset.purchase_date ? new Date(asset.purchase_date).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-white text-sm">
                    {asset.current_value ? `£${Number(asset.current_value).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${STATUS_COLORS[asset.status] || 'bg-white/5 text-white/40 border-white/10'}`}>
                      {asset.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/50 text-sm">{asset.assigned_to || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEdit(asset)}
                        className="text-white/40 hover:text-saffron-400 text-xs font-semibold transition-colors">Edit</button>
                      <button onClick={() => del(asset.id)} disabled={deleting === asset.id}
                        className="text-white/30 hover:text-red-400 text-xs font-semibold transition-colors disabled:opacity-40">
                        {deleting === asset.id ? '…' : 'Dispose'}
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </motion.div>

      {/* Add / Edit slide-over */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-[520px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editAsset ? 'Edit Asset' : 'Add Asset'}</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div>
                  <label className={lbl}>Asset Name *</label>
                  <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inp} placeholder="e.g. Reception Desk" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Category</label>
                    <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inp}>
                      {CATEGORIES.filter(c => c !== 'ALL').map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Serial Number</label>
                    <input value={form.serial_number} onChange={e => setForm(p => ({ ...p, serial_number: e.target.value }))} className={inp} placeholder="SN-12345" />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Description</label>
                  <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} className={inp + ' resize-none'} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Purchase Date</label>
                    <input type="date" value={form.purchase_date} onChange={e => setForm(p => ({ ...p, purchase_date: e.target.value }))} className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Purchase Price (£)</label>
                    <input type="number" min="0" step="0.01" value={form.purchase_price} onChange={e => setForm(p => ({ ...p, purchase_price: e.target.value }))} className={inp} placeholder="0.00" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Supplier</label>
                    <input value={form.supplier} onChange={e => setForm(p => ({ ...p, supplier: e.target.value }))} className={inp} placeholder="Supplier name" />
                  </div>
                  <div>
                    <label className={lbl}>Warranty Expiry</label>
                    <input type="date" value={form.warranty_expiry} onChange={e => setForm(p => ({ ...p, warranty_expiry: e.target.value }))} className={inp} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Location</label>
                    <input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} className={inp} placeholder="e.g. Main Office" />
                  </div>
                  <div>
                    <label className={lbl}>Assigned To</label>
                    <input value={form.assigned_to} onChange={e => setForm(p => ({ ...p, assigned_to: e.target.value }))} className={inp} placeholder="Person/department" />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Notes</label>
                  <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className={inp + ' resize-none'} />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={save} disabled={saving || !form.name.trim()}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {saving ? 'Saving…' : editAsset ? 'Update Asset' : 'Add Asset'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
