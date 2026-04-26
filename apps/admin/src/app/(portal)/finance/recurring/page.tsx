'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

const CATEGORIES = ['RENT','RATES','LEASE','UTILITIES','HMRC_VAT','HMRC_PAYE','HMRC_CORP_TAX','INSURANCE','PAYROLL','OTHER']
const CRITICAL_CATS = new Set(['RENT','LEASE','HMRC_VAT','HMRC_PAYE','HMRC_CORP_TAX'])
const FREQUENCIES = ['DAILY','WEEKLY','MONTHLY','QUARTERLY','BIANNUAL','ANNUAL']

const CAT_COLORS: Record<string,string> = {
  RENT:'bg-red-500/20 text-red-300 border-red-500/30',
  RATES:'bg-orange-500/20 text-orange-300 border-orange-500/30',
  LEASE:'bg-red-600/20 text-red-400 border-red-600/30',
  UTILITIES:'bg-blue-500/20 text-blue-300 border-blue-500/30',
  HMRC_VAT:'bg-purple-500/20 text-purple-300 border-purple-500/30',
  HMRC_PAYE:'bg-purple-600/20 text-purple-400 border-purple-600/30',
  HMRC_CORP_TAX:'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30',
  INSURANCE:'bg-teal-500/20 text-teal-300 border-teal-500/30',
  PAYROLL:'bg-green-500/20 text-green-300 border-green-500/30',
  OTHER:'bg-white/5 text-white/40 border-white/10',
}

interface RecurringPayment {
  id: string; name: string; category: string; is_critical: boolean
  amount: number; currency: string; frequency: string
  start_date: string; end_date: string | null
  renewal_date: string | null; notice_days: number
  payee: string; reference: string; notes: string
  is_active: boolean; branch_id: string; day_of_month: number | null
  next_due_date: string | null; next_due_status: string; overdue_count: number
}

interface ScheduleEntry {
  id: string; due_date: string; amount: number; currency: string
  status: string; paid_date: string | null; paid_amount: number | null
  paid_reference: string; paid_by: string; notes: string
}

interface Dashboard {
  overdue: Array<{id:string;due_date:string;amount:number;name:string;category:string;is_critical:boolean;rp_id:string}>
  due_7_days: Array<{id:string;due_date:string;amount:number;name:string;category:string;is_critical:boolean;rp_id:string}>
  renewals_due: Array<{id:string;name:string;renewal_date:string;category:string;is_critical:boolean}>
}

const EMPTY = {
  name:'', category:'OTHER', is_critical:false, amount:'', currency:'GBP',
  frequency:'MONTHLY', branch_id:'main', start_date: new Date().toISOString().slice(0,10),
  end_date:'', day_of_month:'', renewal_date:'', notice_days:'30',
  payee:'', reference:'', notes:'', is_active:true,
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-saffron-400/50 placeholder-white/20'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1'

export default function RecurringPaymentsPage() {
  const [payments, setPayments] = useState<RecurringPayment[]>([])
  const [dash, setDash] = useState<Dashboard|null>(null)
  const [branches, setBranches] = useState<Array<{branch_id:string;name:string}>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [catFilter, setCatFilter] = useState('ALL')

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<RecurringPayment|null>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  // Schedule drawer
  const [scheduleFor, setScheduleFor] = useState<RecurringPayment|null>(null)
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([])
  const [schedLoading, setSchedLoading] = useState(false)
  const [markingPaid, setMarkingPaid] = useState<string|null>(null)
  const [paidForm, setPaidForm] = useState({paid_date:'',paid_amount:'',paid_reference:'',paid_by:''})

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [pmtsResult, dashResult, brResult] = await Promise.allSettled([
        apiFetch<{recurring_payments: RecurringPayment[]}>('/recurring-payments?include_inactive=true'),
        apiFetch<Dashboard>('/recurring-payments/dashboard'),
        apiFetch<{branches: Array<{branch_id:string;name:string}>}>('/branches'),
      ])
      if (pmtsResult.status === 'fulfilled') setPayments(pmtsResult.value.recurring_payments || [])
      else setError(pmtsResult.reason instanceof Error ? pmtsResult.reason.message : 'Failed to load obligations')
      if (dashResult.status === 'fulfilled') setDash(dashResult.value)
      if (brResult.status === 'fulfilled') setBranches(brResult.value.branches || [])
    } catch(e:unknown) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const openNew = () => {
    setEditing(null)
    setForm(EMPTY)
    setShowForm(true)
  }

  const openEdit = (p: RecurringPayment) => {
    setEditing(p)
    setForm({
      name: p.name, category: p.category, is_critical: p.is_critical,
      amount: String(p.amount), currency: p.currency, frequency: p.frequency,
      branch_id: p.branch_id,
      start_date: p.start_date ? p.start_date.slice(0,10) : '',
      end_date: p.end_date ? p.end_date.slice(0,10) : '',
      day_of_month: p.day_of_month ? String(p.day_of_month) : '',
      renewal_date: p.renewal_date ? p.renewal_date.slice(0,10) : '',
      notice_days: String(p.notice_days),
      payee: p.payee, reference: p.reference, notes: p.notes,
      is_active: p.is_active,
    })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name.trim() || !form.amount) return
    setSaving(true)
    try {
      const body = {
        ...form,
        amount: parseFloat(form.amount) || 0,
        day_of_month: form.day_of_month ? parseInt(form.day_of_month as string) : null,
        notice_days: parseInt(form.notice_days as string) || 30,
        is_critical: CRITICAL_CATS.has(form.category) || form.is_critical,
        is_active: form.is_active,
      }
      if (editing) {
        await apiFetch(`/recurring-payments/${editing.id}`, { method:'PUT', body: JSON.stringify(body) })
      } else {
        await apiFetch('/recurring-payments', { method:'POST', body: JSON.stringify(body) })
      }
      setShowForm(false)
      await load()
    } catch(e:unknown) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  const remove = async (p: RecurringPayment) => {
    if (!confirm(`Delete "${p.name}"? All pending schedule entries will be voided.`)) return
    try {
      await apiFetch(`/recurring-payments/${p.id}`, { method:'DELETE' })
      await load()
    } catch(e:unknown) { setError(e instanceof Error ? e.message : 'Delete failed') }
  }

  const openSchedule = async (p: RecurringPayment) => {
    setScheduleFor(p)
    setSchedLoading(true)
    setMarkingPaid(null)
    try {
      const d = await apiFetch<{schedule: ScheduleEntry[]}>(`/recurring-payments/${p.id}/schedule`)
      setSchedule(d.schedule || [])
    } catch { setSchedule([]) }
    finally { setSchedLoading(false) }
  }

  const doMarkPaid = async (entry: ScheduleEntry) => {
    try {
      await apiFetch(`/recurring-payments/schedule/${entry.id}/mark-paid`, {
        method:'PATCH',
        body: JSON.stringify({
          paid_date: paidForm.paid_date || new Date().toISOString().slice(0,10),
          paid_amount: paidForm.paid_amount ? parseFloat(paidForm.paid_amount) : null,
          paid_reference: paidForm.paid_reference,
          paid_by: paidForm.paid_by,
        }),
      })
      setMarkingPaid(null)
      if (scheduleFor) openSchedule(scheduleFor)
    } catch(e:unknown) { setError(e instanceof Error ? e.message : 'Failed') }
  }

  const doMarkSkipped = async (id: string) => {
    try {
      await apiFetch(`/recurring-payments/schedule/${id}/mark-skipped`, { method:'PATCH', body: JSON.stringify({notes:''}) })
      if (scheduleFor) openSchedule(scheduleFor)
    } catch { /* ignore */ }
  }

  const doMarkPending = async (id: string) => {
    try {
      await apiFetch(`/recurring-payments/schedule/${id}/mark-pending`, { method:'PATCH', body: '{}' })
      if (scheduleFor) openSchedule(scheduleFor)
    } catch { /* ignore */ }
  }

  const filtered = catFilter === 'ALL' ? payments : payments.filter(p => p.category === catFilter)

  const statusChip = (status: string, dueDate: string | null) => {
    const overdue = dueDate && new Date(dueDate) < new Date()
    const dueSoon = dueDate && !overdue && new Date(dueDate) <= new Date(Date.now() + 7*86400000)
    if (status === 'OVERDUE' || overdue) return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">OVERDUE</span>
    if (dueSoon) return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">DUE SOON</span>
    if (status === 'NO_SCHEDULE') return <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/30 border border-white/10">NO SCHEDULE</span>
    return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">OK</span>
  }

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB') : '—'
  const fmtAmt  = (a: number, cur = 'GBP') => `${cur === 'GBP' ? '£' : cur}${Number(a).toLocaleString('en-GB', {minimumFractionDigits:2})}`

  const overdueCount  = dash?.overdue.length || 0
  const due7Count     = dash?.due_7_days.length || 0
  const renewalCount  = dash?.renewals_due.length || 0
  const criticalAlert = dash?.overdue.some(o => o.is_critical)

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Recurring Payments</h1>
          <p className="text-white/40 mt-1">Track rent, rates, HMRC, utilities and all financial obligations</p>
        </div>
        <button onClick={openNew}
          className="px-5 py-2.5 rounded-xl text-white text-sm font-black transition-all hover:opacity-90"
          style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
          + Add Obligation
        </button>
      </div>

      {/* Critical alert banner */}
      {criticalAlert && (
        <motion.div initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}}
          className="flex items-center gap-3 px-4 py-3 rounded-xl border border-red-500/50 bg-red-500/10">
          <span className="text-xl animate-pulse">🚨</span>
          <div>
            <p className="text-red-400 font-black text-sm">Critical payment overdue!</p>
            <p className="text-red-400/70 text-xs">{dash?.overdue.filter(o=>o.is_critical).map(o=>o.name).join(', ')}</p>
          </div>
        </motion.div>
      )}

      {/* Alert cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:'Overdue',       value:overdueCount,  icon:'🔴', color:'from-red-700 to-red-500',    text:'text-red-400' },
          { label:'Due ≤7 days',   value:due7Count,     icon:'🟡', color:'from-amber-700 to-amber-500', text:'text-amber-400' },
          { label:'Active',        value:payments.filter(p=>p.is_active).length, icon:'🔄', color:'from-green-700 to-green-500', text:'text-green-400' },
          { label:'Renewals (60d)',value:renewalCount,  icon:'📋', color:'from-blue-700 to-blue-500',   text:'text-blue-400' },
        ].map((s,i) => (
          <motion.div key={s.label} initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}}
            className="glass rounded-2xl p-4 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-16 h-16 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
            <p className="text-2xl mb-1">{s.icon}</p>
            <p className="text-white/40 text-xs mb-0.5">{s.label}</p>
            <p className={`text-3xl font-black ${s.text}`}>{loading ? '—' : s.value}</p>
          </motion.div>
        ))}
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Category filters */}
      <div className="flex flex-wrap gap-2">
        {['ALL', ...CATEGORIES].map(c => (
          <button key={c} onClick={() => setCatFilter(c)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              catFilter === c ? 'bg-saffron-400/20 text-saffron-400 border-saffron-400/40' : 'border-white/10 text-white/40 hover:text-white/70'
            }`}>{c.replace(/_/g,' ')}</button>
        ))}
      </div>

      {/* Main table */}
      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        {loading ? (
          <div className="text-center py-20 text-white/30">Loading obligations…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-white/30">
            <p className="text-4xl mb-3">🔄</p>
            <p>No recurring obligations yet. Add rent, HMRC, utilities etc.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Obligation','Category','Amount','Frequency','Next Due','Status',''].map(h=>(
                    <th key={h} className={`text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider ${h==='Frequency'?'hidden sm:table-cell':''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p,i) => {
                  const overdue = p.next_due_date && new Date(p.next_due_date) < new Date()
                  return (
                    <motion.tr key={p.id}
                      initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} transition={{delay:i*0.02}}
                      className={`border-b border-white/5 transition-colors ${overdue ? 'bg-red-500/5' : 'hover:bg-white/3'}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {p.is_critical && <span className="text-red-400 text-xs font-black flex-shrink-0" title="Critical">!</span>}
                          <div>
                            <p className="text-white font-semibold text-sm">{p.name}</p>
                            {p.payee && <p className="text-white/40 text-xs">{p.payee}</p>}
                            {p.renewal_date && (
                              <p className="text-amber-400/70 text-[11px]">Renews {fmtDate(p.renewal_date)}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${CAT_COLORS[p.category] || CAT_COLORS.OTHER}`}>
                          {p.category.replace(/_/g,' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-white whitespace-nowrap">
                        {fmtAmt(p.amount, p.currency)}
                      </td>
                      <td className="px-4 py-3 text-white/50 text-sm hidden sm:table-cell capitalize">
                        {p.frequency.toLowerCase()}
                      </td>
                      <td className="px-4 py-3 text-white/60 text-sm whitespace-nowrap">
                        {fmtDate(p.next_due_date)}
                      </td>
                      <td className="px-4 py-3">
                        {statusChip(p.next_due_status, p.next_due_date)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => openSchedule(p)}
                          className="text-saffron-400/70 hover:text-saffron-400 text-xs font-bold px-2 py-1 mr-1">
                          Schedule
                        </button>
                        <button onClick={() => openEdit(p)}
                          className="text-white/40 hover:text-white text-sm px-2 py-1 mr-1">Edit</button>
                        <button onClick={() => remove(p)}
                          className="text-red-400/40 hover:text-red-400 text-sm px-2 py-1">Del</button>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Schedule drawer */}
      <AnimatePresence>
        {scheduleFor && (
          <>
            <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
              onClick={() => { setScheduleFor(null); setMarkingPaid(null) }}
              className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{x:'100%'}} animate={{x:0}} exit={{x:'100%'}}
              transition={{type:'spring',damping:28,stiffness:280}}
              className="fixed right-0 top-0 h-full w-full sm:max-w-[640px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                <div>
                  <h2 className="text-white font-black text-lg">{scheduleFor.name}</h2>
                  <p className="text-white/40 text-xs">{scheduleFor.frequency} · {fmtAmt(scheduleFor.amount, scheduleFor.currency)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={async () => {
                    try {
                      await apiFetch(`/recurring-payments/${scheduleFor.id}/regenerate`, {method:'POST', body:'{}'})
                      openSchedule(scheduleFor)
                    } catch { /* ignore */ }
                  }} className="px-3 py-1.5 rounded-lg border border-white/10 text-white/50 text-xs hover:bg-white/5">
                    Regenerate
                  </button>
                  <button onClick={() => { setScheduleFor(null); setMarkingPaid(null) }}
                    className="text-white/40 hover:text-white text-xl p-1">✕</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {schedLoading ? (
                  <div className="text-center py-20 text-white/30">Loading schedule…</div>
                ) : schedule.length === 0 ? (
                  <div className="text-center py-20 text-white/30">No schedule entries. Click Regenerate.</div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/5">
                        {['Due Date','Amount','Status','Actions'].map(h=>(
                          <th key={h} className="text-left px-4 py-2.5 text-white/30 text-xs font-semibold uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.map(entry => {
                        const isPast = new Date(entry.due_date) < new Date()
                        const effectiveStatus = entry.status === 'PENDING' && isPast ? 'OVERDUE' : entry.status
                        return (
                          <>
                            <tr key={entry.id} className={`border-b border-white/5 transition-colors ${
                              effectiveStatus === 'OVERDUE' ? 'bg-red-500/5' :
                              effectiveStatus === 'PAID' ? 'bg-green-500/5' : 'hover:bg-white/3'
                            }`}>
                              <td className="px-4 py-3 text-white/70 text-sm">{fmtDate(entry.due_date)}</td>
                              <td className="px-4 py-3 font-mono font-bold text-white text-sm">{fmtAmt(entry.amount)}</td>
                              <td className="px-4 py-3">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                                  effectiveStatus==='PAID'    ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                                  effectiveStatus==='OVERDUE' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                                  effectiveStatus==='SKIPPED' ? 'bg-white/5 text-white/30 border-white/10' :
                                                                'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                }`}>{effectiveStatus}</span>
                                {entry.paid_date && (
                                  <p className="text-white/30 text-[11px] mt-0.5">
                                    Paid {fmtDate(entry.paid_date)}{entry.paid_reference ? ` · ${entry.paid_reference}` : ''}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                {entry.status !== 'PAID' && (
                                  <button onClick={() => {
                                    setMarkingPaid(markingPaid === entry.id ? null : entry.id)
                                    setPaidForm({paid_date:new Date().toISOString().slice(0,10),paid_amount:'',paid_reference:'',paid_by:''})
                                  }}
                                    className="text-green-400/70 hover:text-green-400 text-xs font-bold px-2 py-1 mr-1">
                                    Mark Paid
                                  </button>
                                )}
                                {entry.status === 'PENDING' && (
                                  <button onClick={() => doMarkSkipped(entry.id)}
                                    className="text-white/30 hover:text-white/60 text-xs px-2 py-1 mr-1">Skip</button>
                                )}
                                {(entry.status === 'PAID' || entry.status === 'SKIPPED') && (
                                  <button onClick={() => doMarkPending(entry.id)}
                                    className="text-white/30 hover:text-white/60 text-xs px-2 py-1">Undo</button>
                                )}
                              </td>
                            </tr>
                            {/* Inline mark-paid form */}
                            {markingPaid === entry.id && (
                              <tr key={`${entry.id}-paid`} className="border-b border-white/5 bg-green-500/5">
                                <td colSpan={4} className="px-4 py-3">
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                                    <div>
                                      <label className="block text-white/40 text-[11px] mb-0.5">Paid Date</label>
                                      <input type="date" value={paidForm.paid_date}
                                        onChange={e => setPaidForm(p=>({...p,paid_date:e.target.value}))}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs outline-none" />
                                    </div>
                                    <div>
                                      <label className="block text-white/40 text-[11px] mb-0.5">Amount Paid</label>
                                      <input type="number" value={paidForm.paid_amount} placeholder={String(entry.amount)}
                                        onChange={e => setPaidForm(p=>({...p,paid_amount:e.target.value}))}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs outline-none" />
                                    </div>
                                    <div>
                                      <label className="block text-white/40 text-[11px] mb-0.5">Reference</label>
                                      <input value={paidForm.paid_reference} placeholder="Bank ref / cheque"
                                        onChange={e => setPaidForm(p=>({...p,paid_reference:e.target.value}))}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs outline-none" />
                                    </div>
                                    <div>
                                      <label className="block text-white/40 text-[11px] mb-0.5">Paid By</label>
                                      <input value={paidForm.paid_by} placeholder="Name"
                                        onChange={e => setPaidForm(p=>({...p,paid_by:e.target.value}))}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs outline-none" />
                                    </div>
                                  </div>
                                  <div className="flex gap-2">
                                    <button onClick={() => doMarkPaid(entry)}
                                      className="px-4 py-1.5 rounded-lg text-white text-xs font-bold bg-green-600 hover:bg-green-500">
                                      Confirm Payment
                                    </button>
                                    <button onClick={() => setMarkingPaid(null)}
                                      className="px-4 py-1.5 rounded-lg text-white/50 text-xs border border-white/10 hover:bg-white/5">
                                      Cancel
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* New/Edit slide-over */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{x:'100%'}} animate={{x:0}} exit={{x:'100%'}}
              transition={{type:'spring',damping:28,stiffness:280}}
              className="fixed right-0 top-0 h-full w-full sm:max-w-[500px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editing ? 'Edit Obligation' : 'New Obligation'}</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl p-1">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

                <div>
                  <label className={lbl}>Name *</label>
                  <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))}
                    placeholder="e.g. Main Branch Rent" className={inp} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Category *</label>
                    <select value={form.category}
                      onChange={e => setForm(p => ({
                        ...p, category: e.target.value,
                        is_critical: CRITICAL_CATS.has(e.target.value),
                      }))} className={inp}>
                      {CATEGORIES.map(c=><option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Frequency *</label>
                    <select value={form.frequency} onChange={e=>setForm(p=>({...p,frequency:e.target.value}))} className={inp}>
                      {FREQUENCIES.map(f=><option key={f} value={f}>{f.charAt(0)+f.slice(1).toLowerCase()}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Amount (£) *</label>
                    <input type="number" min="0" step="0.01" value={form.amount}
                      onChange={e=>setForm(p=>({...p,amount:e.target.value}))} className={inp} placeholder="0.00" />
                  </div>
                  <div>
                    <label className={lbl}>Day of Month</label>
                    <input type="number" min="1" max="28" value={form.day_of_month}
                      onChange={e=>setForm(p=>({...p,day_of_month:e.target.value}))}
                      placeholder="e.g. 1" className={inp} />
                    <p className="text-white/25 text-[11px] mt-0.5">Pin to specific day (optional)</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Start Date *</label>
                    <input type="date" value={form.start_date} onChange={e=>setForm(p=>({...p,start_date:e.target.value}))} className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>End Date</label>
                    <input type="date" value={form.end_date} onChange={e=>setForm(p=>({...p,end_date:e.target.value}))} className={inp} />
                    <p className="text-white/25 text-[11px] mt-0.5">Leave blank = ongoing</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Renewal Date</label>
                    <input type="date" value={form.renewal_date} onChange={e=>setForm(p=>({...p,renewal_date:e.target.value}))} className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Alert Before (days)</label>
                    <input type="number" min="1" value={form.notice_days}
                      onChange={e=>setForm(p=>({...p,notice_days:e.target.value}))} className={inp} />
                  </div>
                </div>

                <div>
                  <label className={lbl}>Branch</label>
                  <select value={form.branch_id} onChange={e=>setForm(p=>({...p,branch_id:e.target.value}))} className={inp}>
                    {branches.map(b=><option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
                    {branches.length===0 && <option value="main">Main</option>}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Payee / Supplier</label>
                    <input value={form.payee} onChange={e=>setForm(p=>({...p,payee:e.target.value}))}
                      placeholder="Landlord / HMRC" className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Account / Reference</label>
                    <input value={form.reference} onChange={e=>setForm(p=>({...p,reference:e.target.value}))}
                      placeholder="Acc no. / UTR" className={inp} />
                  </div>
                </div>

                <div>
                  <label className={lbl}>Notes</label>
                  <textarea value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))}
                    rows={2} className={inp+' resize-none'} />
                </div>

                <div className="flex items-center gap-3 bg-white/5 rounded-xl p-3">
                  <button onClick={()=>setForm(p=>({...p,is_critical:!p.is_critical}))}
                    className={`w-11 h-6 rounded-full transition-all flex-shrink-0 relative ${form.is_critical ? 'bg-red-500' : 'bg-white/10'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${form.is_critical ? 'left-5' : 'left-0.5'}`} />
                  </button>
                  <div>
                    <p className="text-white text-sm font-bold">Critical obligation</p>
                    <p className="text-white/30 text-xs">Auto-on for Rent, Lease, HMRC. Shows red alert if overdue.</p>
                  </div>
                </div>

              </div>
              <div className="px-5 py-4 border-t border-white/5 flex gap-3">
                <button onClick={()=>setShowForm(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={save} disabled={saving || !form.name.trim() || !form.amount}
                  className="flex-[2] py-3 rounded-xl text-white font-black text-sm disabled:opacity-40"
                  style={{background:'linear-gradient(135deg,#B91C1C,#7f1010)'}}>
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Obligation'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
