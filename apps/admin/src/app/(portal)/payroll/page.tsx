'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Employee {
  id: string
  full_name: string
}

interface PayslipResult {
  employee_id?: string
  gross_salary?: number
  net_pay?: number
  tax?: number
  ni?: number
  [key: string]: unknown
}

interface PayrollRun {
  id: string
  period: string
  total_employees: number
  total_net: number
  status: string
  run_at: string
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-500/15 text-green-400 border-green-500/30',
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  failed: 'bg-red-500/15 text-red-400 border-red-500/30',
}

export default function PayrollPage() {
  const [tab, setTab] = useState<'calculate' | 'run' | 'history'>('calculate')
  const [employees, setEmployees] = useState<Employee[]>([])

  // Calculate tab
  const [calcForm, setCalcForm] = useState({ employee_id: '', period_start: '', period_end: '', gross_salary: '' })
  const [calcResult, setCalcResult] = useState<PayslipResult | null>(null)
  const [calcLoading, setCalcLoading] = useState(false)
  const [calcError, setCalcError] = useState('')

  // Run tab
  const [runForm, setRunForm] = useState({ pay_period_start: '', pay_period_end: '' })
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set())
  const [runResult, setRunResult] = useState<string>('')
  const [runLoading, setRunLoading] = useState(false)
  const [runError, setRunError] = useState('')

  // History tab
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [histLoading, setHistLoading] = useState(false)
  const [histError, setHistError] = useState('')

  const loadEmployees = useCallback(async () => {
    try {
      const data = await apiFetch<{ employees: Employee[] }>('/hr/employees?limit=100')
      setEmployees(data.employees || [])
    } catch {
      // non-fatal
    }
  }, [])

  const loadHistory = useCallback(async () => {
    setHistLoading(true); setHistError('')
    try {
      const data = await apiFetch<{ runs: PayrollRun[] }>('/payroll/runs')
      setRuns(data.runs || [])
    } catch (e: unknown) {
      setHistError(e instanceof Error ? e.message : 'Failed to load payroll history')
    } finally {
      setHistLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEmployees()
    if (tab === 'history') loadHistory()
  }, [tab, loadEmployees, loadHistory])

  async function calculate() {
    if (!calcForm.employee_id || !calcForm.period_start || !calcForm.period_end || !calcForm.gross_salary) {
      setCalcError('All fields are required'); return
    }
    setCalcLoading(true); setCalcError(''); setCalcResult(null)
    try {
      const data = await apiFetch<PayslipResult>('/payroll/calculate', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: calcForm.employee_id,
          period_start: calcForm.period_start,
          period_end: calcForm.period_end,
          gross_salary: parseFloat(calcForm.gross_salary),
        }),
      })
      setCalcResult(data)
    } catch (e: unknown) {
      setCalcError(e instanceof Error ? e.message : 'Failed to calculate payroll')
    } finally {
      setCalcLoading(false)
    }
  }

  async function runPayroll() {
    if (!runForm.pay_period_start || !runForm.pay_period_end) {
      setRunError('Period start and end are required'); return
    }
    setRunLoading(true); setRunError(''); setRunResult('')
    try {
      const res = await apiFetch<unknown>('/payroll/run', {
        method: 'POST',
        body: JSON.stringify({
          pay_period_start: runForm.pay_period_start,
          pay_period_end: runForm.pay_period_end,
          employee_ids: selectedEmployees.size > 0 ? Array.from(selectedEmployees) : undefined,
        }),
      })
      setRunResult(JSON.stringify(res, null, 2))
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : 'Payroll run failed')
    } finally {
      setRunLoading(false)
    }
  }

  function toggleEmployee(id: string) {
    setSelectedEmployees(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-white">Payroll</h1>
        <p className="text-white/40 mt-1">Calculate and process employee payroll</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit">
        {(['calculate', 'run', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all capitalize ${
              tab === t ? 'bg-saffron-gradient text-white shadow-saffron' : 'text-white/50 hover:text-white/80'
            }`}>
            {t === 'run' ? 'Run Payroll' : t}
          </button>
        ))}
      </div>

      {/* Calculate tab */}
      {tab === 'calculate' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl space-y-4">
          <div className="glass rounded-2xl p-6 space-y-4">
            <h2 className="text-white font-bold text-lg">Calculate Payslip</h2>
            {calcError && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{calcError}</div>}
            <div>
              <label className={lbl}>Employee *</label>
              <select value={calcForm.employee_id} onChange={e => setCalcForm(p => ({ ...p, employee_id: e.target.value }))} className={inp}>
                <option value="">Select employee…</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Period Start *</label>
                <input type="date" value={calcForm.period_start} onChange={e => setCalcForm(p => ({ ...p, period_start: e.target.value }))} className={inp} />
              </div>
              <div>
                <label className={lbl}>Period End *</label>
                <input type="date" value={calcForm.period_end} onChange={e => setCalcForm(p => ({ ...p, period_end: e.target.value }))} className={inp} />
              </div>
            </div>
            <div>
              <label className={lbl}>Gross Salary (£) *</label>
              <input type="number" min="0" step="0.01" value={calcForm.gross_salary}
                onChange={e => setCalcForm(p => ({ ...p, gross_salary: e.target.value }))}
                placeholder="3000.00" className={inp} />
            </div>
            <button onClick={calculate} disabled={calcLoading}
              className="w-full py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
              {calcLoading ? 'Calculating…' : 'Calculate'}
            </button>
          </div>
          {calcResult && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="glass rounded-2xl p-6 border border-saffron-400/20">
              <h3 className="text-white font-bold mb-4">Payslip Preview</h3>
              <div className="space-y-2">
                {Object.entries(calcResult).map(([k, v]) => (
                  <div key={k} className="flex justify-between py-2 border-b border-white/5">
                    <span className="text-white/50 text-sm capitalize">{k.replace(/_/g, ' ')}</span>
                    <span className="text-white font-mono text-sm">
                      {typeof v === 'number' ? `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* Run Payroll tab */}
      {tab === 'run' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl space-y-4">
          <div className="glass rounded-2xl p-6 space-y-4">
            <h2 className="text-white font-bold text-lg">Run Payroll</h2>
            <p className="text-white/40 text-sm">Process payroll for all or selected employees.</p>
            {runError && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{runError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Pay Period Start *</label>
                <input type="date" value={runForm.pay_period_start} onChange={e => setRunForm(p => ({ ...p, pay_period_start: e.target.value }))} className={inp} />
              </div>
              <div>
                <label className={lbl}>Pay Period End *</label>
                <input type="date" value={runForm.pay_period_end} onChange={e => setRunForm(p => ({ ...p, pay_period_end: e.target.value }))} className={inp} />
              </div>
            </div>
            {employees.length > 0 && (
              <div>
                <label className={lbl}>Employees (leave unchecked for all)</label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {employees.map(e => (
                    <label key={e.id} className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-white/5 cursor-pointer">
                      <input type="checkbox" checked={selectedEmployees.has(e.id)} onChange={() => toggleEmployee(e.id)}
                        className="w-4 h-4 rounded accent-orange-500" />
                      <span className="text-white/70 text-sm">{e.full_name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <button onClick={runPayroll} disabled={runLoading}
              className="w-full py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
              {runLoading ? 'Processing…' : 'Run Payroll'}
            </button>
          </div>
          {runResult && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="glass rounded-2xl p-6 border border-green-500/20">
              <p className="text-green-400 text-xs font-semibold uppercase tracking-wide mb-3">Run Result</p>
              <pre className="text-white/70 text-xs overflow-auto max-h-64">{runResult}</pre>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* History tab */}
      {tab === 'history' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl overflow-hidden border border-temple-border">
          {histError && <div className="m-4 bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{histError}</div>}
          {histLoading ? (
            <div className="text-center py-16 text-white/30">Loading payroll history…</div>
          ) : runs.length === 0 ? (
            <div className="text-center py-20 text-white/30">
              <p className="text-4xl mb-3">💷</p>
              <p>No payroll runs yet. Use the Calculate or Run Payroll tabs to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Period', 'Employees', 'Total Net', 'Status', 'Run At'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => (
                  <motion.tr key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-4 text-white font-medium">{r.period}</td>
                    <td className="px-4 py-4 text-white/60 text-sm">{r.total_employees}</td>
                    <td className="px-4 py-4 font-mono font-bold text-saffron-400">
                      £{Number(r.total_net).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${STATUS_COLORS[r.status] || 'bg-white/5 text-white/40 border-white/10'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-white/40 text-sm">
                      {new Date(r.run_at).toLocaleDateString('en-GB')}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table></div>
          )}
        </motion.div>
      )}
    </div>
  )
}
