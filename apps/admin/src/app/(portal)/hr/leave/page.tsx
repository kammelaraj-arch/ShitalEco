'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Employee {
  id: string
  full_name: string
}

interface LeaveForm {
  employee_id: string
  leave_type: string
  start_date: string
  end_date: string
  reason: string
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

const LEAVE_TYPES = ['annual', 'sick', 'maternity', 'paternity', 'unpaid']

export default function LeavePage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [empLoading, setEmpLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const [form, setForm] = useState<LeaveForm>({
    employee_id: '', leave_type: 'annual', start_date: '', end_date: '', reason: '',
  })

  const loadEmployees = useCallback(async () => {
    setEmpLoading(true)
    try {
      const data = await apiFetch<{ employees: Employee[] }>('/hr/employees?limit=100')
      setEmployees(data.employees || [])
    } catch {
      // non-fatal
    } finally {
      setEmpLoading(false)
    }
  }, [])

  useEffect(() => { loadEmployees() }, [loadEmployees])

  async function submit() {
    if (!form.employee_id || !form.start_date || !form.end_date) {
      setFormError('Employee, start date and end date are required'); return
    }
    if (form.end_date < form.start_date) {
      setFormError('End date must be on or after start date'); return
    }
    setSaving(true); setFormError('')
    try {
      await apiFetch('/hr/leave', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: form.employee_id,
          leave_type: form.leave_type,
          start_date: form.start_date,
          end_date: form.end_date,
          reason: form.reason,
        }),
      })
      setShowForm(false)
      setForm({ employee_id: '', leave_type: 'annual', start_date: '', end_date: '', reason: '' })
      setSuccessMsg('Leave request submitted successfully')
      setTimeout(() => setSuccessMsg(''), 5000)
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to submit leave request')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Leave Management</h1>
          <p className="text-white/40 mt-1">Track and approve employee leave requests</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ New Leave Request</button>
      </div>

      {successMsg && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <span>✓</span> {successMsg}
        </motion.div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Annual Leave', value: '—', icon: '🏖️', color: 'from-blue-600 to-indigo-500' },
          { label: 'Sick Leave', value: '—', icon: '🏥', color: 'from-red-600 to-rose-500' },
          { label: 'Pending Approval', value: '—', icon: '⏳', color: 'from-amber-600 to-orange-500' },
          { label: 'Approved This Month', value: '—', icon: '✓', color: 'from-green-600 to-emerald-500' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="glass rounded-2xl p-5 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-24 h-24 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-lg mb-3`}>{s.icon}</div>
            <p className="text-white/50 text-xs font-medium mb-1">{s.label}</p>
            <p className="text-3xl font-black text-white/30">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Empty state table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="px-5 py-4 border-b border-white/5">
          <h2 className="text-white font-bold">Leave Requests</h2>
        </div>
        <div className="text-center py-20 text-white/30">
          <p className="text-4xl mb-3">📅</p>
          <p className="font-medium text-white/40">No leave requests yet</p>
          <p className="text-xs mt-2 max-w-sm mx-auto">
            Leave requests submitted via the kiosk or admin will appear here once the HR database is seeded.
          </p>
          <button onClick={() => setShowForm(true)}
            className="mt-5 px-5 py-2.5 rounded-xl bg-saffron-gradient text-white text-sm font-bold">
            Submit First Request
          </button>
        </div>
      </motion.div>

      {/* Slide-over form */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full max-w-[520px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">New Leave Request</h2>
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
                <div>
                  <label className={lbl}>Leave Type *</label>
                  <select value={form.leave_type} onChange={e => setForm(p => ({ ...p, leave_type: e.target.value }))} className={inp}>
                    {LEAVE_TYPES.map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Start Date *</label>
                    <input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>End Date *</label>
                    <input type="date" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} className={inp} />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Reason</label>
                  <textarea value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
                    rows={4} placeholder="Brief reason for leave…"
                    className={`${inp} resize-none`} />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={submit} disabled={saving}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {saving ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
