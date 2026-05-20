'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Employee {
  id: string
  full_name: string
}

interface TimesheetForm {
  employee_id: string
  date: string
  hours_worked: string
  project: string
  notes: string
}

interface TimeEntry {
  id: string
  employee_id: string
  employee_name: string
  date: string
  hours_worked: number
  description: string | null
  approved: boolean
  created_at: string
}

interface TimesheetResponse {
  items: TimeEntry[]
  count: number
  week_start: string
  week_end: string
  // employee_id → "0".."6" → hours
  weekly_grid: Record<string, Record<string, number>>
  summary: {
    hours_this_week: number
    hours_this_month: number
    staff_logged_today: number
  }
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function formatShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function weekDatesFromMonday(weekStartIso: string): string[] {
  const mon = new Date(weekStartIso + 'T00:00:00')
  return DAYS.map((_, i) => {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  })
}

export default function TimesheetsPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [empLoading, setEmpLoading] = useState(true)
  const [sheet, setSheet] = useState<TimesheetResponse | null>(null)
  const [sheetLoading, setSheetLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState('')

  const [form, setForm] = useState<TimesheetForm>({
    employee_id: '', date: new Date().toISOString().split('T')[0], hours_worked: '', project: '', notes: '',
  })

  const loadEmployees = useCallback(async () => {
    setEmpLoading(true)
    try {
      const data = await apiFetch<{ items: Employee[] }>('/hr/employees?limit=100')
      setEmployees(data.items || [])
    } catch {
      // non-fatal
    } finally {
      setEmpLoading(false)
    }
  }, [])

  const loadSheet = useCallback(async () => {
    setSheetLoading(true)
    try {
      const data = await apiFetch<TimesheetResponse>('/hr/timesheets')
      setSheet(data)
    } catch {
      // non-fatal — show empty state
    } finally {
      setSheetLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEmployees()
    loadSheet()
  }, [loadEmployees, loadSheet])

  async function submit() {
    if (!form.employee_id || !form.date || !form.hours_worked) {
      setFormError('Employee, date and hours worked are required'); return
    }
    setSaving(true); setFormError('')
    try {
      await apiFetch('/hr/timesheet', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: form.employee_id,
          entry_date: form.date,
          hours_worked: form.hours_worked,
          description: form.notes,
        }),
      })
      setShowForm(false)
      setForm({ employee_id: '', date: new Date().toISOString().split('T')[0], hours_worked: '', project: '', notes: '' })
      setToast('Timesheet entry logged successfully')
      setTimeout(() => setToast(''), 4000)
      // Refresh the grid + summary so the new entry shows up immediately
      loadSheet()
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to log timesheet')
    } finally {
      setSaving(false)
    }
  }

  const weekDates = sheet ? weekDatesFromMonday(sheet.week_start) : DAYS.map(() => '—')
  const summary = sheet?.summary
  const grid = sheet?.weekly_grid || {}

  // Employees who either appear in the week's grid OR are loaded from /hr/employees.
  // Keeps the table populated even before the first entry is logged.
  const gridEmployeeIds = new Set(Object.keys(grid))
  const orderedEmployees: Employee[] = [
    ...employees.filter(e => gridEmployeeIds.has(e.id)),
    ...employees.filter(e => !gridEmployeeIds.has(e.id)),
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Timesheets</h1>
          <p className="text-white/40 mt-1">Track employee hours and project time</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ Log Time</button>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
            <span>✓</span> {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Hours This Week', value: summary ? summary.hours_this_week.toFixed(1) : '—', icon: '⏱', color: 'from-blue-600 to-indigo-500' },
          { label: 'Hours This Month', value: summary ? summary.hours_this_month.toFixed(1) : '—', icon: '📅', color: 'from-amber-600 to-orange-500' },
          { label: 'Entries (this month)', value: sheet ? String(sheet.count) : '—', icon: '🗂', color: 'from-purple-600 to-violet-500' },
          { label: 'Staff Logged Today', value: summary ? String(summary.staff_logged_today) : '—', icon: '👥', color: 'from-green-600 to-emerald-500' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="glass rounded-2xl p-5 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-24 h-24 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-lg mb-3`}>{s.icon}</div>
            <p className="text-white/50 text-xs font-medium mb-1">{s.label}</p>
            <p className={`text-3xl font-black ${s.value === '—' ? 'text-white/30' : 'text-white'}`}>{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Weekly view */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-white font-bold">Weekly Overview</h2>
          <span className="text-xs text-white/30 bg-white/5 px-3 py-1 rounded-full">
            {sheet ? `${formatShort(sheet.week_start)} – ${formatShort(sheet.week_end)}` : 'Current week'}
          </span>
        </div>
        <div className="overflow-x-auto"><table className="w-full">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Employee</th>
              {DAYS.map((d, i) => (
                <th key={d} className="text-center px-2 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">
                  <div>{d}</div>
                  <div className="text-white/20 font-normal normal-case">{weekDates[i]}</div>
                </th>
              ))}
              <th className="text-right px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Total</th>
            </tr>
          </thead>
          <tbody>
            {orderedEmployees.slice(0, 12).map((emp, i) => {
              const empGrid = grid[emp.id] || {}
              const total = DAYS.reduce((s, _, dayIdx) => s + (empGrid[String(dayIdx)] || 0), 0)
              return (
                <motion.tr key={emp.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 + i * 0.04 }}
                  className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-4 py-4 text-white/70 text-sm font-medium">{emp.full_name}</td>
                  {DAYS.map((_, dayIdx) => {
                    const h = empGrid[String(dayIdx)] || 0
                    return (
                      <td key={dayIdx} className={`px-2 py-4 text-center text-sm font-mono ${h > 0 ? 'text-white/80' : 'text-white/20'}`}>
                        {h > 0 ? h.toFixed(1) : '—'}
                      </td>
                    )
                  })}
                  <td className={`px-4 py-4 text-right font-mono text-sm ${total > 0 ? 'text-white font-bold' : 'text-white/20'}`}>
                    {total > 0 ? total.toFixed(1) : '—'}
                  </td>
                </motion.tr>
              )
            })}
            {!sheetLoading && orderedEmployees.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-white/30 text-sm">
                  No employees loaded. Log time to populate the weekly view.
                </td>
              </tr>
            )}
          </tbody>
        </table></div>
      </motion.div>

      {/* Recent entries list */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
        className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-white font-bold">Recent Entries</h2>
          <span className="text-xs text-white/30">{sheet ? `${sheet.count} this month` : ''}</span>
        </div>
        <div className="overflow-x-auto"><table className="w-full">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Date</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Employee</th>
              <th className="text-right px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Hours</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Notes</th>
              <th className="text-center px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            {sheetLoading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-white/30 text-sm">Loading entries…</td></tr>
            )}
            {!sheetLoading && (!sheet || sheet.items.length === 0) && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-white/30 text-sm">No timesheet entries yet this month.</td></tr>
            )}
            {sheet?.items.slice(0, 25).map((e, i) => (
              <motion.tr key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                className="border-b border-white/5 hover:bg-white/3 transition-colors">
                <td className="px-4 py-3 text-white/70 text-sm font-mono">{formatShort(e.date)}</td>
                <td className="px-4 py-3 text-white/80 text-sm font-medium">{e.employee_name}</td>
                <td className="px-4 py-3 text-right text-white font-mono text-sm font-bold">{e.hours_worked.toFixed(1)}</td>
                <td className="px-4 py-3 text-white/50 text-sm truncate max-w-[280px]">{e.description || '—'}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${e.approved
                    ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'}`}>
                    {e.approved ? 'APPROVED' : 'PENDING'}
                  </span>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table></div>
      </motion.div>

      {/* Slide-over form */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-[520px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">Log Time</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {formError && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{formError}</div>}
                <div>
                  <label className={lbl}>Employee *</label>
                  {empLoading ? (
                    <div className={`${inp} text-white/30`}>Loading employees…</div>
                  ) : (
                    <select value={form.employee_id} onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))} className={inp}>
                      <option value="">Select employee…</option>
                      {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                    </select>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Date *</label>
                    <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Hours Worked *</label>
                    <input type="number" min="0.5" max="24" step="0.5" value={form.hours_worked}
                      onChange={e => setForm(p => ({ ...p, hours_worked: e.target.value }))}
                      placeholder="8" className={inp} />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Project</label>
                  <input value={form.project} onChange={e => setForm(p => ({ ...p, project: e.target.value }))}
                    placeholder="e.g. Diwali Festival Planning" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Notes</label>
                  <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                    rows={3} placeholder="Any additional notes…" className={`${inp} resize-none`} />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={submit} disabled={saving}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {saving ? 'Logging…' : 'Log Time'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
