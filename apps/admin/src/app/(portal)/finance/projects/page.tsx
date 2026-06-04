'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'
import { Pagination } from '@/components/ui/Pagination'
import { ProjectPicker } from '@/components/ui/ProjectPicker'

interface Branch { branch_id: string; name: string; is_active?: boolean }

interface Project {
  id: string
  project_id: string
  name: string
  description: string
  branch_id: string
  project_type: string
  status: string
  fund_type: string
  goal_amount: number
  budget_amount: number
  start_date: string | null
  end_date: string | null
  is_active: boolean
  reference: string
  notes: string
  manager_user_id: string | null
  sponsor_contact_id: string | null
  image_url: string
  created_at: string
  updated_at: string
}

interface PLItem { code_id: string; code: string; code_name: string; code_type: string; amount: number }
interface PLResponse {
  project: Project
  items: PLItem[]
  total_income: number
  total_expense: number
  net: number
  budget_amount: number
  budget_pct_used: number
  goal_pct_raised: number
}

interface TimelineRow {
  id: string; reference: string; description: string; date: string
  total_amount: number; source_type: string; source_id: string | null
  posted_by: string; posted_at: string | null
  branch_id: string; fund_type: string
}

// Keep in sync with backend VALID_TYPES in
// backend/src/shital/api/routers/project_costing.py and the glossary.
const PROJECT_TYPES = [
  'GENERAL', 'CAPITAL', 'OPERATIONAL', 'RESTRICTED_FUND',
  'EVENT', 'FUNDRAISING', 'GRANT', 'OUTREACH',
  'TECHNOLOGY', 'MAINTENANCE', 'TRAINING', 'MARKETING',
  'RESEARCH', 'PARTNERSHIP', 'EMERGENCY', 'COMPLIANCE',
]
const STATUSES      = ['ACTIVE', 'PLANNING', 'ON_HOLD', 'COMPLETED', 'CANCELLED']
const FUND_TYPES    = ['UNRESTRICTED', 'RESTRICTED', 'ENDOWMENT']

const STATUS_BADGE: Record<string, string> = {
  ACTIVE:    'bg-green-500/15 text-green-300 border-green-500/30',
  PLANNING:  'bg-blue-500/15 text-blue-300 border-blue-500/30',
  ON_HOLD:   'bg-amber-500/15 text-amber-300 border-amber-500/30',
  COMPLETED: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  CANCELLED: 'bg-red-500/15 text-red-300 border-red-500/30',
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n || 0)
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso }
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-[11px] font-semibold uppercase tracking-wide mb-1'

export default function ProjectCostingPage() {
  const [items, setItems] = useState<Project[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [filters, setFilters] = useState({ branch_id: '', status: '', project_type: '', fund_type: '', search: '' })
  const [branches, setBranches] = useState<Branch[]>([])
  const [showForm, setShowForm] = useState(false)
  const [detail, setDetail] = useState<Project | null>(null)
  const [pAndL, setPAndL] = useState<PLResponse | null>(null)
  const [timeline, setTimeline] = useState<TimelineRow[]>([])

  useEffect(() => {
    apiFetch<{ branches: Branch[] }>('/branches')
      .then(d => setBranches((d.branches || []).filter(b => b.is_active !== false)))
      .catch(() => setBranches([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ page: String(page), per_page: String(perPage), active: 'true' })
      Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const d = await apiFetch<{ items: Project[]; total: number }>(`/admin/projects?${qs}`)
      setItems(d.items || [])
      setTotal(d.total || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [page, perPage, filters])

  useEffect(() => { load() }, [load])

  async function openDetail(p: Project) {
    setDetail(p)
    try {
      const [pl, tl] = await Promise.all([
        apiFetch<PLResponse>(`/admin/projects/${p.id}/p-and-l`).catch(() => null),
        apiFetch<{ items: TimelineRow[] }>(`/admin/projects/${p.id}/timeline?limit=50`).catch(() => ({ items: [] })),
      ])
      setPAndL(pl)
      setTimeline(tl?.items || [])
    } catch {
      setPAndL(null); setTimeline([])
    }
  }

  async function setStatus(id: string, status: string) {
    try {
      const updated = await apiFetch<Project>(`/admin/projects/${id}/status`, {
        method: 'POST', body: JSON.stringify({ status }),
      })
      setDetail(updated)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update status')
    }
  }

  async function deactivate(id: string) {
    if (!window.confirm('Deactivate this project? (Soft-delete — history is preserved.)')) return
    try {
      await apiFetch(`/admin/projects/${id}`, { method: 'DELETE' })
      setDetail(null)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to deactivate')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Project Costing</h1>
          <p className="text-white/40 mt-1">Track income vs expense + budget for capital, event, grant, and restricted-fund projects.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ New Project</button>
      </div>

      <div className="glass rounded-2xl p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
        <input value={filters.search} onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1) }}
          placeholder="Search" className={inp} />
        <select value={filters.branch_id} onChange={e => { setFilters(f => ({ ...f, branch_id: e.target.value })); setPage(1) }} className={inp}>
          <option value="">All branches</option>
          {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
        </select>
        <select value={filters.status} onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1) }} className={inp}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.project_type} onChange={e => { setFilters(f => ({ ...f, project_type: e.target.value })); setPage(1) }} className={inp}>
          <option value="">All types</option>
          {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filters.fund_type} onChange={e => { setFilters(f => ({ ...f, fund_type: e.target.value })); setPage(1) }} className={inp}>
          <option value="">All funds</option>
          {FUND_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="overflow-x-auto"><table className="w-full">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs font-semibold uppercase tracking-wider">
              <th className="text-left px-4 py-3">Code</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Branch</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-right px-4 py-3">Budget</th>
              <th className="text-right px-4 py-3">Goal</th>
              <th className="text-center px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-4 py-10 text-center text-white/30 text-sm">Loading…</td></tr>}
            {!loading && items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-white/30 text-sm">No projects. Click + New Project to start tracking one.</td></tr>
            )}
            {items.map(p => (
              <tr key={p.id} onClick={() => openDetail(p)} className="border-b border-white/5 hover:bg-white/3 cursor-pointer transition-colors">
                <td className="px-4 py-3 text-white font-mono text-xs font-bold">
                  {p.project_id}
                  <Link href={`/finance/projects/detail?id=${p.id}`} onClick={e => e.stopPropagation()}
                     className="ml-2 text-[10px] text-saffron-300 hover:underline">Detail ↗</Link>
                </td>
                <td className="px-4 py-3 text-white/80 text-sm">{p.name}</td>
                <td className="px-4 py-3 text-white/50 text-xs">{p.branch_id}</td>
                <td className="px-4 py-3 text-white/50 text-xs">{p.project_type}</td>
                <td className="px-4 py-3 text-right text-white/70 font-mono text-sm">{fmt(p.budget_amount)}</td>
                <td className="px-4 py-3 text-right text-white/70 font-mono text-sm">{fmt(p.goal_amount)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${STATUS_BADGE[p.status] || 'bg-white/10 text-white/60 border-white/20'}`}>{p.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <Pagination page={page} pageSize={perPage} total={total} onPageChange={setPage} onPageSizeChange={setPerPage} />
      </div>

      <ProjectForm
        open={showForm} onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); load() }}
        branches={branches}
      />

      <DetailDrawer
        project={detail} pAndL={pAndL} timeline={timeline}
        onClose={() => { setDetail(null); setPAndL(null); setTimeline([]) }}
        onSetStatus={setStatus} onDeactivate={deactivate}
      />
    </div>
  )
}

function ProjectForm({ open, onClose, onSaved, branches }: {
  open: boolean; onClose: () => void; onSaved: () => void; branches: Branch[]
}) {
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [branchId, setBranchId] = useState('main')
  const [description, setDescription] = useState('')
  const [projectType, setProjectType] = useState('GENERAL')
  const [fundType, setFundType] = useState('UNRESTRICTED')
  const [status, setStatus] = useState('ACTIVE')
  const [budget, setBudget] = useState('0')
  const [goal, setGoal] = useState('0')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [parent, setParent] = useState<{ id: string; name: string; project_id: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')
    try {
      const created = await apiFetch<{ id?: string }>('/admin/projects', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId, name, description, branch_id: branchId,
          project_type: projectType, status, fund_type: fundType,
          budget_amount: Number(budget), goal_amount: Number(goal),
          start_date: startDate, end_date: endDate,
          reference, notes,
        }),
      })
      // Backend create endpoint doesn't accept parent_project_id, so wire
      // it up as a second call via the PATCH /parent endpoint. Skipped if
      // the user didn't pick a parent.
      if (parent && created?.id) {
        try {
          await apiFetch(`/admin/projects/${created.id}/parent`, {
            method: 'PATCH',
            body: JSON.stringify({ parent_project_id: parent.id }),
          })
        } catch { /* non-fatal — project still created */ }
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create project')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} className="fixed inset-0 bg-black/60 z-40" />
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="fixed right-0 top-0 h-full w-full sm:max-w-[600px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-white font-black text-lg">New Project</h2>
              <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

              <div>
                <label className={lbl}>Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} className={inp} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Project code</label>
                  <input value={projectId} onChange={e => setProjectId(e.target.value.toUpperCase())}
                    placeholder="auto if blank" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Branch</label>
                  <select value={branchId} onChange={e => setBranchId(e.target.value)} className={inp}>
                    {branches.length === 0 && <option value="main">main</option>}
                    {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Type</label>
                  <select value={projectType} onChange={e => setProjectType(e.target.value)} className={inp}>
                    {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Fund</label>
                  <select value={fundType} onChange={e => setFundType(e.target.value)} className={inp}>
                    {FUND_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Status</label>
                  <select value={status} onChange={e => setStatus(e.target.value)} className={inp}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Reference</label>
                  <input value={reference} onChange={e => setReference(e.target.value)} className={inp} />
                </div>
                <div>
                  <label className={lbl}>Budget £</label>
                  <input type="number" step="0.01" min="0" value={budget} onChange={e => setBudget(e.target.value)} className={inp} />
                </div>
                <div>
                  <label className={lbl}>Goal (target raise) £</label>
                  <input type="number" step="0.01" min="0" value={goal} onChange={e => setGoal(e.target.value)} className={inp} />
                </div>
                <div>
                  <label className={lbl}>Start date</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inp} />
                </div>
                <div>
                  <label className={lbl}>End date</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inp} />
                </div>
              </div>

              <div>
                <label className={lbl}>Parent project (optional)</label>
                <ProjectPicker value={parent} onChange={setParent} placeholder="Leave blank for top-level project…" />
                <p className="text-white/30 text-[10px] mt-1">Link this project under an existing one to form a programme / sub-project hierarchy.</p>
              </div>

              <div>
                <label className={lbl}>Description</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={`${inp} resize-none`} />
              </div>

              <div>
                <label className={lbl}>Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${inp} resize-none`} />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-white/5 flex gap-3">
              <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
              <button onClick={submit} disabled={saving} className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                {saving ? 'Creating…' : 'Create Project'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function DetailDrawer({ project, pAndL, timeline, onClose, onSetStatus, onDeactivate }: {
  project: Project | null; pAndL: PLResponse | null; timeline: TimelineRow[]
  onClose: () => void
  onSetStatus: (id: string, status: string) => void
  onDeactivate: (id: string) => void
}) {
  if (!project) return null
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="fixed inset-0 bg-black/60 z-40" />
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed right-0 top-0 h-full w-full sm:max-w-[860px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div>
            <h2 className="text-white font-black text-lg">{project.name}</h2>
            <p className="text-white/40 text-xs mt-0.5 font-mono">
              {project.project_id} · {project.branch_id} · {project.project_type} · {project.fund_type}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select value={project.status} onChange={e => onSetStatus(project.id, e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-1 text-white text-xs">
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {pAndL && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Tile label="Income"   value={fmt(pAndL.total_income)}  color="green" />
              <Tile label="Expense"  value={fmt(pAndL.total_expense)} color="red" />
              <Tile label="Net"      value={fmt(pAndL.net)}           color={pAndL.net >= 0 ? 'green' : 'red'} />
              <Tile label="Budget used"
                    value={`${pAndL.budget_pct_used.toFixed(1)}%`}
                    color={pAndL.budget_pct_used > 100 ? 'red' : 'white'} />
            </div>
          )}

          {pAndL && pAndL.goal_pct_raised > 0 && (
            <div className="glass rounded-xl p-3 border border-white/5">
              <div className="flex justify-between text-xs text-white/50 mb-1">
                <span>Goal progress</span>
                <span>{fmt(pAndL.total_income)} of {fmt(project.goal_amount)} · {pAndL.goal_pct_raised.toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full bg-saffron-gradient" style={{ width: `${Math.min(100, pAndL.goal_pct_raised)}%` }} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div><p className="text-white/40">Start</p><p className="text-white font-mono">{fmtDate(project.start_date)}</p></div>
            <div><p className="text-white/40">End</p><p className="text-white font-mono">{fmtDate(project.end_date)}</p></div>
            <div><p className="text-white/40">Reference</p><p className="text-white/80">{project.reference || '—'}</p></div>
            <div><p className="text-white/40">Active</p><p className="text-white">{project.is_active ? '✓' : '✗'}</p></div>
          </div>

          {project.description && (
            <div>
              <p className="text-white/40 text-xs mb-1">Description</p>
              <p className="text-white/70 text-sm whitespace-pre-wrap">{project.description}</p>
            </div>
          )}

          <div>
            <p className="text-white/40 text-xs uppercase tracking-wide mb-2">P&L by nominal code</p>
            <div className="border border-white/5 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-white/3 text-white/40 text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">Code</th>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-right px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(pAndL?.items || []).length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-white/30 text-xs">No postings yet against this project.</td></tr>
                  )}
                  {(pAndL?.items || []).map(it => (
                    <tr key={it.code_id} className="border-t border-white/5 text-white/70">
                      <td className="px-3 py-2 font-mono text-xs font-bold">{it.code}</td>
                      <td className="px-3 py-2 text-xs">{it.code_name}</td>
                      <td className={`px-3 py-2 text-xs font-bold ${it.code_type === 'INCOME' ? 'text-green-300' : 'text-yellow-300'}`}>{it.code_type}</td>
                      <td className={`px-3 py-2 text-right font-mono ${it.code_type === 'INCOME' ? 'text-green-200' : 'text-yellow-200'}`}>{fmt(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="text-white/40 text-xs uppercase tracking-wide mb-2">Recent GL postings</p>
            <div className="border border-white/5 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-white/3 text-white/40 text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Reference</th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-left px-3 py-2">Source</th>
                    <th className="text-right px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-white/30 text-xs">No GL entries yet.</td></tr>
                  )}
                  {timeline.map(t => (
                    <tr key={t.id} className="border-t border-white/5 text-white/70">
                      <td className="px-3 py-2 font-mono text-xs">{fmtDate(t.date)}</td>
                      <td className="px-3 py-2 font-mono text-xs font-bold">{t.reference}</td>
                      <td className="px-3 py-2 text-xs">{t.description}</td>
                      <td className="px-3 py-2 text-xs font-mono text-white/50">{t.source_type}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(t.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/5 flex gap-3">
          <button onClick={() => onDeactivate(project.id)}
            className="px-4 py-2.5 rounded-xl border border-red-500/30 text-red-300 text-sm font-semibold">Deactivate</button>
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-white/5 text-white/70 text-sm">Close</button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

function Tile({ label, value, color }: { label: string; value: string; color: 'green' | 'red' | 'white' }) {
  const txt = color === 'green' ? 'text-green-300' : color === 'red' ? 'text-red-300' : 'text-white'
  return (
    <div className="glass rounded-xl p-3 border border-white/5">
      <p className="text-white/40 text-[10px] uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-black font-mono mt-1 ${txt}`}>{value}</p>
    </div>
  )
}
