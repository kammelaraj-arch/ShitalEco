'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'
import { Pagination } from '@/components/ui/Pagination'

interface Branch { branch_id: string; name: string; is_active?: boolean }
interface NominalCode { id: string; code: string; name: string; type: string }

interface Budget {
  id: string
  branch_id: string
  fiscal_year: number
  period_type: string
  period_label: string
  period_start: string
  period_end: string
  name: string
  status: string
  fund_type: string
  project_id: string | null
  total_income: number
  total_expense: number
  net_budget: number
  notes: string
  created_by: string
  approved_by: string
  approved_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
  lines?: BudgetLine[]
}

interface BudgetLine {
  id: string
  budget_id: string
  nominal_code_id: string
  nominal_code: string
  code: string | null
  code_name: string | null
  code_type: string | null
  fund_type: string
  project_id: string | null
  amount: number
  notes: string
}

interface VarianceRow {
  line_id: string
  code: string
  code_name: string
  code_type: string
  budget_amount: number
  actual_amount: number
  variance: number
  pct_used: number
  notes: string
}

interface VarianceResponse {
  budget: Budget
  items: VarianceRow[]
  totals: {
    budget_income: number; actual_income: number
    budget_expense: number; actual_expense: number
    budget_net: number; actual_net: number
  }
}

const FUND_TYPES = ['UNRESTRICTED', 'RESTRICTED', 'ENDOWMENT']
const PERIOD_TYPES = ['YEAR', 'QUARTER', 'MONTH']

const STATUS_BADGE: Record<string, string> = {
  DRAFT:    'bg-white/10 text-white/60 border-white/20',
  APPROVED: 'bg-green-500/15 text-green-300 border-green-500/30',
  CLOSED:   'bg-blue-500/15 text-blue-300 border-blue-500/30',
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n || 0)
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-[11px] font-semibold uppercase tracking-wide mb-1'

export default function BudgetsPage() {
  const thisYear = new Date().getFullYear()
  const [items, setItems] = useState<Budget[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [filters, setFilters] = useState({ branch_id: '', fiscal_year: String(thisYear), status: '', fund_type: '' })
  const [branches, setBranches] = useState<Branch[]>([])
  const [codes, setCodes] = useState<NominalCode[]>([])
  const [showForm, setShowForm] = useState(false)
  const [detail, setDetail] = useState<Budget | null>(null)
  const [variance, setVariance] = useState<VarianceResponse | null>(null)

  useEffect(() => {
    apiFetch<{ branches: Branch[] }>('/branches')
      .then(d => setBranches((d.branches || []).filter(b => b.is_active !== false)))
      .catch(() => setBranches([]))
    apiFetch<{ items: NominalCode[] }>('/admin/nominal-codes?active=true&per_page=500')
      .then(d => setCodes(d.items || []))
      .catch(() => setCodes([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) })
      if (filters.branch_id) qs.set('branch_id', filters.branch_id)
      if (filters.fiscal_year) qs.set('fiscal_year', filters.fiscal_year)
      if (filters.status) qs.set('status', filters.status)
      if (filters.fund_type) qs.set('fund_type', filters.fund_type)
      const d = await apiFetch<{ items: Budget[]; total: number }>(`/admin/budgets?${qs}`)
      setItems(d.items || [])
      setTotal(d.total || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load budgets')
    } finally {
      setLoading(false)
    }
  }, [page, perPage, filters])

  useEffect(() => { load() }, [load])

  async function openDetail(b: Budget) {
    try {
      const [full, va] = await Promise.all([
        apiFetch<Budget>(`/admin/budgets/${b.id}`),
        apiFetch<VarianceResponse>(`/admin/budgets/${b.id}/vs-actual`).catch(() => null),
      ])
      setDetail(full)
      setVariance(va)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load budget')
    }
  }

  async function action(id: string, verb: 'approve' | 'close' | 'delete') {
    if (verb === 'delete' && !window.confirm('Delete this DRAFT budget?')) return
    try {
      if (verb === 'delete') {
        await apiFetch(`/admin/budgets/${id}`, { method: 'DELETE' })
        setDetail(null); setVariance(null)
      } else {
        const updated = await apiFetch<Budget>(`/admin/budgets/${id}/${verb}`, { method: 'POST' })
        setDetail(updated)
      }
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : `Failed to ${verb}`)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Budgets</h1>
          <p className="text-white/40 mt-1">Plan income/expense per branch + period + nominal code, then track variance against the live ledger.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ New Budget</button>
      </div>

      {/* Filters */}
      <div className="glass rounded-2xl p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <select value={filters.branch_id} onChange={e => { setFilters(f => ({ ...f, branch_id: e.target.value })); setPage(1) }} className={inp}>
          <option value="">All branches</option>
          {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
        </select>
        <input type="number" value={filters.fiscal_year} onChange={e => { setFilters(f => ({ ...f, fiscal_year: e.target.value })); setPage(1) }}
          placeholder="Fiscal year" className={inp} />
        <select value={filters.status} onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1) }} className={inp}>
          <option value="">All statuses</option>
          {['DRAFT', 'APPROVED', 'CLOSED'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.fund_type} onChange={e => { setFilters(f => ({ ...f, fund_type: e.target.value })); setPage(1) }} className={inp}>
          <option value="">All funds</option>
          {FUND_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Table */}
      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="overflow-x-auto"><table className="w-full">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs font-semibold uppercase tracking-wider">
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Period</th>
              <th className="text-left px-4 py-3">Branch</th>
              <th className="text-left px-4 py-3">Fund</th>
              <th className="text-right px-4 py-3">Income</th>
              <th className="text-right px-4 py-3">Expense</th>
              <th className="text-right px-4 py-3">Net</th>
              <th className="text-center px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-4 py-10 text-center text-white/30 text-sm">Loading…</td></tr>}
            {!loading && items.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-white/30 text-sm">No budgets yet. Click + New Budget to set one up.</td></tr>
            )}
            {items.map(b => (
              <tr key={b.id} onClick={() => openDetail(b)} className="border-b border-white/5 hover:bg-white/3 cursor-pointer transition-colors">
                <td className="px-4 py-3 text-white font-bold text-sm">{b.name}</td>
                <td className="px-4 py-3 text-white/70 text-sm font-mono">{b.period_label || `${b.fiscal_year} ${b.period_type}`}</td>
                <td className="px-4 py-3 text-white/60 text-xs">{b.branch_id}</td>
                <td className="px-4 py-3 text-white/60 text-xs">{b.fund_type}</td>
                <td className="px-4 py-3 text-right text-green-300 font-mono text-sm">{fmt(b.total_income)}</td>
                <td className="px-4 py-3 text-right text-red-300 font-mono text-sm">{fmt(b.total_expense)}</td>
                <td className={`px-4 py-3 text-right font-mono text-sm font-bold ${b.net_budget >= 0 ? 'text-white' : 'text-red-300'}`}>{fmt(b.net_budget)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${STATUS_BADGE[b.status] || 'bg-white/10 text-white/60 border-white/20'}`}>{b.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <Pagination page={page} pageSize={perPage} total={total} onPageChange={setPage} onPageSizeChange={setPerPage} />
      </div>

      <BudgetForm
        open={showForm} onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); load() }}
        branches={branches} codes={codes}
      />

      <DetailDrawer
        budget={detail} variance={variance}
        onClose={() => { setDetail(null); setVariance(null) }}
        onAction={action}
      />
    </div>
  )
}

function BudgetForm({ open, onClose, onSaved, branches, codes }: {
  open: boolean; onClose: () => void; onSaved: () => void
  branches: Branch[]; codes: NominalCode[]
}) {
  const thisYear = new Date().getFullYear()
  const [branchId, setBranchId] = useState('main')
  const [fy, setFy] = useState(String(thisYear))
  const [periodType, setPeriodType] = useState('YEAR')
  const [periodLabel, setPeriodLabel] = useState(String(thisYear))
  const [name, setName] = useState('')
  const [fundType, setFundType] = useState('UNRESTRICTED')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Array<{ nominal_code: string; amount: number; notes: string }>>([
    { nominal_code: '', amount: 0, notes: '' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (periodType === 'YEAR') setPeriodLabel(fy)
  }, [periodType, fy])

  function setLine(i: number, patch: Partial<typeof lines[number]>) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }
  function addLine() { setLines(prev => [...prev, { nominal_code: '', amount: 0, notes: '' }]) }
  function removeLine(i: number) {
    setLines(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)
  }

  const totalIncome = lines.reduce((s, l) => s + (l.amount > 0 ? l.amount : 0), 0)
  const totalExpense = lines.reduce((s, l) => s + (l.amount < 0 ? Math.abs(l.amount) : 0), 0)

  async function submit() {
    if (lines.filter(l => l.nominal_code && l.amount).length === 0) {
      setError('Add at least one line with a nominal code and amount'); return
    }
    setSaving(true); setError('')
    try {
      await apiFetch('/admin/budgets', {
        method: 'POST',
        body: JSON.stringify({
          branch_id: branchId, fiscal_year: Number(fy),
          period_type: periodType, period_label: periodLabel,
          name, fund_type: fundType, notes,
          lines: lines.filter(l => l.nominal_code).map(l => ({
            nominal_code: l.nominal_code, amount: l.amount, notes: l.notes,
          })),
        }),
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create budget')
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
            className="fixed right-0 top-0 h-full w-full sm:max-w-[760px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-white font-black text-lg">New Budget</h2>
              <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Branch</label>
                  <select value={branchId} onChange={e => setBranchId(e.target.value)} className={inp}>
                    {branches.length === 0 && <option value="main">main</option>}
                    {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Name</label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="auto from branch + period" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Fiscal year</label>
                  <input type="number" value={fy} onChange={e => setFy(e.target.value)} className={inp} />
                </div>
                <div>
                  <label className={lbl}>Period type</label>
                  <select value={periodType} onChange={e => setPeriodType(e.target.value)} className={inp}>
                    {PERIOD_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Period label</label>
                  <input value={periodLabel} onChange={e => setPeriodLabel(e.target.value)}
                    placeholder={periodType === 'YEAR' ? '2026' : periodType === 'QUARTER' ? '2026-Q1' : '2026-04'}
                    className={inp} />
                </div>
                <div>
                  <label className={lbl}>Fund type</label>
                  <select value={fundType} onChange={e => setFundType(e.target.value)} className={inp}>
                    {FUND_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={lbl}>Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${inp} resize-none`} />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={lbl}>Lines (positive = income, negative = expense)</label>
                  <button onClick={addLine} className="text-xs text-saffron-300 hover:text-saffron-200">+ Add line</button>
                </div>
                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={i} className="bg-white/3 border border-white/5 rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <select value={l.nominal_code} onChange={e => setLine(i, { nominal_code: e.target.value })}
                          className={`${inp} flex-1 text-xs`}>
                          <option value="">Pick nominal code…</option>
                          {codes.map(c => <option key={c.id} value={c.code}>{c.code} — {c.name} [{c.type}]</option>)}
                        </select>
                        <button onClick={() => removeLine(i)} disabled={lines.length === 1}
                          className="text-white/40 hover:text-red-400 disabled:opacity-30 text-lg w-9 h-9 flex items-center justify-center">✕</button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="number" step="0.01" value={l.amount || ''}
                          onChange={e => setLine(i, { amount: Number(e.target.value) })}
                          placeholder="Amount £ (negative = expense)" className={inp} />
                        <input value={l.notes} onChange={e => setLine(i, { notes: e.target.value })}
                          placeholder="Notes (optional)" className={inp} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-white/5 pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-green-300"><span>Total Income</span><span className="font-mono">{fmt(totalIncome)}</span></div>
                <div className="flex justify-between text-red-300"><span>Total Expense</span><span className="font-mono">{fmt(totalExpense)}</span></div>
                <div className="flex justify-between text-white font-black text-base pt-1"><span>Net Budget</span><span className="font-mono">{fmt(totalIncome - totalExpense)}</span></div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-white/5 flex gap-3">
              <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
              <button onClick={submit} disabled={saving} className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                {saving ? 'Creating…' : 'Create as DRAFT'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function DetailDrawer({ budget, variance, onClose, onAction }: {
  budget: Budget | null; variance: VarianceResponse | null; onClose: () => void
  onAction: (id: string, verb: 'approve' | 'close' | 'delete') => void
}) {
  if (!budget) return null
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="fixed inset-0 bg-black/60 z-40" />
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed right-0 top-0 h-full w-full sm:max-w-[820px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div>
            <h2 className="text-white font-black text-lg">{budget.name}</h2>
            <p className="text-white/40 text-xs mt-0.5">
              {budget.branch_id} · {budget.period_label || `${budget.fiscal_year}`} · {budget.fund_type}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${STATUS_BADGE[budget.status] || 'bg-white/10 text-white/60 border-white/20'}`}>{budget.status}</span>
            <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {variance && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Tile label="Budget Income"  value={fmt(variance.totals.budget_income)}  color="green" />
              <Tile label="Actual Income"  value={fmt(variance.totals.actual_income)}  color="green" />
              <Tile label="Budget Expense" value={fmt(variance.totals.budget_expense)} color="red" />
              <Tile label="Actual Expense" value={fmt(variance.totals.actual_expense)} color="red" />
            </div>
          )}

          <div>
            <p className="text-white/40 text-xs uppercase tracking-wide mb-2">Budget vs Actual (by nominal code)</p>
            <div className="border border-white/5 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-white/3 text-white/40 text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">Code</th>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-right px-3 py-2">Budget</th>
                    <th className="text-right px-3 py-2">Actual</th>
                    <th className="text-right px-3 py-2">Variance</th>
                    <th className="text-right px-3 py-2">% Used</th>
                  </tr>
                </thead>
                <tbody>
                  {variance && variance.items.map(v => (
                    <tr key={v.line_id} className="border-t border-white/5 text-white/70">
                      <td className="px-3 py-2 font-mono text-xs font-bold">{v.code}</td>
                      <td className="px-3 py-2 text-xs">{v.code_name}</td>
                      <td className="px-3 py-2 text-xs">{v.code_type}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(v.budget_amount)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(v.actual_amount)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${
                        v.code_type === 'INCOME'
                          ? (v.variance <= 0 ? 'text-green-300' : 'text-red-300')
                          : (v.variance >= 0 ? 'text-green-300' : 'text-red-300')
                      }`}>{fmt(v.variance)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{v.pct_used.toFixed(1)}%</td>
                    </tr>
                  ))}
                  {!variance && (budget.lines || []).map(l => (
                    <tr key={l.id} className="border-t border-white/5 text-white/70">
                      <td className="px-3 py-2 font-mono text-xs font-bold">{l.code}</td>
                      <td className="px-3 py-2 text-xs">{l.code_name}</td>
                      <td className="px-3 py-2 text-xs">{l.code_type}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(l.amount)}</td>
                      <td colSpan={3} className="px-3 py-2 text-right text-white/30 italic text-xs">no actuals (DRAFT)</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {budget.notes && (
            <div>
              <p className="text-white/40 text-xs mb-1">Notes</p>
              <p className="text-white/70 text-sm whitespace-pre-wrap">{budget.notes}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/5 flex flex-wrap gap-2">
          {budget.status === 'DRAFT' && (
            <button onClick={() => onAction(budget.id, 'delete')}
              className="px-4 py-2.5 rounded-xl border border-red-500/30 text-red-300 text-sm font-semibold">Delete</button>
          )}
          <div className="flex-1" />
          {budget.status === 'DRAFT' && (
            <button onClick={() => onAction(budget.id, 'approve')}
              className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white text-sm font-black">Approve</button>
          )}
          {budget.status === 'APPROVED' && (
            <button onClick={() => onAction(budget.id, 'close')}
              className="px-5 py-2.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-200 text-sm font-bold">Close period</button>
          )}
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
