'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

const CATEGORIES = ['GENERAL_DONATION', 'SOFT_DONATION', 'PROJECT_DONATION', 'SHOP', 'SERVICE']
const BRANCHES = ['main', 'leicester', 'reading', 'mk']
const BRANCH_LABELS: Record<string, string> = { main: 'Wembley', leicester: 'Leicester', reading: 'Reading', mk: 'Milton Keynes' }

const CATEGORY_COLORS: Record<string, string> = {
  GENERAL_DONATION: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  SOFT_DONATION:    'bg-green-500/20 text-green-300 border-green-500/30',
  PROJECT_DONATION: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  SHOP:             'bg-purple-500/20 text-purple-300 border-purple-500/30',
  SERVICE:          'bg-orange-500/20 text-orange-300 border-orange-500/30',
}

interface Item {
  id: string
  name: string
  name_gu: string
  name_hi: string
  name_te: string
  description: string
  category: string
  price: number
  unit: string
  emoji: string
  image_url: string
  gift_aid_eligible: boolean
  is_active: boolean
  is_live: boolean
  scope: string
  branch_id: string
  stock_qty: number | null
  sort_order: number
  available_from: string | null
  available_until: string | null
  display_channel: string
  branch_stock: Record<string, number>
}

type FormState = Omit<Item, 'id' | 'price'> & { price: string }

const EMPTY_FORM: FormState = {
  name: '', name_gu: '', name_hi: '', name_te: '', description: '',
  category: 'GENERAL_DONATION', price: '0', unit: '', emoji: '', image_url: '',
  gift_aid_eligible: false, is_active: true, is_live: true,
  scope: 'GLOBAL', branch_id: '',
  stock_qty: null, sort_order: 0,
  available_from: '', available_until: '',
  display_channel: 'both',
  branch_stock: {},
}

export default function CatalogItemsPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('ALL')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [imageUploading, setImageUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API}/items/?active_only=false`, {
        headers: { 'X-Space-Id': 'main', 'X-User-Id': 'admin' },
      })
      const data = await res.json()
      setItems(data.items || [])
    } catch { setError('Failed to load items') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const openNew = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true) }
  const openEdit = (item: Item) => {
    setEditing(item)
    setForm({
      name: item.name, name_gu: item.name_gu || '', name_hi: item.name_hi || '', name_te: item.name_te || '',
      description: item.description || '', category: item.category,
      price: String(item.price), unit: item.unit || '', emoji: item.emoji || '', image_url: item.image_url || '',
      gift_aid_eligible: item.gift_aid_eligible, is_active: item.is_active,
      is_live: item.is_live ?? true,
      scope: item.scope, branch_id: item.branch_id || '',
      stock_qty: item.stock_qty, sort_order: item.sort_order || 0,
      available_from: item.available_from ? item.available_from.slice(0, 10) : '',
      available_until: item.available_until ? item.available_until.slice(0, 10) : '',
      display_channel: item.display_channel || 'both',
      branch_stock: item.branch_stock || {},
    })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const url = editing ? `${API}/items/${editing.id}` : `${API}/items/`
      const method = editing ? 'PUT' : 'POST'
      const body = {
        ...form,
        price: parseFloat(form.price) || 0,
        available_from: form.available_from || null,
        available_until: form.available_until || null,
        stock_qty: form.stock_qty ?? null,
      }
      await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Space-Id': 'main', 'X-User-Id': 'admin',
        },
        body: JSON.stringify(body),
      })
      setShowForm(false)
      await load()
    } catch { setError('Failed to save item') }
    finally { setSaving(false) }
  }

  const toggleLive = async (item: Item) => {
    try {
      await fetch(`${API}/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Space-Id': 'main', 'X-User-Id': 'admin' },
        body: JSON.stringify({ is_live: !item.is_live }),
      })
      setItems(prev => prev.map(x => x.id === item.id ? { ...x, is_live: !x.is_live } : x))
    } catch { setError('Failed to update') }
  }

  const filtered = items.filter(i =>
    (catFilter === 'ALL' || i.category === catFilter) &&
    i.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleImageFile = (file: File) => {
    if (file.size > 3 * 1024 * 1024) { setError('Image must be under 3MB'); return }
    setImageUploading(true)
    const reader = new FileReader()
    reader.onload = (e) => {
      setForm(p => ({ ...p, image_url: e.target?.result as string }))
      setImageUploading(false)
    }
    reader.readAsDataURL(file)
  }

  const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-crimson-700/50'
  const label = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Catalog Items</h1>
          <p className="text-white/40 mt-1">Manage donations, shop items, and catalog — with scheduling and availability</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90">
          + Add Item
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="flex gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search items…"
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-white/30 outline-none focus:border-saffron-400/50 w-64" />
        <div className="flex gap-2 flex-wrap">
          {['ALL', ...CATEGORIES].map(c => (
            <button key={c} onClick={() => setCatFilter(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                catFilter === c ? 'bg-saffron-400/20 text-saffron-400 border-saffron-400/40' : 'border-white/10 text-white/40 hover:text-white/70'
              }`}>{c.replace('_', ' ')}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-white/30">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-white/30"><p className="text-4xl mb-3">📦</p><p>No items found.</p></div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden border border-temple-border">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Item', 'Category', 'Price', 'Channel', 'Schedule', 'Live', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => {
                const now = new Date()
                const from = item.available_from ? new Date(item.available_from) : null
                const until = item.available_until ? new Date(item.available_until) : null
                const inWindow = (!from || from <= now) && (!until || until >= now)
                return (
                  <motion.tr key={item.id}
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                    className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {item.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.image_url} alt="" className="w-10 h-10 object-cover rounded-lg flex-shrink-0 border border-white/10" />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0 text-xl">{item.emoji || '📦'}</div>
                        )}
                        <div>
                          <p className="text-white font-semibold text-sm">{item.name}</p>
                          <p className="text-white/30 text-xs">{item.unit}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[item.category] || 'bg-white/5 text-white/40 border-white/10'}`}>
                        {item.category.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white font-bold text-sm">£{Number(item.price).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className="text-white/50 text-xs capitalize">{item.display_channel}</span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {!from && !until ? (
                        <span className="text-white/30">Always</span>
                      ) : (
                        <span className={inWindow ? 'text-green-400' : 'text-red-400'}>
                          {from ? from.toLocaleDateString('en-GB') : '∞'} → {until ? until.toLocaleDateString('en-GB') : '∞'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleLive(item)}
                        className={`w-10 h-5 rounded-full transition-all relative ${item.is_live ? 'bg-green-500' : 'bg-white/10'}`}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${item.is_live ? 'left-5' : 'left-0.5'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(item)}
                        className="text-white/40 hover:text-saffron-400 text-sm font-medium px-3 py-1">Edit</button>
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Slide-over form */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-[520px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editing ? 'Edit Item' : 'New Item'}</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

                {/* Name */}
                <div>
                  <label className={label}>Name (English) *</label>
                  <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. General Donation" className={inp} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={label}>Gujarati</label>
                    <input value={form.name_gu} onChange={e => setForm(p => ({ ...p, name_gu: e.target.value }))} className={inp} placeholder="ગણેશ પૂજા" />
                  </div>
                  <div>
                    <label className={label}>Hindi</label>
                    <input value={form.name_hi} onChange={e => setForm(p => ({ ...p, name_hi: e.target.value }))} className={inp} placeholder="गणेश पूजा" />
                  </div>
                  <div>
                    <label className={label}>Telugu</label>
                    <input value={form.name_te} onChange={e => setForm(p => ({ ...p, name_te: e.target.value }))} className={inp} placeholder="గణేష పూజ" />
                  </div>
                </div>

                {/* Category, Price, Emoji */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={label}>Category *</label>
                    <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                      className={inp}>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={label}>Price (£) *</label>
                    <input type="number" min="0" step="0.01" value={form.price}
                      onChange={e => setForm(p => ({ ...p, price: e.target.value }))} className={inp} />
                  </div>
                  <div>
                    <label className={label}>Emoji</label>
                    <input value={form.emoji} onChange={e => setForm(p => ({ ...p, emoji: e.target.value }))} className={inp} placeholder="🙏" />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className={label}>Description</label>
                  <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    rows={2} className={inp + ' resize-none'} placeholder="Brief description…" />
                </div>

                {/* Image */}
                <div>
                  <label className={label}>Item Image</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f) }}
                  />
                  {form.image_url ? (
                    <div className="flex items-start gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={form.image_url} alt="Preview" className="w-24 h-16 object-cover rounded-xl border border-white/10 flex-shrink-0" />
                      <div className="flex-1 space-y-2">
                        <button onClick={() => fileInputRef.current?.click()}
                          className="w-full py-2 rounded-xl border border-white/10 text-white/60 text-xs font-semibold hover:bg-white/5">
                          {imageUploading ? 'Uploading…' : 'Change Image'}
                        </button>
                        <button onClick={() => setForm(p => ({ ...p, image_url: '' }))}
                          className="w-full py-2 rounded-xl border border-red-500/30 text-red-400 text-xs font-semibold hover:bg-red-500/10">
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-white/10 rounded-xl p-6 text-center cursor-pointer hover:border-crimson-700/40 transition-colors"
                    >
                      <p className="text-white/30 text-2xl mb-1">🖼</p>
                      <p className="text-white/40 text-xs">Click to upload an image (max 3MB)</p>
                      <p className="text-white/20 text-[10px] mt-0.5">JPG, PNG, WebP</p>
                    </div>
                  )}
                  <div className="mt-2">
                    <input value={form.image_url.startsWith('data:') ? '' : form.image_url}
                      onChange={e => setForm(p => ({ ...p, image_url: e.target.value }))}
                      placeholder="…or paste an image URL"
                      className={inp + ' mt-1'} />
                  </div>
                </div>

                {/* Display Channel */}
                <div>
                  <label className={label}>Display Channel</label>
                  <div className="flex gap-2">
                    {[['both', '🌐 Both'], ['kiosk', '🖥 Kiosk only'], ['web', '💻 Web only']].map(([val, lbl]) => (
                      <button key={val} onClick={() => setForm(p => ({ ...p, display_channel: val }))}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                          form.display_channel === val ? 'bg-saffron-400/20 text-saffron-400 border-saffron-400/40' : 'border-white/10 text-white/40'
                        }`}>{lbl}</button>
                    ))}
                  </div>
                </div>

                {/* Scheduling */}
                <div>
                  <label className={label}>Active Period <span className="normal-case font-normal text-white/30">(leave blank = always active)</span></label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-white/30 text-xs mb-1">From</p>
                      <input type="date" value={form.available_from || ''} onChange={e => setForm(p => ({ ...p, available_from: e.target.value }))}
                        className={inp} />
                    </div>
                    <div>
                      <p className="text-white/30 text-xs mb-1">Until</p>
                      <input type="date" value={form.available_until || ''} onChange={e => setForm(p => ({ ...p, available_until: e.target.value }))}
                        className={inp} />
                    </div>
                  </div>
                </div>

                {/* Live / Active toggles */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm font-bold">Live</p>
                      <p className="text-white/30 text-xs">Visible on kiosk/web now</p>
                    </div>
                    <button onClick={() => setForm(p => ({ ...p, is_live: !p.is_live }))}
                      className={`w-11 h-6 rounded-full transition-all relative ${form.is_live ? 'bg-green-500' : 'bg-white/10'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${form.is_live ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </div>
                  <div className="bg-white/5 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm font-bold">Gift Aid</p>
                      <p className="text-white/30 text-xs">Eligible for reclaim</p>
                    </div>
                    <button onClick={() => setForm(p => ({ ...p, gift_aid_eligible: !p.gift_aid_eligible }))}
                      className={`w-11 h-6 rounded-full transition-all relative ${form.gift_aid_eligible ? 'bg-green-500' : 'bg-white/10'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${form.gift_aid_eligible ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </div>
                </div>

                {/* Scope / Branch */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Scope</label>
                    <select value={form.scope} onChange={e => setForm(p => ({ ...p, scope: e.target.value }))} className={inp}>
                      <option value="GLOBAL">Global (all branches)</option>
                      <option value="BRANCH">Branch-specific</option>
                    </select>
                  </div>
                  <div>
                    <label className={label}>Sort Order</label>
                    <input type="number" value={form.sort_order} onChange={e => setForm(p => ({ ...p, sort_order: parseInt(e.target.value) || 0 }))} className={inp} />
                  </div>
                </div>

                {/* Per-branch stock (SHOP items) */}
                {form.category === 'SHOP' && (
                  <div>
                    <label className={label}>Stock per Branch</label>
                    <div className="grid grid-cols-2 gap-2">
                      {BRANCHES.map(b => (
                        <div key={b} className="flex items-center gap-2">
                          <span className="text-white/50 text-xs w-20 flex-shrink-0">{BRANCH_LABELS[b]}</span>
                          <input type="number" min="0"
                            value={form.branch_stock[b] ?? ''}
                            onChange={e => setForm(p => ({
                              ...p,
                              branch_stock: { ...p.branch_stock, [b]: e.target.value ? parseInt(e.target.value) : undefined } as Record<string, number>,
                            }))}
                            placeholder="∞"
                            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-saffron-400/50" />
                        </div>
                      ))}
                    </div>
                    <p className="text-white/20 text-xs mt-1">Leave blank = unlimited stock for that branch</p>
                  </div>
                )}

              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm hover:bg-white/5">Cancel</button>
                <button onClick={save} disabled={saving || !form.name.trim()}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm shadow-saffron hover:opacity-90 disabled:opacity-40">
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Item'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
