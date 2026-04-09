'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Employee {
  id: string
  full_name: string
  email: string
  phone: string
  role: string
  department: string
  employment_type: string
  is_active: boolean
  start_date: string
  gross_salary: number
  photo_url: string
  nationality: string
  right_to_work_type: string
  visa_expiry: string | null
}

interface EmployeeForm {
  full_name: string
  role: string
  department: string
  employment_type: string
  email: string
  phone: string
  start_date: string
  gross_salary: string
  national_insurance: string
  address: string
  photo_url: string
  nationality: string
  right_to_work_type: string
  visa_number: string
  visa_expiry: string
}

const EMPTY_FORM: EmployeeForm = {
  full_name: '', role: '', department: 'Admin', employment_type: 'FULL_TIME',
  email: '', phone: '', start_date: '', gross_salary: '', national_insurance: '', address: '',
  photo_url: '', nationality: 'British', right_to_work_type: 'British Citizen',
  visa_number: '', visa_expiry: '',
}

const RTW_TYPES = ['British Citizen', 'ILR / Settled Status', 'Pre-Settled Status', 'Skilled Worker Visa', 'Student Visa', 'Graduate Visa', 'Spouse Visa', 'Other']

const DEPARTMENTS = ['Admin', 'Finance', 'Religious', 'Operations', 'Community', 'IT', 'HR']
const EMP_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'VOLUNTEER']

const TYPE_COLORS: Record<string, string> = {
  FULL_TIME: 'bg-green-500/20 text-green-400 border-green-500/30',
  PART_TIME: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  CONTRACTOR: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  VOLUNTEER: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

export default function HRPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [form, setForm] = useState<EmployeeForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await apiFetch<{ items: Employee[]; next_cursor: string | null; count: number }>('/hr/employees?limit=200')
      setEmployees(data.items || [])
    } catch {
      setError('Failed to load employees')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const openNew = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true) }
  const openEdit = (emp: Employee) => {
    setEditing(emp)
    setForm({
      full_name: emp.full_name || '', role: emp.role || '',
      department: emp.department || 'Admin', employment_type: emp.employment_type || 'FULL_TIME',
      email: emp.email || '', phone: emp.phone || '',
      start_date: emp.start_date ? emp.start_date.slice(0, 10) : '',
      gross_salary: String(emp.gross_salary || ''),
      national_insurance: '', address: '',
      photo_url: emp.photo_url || '', nationality: emp.nationality || '',
      right_to_work_type: emp.right_to_work_type || '', visa_number: '',
      visa_expiry: emp.visa_expiry ? emp.visa_expiry.slice(0, 10) : '',
    })
    setShowForm(true)
  }

  const handlePhoto = (file: File) => {
    if (file.size > 3 * 1024 * 1024) { setError('Photo must be under 3MB'); return }
    const reader = new FileReader()
    reader.onload = e => setForm(p => ({ ...p, photo_url: e.target?.result as string }))
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!form.full_name.trim() || !form.role.trim()) return
    setSaving(true)
    try {
      const body = { ...form, gross_salary: parseFloat(form.gross_salary) || 0 }
      if (editing) {
        await apiFetch(`/hr/employees/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
      } else {
        await apiFetch('/hr/employees', { method: 'POST', body: JSON.stringify(body) })
      }
      setShowForm(false)
      setForm(EMPTY_FORM)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save employee')
    } finally { setSaving(false) }
  }

  const deactivate = async (emp: Employee) => {
    if (!confirm(`Deactivate ${emp.full_name}?`)) return
    try {
      await apiFetch(`/hr/employees/${emp.id}`, { method: 'DELETE' })
      await load()
    } catch { setError('Failed to deactivate') }
  }

  const filtered = employees.filter(e =>
    (deptFilter === '' || e.department === deptFilter) &&
    (e.full_name.toLowerCase().includes(search.toLowerCase()) ||
     e.role?.toLowerCase().includes(search.toLowerCase()) || false)
  )

  const fullTime = employees.filter(e => e.employment_type === 'FULL_TIME').length
  const partTime = employees.filter(e => e.employment_type === 'PART_TIME').length
  const volunteers = employees.filter(e => e.employment_type === 'VOLUNTEER').length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Human Resources</h1>
          <p className="text-white/40 mt-1">Employees, Leave & Timesheets — live from database</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a href="/hr/leave"
            className="px-4 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/5 transition-all">
            Leave Requests
          </a>
          <a href="/hr/timesheets"
            className="px-4 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/5 transition-all">
            Timesheets
          </a>
          <button onClick={openNew}
            className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90">
            + New Employee
          </button>
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Employees', value: String(employees.length), icon: '👥', color: 'from-blue-600 to-indigo-500' },
          { label: 'Full-Time', value: String(fullTime), icon: '💼', color: 'from-green-600 to-emerald-500' },
          { label: 'Part-Time', value: String(partTime), icon: '⏱️', color: 'from-amber-600 to-orange-500' },
          { label: 'Volunteers', value: String(volunteers), icon: '🤝', color: 'from-purple-600 to-violet-500' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="glass rounded-2xl p-5 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-lg mb-3`}>{s.icon}</div>
            <p className="text-white/50 text-xs font-medium">{s.label}</p>
            <p className="text-3xl font-black text-white mt-1">{loading ? '—' : s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search employees…"
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-white/30 outline-none focus:border-saffron-400/50 w-full sm:w-64" />
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none">
          <option value="">All Departments</option>
          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Employee table */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="glass rounded-2xl overflow-hidden border border-temple-border">
        {loading ? (
          <div className="text-center py-16 text-white/30">Loading employees…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-white/30">
            <p className="text-4xl mb-3">👥</p>
            <p>{employees.length === 0 ? 'No employees yet — add your first team member.' : 'No employees match your search.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Employee', 'Contact', 'Department', 'Type', 'RTW / Visa', 'Active', ''].map(h => (
                  <th key={h} className={`text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider ${h === 'RTW / Visa' ? 'hidden md:table-cell' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp, i) => (
                <motion.tr key={emp.id}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                  className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {emp.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={emp.photo_url} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-white/10" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-saffron-gradient flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                          {emp.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                        </div>
                      )}
                      <div>
                        <p className="text-white font-semibold text-sm">{emp.full_name}</p>
                        <p className="text-white/40 text-xs">{emp.role || '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      {emp.email && <p className="text-white/60 text-xs">{emp.email}</p>}
                      {emp.phone && <p className="text-white/40 text-xs">{emp.phone}</p>}
                      {!emp.email && !emp.phone && <span className="text-white/20 text-xs">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-white/60 text-sm">{emp.department || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${TYPE_COLORS[emp.employment_type] || 'bg-white/5 text-white/40 border-white/10'}`}>
                      {(emp.employment_type || 'UNKNOWN').replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {emp.right_to_work_type ? (
                      <div>
                        <p className="text-white/70 text-xs">{emp.right_to_work_type}</p>
                        {emp.visa_expiry && (
                          <p className={`text-xs mt-0.5 ${new Date(emp.visa_expiry) < new Date() ? 'text-red-400' : 'text-amber-400/70'}`}>
                            Exp: {new Date(emp.visa_expiry).toLocaleDateString('en-GB')}
                          </p>
                        )}
                      </div>
                    ) : <span className="text-white/20 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                      emp.is_active
                        ? 'bg-green-500/20 text-green-400 border-green-500/30'
                        : 'bg-white/5 text-white/40 border-white/10'
                    }`}>{emp.is_active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(emp)} className="text-white/40 hover:text-saffron-400 text-sm px-2 py-1 mr-1">Edit</button>
                    {emp.is_active && (
                      <button onClick={() => deactivate(emp)} className="text-red-400/50 hover:text-red-400 text-xs px-2 py-1">Off</button>
                    )}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </motion.div>

      {/* Employee slide-over */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handlePhoto(f) }} />
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-[520px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editing ? 'Edit Employee' : 'New Employee'}</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl p-1">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4">

                {/* Photo */}
                <div>
                  <label className={lbl}>Photo</label>
                  <div className="flex items-center gap-4">
                    {form.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={form.photo_url} alt="" className="w-16 h-16 rounded-full object-cover border border-white/10 flex-shrink-0" />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-white/5 border-2 border-dashed border-white/20 flex items-center justify-center text-white/30 text-2xl flex-shrink-0">👤</div>
                    )}
                    <div className="flex flex-col gap-2">
                      <button type="button" onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2 rounded-xl border border-white/10 text-white/60 text-xs font-semibold hover:bg-white/5">
                        Upload Photo
                      </button>
                      {form.photo_url && (
                        <button type="button" onClick={() => setForm(p => ({ ...p, photo_url: '' }))}
                          className="px-4 py-2 rounded-xl border border-red-500/30 text-red-400 text-xs font-semibold hover:bg-red-500/10">Remove</button>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label className={lbl}>Full Name *</label>
                  <input value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} className={inp} placeholder="e.g. Arjun Patel" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Role *</label>
                    <input value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} className={inp} placeholder="Temple Priest" />
                  </div>
                  <div>
                    <label className={lbl}>Department</label>
                    <select value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} className={inp}>
                      {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Employment Type</label>
                    <select value={form.employment_type} onChange={e => setForm(p => ({ ...p, employment_type: e.target.value }))} className={inp}>
                      {EMP_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Start Date</label>
                    <input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} className={inp} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Email</label>
                    <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className={inp} placeholder="arjun@shital.org" />
                  </div>
                  <div>
                    <label className={lbl}>Phone</label>
                    <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} className={inp} placeholder="+44 7700 000000" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Gross Salary (£/yr)</label>
                    <input type="number" min="0" step="100" value={form.gross_salary} onChange={e => setForm(p => ({ ...p, gross_salary: e.target.value }))} className={inp} placeholder="32000" />
                  </div>
                  <div>
                    <label className={lbl}>NI Number</label>
                    <input value={form.national_insurance} onChange={e => setForm(p => ({ ...p, national_insurance: e.target.value }))} className={inp} placeholder="AB123456C" />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Address</label>
                  <textarea value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} rows={2} className={inp + ' resize-none'} placeholder="1 Temple Road, Wembley, HA9 0AA" />
                </div>

                {/* Immigration */}
                <div className="border-t border-white/5 pt-4">
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-3">Immigration &amp; Right to Work</p>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>Nationality</label>
                        <input value={form.nationality} onChange={e => setForm(p => ({ ...p, nationality: e.target.value }))} className={inp} placeholder="British" />
                      </div>
                      <div>
                        <label className={lbl}>Right to Work Type</label>
                        <select value={form.right_to_work_type} onChange={e => setForm(p => ({ ...p, right_to_work_type: e.target.value }))} className={inp}>
                          <option value="">Select…</option>
                          {RTW_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                    {form.right_to_work_type && !['British Citizen', 'ILR / Settled Status'].includes(form.right_to_work_type) && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={lbl}>Visa / BRP Number</label>
                          <input value={form.visa_number} onChange={e => setForm(p => ({ ...p, visa_number: e.target.value }))} className={inp} placeholder="BRP No." />
                        </div>
                        <div>
                          <label className={lbl}>Visa Expiry Date</label>
                          <input type="date" value={form.visa_expiry} onChange={e => setForm(p => ({ ...p, visa_expiry: e.target.value }))} className={inp} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

              </div>
              <div className="px-4 sm:px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={save} disabled={saving || !form.full_name.trim()}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Employee'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
