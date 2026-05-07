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
  branch_id?: string
  department: string
  employment_type: string
  is_active: boolean
  start_date: string
  gross_salary: number
  photo_url: string
  nationality: string
  right_to_work_type: string
  visa_expiry: string | null
  reporting_manager_id?: string | null
  // Phase 1 fields — populated from list response (server may redact for non-privileged callers)
  national_insurance?: string
  address?: string
  visa_number?: string
  visa_type?: string
  visa_issue_date?: string | null
  visa_sponsor_license?: string
  share_code?: string
  share_code_expiry?: string | null
  date_of_birth?: string | null
  gender?: string
  personal_email?: string
  emergency_phone?: string
  next_of_kin_name?: string
  next_of_kin_relationship?: string
  next_of_kin_phone?: string
  next_of_kin_email?: string
  next_of_kin_address?: string
  bank_sort_code?: string
  bank_account_number?: string
  bank_account_name?: string
  pension_enrolled?: boolean
  pension_provider?: string
  pension_employee_pct?: number
  pension_employer_pct?: number
  benefits_notes?: string
  dbs_check_status?: string
  dbs_check_date?: string | null
  dbs_check_expiry?: string | null
  dbs_certificate_number?: string
  rtw_check_date?: string | null
  rtw_check_reference?: string
  p45_received?: boolean
  starter_declaration?: string
  hours_per_week?: number
  holiday_entitlement_days?: number
  probation_end_date?: string | null
  end_date?: string | null
  leaving_reason?: string
  qualifications_notes?: string
  documents_held_notes?: string
  _sensitive_redacted?: boolean
}

interface EmployeeForm {
  full_name: string
  role: string
  branch_id: string
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
  reporting_manager_id: string
  reporting_manager_name: string
  // Phase 1 — visa expansion
  visa_type: string
  visa_issue_date: string
  visa_sponsor_license: string
  share_code: string
  share_code_expiry: string
  // Personal
  date_of_birth: string
  gender: string
  personal_email: string
  emergency_phone: string
  // Next of kin
  next_of_kin_name: string
  next_of_kin_relationship: string
  next_of_kin_phone: string
  next_of_kin_email: string
  next_of_kin_address: string
  // Banking
  bank_sort_code: string
  bank_account_number: string
  bank_account_name: string
  // Pension / benefits
  pension_enrolled: boolean
  pension_provider: string
  pension_employee_pct: string
  pension_employer_pct: string
  benefits_notes: string
  // UK compliance
  dbs_check_status: string
  dbs_check_date: string
  dbs_check_expiry: string
  dbs_certificate_number: string
  rtw_check_date: string
  rtw_check_reference: string
  p45_received: boolean
  starter_declaration: string
  // Working terms
  hours_per_week: string
  holiday_entitlement_days: string
  probation_end_date: string
  end_date: string
  leaving_reason: string
  // Stopgap free-text
  qualifications_notes: string
  documents_held_notes: string
}

const EMPTY_FORM: EmployeeForm = {
  full_name: '', role: '', branch_id: 'main', department: 'Admin', employment_type: 'FULL_TIME',
  email: '', phone: '', start_date: '', gross_salary: '', national_insurance: '', address: '',
  photo_url: '', nationality: 'British', right_to_work_type: 'British Citizen',
  visa_number: '', visa_expiry: '',
  reporting_manager_id: '', reporting_manager_name: '',
  visa_type: '', visa_issue_date: '', visa_sponsor_license: '',
  share_code: '', share_code_expiry: '',
  date_of_birth: '', gender: '', personal_email: '', emergency_phone: '',
  next_of_kin_name: '', next_of_kin_relationship: '',
  next_of_kin_phone: '', next_of_kin_email: '', next_of_kin_address: '',
  bank_sort_code: '', bank_account_number: '', bank_account_name: '',
  pension_enrolled: false, pension_provider: '',
  pension_employee_pct: '', pension_employer_pct: '', benefits_notes: '',
  dbs_check_status: '', dbs_check_date: '', dbs_check_expiry: '', dbs_certificate_number: '',
  rtw_check_date: '', rtw_check_reference: '',
  p45_received: false, starter_declaration: '',
  hours_per_week: '', holiday_entitlement_days: '',
  probation_end_date: '', end_date: '', leaving_reason: '',
  qualifications_notes: '', documents_held_notes: '',
}

const RTW_TYPES = ['British Citizen', 'ILR / Settled Status', 'Pre-Settled Status', 'Skilled Worker Visa', 'Student Visa', 'Graduate Visa', 'Spouse Visa', 'Other']
const BRANCHES = ['main', 'wembley', 'wembley_main']  // TODO: wire to /branches API once exposed publicly
const DEPARTMENTS = ['Admin', 'Finance', 'Religious', 'Operations', 'Community', 'IT', 'HR']
const EMP_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'VOLUNTEER']
const GENDERS = ['', 'M', 'F', 'X', 'PREFER_NOT_SAY']
const DBS_STATUSES = ['', 'NOT_CHECKED', 'IN_PROGRESS', 'CLEAR', 'FLAGGED']
const STARTER_DECL = ['', 'A', 'B', 'C']
const LEAVING_REASONS = ['', 'RESIGNED', 'REDUNDANCY', 'DISMISSED', 'RETIRED', 'CONTRACT_ENDED', 'OTHER']

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
  const [activeView, setActiveView] = useState<'active' | 'inactive'>('active')
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [form, setForm] = useState<EmployeeForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [mgrSearch, setMgrSearch] = useState('')
  const [mgrResults, setMgrResults] = useState<{ id: string; full_name: string; role: string }[]>([])
  const [showMgrDropdown, setShowMgrDropdown] = useState(false)
  const mgrRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await apiFetch<{ items: Employee[]; next_cursor: string | null; count: number }>(
        `/hr/employees?limit=200&is_active=${activeView === 'active'}`
      )
      setEmployees(data.items || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load employees')
    } finally { setLoading(false) }
  }, [activeView])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!mgrSearch.trim()) { setMgrResults([]); return }
    const t = setTimeout(async () => {
      try {
        const data = await apiFetch<{ items: { id: string; full_name: string; role: string }[] }>(
          `/hr/employees/search?q=${encodeURIComponent(mgrSearch)}&limit=10`
        )
        setMgrResults(data.items || [])
        setShowMgrDropdown(true)
      } catch { setMgrResults([]) }
    }, 250)
    return () => clearTimeout(t)
  }, [mgrSearch])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (mgrRef.current && !mgrRef.current.contains(e.target as Node)) setShowMgrDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const openNew = () => { setEditing(null); setForm(EMPTY_FORM); setMgrSearch(''); setShowForm(true) }
  const openEdit = async (emp: Employee) => {
    setEditing(emp)
    setMgrSearch('')
    const dt = (s?: string | null) => (s ? s.slice(0, 10) : '')
    const f: EmployeeForm = {
      full_name: emp.full_name || '', role: emp.role || '',
      branch_id: emp.branch_id || 'main',
      department: emp.department || 'Admin', employment_type: emp.employment_type || 'FULL_TIME',
      email: emp.email || '', phone: emp.phone || '',
      start_date: dt(emp.start_date),
      gross_salary: String(emp.gross_salary || ''),
      national_insurance: emp.national_insurance || '',
      address: emp.address || '',
      photo_url: emp.photo_url || '', nationality: emp.nationality || '',
      right_to_work_type: emp.right_to_work_type || '',
      visa_number: emp.visa_number || '',
      visa_expiry: dt(emp.visa_expiry),
      reporting_manager_id: emp.reporting_manager_id || '',
      reporting_manager_name: '',
      // Phase 1 — visa expansion
      visa_type: emp.visa_type || '',
      visa_issue_date: dt(emp.visa_issue_date),
      visa_sponsor_license: emp.visa_sponsor_license || '',
      share_code: emp.share_code || '',
      share_code_expiry: dt(emp.share_code_expiry),
      // Personal
      date_of_birth: dt(emp.date_of_birth),
      gender: emp.gender || '',
      personal_email: emp.personal_email || '',
      emergency_phone: emp.emergency_phone || '',
      // NoK
      next_of_kin_name: emp.next_of_kin_name || '',
      next_of_kin_relationship: emp.next_of_kin_relationship || '',
      next_of_kin_phone: emp.next_of_kin_phone || '',
      next_of_kin_email: emp.next_of_kin_email || '',
      next_of_kin_address: emp.next_of_kin_address || '',
      // Banking
      bank_sort_code: emp.bank_sort_code || '',
      bank_account_number: emp.bank_account_number || '',
      bank_account_name: emp.bank_account_name || '',
      // Pension / benefits
      pension_enrolled: !!emp.pension_enrolled,
      pension_provider: emp.pension_provider || '',
      pension_employee_pct: String(emp.pension_employee_pct ?? ''),
      pension_employer_pct: String(emp.pension_employer_pct ?? ''),
      benefits_notes: emp.benefits_notes || '',
      // UK compliance
      dbs_check_status: emp.dbs_check_status || '',
      dbs_check_date: dt(emp.dbs_check_date),
      dbs_check_expiry: dt(emp.dbs_check_expiry),
      dbs_certificate_number: emp.dbs_certificate_number || '',
      rtw_check_date: dt(emp.rtw_check_date),
      rtw_check_reference: emp.rtw_check_reference || '',
      p45_received: !!emp.p45_received,
      starter_declaration: emp.starter_declaration || '',
      // Working terms
      hours_per_week: String(emp.hours_per_week ?? ''),
      holiday_entitlement_days: String(emp.holiday_entitlement_days ?? ''),
      probation_end_date: dt(emp.probation_end_date),
      end_date: dt(emp.end_date),
      leaving_reason: emp.leaving_reason || '',
      // Stopgap
      qualifications_notes: emp.qualifications_notes || '',
      documents_held_notes: emp.documents_held_notes || '',
    }
    // Resolve manager name if we have an id
    if (emp.reporting_manager_id) {
      try {
        const res = await apiFetch<{ items: { id: string; full_name: string }[] }>(
          `/hr/employees/search?id=${emp.reporting_manager_id}`
        )
        const mgr = res.items[0]
        if (mgr) { f.reporting_manager_name = mgr.full_name; setMgrSearch(mgr.full_name) }
      } catch { /* non-fatal */ }
    }
    setForm(f)
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
      const isVolunteer = form.employment_type === 'VOLUNTEER'
      // Coerce numeric strings → numbers; volunteer salary forced to 0 client-
      // side AND server-side. Empty strings → 0 for numeric fields.
      const body = {
        ...form,
        gross_salary: isVolunteer ? 0 : (parseFloat(form.gross_salary) || 0),
        pension_employee_pct: parseFloat(form.pension_employee_pct) || 0,
        pension_employer_pct: parseFloat(form.pension_employer_pct) || 0,
        hours_per_week: parseFloat(form.hours_per_week) || 0,
        holiday_entitlement_days: parseFloat(form.holiday_entitlement_days) || 0,
      }
      if (editing) {
        await apiFetch(`/hr/employees/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
      } else {
        await apiFetch('/hr/employees', { method: 'POST', body: JSON.stringify(body) })
      }
      setShowForm(false)
      setForm(EMPTY_FORM)
      await load()
    } catch (e) {
      // Backend returns { detail: { errors: [...] } } for required-field
      // validation; surface each error on its own line.
      let msg = e instanceof Error ? e.message : 'Failed to save employee'
      try {
        const parsed = JSON.parse(msg)
        if (parsed?.errors) msg = parsed.errors.join(' · ')
        else if (parsed?.detail?.errors) msg = parsed.detail.errors.join(' · ')
      } catch { /* not JSON, leave as-is */ }
      setError(msg)
    } finally { setSaving(false) }
  }

  const deactivate = async (emp: Employee) => {
    if (!confirm(`Deactivate ${emp.full_name}?`)) return
    try {
      await apiFetch(`/hr/employees/${emp.id}`, { method: 'DELETE' })
      await load()
    } catch { setError('Failed to deactivate') }
  }

  const reactivate = async (emp: Employee) => {
    if (!confirm(`Reactivate ${emp.full_name}?`)) return
    try {
      await apiFetch(`/hr/employees/${emp.id}`, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
      await load()
    } catch { setError('Failed to reactivate') }
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
          { label: activeView === 'active' ? 'Active Employees' : 'Inactive Employees', value: String(employees.length), icon: '👥', color: 'from-blue-600 to-indigo-500' },
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

      {/* Active / Inactive toggle + filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
          {(['active', 'inactive'] as const).map(v => (
            <button key={v} onClick={() => { setActiveView(v); setSearch(''); setDeptFilter('') }}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize ${
                activeView === v
                  ? 'bg-saffron-gradient text-white shadow'
                  : 'text-white/40 hover:text-white/70'
              }`}>
              {v}
            </button>
          ))}
        </div>
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
            <p>{employees.length === 0
              ? (activeView === 'inactive' ? 'No inactive employees.' : 'No employees yet — add your first team member.')
              : 'No employees match your search.'}</p>
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
                    {activeView === 'active' ? (
                      <>
                        <button onClick={() => openEdit(emp)} className="text-white/40 hover:text-saffron-400 text-sm px-2 py-1 mr-1">Edit</button>
                        <button onClick={() => deactivate(emp)} className="text-red-400/50 hover:text-red-400 text-xs px-2 py-1">Off</button>
                      </>
                    ) : (
                      <button onClick={() => reactivate(emp)} className="text-green-400/60 hover:text-green-400 text-xs font-semibold px-2 py-1">Reactivate</button>
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
                    <label className={lbl}>Branch *</label>
                    <select value={form.branch_id} onChange={e => setForm(p => ({ ...p, branch_id: e.target.value }))} className={inp}>
                      {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Employment Type</label>
                    <select value={form.employment_type} onChange={e => setForm(p => ({ ...p, employment_type: e.target.value }))} className={inp}>
                      {EMP_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={lbl}>Start Date *</label>
                  <input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} className={inp} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Email {form.employment_type !== 'VOLUNTEER' && '*'}</label>
                    <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className={inp} placeholder="arjun@shital.org" />
                  </div>
                  <div>
                    <label className={lbl}>Phone</label>
                    <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} className={inp} placeholder="+44 7700 000000" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Gross Salary (£/yr){form.employment_type === 'VOLUNTEER' && ' — volunteers always 0'}</label>
                    <input
                      type="number" min="0" step="100"
                      value={form.employment_type === 'VOLUNTEER' ? '0' : form.gross_salary}
                      onChange={e => setForm(p => ({ ...p, gross_salary: e.target.value }))}
                      disabled={form.employment_type === 'VOLUNTEER'}
                      className={inp + (form.employment_type === 'VOLUNTEER' ? ' opacity-50 cursor-not-allowed' : '')}
                      placeholder="32000"
                    />
                  </div>
                  <div>
                    <label className={lbl}>NI Number {form.employment_type !== 'VOLUNTEER' && '*'}</label>
                    <input value={form.national_insurance} onChange={e => setForm(p => ({ ...p, national_insurance: e.target.value }))} className={inp} placeholder="AB123456C" />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Address</label>
                  <textarea value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} rows={2} className={inp + ' resize-none'} placeholder="1 Temple Road, Wembley, HA9 0AA" />
                </div>

                {/* Reporting Manager */}
                <div ref={mgrRef} className="relative">
                  <label className={lbl}>Reporting Manager</label>
                  <input
                    value={mgrSearch}
                    onChange={e => {
                      setMgrSearch(e.target.value)
                      if (!e.target.value) setForm(p => ({ ...p, reporting_manager_id: '', reporting_manager_name: '' }))
                    }}
                    onFocus={() => { if (mgrResults.length > 0) setShowMgrDropdown(true) }}
                    className={inp}
                    placeholder="Search by name…"
                    autoComplete="off"
                  />
                  {form.reporting_manager_id && !showMgrDropdown && (
                    <p className="text-white/40 text-xs mt-1">Selected: {form.reporting_manager_name}</p>
                  )}
                  {showMgrDropdown && mgrResults.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-[#1a1a2e] border border-white/10 rounded-xl shadow-xl overflow-hidden">
                      {mgrResults.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            setForm(p => ({ ...p, reporting_manager_id: m.id, reporting_manager_name: m.full_name }))
                            setMgrSearch(m.full_name)
                            setShowMgrDropdown(false)
                          }}
                          className="w-full text-left px-4 py-2.5 hover:bg-white/5 transition-colors flex items-center gap-3"
                        >
                          <span className="w-7 h-7 rounded-full bg-saffron-gradient flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {m.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                          </span>
                          <div>
                            <p className="text-white text-sm font-semibold">{m.full_name}</p>
                            <p className="text-white/40 text-xs">{m.role}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Immigration */}
                <div className="border-t border-white/5 pt-4">
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-3">Immigration &amp; Right to Work</p>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>Nationality *</label>
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
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={lbl}>Visa / BRP Number</label>
                            <input value={form.visa_number} onChange={e => setForm(p => ({ ...p, visa_number: e.target.value }))} className={inp} placeholder="BRP No." />
                          </div>
                          <div>
                            <label className={lbl}>Visa Type</label>
                            <input value={form.visa_type} onChange={e => setForm(p => ({ ...p, visa_type: e.target.value }))} className={inp} placeholder="Skilled Worker / Student / etc." />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={lbl}>Visa Issue Date</label>
                            <input type="date" value={form.visa_issue_date} onChange={e => setForm(p => ({ ...p, visa_issue_date: e.target.value }))} className={inp} />
                          </div>
                          <div>
                            <label className={lbl}>Visa Expiry Date</label>
                            <input type="date" value={form.visa_expiry} onChange={e => setForm(p => ({ ...p, visa_expiry: e.target.value }))} className={inp} />
                          </div>
                        </div>
                        <div>
                          <label className={lbl}>Sponsor Licence Number</label>
                          <input value={form.visa_sponsor_license} onChange={e => setForm(p => ({ ...p, visa_sponsor_license: e.target.value }))} className={inp} placeholder="Sponsor licence ref (if applicable)" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={lbl}>Share Code</label>
                            <input value={form.share_code} onChange={e => setForm(p => ({ ...p, share_code: e.target.value }))} className={inp} placeholder="9-char gov.uk share code" />
                          </div>
                          <div>
                            <label className={lbl}>Share Code Expiry</label>
                            <input type="date" value={form.share_code_expiry} onChange={e => setForm(p => ({ ...p, share_code_expiry: e.target.value }))} className={inp} />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Personal */}
                <div className="border-t border-white/5 pt-4">
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-3">Personal</p>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>Date of Birth</label>
                        <input type="date" value={form.date_of_birth} onChange={e => setForm(p => ({ ...p, date_of_birth: e.target.value }))} className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>Gender</label>
                        <select value={form.gender} onChange={e => setForm(p => ({ ...p, gender: e.target.value }))} className={inp}>
                          {GENDERS.map(g => <option key={g} value={g}>{g === '' ? '— Select —' : g === 'M' ? 'Male' : g === 'F' ? 'Female' : g === 'X' ? 'Non-binary' : 'Prefer not to say'}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>Personal Email</label>
                        <input type="email" value={form.personal_email} onChange={e => setForm(p => ({ ...p, personal_email: e.target.value }))} className={inp} placeholder="personal@example.com" />
                      </div>
                      <div>
                        <label className={lbl}>Emergency Phone</label>
                        <input value={form.emergency_phone} onChange={e => setForm(p => ({ ...p, emergency_phone: e.target.value }))} className={inp} placeholder="+44 7700 000000" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Next of Kin */}
                <div className="border-t border-white/5 pt-4">
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-3">Next of Kin <span className="text-saffron-400/70 normal-case font-normal">(required)</span></p>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>Name *</label>
                        <input value={form.next_of_kin_name} onChange={e => setForm(p => ({ ...p, next_of_kin_name: e.target.value }))} className={inp} placeholder="Jane Patel" />
                      </div>
                      <div>
                        <label className={lbl}>Relationship *</label>
                        <input value={form.next_of_kin_relationship} onChange={e => setForm(p => ({ ...p, next_of_kin_relationship: e.target.value }))} className={inp} placeholder="Spouse / Parent / Sibling" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>Phone *</label>
                        <input value={form.next_of_kin_phone} onChange={e => setForm(p => ({ ...p, next_of_kin_phone: e.target.value }))} className={inp} placeholder="+44 7700 000000" />
                      </div>
                      <div>
                        <label className={lbl}>Email</label>
                        <input type="email" value={form.next_of_kin_email} onChange={e => setForm(p => ({ ...p, next_of_kin_email: e.target.value }))} className={inp} placeholder="jane@example.com" />
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>Address</label>
                      <textarea value={form.next_of_kin_address} onChange={e => setForm(p => ({ ...p, next_of_kin_address: e.target.value }))} rows={2} className={inp + ' resize-none'} placeholder="Same as employee address if blank" />
                    </div>
                  </div>
                </div>

                {/* Banking — only when not volunteer (volunteers are unpaid) */}
                {form.employment_type !== 'VOLUNTEER' && (
                  <div className="border-t border-white/5 pt-4">
                    <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-3">Banking</p>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={lbl}>Sort Code</label>
                          <input value={form.bank_sort_code} onChange={e => setForm(p => ({ ...p, bank_sort_code: e.target.value }))} className={inp} placeholder="12-34-56" />
                        </div>
                        <div>
                          <label className={lbl}>Account Number</label>
                          <input value={form.bank_account_number} onChange={e => setForm(p => ({ ...p, bank_account_number: e.target.value }))} className={inp} placeholder="12345678" />
                        </div>
                      </div>
                      <div>
                        <label className={lbl}>Account Name</label>
                        <input value={form.bank_account_name} onChange={e => setForm(p => ({ ...p, bank_account_name: e.target.value }))} className={inp} placeholder="A Patel" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Pension / Benefits — only when not volunteer */}
                {form.employment_type !== 'VOLUNTEER' && (
                  <div className="border-t border-white/5 pt-4">
                    <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-3">Pension &amp; Benefits</p>
                    <div className="space-y-3">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={form.pension_enrolled} onChange={e => setForm(p => ({ ...p, pension_enrolled: e.target.checked }))}
                          className="w-4 h-4 rounded accent-saffron-400" />
                        <span className="text-white/70 text-sm">Enrolled in workplace pension</span>
                      </label>
                      {form.pension_enrolled && (
                        <>
                          <div>
                            <label className={lbl}>Pension Provider</label>
                            <input value={form.pension_provider} onChange={e => setForm(p => ({ ...p, pension_provider: e.target.value }))} className={inp} placeholder="NEST / Aviva / etc." />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className={lbl}>Employee Contribution (%)</label>
                              <input type="number" min="0" max="100" step="0.1"
                                value={form.pension_employee_pct} onChange={e => setForm(p => ({ ...p, pension_employee_pct: e.target.value }))} className={inp} placeholder="5" />
                            </div>
                            <div>
                              <label className={lbl}>Employer Contribution (%)</label>
                              <input type="number" min="0" max="100" step="0.1"
                                value={form.pension_employer_pct} onChange={e => setForm(p => ({ ...p, pension_employer_pct: e.target.value }))} className={inp} placeholder="3" />
                            </div>
                          </div>
                        </>
                      )}
                      <div>
                        <label className={lbl}>Benefits Notes</label>
                        <textarea value={form.benefits_notes} onChange={e => setForm(p => ({ ...p, benefits_notes: e.target.value }))} rows={2} className={inp + ' resize-none'}
                          placeholder="Health insurance, season-ticket loan, cycle-to-work, etc." />
                      </div>
                    </div>
                  </div>
                )}

                {/* UK Compliance — DBS + RTW + P45 */}
                <div className="border-t border-white/5 pt-4">
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-3">UK Compliance</p>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>DBS Check Status</label>
                        <select value={form.dbs_check_status} onChange={e => setForm(p => ({ ...p, dbs_check_status: e.target.value }))} className={inp}>
                          {DBS_STATUSES.map(s => <option key={s} value={s}>{s === '' ? '— Select —' : s.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={lbl}>DBS Certificate Number</label>
                        <input value={form.dbs_certificate_number} onChange={e => setForm(p => ({ ...p, dbs_certificate_number: e.target.value }))} className={inp} placeholder="Cert ref" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>DBS Check Date</label>
                        <input type="date" value={form.dbs_check_date} onChange={e => setForm(p => ({ ...p, dbs_check_date: e.target.value }))} className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>DBS Expiry</label>
                        <input type="date" value={form.dbs_check_expiry} onChange={e => setForm(p => ({ ...p, dbs_check_expiry: e.target.value }))} className={inp} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>RTW Check Date</label>
                        <input type="date" value={form.rtw_check_date} onChange={e => setForm(p => ({ ...p, rtw_check_date: e.target.value }))} className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>RTW Reference</label>
                        <input value={form.rtw_check_reference} onChange={e => setForm(p => ({ ...p, rtw_check_reference: e.target.value }))} className={inp} placeholder="Internal ref / share-code used" />
                      </div>
                    </div>
                    {form.employment_type !== 'VOLUNTEER' && (
                      <div className="grid grid-cols-2 gap-3 items-end">
                        <label className="flex items-center gap-3 cursor-pointer h-12">
                          <input type="checkbox" checked={form.p45_received} onChange={e => setForm(p => ({ ...p, p45_received: e.target.checked }))}
                            className="w-4 h-4 rounded accent-saffron-400" />
                          <span className="text-white/70 text-sm">P45 received</span>
                        </label>
                        {!form.p45_received && (
                          <div>
                            <label className={lbl}>Starter Declaration</label>
                            <select value={form.starter_declaration} onChange={e => setForm(p => ({ ...p, starter_declaration: e.target.value }))} className={inp}>
                              {STARTER_DECL.map(d => <option key={d} value={d}>{d === '' ? '— Select —' : `Statement ${d}`}</option>)}
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Working Terms */}
                <div className="border-t border-white/5 pt-4">
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-3">Working Terms</p>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>Hours / Week</label>
                        <input type="number" min="0" max="80" step="0.5"
                          value={form.hours_per_week} onChange={e => setForm(p => ({ ...p, hours_per_week: e.target.value }))} className={inp} placeholder="37.5" />
                      </div>
                      <div>
                        <label className={lbl}>Holiday Entitlement (days/yr)</label>
                        <input type="number" min="0" max="60" step="0.5"
                          value={form.holiday_entitlement_days} onChange={e => setForm(p => ({ ...p, holiday_entitlement_days: e.target.value }))} className={inp} placeholder="28" />
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>Probation End Date</label>
                      <input type="date" value={form.probation_end_date} onChange={e => setForm(p => ({ ...p, probation_end_date: e.target.value }))} className={inp} />
                    </div>
                    {/* End-date + leaving reason are only meaningful when editing — for a new hire they'd be left blank. Show always; backend keeps them nullable. */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>End Date</label>
                        <input type="date" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>Leaving Reason</label>
                        <select value={form.leaving_reason} onChange={e => setForm(p => ({ ...p, leaving_reason: e.target.value }))} className={inp}>
                          {LEAVING_REASONS.map(r => <option key={r} value={r}>{r === '' ? '— Not applicable —' : r.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stopgap free-text */}
                <div className="border-t border-white/5 pt-4">
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-3">Notes</p>
                  <div className="space-y-3">
                    <div>
                      <label className={lbl}>Qualifications</label>
                      <textarea value={form.qualifications_notes} onChange={e => setForm(p => ({ ...p, qualifications_notes: e.target.value }))} rows={3} className={inp + ' resize-none'}
                        placeholder="Degrees, certifications, training. Free-text for now — structured table coming in a later phase." />
                    </div>
                    <div>
                      <label className={lbl}>Documents Held</label>
                      <textarea value={form.documents_held_notes} onChange={e => setForm(p => ({ ...p, documents_held_notes: e.target.value }))} rows={3} className={inp + ' resize-none'}
                        placeholder="Passport, visa, bank statement, contract signed, etc. — what we've received and stored." />
                    </div>
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
