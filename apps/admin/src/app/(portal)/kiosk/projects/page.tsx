'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Project {
  id: string
  project_id: string
  name: string
  description: string
  branch_id: string
  goal_amount: number
  image_url: string
  start_date: string | null
  end_date: string | null
  is_active: boolean
  sort_order: number
}

interface ProjectItem {
  id: string
  name: string
  name_gu: string
  name_hi: string
  category: string
  price: number
  emoji: string
  image_url: string
  gift_aid_eligible: boolean
  is_active: boolean
  is_live: boolean
  available_from: string | null
  available_until: string | null
}

const BRANCHES = [
  { id: 'main', name: 'Wembley (Main)' },
  { id: 'leicester', name: 'Leicester' },
  { id: 'reading', name: 'Reading' },
  { id: 'mk', name: 'Milton Keynes' },
]

const EMPTY: Omit<Project, 'id' | 'project_id'> = {
  name: '', description: '', branch_id: 'main', goal_amount: 0,
  image_url: '', start_date: null, end_date: null, is_active: true, sort_order: 0,
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-saffron-400/50 placeholder-white/20'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1'

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [itemsByProject, setItemsByProject] = useState<Record<string, ProjectItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [form, setForm] = useState<Omit<Project, 'id' | 'project_id'>>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await apiFetch<{ projects: Project[] }>('/projects?include_inactive=true')
      const list = data.projects || []
      setProjects(list)
      // Load items for each project
      const entries = await Promise.allSettled(
        list.map(p => apiFetch<{ items: ProjectItem[] }>(`/projects/${p.id}/items`))
      )
      const map: Record<string, ProjectItem[]> = {}
      list.forEach((p, i) => {
        const r = entries[i]
        map[p.id] = r.status === 'fulfilled' ? (r.value.items || []) : []
      })
      setItemsByProject(map)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openNew = () => { setEditing(null); setForm(EMPTY); setShowForm(true) }
  const openEdit = (p: Project) => {
    setEditing(p)
    setForm({
      name: p.name, description: p.description, branch_id: p.branch_id,
      goal_amount: p.goal_amount, image_url: p.image_url,
      start_date: p.start_date ? p.start_date.slice(0, 10) : null,
      end_date: p.end_date ? p.end_date.slice(0, 10) : null,
      is_active: p.is_active, sort_order: p.sort_order,
    })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editing) {
        await apiFetch(`/projects/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) })
      } else {
        await apiFetch('/projects', { method: 'POST', body: JSON.stringify(form) })
      }
      setShowForm(false)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  const remove = async (p: Project) => {
    if (!confirm(`Delete project "${p.name}"? This cannot be undone.`)) return
    try {
      await apiFetch(`/projects/${p.id}`, { method: 'DELETE' })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const f = <K extends keyof typeof EMPTY>(k: K, v: typeof EMPTY[K]) =>
    setForm(p => ({ ...p, [k]: v }))

  const branchName = (bid: string) => BRANCHES.find(b => b.id === bid)?.name || bid

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Fundraising Projects</h1>
          <p className="text-white/40 mt-1">Manage projects like Temple Hall, Prayer Room — with donation tiers</p>
        </div>
        <button onClick={openNew}
          className="px-5 py-2.5 rounded-xl text-white text-sm font-black transition-all hover:scale-105 active:scale-95"
          style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
          + New Project
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {loading ? (
        <div className="space-y-3">
          {[1,2].map(i => <div key={i} className="glass rounded-2xl p-6 animate-pulse h-32 border border-temple-border" />)}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 text-white/30">
          <p className="text-4xl mb-3">🏗️</p>
          <p>No projects yet. Create your first fundraising project.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {projects.map((p, i) => {
            const items = itemsByProject[p.id] || []
            const raised = items.reduce((s, it) => s + it.price, 0)
            const isExpanded = expanded === p.id
            const now = new Date()
            const start = p.start_date ? new Date(p.start_date) : null
            const end = p.end_date ? new Date(p.end_date) : null
            const active = p.is_active && (!start || start <= now) && (!end || end >= now)
            return (
              <motion.div key={p.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass rounded-2xl border border-temple-border overflow-hidden">
                {/* Project header */}
                <div className="p-4 sm:p-6">
                  <div className="flex flex-wrap items-start gap-3 sm:gap-0 sm:justify-between">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image_url} alt="" className="w-14 h-14 object-cover rounded-xl flex-shrink-0 border border-white/10" />
                      ) : (
                        <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center text-2xl flex-shrink-0">🏗️</div>
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h3 className="text-white font-black text-lg leading-tight">{p.name}</h3>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                            active ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                          }`}>{active ? 'Active' : 'Inactive'}</span>
                        </div>
                        <p className="text-white/40 text-sm truncate">{branchName(p.branch_id)}</p>
                        {(p.start_date || p.end_date) && (
                          <p className="text-amber-400/70 text-xs mt-0.5">
                            {p.start_date ? p.start_date.slice(0, 10) : '∞'} → {p.end_date ? p.end_date.slice(0, 10) : '∞'}
                          </p>
                        )}
                        {p.description && <p className="text-white/30 text-xs mt-1 line-clamp-1">{p.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                      {p.goal_amount > 0 && (
                        <span className="text-saffron-400 font-bold text-sm">Goal: £{p.goal_amount.toLocaleString()}</span>
                      )}
                      <button onClick={() => openEdit(p)}
                        className="px-3 py-1.5 rounded-lg border border-white/10 text-white/60 text-xs font-semibold hover:bg-white/5 transition-all">
                        Edit
                      </button>
                      <button onClick={() => remove(p)}
                        className="px-3 py-1.5 rounded-lg border border-red-500/20 text-red-400/70 text-xs hover:bg-red-500/10 hover:text-red-400 transition-all">
                        Delete
                      </button>
                      <button onClick={() => setExpanded(isExpanded ? null : p.id)}
                        className="px-3 py-1.5 rounded-lg border border-white/10 text-white/60 text-xs font-semibold hover:bg-white/5 transition-all">
                        {items.length} items {isExpanded ? '▲' : '▼'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Items list */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                      className="overflow-hidden border-t border-white/5">
                      {items.length === 0 ? (
                        <div className="px-6 py-6 text-center text-white/30 text-sm">
                          No items linked to this project.
                          <br />
                          <span className="text-xs">Go to Catalog Items and set project_id to <code className="text-saffron-400">{p.project_id}</code></span>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-white/5">
                                <th className="text-left px-4 sm:px-6 py-2 text-white/30 text-xs font-semibold uppercase">Item</th>
                                <th className="text-left px-4 py-2 text-white/30 text-xs font-semibold uppercase hidden sm:table-cell">Price</th>
                                <th className="text-left px-4 py-2 text-white/30 text-xs font-semibold uppercase hidden md:table-cell">Schedule</th>
                                <th className="text-left px-4 py-2 text-white/30 text-xs font-semibold uppercase">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map(it => {
                                const itFrom = it.available_from ? new Date(it.available_from) : null
                                const itUntil = it.available_until ? new Date(it.available_until) : null
                                const inWindow = (!itFrom || itFrom <= now) && (!itUntil || itUntil >= now)
                                return (
                                  <tr key={it.id} className="border-b border-white/5 hover:bg-white/3">
                                    <td className="px-4 sm:px-6 py-3">
                                      <div className="flex items-center gap-2">
                                        <span className="text-lg">{it.emoji || '🧱'}</span>
                                        <div>
                                          <p className="text-white text-sm font-semibold">{it.name}</p>
                                          {it.gift_aid_eligible && (
                                            <span className="text-xs text-green-400/70">Gift Aid eligible</span>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-white font-bold text-sm hidden sm:table-cell">
                                      £{Number(it.price).toFixed(2)}
                                    </td>
                                    <td className="px-4 py-3 text-xs hidden md:table-cell">
                                      {!itFrom && !itUntil ? (
                                        <span className="text-white/30">Always</span>
                                      ) : (
                                        <span className={inWindow ? 'text-green-400' : 'text-red-400'}>
                                          {itFrom ? itFrom.toLocaleDateString('en-GB') : '∞'} → {itUntil ? itUntil.toLocaleDateString('en-GB') : '∞'}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                                        it.is_live ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-white/5 text-white/30 border-white/10'
                                      }`}>{it.is_live ? 'Live' : 'Hidden'}</span>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
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
              className="fixed right-0 top-0 h-full w-full sm:max-w-[500px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editing ? 'Edit Project' : 'New Project'}</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl p-1">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4">
                {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

                <div>
                  <label className={lbl}>Project Name *</label>
                  <input value={form.name} onChange={e => f('name', e.target.value)}
                    placeholder="e.g. Temple Hall Construction" className={inp} />
                </div>

                <div>
                  <label className={lbl}>Description</label>
                  <textarea value={form.description} onChange={e => f('description', e.target.value)}
                    rows={3} className={inp + ' resize-none'} placeholder="Briefly describe the project…" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Branch</label>
                    <select value={form.branch_id} onChange={e => f('branch_id', e.target.value)} className={inp}>
                      {BRANCHES.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Fundraising Goal (£)</label>
                    <input type="number" min="0" step="100" value={form.goal_amount}
                      onChange={e => f('goal_amount', parseFloat(e.target.value) || 0)} className={inp} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Start Date</label>
                    <input type="date" value={form.start_date || ''}
                      onChange={e => f('start_date', e.target.value || null)} className={inp} />
                    <p className="text-white/25 text-[11px] mt-1">Leave blank = no start limit</p>
                  </div>
                  <div>
                    <label className={lbl}>End Date</label>
                    <input type="date" value={form.end_date || ''}
                      onChange={e => f('end_date', e.target.value || null)} className={inp} />
                    <p className="text-white/25 text-[11px] mt-1">Leave blank = ongoing</p>
                  </div>
                </div>

                <div>
                  <label className={lbl}>Image URL</label>
                  <input value={form.image_url} onChange={e => f('image_url', e.target.value)}
                    placeholder="https://..." className={inp} />
                </div>

                <div>
                  <label className={lbl}>Sort Order</label>
                  <input type="number" value={form.sort_order}
                    onChange={e => f('sort_order', parseInt(e.target.value) || 0)} className={inp} />
                </div>

                <div className="flex items-center gap-3 bg-white/5 rounded-xl p-3">
                  <button onClick={() => f('is_active', !form.is_active)}
                    className={`w-11 h-6 rounded-full transition-all flex-shrink-0 relative ${form.is_active ? 'bg-green-500' : 'bg-white/10'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${form.is_active ? 'left-5' : 'left-0.5'}`} />
                  </button>
                  <div>
                    <p className="text-white text-sm font-bold">Project is active</p>
                    <p className="text-white/30 text-xs">Visible to donors on kiosk &amp; web</p>
                  </div>
                </div>
              </div>
              <div className="px-4 sm:px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={save} disabled={saving || !form.name.trim()}
                  className="flex-[2] py-3 rounded-xl text-white font-black text-sm disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Project'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
