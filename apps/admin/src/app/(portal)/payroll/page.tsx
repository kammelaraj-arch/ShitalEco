'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'
import { Pagination } from '@/components/ui/Pagination'

interface Branch { branch_id: string; name: string; is_active?: boolean }

interface Payslip {
  id: string
  payroll_run_id: string
  employee_id: string
  employee_name: string
  employee_number: string
  branch_id: string
  period_label: string
  period_start: string | null
  period_end: string | null
  pay_date: string | null
  tax_code: string
  ni_number: string
  basic_pay: number
  overtime_pay: number
  bonus_pay: number
  other_pay: number
  gross_pay: number
  taxable_pay: number
  tax_deduction: number
  ni_employee: number
  pension_employee: number
  student_loan: number
  other_deductions: number
  total_deductions: number
  net_pay: number
  ni_employer: number
  pension_employer: number
  total_employer_cost: number
  ytd_gross: number
  ytd_tax: number
  ytd_ni: number
  ytd_pension: number
  ytd_net: number
  status: string
  payment_method: string
  payment_ref: string
  paid_at: string | null
  sent_at: string | null
  earnings_json: Array<{ label: string; amount: number }>
  deductions_json: Array<{ label: string; amount: number }>
  notes: string
}

interface PayrollRun {
  id: string
  branch_id: string
  period: string
  period_year: number | null
  period_month: number | null
  period_label: string
  period_start: string | null
  period_end: string | null
  pay_date: string | null
  run_date: string
  status: string
  processed_by: string
  total_gross: number
  total_net: number
  total_tax: number
  total_ni: number
  total_pension: number
  total_employer_ni: number
  total_employer_pension: number
  total_employer_cost: number
  notes: string
  payslip_count?: number
  finalised_by: string
  finalised_at: string | null
  paid_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  payslips?: Payslip[]
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT:     'bg-white/10 text-white/60 border-white/20',
  PENDING:   'bg-white/10 text-white/60 border-white/20',
  FINALIZED: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  PAID:      'bg-green-500/15 text-green-300 border-green-500/30',
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n || 0)
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso }
}
function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-[11px] font-semibold uppercase tracking-wide mb-1'

export default function PayrollPage() {
  const [items, setItems]       = useState<PayrollRun[]>([])
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [page, setPage]         = useState(1)
  const [perPage, setPerPage]   = useState(20)
  const [filters, setFilters]   = useState({ branch_id: '', year: '', status: '' })
  const [branches, setBranches] = useState<Branch[]>([])
  const [showForm, setShowForm] = useState(false)
  const [detail, setDetail]     = useState<PayrollRun | null>(null)
  const [payslipDetail, setPayslipDetail] = useState<Payslip | null>(null)
  const [actioning, setActioning] = useState('')

  useEffect(() => {
    apiFetch<{ branches: Branch[] }>('/branches')
      .then(d => setBranches((d.branches || []).filter(b => b.is_active !== false)))
      .catch(() => setBranches([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) })
      if (filters.branch_id) qs.set('branch_id', filters.branch_id)
      if (filters.year)      qs.set('year',      filters.year)
      if (filters.status)    qs.set('status',    filters.status)
      const d = await apiFetch<{ items: PayrollRun[]; total: number }>(`/payroll/runs?${qs}`)
      setItems(d.items || [])
      setTotal(d.total || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load payroll runs')
    } finally {
      setLoading(false)
    }
  }, [page, perPage, filters])

  useEffect(() => { load() }, [load])

  async function openRun(r: PayrollRun) {
    try {
      const full = await apiFetch<PayrollRun>(`/payroll/runs/${r.id}`)
      setDetail(full)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load run')
    }
  }

  async function refreshDetail(id: string) {
    try {
      const full = await apiFetch<PayrollRun>(`/payroll/runs/${id}`)
      setDetail(full)
    } catch { /* non-fatal */ }
  }

  async function action(id: string, verb: 'regenerate' | 'finalize' | 'mark-paid' | 'delete') {
    if (verb === 'delete' && !window.confirm('Delete this DRAFT payroll run?')) return
    if (verb === 'finalize' && !window.confirm('Finalize this run? Payslips will be frozen.')) return
    setActioning(id + verb)
    try {
      if (verb === 'delete') {
        await apiFetch(`/payroll/runs/${id}`, { method: 'DELETE' })
        setDetail(null)
      } else if (verb === 'mark-paid') {
        const ref = window.prompt('Payment reference (BACS / cheque / etc):') || ''
        await apiFetch(`/payroll/runs/${id}/mark-paid`, {
          method: 'POST',
          body: JSON.stringify({ payment_method: 'bank_transfer', payment_ref: ref }),
        })
        await refreshDetail(id)
      } else {
        await apiFetch(`/payroll/runs/${id}/${verb}`, { method: 'POST' })
        await refreshDetail(id)
      }
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : `Failed to ${verb}`)
    } finally {
      setActioning('')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Payroll</h1>
          <p className="text-white/40 mt-1">Monthly payroll runs with auto-generated payslips. UK PAYE/NI/Pension calculation built in.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ New Payroll Run</button>
      </div>

      <div className="glass rounded-2xl p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <select value={filters.branch_id} onChange={e => { setFilters(f => ({ ...f, branch_id: e.target.value })); setPage(1) }} className={inp}>
          <option value="">All branches</option>
          {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
        </select>
        <input type="number" value={filters.year} onChange={e => { setFilters(f => ({ ...f, year: e.target.value })); setPage(1) }}
          placeholder="Year" className={inp} />
        <select value={filters.status} onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1) }} className={inp}>
          <option value="">All statuses</option>
          {['DRAFT', 'FINALIZED', 'PAID', 'PENDING'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="overflow-x-auto"><table className="w-full">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs font-semibold uppercase tracking-wider">
              <th className="text-left px-4 py-3">Period</th>
              <th className="text-left px-4 py-3">Branch</th>
              <th className="text-left px-4 py-3">Pay date</th>
              <th className="text-right px-4 py-3">Payslips</th>
              <th className="text-right px-4 py-3">Gross</th>
              <th className="text-right px-4 py-3">Net</th>
              <th className="text-right px-4 py-3">Employer cost</th>
              <th className="text-center px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-4 py-10 text-center text-white/30 text-sm">Loading…</td></tr>}
            {!loading && items.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-white/30 text-sm">No payroll runs yet. Click + New Payroll Run.</td></tr>
            )}
            {items.map(r => (
              <tr key={r.id} onClick={() => openRun(r)} className="border-b border-white/5 hover:bg-white/3 cursor-pointer transition-colors">
                <td className="px-4 py-3 text-white font-bold text-sm">{r.period_label || r.period}</td>
                <td className="px-4 py-3 text-white/60 text-xs">{r.branch_id}</td>
                <td className="px-4 py-3 text-white/70 text-sm font-mono">{fmtDate(r.pay_date)}</td>
                <td className="px-4 py-3 text-right text-white/80 font-mono">{r.payslip_count ?? '—'}</td>
                <td className="px-4 py-3 text-right text-white font-mono text-sm font-bold">{fmt(r.total_gross)}</td>
                <td className="px-4 py-3 text-right text-green-300 font-mono text-sm font-bold">{fmt(r.total_net)}</td>
                <td className="px-4 py-3 text-right text-white/70 font-mono text-sm">{fmt(r.total_employer_cost)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${STATUS_BADGE[r.status] || 'bg-white/10 text-white/60 border-white/20'}`}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <Pagination page={page} pageSize={perPage} total={total} onPageChange={setPage} onPageSizeChange={setPerPage} />
      </div>

      <CreateForm
        open={showForm} onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); load() }}
        branches={branches}
      />

      <RunDrawer
        run={detail} onClose={() => setDetail(null)}
        onAction={action} actioning={actioning}
        onPayslipClick={setPayslipDetail}
      />

      <PayslipDrawer payslip={payslipDetail} onClose={() => setPayslipDetail(null)} />
    </div>
  )
}

function CreateForm({ open, onClose, onSaved, branches }: {
  open: boolean; onClose: () => void; onSaved: () => void; branches: Branch[]
}) {
  const today = new Date()
  const [branchId, setBranchId] = useState('main')
  const [year, setYear]   = useState(String(today.getFullYear()))
  const [month, setMonth] = useState(String(today.getMonth() + 1))
  const [payDate, setPayDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!year || !month) { setError('Year and month required'); return }
    setSaving(true); setError('')
    try {
      await apiFetch('/payroll/runs', {
        method: 'POST',
        body: JSON.stringify({
          branch_id: branchId,
          year: Number(year), month: Number(month),
          pay_date: payDate, notes,
        }),
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create run')
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
            className="fixed right-0 top-0 h-full w-full sm:max-w-[520px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-white font-black text-lg">New Payroll Run</h2>
              <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

              <div>
                <label className={lbl}>Branch</label>
                <select value={branchId} onChange={e => setBranchId(e.target.value)} className={inp}>
                  {branches.length === 0 && <option value="main">main</option>}
                  {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Year</label>
                  <input type="number" value={year} onChange={e => setYear(e.target.value)} className={inp} />
                </div>
                <div>
                  <label className={lbl}>Month</label>
                  <select value={month} onChange={e => setMonth(e.target.value)} className={inp}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
                      <option key={m} value={m}>{monthLabel(Number(year) || 2026, m)}</option>
                    )}
                  </select>
                </div>
              </div>

              <div>
                <label className={lbl}>Pay date (leave blank = last day of month)</label>
                <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className={inp} />
              </div>

              <div>
                <label className={lbl}>Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${inp} resize-none`} />
              </div>

              <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-200/70">
                ℹ A draft payslip will be auto-generated for every active employee in the selected branch.
                You can review + override individual payslips before finalizing.
              </div>
            </div>
            <div className="px-6 py-4 border-t border-white/5 flex gap-3">
              <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
              <button onClick={submit} disabled={saving} className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                {saving ? 'Generating…' : 'Create Run + Generate Payslips'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function RunDrawer({ run, onClose, onAction, actioning, onPayslipClick }: {
  run: PayrollRun | null; onClose: () => void
  onAction: (id: string, verb: 'regenerate' | 'finalize' | 'mark-paid' | 'delete') => void
  actioning: string
  onPayslipClick: (p: Payslip) => void
}) {
  if (!run) return null
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="fixed inset-0 bg-black/60 z-40" />
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed right-0 top-0 h-full w-full sm:max-w-[920px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div>
            <h2 className="text-white font-black text-lg">{run.period_label || run.period}</h2>
            <p className="text-white/40 text-xs mt-0.5">{run.branch_id} · pay date {fmtDate(run.pay_date)}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${STATUS_BADGE[run.status] || 'bg-white/10 text-white/60 border-white/20'}`}>{run.status}</span>
            <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Tile label="Gross"        value={fmt(run.total_gross)}        color="white" />
            <Tile label="Total deductions" value={fmt(Number(run.total_tax) + Number(run.total_ni) + Number(run.total_pension))} color="red" />
            <Tile label="Net (employee bank)" value={fmt(run.total_net)}    color="green" />
            <Tile label="Employer cost"  value={fmt(run.total_employer_cost)} color="white" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <Mini label="PAYE tax"        value={fmt(run.total_tax)} />
            <Mini label="Employee NI"     value={fmt(run.total_ni)} />
            <Mini label="Employee pension" value={fmt(run.total_pension)} />
            <Mini label="Employer NI"      value={fmt(run.total_employer_ni)} />
            <Mini label="Employer pension" value={fmt(run.total_employer_pension)} />
          </div>

          <div>
            <p className="text-white/40 text-xs uppercase tracking-wide mb-2">Payslips ({(run.payslips || []).length})</p>
            <div className="border border-white/5 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-white/3 text-white/40 text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">Employee</th>
                    <th className="text-left px-3 py-2">Tax code</th>
                    <th className="text-right px-3 py-2">Gross</th>
                    <th className="text-right px-3 py-2">PAYE</th>
                    <th className="text-right px-3 py-2">NI</th>
                    <th className="text-right px-3 py-2">Pension</th>
                    <th className="text-right px-3 py-2">Net</th>
                    <th className="text-center px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(run.payslips || []).length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-6 text-center text-white/30 text-xs">No payslips — try regenerate.</td></tr>
                  )}
                  {(run.payslips || []).map(p => (
                    <tr key={p.id} onClick={() => onPayslipClick(p)}
                      className="border-t border-white/5 text-white/70 hover:bg-white/3 cursor-pointer">
                      <td className="px-3 py-2">
                        <div className="font-semibold">{p.employee_name || p.employee_number || '—'}</div>
                        {p.employee_number && <div className="text-white/40 text-[10px] font-mono">{p.employee_number}</div>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{p.tax_code}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(p.gross_pay)}</td>
                      <td className="px-3 py-2 text-right font-mono text-yellow-300">{fmt(p.tax_deduction)}</td>
                      <td className="px-3 py-2 text-right font-mono text-yellow-300">{fmt(p.ni_employee)}</td>
                      <td className="px-3 py-2 text-right font-mono text-yellow-300">{fmt(p.pension_employee)}</td>
                      <td className="px-3 py-2 text-right font-mono text-green-300 font-bold">{fmt(p.net_pay)}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${STATUS_BADGE[p.status] || 'bg-white/10 text-white/60 border-white/20'}`}>{p.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {run.notes && (
            <div>
              <p className="text-white/40 text-xs mb-1">Notes</p>
              <p className="text-white/70 text-sm whitespace-pre-wrap">{run.notes}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/5 flex flex-wrap gap-2">
          {run.status === 'DRAFT' && (
            <>
              <button onClick={() => onAction(run.id, 'delete')} disabled={!!actioning}
                className="px-4 py-2.5 rounded-xl border border-red-500/30 text-red-300 text-sm font-semibold disabled:opacity-40">Delete</button>
              <button onClick={() => onAction(run.id, 'regenerate')} disabled={!!actioning}
                className="px-4 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-semibold disabled:opacity-40">
                {actioning === run.id + 'regenerate' ? '↻ …' : '↻ Regenerate'}
              </button>
            </>
          )}
          <div className="flex-1" />
          {run.status === 'DRAFT' && (
            <button onClick={() => onAction(run.id, 'finalize')} disabled={!!actioning}
              className="px-5 py-2.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-200 text-sm font-bold disabled:opacity-40">
              {actioning === run.id + 'finalize' ? 'Finalizing…' : 'Finalize'}
            </button>
          )}
          {run.status === 'FINALIZED' && (
            <button onClick={() => onAction(run.id, 'mark-paid')} disabled={!!actioning}
              className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white text-sm font-black disabled:opacity-40">
              {actioning === run.id + 'mark-paid' ? 'Posting…' : 'Mark Paid + Post GL'}
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

function PayslipDrawer({ payslip, onClose }: { payslip: Payslip | null; onClose: () => void }) {
  if (!payslip) return null
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="fixed inset-0 bg-black/70 z-[60]" />
      <motion.div initial={{ y: 32, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 32, opacity: 0 }}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-[640px] max-h-[88vh] overflow-hidden bg-white text-black z-[70] rounded-2xl shadow-2xl flex flex-col"
        style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-200 flex items-start justify-between bg-gray-50">
          <div>
            <h2 className="font-black text-2xl text-gray-900">Payslip</h2>
            <p className="text-gray-600 text-sm mt-0.5">{payslip.period_label} · Pay date {fmtDate(payslip.pay_date)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500 text-xs uppercase tracking-wide">Employee</p>
              <p className="font-bold text-gray-900">{payslip.employee_name}</p>
              <p className="text-gray-500 text-xs font-mono">{payslip.employee_number}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs uppercase tracking-wide">Tax / NI</p>
              <p className="font-mono text-sm">{payslip.tax_code}</p>
              <p className="font-mono text-xs text-gray-500">{payslip.ni_number || '—'}</p>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">Earnings</p>
            <table className="w-full text-sm">
              <tbody>
                {(payslip.earnings_json || []).map((e, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1.5 text-gray-700">{e.label}</td>
                    <td className="py-1.5 text-right font-mono">{fmt(e.amount)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="py-2 text-gray-900">Gross Pay</td>
                  <td className="py-2 text-right font-mono">{fmt(payslip.gross_pay)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">Deductions</p>
            <table className="w-full text-sm">
              <tbody>
                {(payslip.deductions_json || []).map((d, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1.5 text-gray-700">{d.label}</td>
                    <td className="py-1.5 text-right font-mono text-red-700">{fmt(d.amount)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="py-2 text-gray-900">Total Deductions</td>
                  <td className="py-2 text-right font-mono text-red-700">{fmt(payslip.total_deductions)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="border-t-2 border-gray-300 pt-4 flex justify-between items-center">
            <p className="font-bold text-lg text-gray-900">Net Pay</p>
            <p className="font-mono font-black text-2xl text-green-700">{fmt(payslip.net_pay)}</p>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">Year-to-date</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
              <YtdMini label="Gross"   value={fmt(payslip.ytd_gross)} />
              <YtdMini label="Tax"     value={fmt(payslip.ytd_tax)} />
              <YtdMini label="NI"      value={fmt(payslip.ytd_ni)} />
              <YtdMini label="Pension" value={fmt(payslip.ytd_pension)} />
              <YtdMini label="Net"     value={fmt(payslip.ytd_net)} />
            </div>
          </div>

          <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-900 border border-blue-200">
            Employer cost: <span className="font-bold">{fmt(payslip.total_employer_cost)}</span>
            {' '}(includes NI {fmt(payslip.ni_employer)} + pension {fmt(payslip.pension_employer)})
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex gap-3 bg-gray-50">
          <button onClick={() => window.print()} className="flex-1 py-2.5 rounded-xl bg-gray-200 text-gray-800 font-semibold text-sm">🖨 Print</button>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold text-sm">Close</button>
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
      <p className={`text-xl font-black font-mono mt-1 ${txt}`}>{value}</p>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/3 border border-white/5 rounded-lg px-3 py-2">
      <p className="text-white/40 text-[9px] uppercase tracking-wider">{label}</p>
      <p className="text-white/80 font-mono text-sm font-bold mt-0.5">{value}</p>
    </div>
  )
}

function YtdMini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-gray-500 text-[10px] uppercase">{label}</p>
      <p className="font-bold font-mono">{value}</p>
    </div>
  )
}
