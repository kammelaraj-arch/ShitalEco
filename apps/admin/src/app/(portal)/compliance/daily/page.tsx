'use client'
/**
 * MASTER 05A — Day-to-Day Branch Checklist & Food Record.
 * All six sub-forms live on one page keyed by (branch_id, record_date). Save
 * Draft keeps editing; Submit locks (status→SUBMITTED). Branch manager /
 * trustee can later Review to mark REVIEWED + leave notes.
 *
 * The paper form (MASTER_05A docx) is the source of truth for check labels
 * and section numbering — keep them in sync.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

// ── Static check definitions (match the paper form row-for-row) ──────────────
// Keys are the keys stored in Postgres JSONB; labels are what volunteers see.
const OPENING_CLOSING_CHECKS: Array<{ key: string; label: string }> = [
  { key: 'public_areas_clear',     label: 'Public areas, entrances and walkways clear' },
  { key: 'emergency_exits_clear',  label: 'Emergency exits and routes clear' },
  { key: 'fire_doors_unobstructed',label: 'Fire doors, alarms and extinguishers unobstructed' },
  { key: 'kitchen_clean',          label: 'Kitchen / food area clean' },
  { key: 'fridges_operating',      label: 'Fridges / freezers operating and food protected' },
  { key: 'gas_cooking_safe',       label: 'Fixed gas cooking equipment visually safe' },
  { key: 'first_aid_available',    label: 'First-aid kit available' },
  { key: 'cleaning_stored_safely', label: 'Cleaning products stored safely' },
  { key: 'waste_removed',          label: 'Waste removed or secured' },
  { key: 'food_stored_safely',     label: 'Food covered, stored or disposed of safely' },
  { key: 'equipment_off_secured', label: 'Equipment switched off and premises secured' },
]

const FOOD_PREP_CHECKS: Array<{ key: string; label: string }> = [
  { key: 'volunteers_fit_washed',  label: 'Volunteers are fit and have washed hands' },
  { key: 'surfaces_utensils_clean',label: 'Food surfaces and utensils are clean' },
  { key: 'ingredients_in_date',    label: 'Ingredients are in good condition and within date where applicable' },
  { key: 'donated_checked',        label: 'Donated ingredients checked and recorded below' },
  { key: 'raw_rte_separated',      label: 'Raw and ready-to-eat food separated' },
  { key: 'allergen_info_available',label: 'Allergen information available' },
  { key: 'food_protected_service', label: 'Food protected during service' },
  { key: 'leftovers_safe',         label: 'Leftovers stored safely or disposed of' },
]

const TEMP_STAGES = ['cooking', 'cooling', 'reheating', 'hot_holding', 'cold_storage']
const STATUS_STYLE: Record<string, string> = {
  DRAFT:     'bg-amber-500/15 text-amber-400 border-amber-500/30',
  SUBMITTED: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  REVIEWED:  'bg-green-500/15 text-green-400 border-green-500/30',
}

// ── Form data types (mirror backend Pydantic DailyRecordData shape) ──────────
interface CheckBool { value?: boolean | null; na?: boolean; action?: string }
interface OpeningClosing {
  opening: Record<string, CheckBool>
  closing: Record<string, CheckBool>
  opened_by: string
  closed_by: string
  manager_action: string
}
interface FoodPrep {
  checks: Record<string, CheckBool>
  food_lead: string
  served_by: string
}
interface DonationReceipt {
  time: string; donor_or_supplier: string; food_quantity: string
  date_or_batch: string; condition_ok: boolean; accepted: boolean
  initials: string; reject_action: string
}
interface TemperatureEntry {
  time: string; food_batch: string; stage: string; target: string
  actual: string; passed: boolean; initials: string; corrective_action: string
}
interface AllergenCheck {
  food_or_prasad: string; known_allergen: string
  separate_utensil: boolean; info_given: boolean; initials: string
}
interface DailyIssue {
  time: string; issue: string; immediate_action: string
  reported_to: string; initials: string
}
interface DailyRecordData {
  opening_closing: OpeningClosing
  food_prep: FoodPrep
  donations: DonationReceipt[]
  temperatures: TemperatureEntry[]
  allergens: AllergenCheck[]
  issues: DailyIssue[]
}
interface DailyRecord {
  id: string | null
  branch_id: string
  record_date: string
  data: DailyRecordData
  status: string
  created_by: string
  submitted_at: string | null
  reviewed_by: string
  reviewed_at: string | null
  manager_notes: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const todayISO = () => new Date().toISOString().slice(0, 10)

interface LoggedInUser {
  id?: string
  name?: string
  email?: string
  role?: string
  branch_id?: string
}

/**
 * Read the logged-in user from localStorage (set at /login).
 * Returns an empty object if nothing is stored or JSON is malformed.
 */
function readUser(): LoggedInUser {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem('shital_user')
    return raw ? (JSON.parse(raw) as LoggedInUser) : {}
  } catch { return {} }
}

/**
 * Initials for the row-level "init" field — first letter of each name token,
 * uppercased, max 3 chars. "Priya Patel" → "PP"; "Raj K Mehta" → "RKM".
 */
function initialsFrom(name: string | undefined): string {
  if (!name) return ''
  return name.trim().split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 3)
}

const emptyData = (): DailyRecordData => ({
  opening_closing: {
    opening: {}, closing: {}, opened_by: '', closed_by: '', manager_action: '',
  },
  food_prep: { checks: {}, food_lead: '', served_by: '' },
  donations: [],
  temperatures: [],
  allergens: [],
  issues: [],
})

// Field class — matches the shared "temple admin dark glass" look of other pages.
const INP = 'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-white/25 text-sm focus:border-saffron-400 focus:outline-none'

// Styled "tri-state" button for Opening/Closing checks: Pass / N/A / Fail (empty)
function TriCheck({ value }: { value: CheckBool }) {
  // Visual indicator; actual change happens via dedicated handler per cell
  if (value.na) return <span className="text-amber-400 text-xs font-bold">N/A</span>
  if (value.value === true) return <span className="text-green-400 text-base">✓</span>
  if (value.value === false) return <span className="text-red-400 text-base">✗</span>
  return <span className="text-white/20 text-xs">—</span>
}

export default function CompliancDailyPage() {
  // Logged-in user — read once on mount. Determines the pinned branch and
  // the auto-populated name / initials.
  const [me, setMe] = useState<LoggedInUser>({})
  useEffect(() => { setMe(readUser()) }, [])
  const myName = me.name || me.email || ''
  const myInitials = useMemo(() => initialsFrom(myName), [myName])

  // Branch is pulled from the account and never changed on this page.
  const branch = me.branch_id || 'main'

  const [recordDate, setRecordDate] = useState<string>(todayISO())
  const [rec, setRec] = useState<DailyRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>('')
  const [flash, setFlash] = useState<string>('')
  // Which panels are expanded. Default: opening_closing + issues open; others collapsed.
  const [open, setOpen] = useState<Record<string, boolean>>({
    oc: true, fp: false, don: false, temp: false, alg: false, iss: true,
  })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const d = await apiFetch<DailyRecord>(`/compliance/daily?branch_id=${branch}&record_date=${recordDate}`)
      // Fill in missing shape bits in case backend returns a sparse skeleton
      d.data = { ...emptyData(), ...(d.data || {}) }
      d.data.opening_closing = { ...emptyData().opening_closing, ...(d.data.opening_closing || {}) }
      d.data.food_prep       = { ...emptyData().food_prep, ...(d.data.food_prep || {}) }
      // Pre-fill names on a brand-new record so the volunteer doesn't retype
      // their own name on four fields. Only touches blanks — never overwrites
      // a value already saved by a previous session for this day.
      if (!d.id && myName) {
        if (!d.data.opening_closing.opened_by) d.data.opening_closing.opened_by = myName
        if (!d.data.opening_closing.closed_by) d.data.opening_closing.closed_by = myName
        if (!d.data.food_prep.food_lead)       d.data.food_prep.food_lead = myName
        if (!d.data.food_prep.served_by)       d.data.food_prep.served_by = myName
      }
      setRec(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load record')
      setRec(null)
    } finally { setLoading(false) }
  }, [branch, recordDate, myName])

  useEffect(() => { load() }, [load])

  // Record is locked once SUBMITTED/REVIEWED. Draft is editable; submitted
  // can only be reviewed. Keeps the paper form's "ink is final" semantics.
  const locked = rec?.status === 'SUBMITTED' || rec?.status === 'REVIEWED'

  const save = async (submit: boolean) => {
    if (!rec) return
    if (submit && !confirm('Submit this record? Once submitted it cannot be edited (only reviewed by a manager).')) return
    setSaving(true); setError(''); setFlash('')
    try {
      await apiFetch(`/compliance/daily`, {
        method: 'POST',
        body: JSON.stringify({
          branch_id: branch, record_date: recordDate,
          data: rec.data, submit,
        }),
      })
      setFlash(submit ? 'Submitted ✓' : 'Draft saved ✓')
      await load()
    } catch (e) {
      // Backend returns errors wrapped — surface them cleanly.
      let msg = e instanceof Error ? e.message : 'Save failed'
      try {
        const parsed = JSON.parse(msg)
        if (parsed?.detail?.errors) msg = parsed.detail.errors.join(' · ')
        else if (parsed?.detail) msg = String(parsed.detail)
      } catch { /* leave as-is */ }
      setError(msg)
    } finally { setSaving(false); setTimeout(() => setFlash(''), 3000) }
  }

  const review = async (reviewed: boolean) => {
    if (!rec?.id) return
    const notes = prompt('Reviewer notes (optional):', rec.manager_notes || '') ?? ''
    setSaving(true)
    try {
      await apiFetch(`/compliance/daily/${rec.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ reviewed, manager_notes: notes }),
      })
      setFlash(reviewed ? 'Marked reviewed ✓' : 'Un-reviewed')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed')
    } finally { setSaving(false); setTimeout(() => setFlash(''), 3000) }
  }

  // ── Mutators (keep the state tree simple — spread the whole data each time) ─
  const setData = (patch: Partial<DailyRecordData>) => {
    setRec(prev => prev ? { ...prev, data: { ...prev.data, ...patch } } : prev)
  }
  const setCheckCell = (section: 'opening' | 'closing', key: string, next: CheckBool) => {
    if (!rec) return
    const oc = rec.data.opening_closing
    setData({ opening_closing: { ...oc, [section]: { ...oc[section], [key]: next } } })
  }
  const setFoodCheck = (key: string, next: CheckBool) => {
    if (!rec) return
    const fp = rec.data.food_prep
    setData({ food_prep: { ...fp, checks: { ...fp.checks, [key]: next } } })
  }
  const cycleCheck = (cur: CheckBool): CheckBool => {
    // Click cycles: — → ✓ → N/A → ✗ → —
    if (cur.value === undefined && !cur.na) return { value: true, na: false, action: '' }
    if (cur.value === true) return { value: null, na: true, action: '' }
    if (cur.na) return { value: false, na: false, action: cur.action || '' }
    return { value: undefined, na: false, action: '' }
  }

  // Memoised panel wrapper — keeps the JSX below readable
  const Panel = useMemo(() => function Panel({
    id, title, children, flag,
  }: { id: string; title: string; children: React.ReactNode; flag?: string }) {
    const isOpen = !!open[id]
    return (
      <section className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <button type="button"
          onClick={() => setOpen(p => ({ ...p, [id]: !isOpen }))}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition">
          <span className="flex items-center gap-3">
            <span className="text-white/40 text-xs">{isOpen ? '▾' : '▸'}</span>
            <span className="text-white font-bold text-sm">{title}</span>
            {flag && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">{flag}</span>}
          </span>
        </button>
        <AnimatePresence>
          {isOpen && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
              className="overflow-hidden">
              <div className="px-4 pb-4 pt-1">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    )
  }, [open])

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Daily Compliance Record</h1>
          <p className="text-white/40 mt-1 text-sm">
            MASTER 05A — Day-to-Day Branch Checklist &amp; Food Record. One record per branch per day.
          </p>
        </div>
        {rec && (
          <span className={`text-xs font-bold px-3 py-1 rounded-full border ${STATUS_STYLE[rec.status] || 'bg-white/5 text-white/50 border-white/10'}`}>
            {rec.status}{rec.reviewed_by && ` · ${rec.reviewed_by}`}
          </span>
        )}
      </div>

      {/* Branch is always read-only on this page — the volunteer / branch
          manager always fills in their own branch's record. Cross-branch
          viewing (for trustees / super-admins) belongs in the history view
          where the branch picker is a legitimate filter, not an editing
          hazard. */}
      <div className="grid grid-cols-2 gap-3 glass rounded-2xl p-4 border border-white/10">
        <div>
          <label className="text-white/50 text-xs font-bold uppercase tracking-wide mb-1 block">Branch</label>
          <div className={INP + ' flex items-center justify-between opacity-80 cursor-not-allowed'}>
            <span className="font-semibold">{branch || '—'}</span>
            <span className="text-white/30 text-xs">from your account</span>
          </div>
        </div>
        <div>
          <label className="text-white/50 text-xs font-bold uppercase tracking-wide mb-1 block">Date</label>
          <input type="date" value={recordDate} onChange={e => setRecordDate(e.target.value)} className={INP} />
        </div>
      </div>

      {/* Submitting-as badge — makes it clear whose name goes on the record. */}
      {myName && (
        <div className="text-xs text-white/40 -mt-2">
          Signing as <span className="text-white/70 font-semibold">{myName}</span>
          {myInitials && <span className="text-white/40"> · initials {myInitials}</span>}
        </div>
      )}

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 px-4 py-3 text-sm">{error}</div>}
      {flash && <div className="rounded-xl border border-green-500/30 bg-green-500/10 text-green-400 px-4 py-3 text-sm">{flash}</div>}
      {loading && <div className="text-white/40 text-sm">Loading…</div>}

      {rec && !loading && (
        <>
          {/* Status banner for locked records */}
          {locked && (
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-300 px-4 py-3 text-sm">
              This record is {rec.status.toLowerCase()}. Volunteers cannot edit; a branch manager can {rec.status === 'SUBMITTED' ? 'mark it reviewed' : 'un-review it to unlock'}.
              {rec.manager_notes && <div className="mt-2 text-white/60"><strong>Manager notes:</strong> {rec.manager_notes}</div>}
            </div>
          )}

          <fieldset disabled={locked} className={locked ? 'opacity-70' : ''}>
            {/* §1 Opening & Closing */}
            <Panel id="oc" title="§1  Opening &amp; Closing Checklist">
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-white/40 text-xs uppercase tracking-wider">
                      <th className="text-left py-2 pr-3 font-semibold">Check</th>
                      <th className="py-2 px-2 font-semibold w-20">Opening</th>
                      <th className="py-2 px-2 font-semibold w-20">Closing</th>
                      <th className="text-left py-2 pl-3 font-semibold">Action / initials</th>
                    </tr>
                  </thead>
                  <tbody>
                    {OPENING_CLOSING_CHECKS.map(c => {
                      const o = rec.data.opening_closing.opening[c.key] || {}
                      const cl = rec.data.opening_closing.closing[c.key] || {}
                      return (
                        <tr key={c.key} className="border-b border-white/5">
                          <td className="py-2 pr-3 text-white/80">{c.label}</td>
                          <td className="py-2 px-2 text-center">
                            <button type="button" onClick={() => setCheckCell('opening', c.key, cycleCheck(o))}
                              className="w-10 h-8 rounded border border-white/10 hover:border-white/30">
                              <TriCheck value={o} />
                            </button>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button type="button" onClick={() => setCheckCell('closing', c.key, cycleCheck(cl))}
                              className="w-10 h-8 rounded border border-white/10 hover:border-white/30">
                              <TriCheck value={cl} />
                            </button>
                          </td>
                          <td className="py-2 pl-3">
                            <input value={o.action || cl.action || ''}
                              onChange={e => {
                                const action = e.target.value
                                if (o.value === false || o.na) setCheckCell('opening', c.key, { ...o, action })
                                else setCheckCell('closing', c.key, { ...cl, action })
                              }}
                              placeholder="If failed: action + initials"
                              className={INP + ' py-1'} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-white/30 text-xs mt-2">Click a cell to cycle: — ✓ N/A ✗</p>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <input placeholder="Opened by" value={rec.data.opening_closing.opened_by}
                  onChange={e => setData({ opening_closing: { ...rec.data.opening_closing, opened_by: e.target.value } })}
                  className={INP} />
                <input placeholder="Closed by" value={rec.data.opening_closing.closed_by}
                  onChange={e => setData({ opening_closing: { ...rec.data.opening_closing, closed_by: e.target.value } })}
                  className={INP} />
              </div>
              <textarea placeholder="Manager action (if any)" rows={2}
                value={rec.data.opening_closing.manager_action}
                onChange={e => setData({ opening_closing: { ...rec.data.opening_closing, manager_action: e.target.value } })}
                className={INP + ' mt-2 resize-none'} />
            </Panel>

            {/* §2 Food Prep */}
            <Panel id="fp" title="§2  Food &amp; Prasad Preparation Check">
              <div className="space-y-2">
                {FOOD_PREP_CHECKS.map(c => {
                  const v = rec.data.food_prep.checks[c.key] || {}
                  return (
                    <div key={c.key} className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center border-b border-white/5 pb-2">
                      <span className="text-white/80 text-sm">{c.label}</span>
                      <button type="button" onClick={() => setFoodCheck(c.key, cycleCheck(v))}
                        className="w-10 h-8 rounded border border-white/10 hover:border-white/30">
                        <TriCheck value={v} />
                      </button>
                      <input placeholder="Action if no" value={v.action || ''}
                        onChange={e => setFoodCheck(c.key, { ...v, action: e.target.value })}
                        className={INP + ' py-1'} />
                    </div>
                  )
                })}
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <input placeholder="Menu / food lead" value={rec.data.food_prep.food_lead}
                  onChange={e => setData({ food_prep: { ...rec.data.food_prep, food_lead: e.target.value } })} className={INP} />
                <input placeholder="Served by" value={rec.data.food_prep.served_by}
                  onChange={e => setData({ food_prep: { ...rec.data.food_prep, served_by: e.target.value } })} className={INP} />
              </div>
            </Panel>

            {/* §3 Donations */}
            <Panel id="don" title="§3  Donation / Delivery Receiving Record" flag={rec.data.donations.length > 0 ? `${rec.data.donations.length}` : undefined}>
              {rec.data.donations.map((d, i) => (
                <div key={i} className="grid grid-cols-[80px_1fr_1fr_90px_60px_90px_60px_auto] gap-2 mb-2 items-center">
                  <input placeholder="Time" value={d.time} onChange={e => setData({ donations: rec.data.donations.map((x, j) => j === i ? { ...x, time: e.target.value } : x) })} className={INP + ' py-1'} />
                  <input placeholder="Donor / supplier" value={d.donor_or_supplier} onChange={e => setData({ donations: rec.data.donations.map((x, j) => j === i ? { ...x, donor_or_supplier: e.target.value } : x) })} className={INP + ' py-1'} />
                  <input placeholder="Food / qty" value={d.food_quantity} onChange={e => setData({ donations: rec.data.donations.map((x, j) => j === i ? { ...x, food_quantity: e.target.value } : x) })} className={INP + ' py-1'} />
                  <input placeholder="Date/batch" value={d.date_or_batch} onChange={e => setData({ donations: rec.data.donations.map((x, j) => j === i ? { ...x, date_or_batch: e.target.value } : x) })} className={INP + ' py-1'} />
                  <label className="text-white/60 text-xs flex items-center gap-1 justify-center">
                    <input type="checkbox" checked={d.condition_ok} onChange={e => setData({ donations: rec.data.donations.map((x, j) => j === i ? { ...x, condition_ok: e.target.checked } : x) })} /> OK
                  </label>
                  <select value={d.accepted ? 'accept' : 'reject'} onChange={e => setData({ donations: rec.data.donations.map((x, j) => j === i ? { ...x, accepted: e.target.value === 'accept' } : x) })} className={INP + ' py-1'}>
                    <option value="accept">Accept</option>
                    <option value="reject">Reject</option>
                  </select>
                  <input placeholder="Initials" value={d.initials} onChange={e => setData({ donations: rec.data.donations.map((x, j) => j === i ? { ...x, initials: e.target.value } : x) })} className={INP + ' py-1 text-center'} />
                  <button type="button" onClick={() => setData({ donations: rec.data.donations.filter((_, j) => j !== i) })}
                    className="text-red-400 hover:text-red-300 text-xs">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => setData({ donations: [...rec.data.donations, { time: '', donor_or_supplier: '', food_quantity: '', date_or_batch: '', condition_ok: false, accepted: true, initials: myInitials, reject_action: '' }] })}
                className="mt-2 px-3 py-1.5 rounded-lg bg-saffron-500/20 text-saffron-400 border border-saffron-500/30 text-xs font-semibold hover:bg-saffron-500/30">
                + Add donation
              </button>
            </Panel>

            {/* §4 Temperatures */}
            <Panel id="temp" title="§4  Temperature &amp; Cooking Record" flag={rec.data.temperatures.length > 0 ? `${rec.data.temperatures.length}` : undefined}>
              {rec.data.temperatures.map((t, i) => (
                <div key={i} className="grid grid-cols-[70px_1fr_120px_80px_80px_70px_60px_auto] gap-2 mb-2 items-center">
                  <input placeholder="Time" value={t.time} onChange={e => setData({ temperatures: rec.data.temperatures.map((x, j) => j === i ? { ...x, time: e.target.value } : x) })} className={INP + ' py-1'} />
                  <input placeholder="Food / batch" value={t.food_batch} onChange={e => setData({ temperatures: rec.data.temperatures.map((x, j) => j === i ? { ...x, food_batch: e.target.value } : x) })} className={INP + ' py-1'} />
                  <select value={t.stage} onChange={e => setData({ temperatures: rec.data.temperatures.map((x, j) => j === i ? { ...x, stage: e.target.value } : x) })} className={INP + ' py-1'}>
                    <option value="">Stage…</option>
                    {TEMP_STAGES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                  <input placeholder="Target" value={t.target} onChange={e => setData({ temperatures: rec.data.temperatures.map((x, j) => j === i ? { ...x, target: e.target.value } : x) })} className={INP + ' py-1'} />
                  <input placeholder="Actual" value={t.actual} onChange={e => setData({ temperatures: rec.data.temperatures.map((x, j) => j === i ? { ...x, actual: e.target.value } : x) })} className={INP + ' py-1'} />
                  <select value={t.passed ? 'pass' : 'fail'} onChange={e => setData({ temperatures: rec.data.temperatures.map((x, j) => j === i ? { ...x, passed: e.target.value === 'pass' } : x) })} className={INP + ' py-1'}>
                    <option value="pass">Pass</option>
                    <option value="fail">Fail</option>
                  </select>
                  <input placeholder="Init" value={t.initials} onChange={e => setData({ temperatures: rec.data.temperatures.map((x, j) => j === i ? { ...x, initials: e.target.value } : x) })} className={INP + ' py-1 text-center'} />
                  <button type="button" onClick={() => setData({ temperatures: rec.data.temperatures.filter((_, j) => j !== i) })}
                    className="text-red-400 hover:text-red-300 text-xs">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => setData({ temperatures: [...rec.data.temperatures, { time: '', food_batch: '', stage: '', target: '', actual: '', passed: true, initials: myInitials, corrective_action: '' }] })}
                className="mt-2 px-3 py-1.5 rounded-lg bg-saffron-500/20 text-saffron-400 border border-saffron-500/30 text-xs font-semibold hover:bg-saffron-500/30">
                + Add temperature reading
              </button>
            </Panel>

            {/* §5 Allergens */}
            <Panel id="alg" title="§5  Allergen &amp; Serving Check" flag={rec.data.allergens.length > 0 ? `${rec.data.allergens.length}` : undefined}>
              {rec.data.allergens.map((a, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_90px_90px_60px_auto] gap-2 mb-2 items-center">
                  <input placeholder="Food / prasad" value={a.food_or_prasad} onChange={e => setData({ allergens: rec.data.allergens.map((x, j) => j === i ? { ...x, food_or_prasad: e.target.value } : x) })} className={INP + ' py-1'} />
                  <input placeholder="Known allergen" value={a.known_allergen} onChange={e => setData({ allergens: rec.data.allergens.map((x, j) => j === i ? { ...x, known_allergen: e.target.value } : x) })} className={INP + ' py-1'} />
                  <label className="text-white/60 text-xs flex items-center gap-1 justify-center">
                    <input type="checkbox" checked={a.separate_utensil} onChange={e => setData({ allergens: rec.data.allergens.map((x, j) => j === i ? { ...x, separate_utensil: e.target.checked } : x) })} /> Sep.
                  </label>
                  <label className="text-white/60 text-xs flex items-center gap-1 justify-center">
                    <input type="checkbox" checked={a.info_given} onChange={e => setData({ allergens: rec.data.allergens.map((x, j) => j === i ? { ...x, info_given: e.target.checked } : x) })} /> Info
                  </label>
                  <input placeholder="Init" value={a.initials} onChange={e => setData({ allergens: rec.data.allergens.map((x, j) => j === i ? { ...x, initials: e.target.value } : x) })} className={INP + ' py-1 text-center'} />
                  <button type="button" onClick={() => setData({ allergens: rec.data.allergens.filter((_, j) => j !== i) })}
                    className="text-red-400 hover:text-red-300 text-xs">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => setData({ allergens: [...rec.data.allergens, { food_or_prasad: '', known_allergen: '', separate_utensil: false, info_given: false, initials: myInitials }] })}
                className="mt-2 px-3 py-1.5 rounded-lg bg-saffron-500/20 text-saffron-400 border border-saffron-500/30 text-xs font-semibold hover:bg-saffron-500/30">
                + Add allergen entry
              </button>
            </Panel>

            {/* §6 Issues */}
            <Panel id="iss" title="§6  Daily Issue Record" flag={rec.data.issues.length > 0 ? `${rec.data.issues.length} issue(s)` : undefined}>
              {rec.data.issues.map((it, i) => (
                <div key={i} className="grid grid-cols-[80px_2fr_2fr_1fr_60px_auto] gap-2 mb-2 items-center">
                  <input placeholder="Time" value={it.time} onChange={e => setData({ issues: rec.data.issues.map((x, j) => j === i ? { ...x, time: e.target.value } : x) })} className={INP + ' py-1'} />
                  <input placeholder="Issue / failed check" value={it.issue} onChange={e => setData({ issues: rec.data.issues.map((x, j) => j === i ? { ...x, issue: e.target.value } : x) })} className={INP + ' py-1'} />
                  <input placeholder="Immediate action" value={it.immediate_action} onChange={e => setData({ issues: rec.data.issues.map((x, j) => j === i ? { ...x, immediate_action: e.target.value } : x) })} className={INP + ' py-1'} />
                  <input placeholder="Reported to" value={it.reported_to} onChange={e => setData({ issues: rec.data.issues.map((x, j) => j === i ? { ...x, reported_to: e.target.value } : x) })} className={INP + ' py-1'} />
                  <input placeholder="Init" value={it.initials} onChange={e => setData({ issues: rec.data.issues.map((x, j) => j === i ? { ...x, initials: e.target.value } : x) })} className={INP + ' py-1 text-center'} />
                  <button type="button" onClick={() => setData({ issues: rec.data.issues.filter((_, j) => j !== i) })}
                    className="text-red-400 hover:text-red-300 text-xs">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => setData({ issues: [...rec.data.issues, { time: '', issue: '', immediate_action: '', reported_to: '', initials: myInitials }] })}
                className="mt-2 px-3 py-1.5 rounded-lg bg-saffron-500/20 text-saffron-400 border border-saffron-500/30 text-xs font-semibold hover:bg-saffron-500/30">
                + Add issue
              </button>
            </Panel>
          </fieldset>

          {/* Action bar — sticky at bottom so it's always reachable */}
          <div className="fixed bottom-0 left-0 right-0 bg-temple-deep/95 backdrop-blur border-t border-white/10 px-6 py-3 flex items-center justify-end gap-3 z-30">
            {!locked && (
              <>
                <button onClick={() => save(false)} disabled={saving}
                  className="px-4 py-2 rounded-lg border border-white/20 text-white font-semibold text-sm disabled:opacity-40 hover:bg-white/5">
                  {saving ? 'Saving…' : 'Save Draft'}
                </button>
                <button onClick={() => save(true)} disabled={saving}
                  className="px-6 py-2 rounded-lg bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  Submit Record
                </button>
              </>
            )}
            {rec.status === 'SUBMITTED' && (
              <button onClick={() => review(true)} disabled={saving}
                className="px-6 py-2 rounded-lg bg-green-600/80 text-white font-black text-sm disabled:opacity-40 hover:bg-green-600">
                Mark Reviewed (Branch Manager)
              </button>
            )}
            {rec.status === 'REVIEWED' && (
              <button onClick={() => review(false)} disabled={saving}
                className="px-4 py-2 rounded-lg border border-amber-500/40 text-amber-400 font-semibold text-sm disabled:opacity-40 hover:bg-amber-500/10">
                Un-review (unlock)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
