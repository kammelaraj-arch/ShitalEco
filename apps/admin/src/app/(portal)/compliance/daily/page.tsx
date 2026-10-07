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

// Visual indicator inside a check cell. Sizes are tuned for a tablet
// touch target (56×48px cell) — the glyph fills ~1/3 of it so it reads
// across the room on a kitchen countertop iPad.
function TriCheck({ value }: { value: CheckBool }) {
  if (value.na) return <span className="text-amber-400 text-sm font-black tracking-wide">N/A</span>
  if (value.value === true) return <span className="text-green-400 text-2xl font-black">✓</span>
  if (value.value === false) return <span className="text-red-400 text-2xl font-black">✗</span>
  return <span className="text-white/25 text-base">—</span>
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
  // Which tab is active. Tab-based (not scroll) layout keeps each §-section
  // on its own view so a kitchen volunteer isn't scrolling a tablet past
  // sections they don't need right now. `open` is a derived value fed into
  // the Panel component below so only the active tab renders its body.
  const [activeTab, setActiveTab] = useState<string>('oc')
  const open: Record<string, boolean> = { [activeTab]: true }

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

  // ── Quick-fill shortcuts ───────────────────────────────────────────────────
  // "Mark all green" — ticks every opening/closing/food-prep check as pass.
  // The happy-path day in a quiet temple kitchen has ~30 passes and 0 fails;
  // this takes submission from ~2 min of clicking to ~10 seconds. Overwrites
  // existing check states — the volunteer then edits the few that aren't
  // actually green. Does not touch dynamic lists (donations / temperatures /
  // allergens / issues), which are per-event by nature.
  const markAllGreen = () => {
    if (!rec || locked) return
    if ((Object.keys(rec.data.opening_closing.opening).length +
         Object.keys(rec.data.opening_closing.closing).length +
         Object.keys(rec.data.food_prep.checks).length) > 0) {
      if (!confirm('Overwrite existing check marks with Pass?')) return
    }
    const pass = (): CheckBool => ({ value: true, na: false, action: '' })
    const opening: Record<string, CheckBool> = {}
    const closing: Record<string, CheckBool> = {}
    for (const c of OPENING_CLOSING_CHECKS) { opening[c.key] = pass(); closing[c.key] = pass() }
    const foodChecks: Record<string, CheckBool> = {}
    for (const c of FOOD_PREP_CHECKS) { foodChecks[c.key] = pass() }
    setData({
      opening_closing: { ...rec.data.opening_closing, opening, closing },
      food_prep:       { ...rec.data.food_prep, checks: foodChecks },
    })
    setFlash('All checks marked Pass — review and submit')
    setTimeout(() => setFlash(''), 2500)
  }

  // "Copy from yesterday" — pulls yesterday's record and copies ONLY the
  // static check patterns (opening/closing/food-prep). Dynamic rows
  // (donations/temperatures/allergens/issues) are deliberately NOT copied —
  // those are events specific to that day and copying them would file
  // yesterday's incidents as today's. If yesterday's record doesn't exist,
  // say so and do nothing.
  const copyFromYesterday = async () => {
    if (!rec || locked) return
    const yesterday = new Date(recordDate + 'T00:00:00Z')
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const ydISO = yesterday.toISOString().slice(0, 10)
    try {
      const prev = await apiFetch<DailyRecord>(`/compliance/daily?branch_id=${branch}&record_date=${ydISO}`)
      if (!prev.id) { setError(`No record found for ${ydISO} — nothing to copy.`); return }
      setData({
        opening_closing: {
          ...rec.data.opening_closing,
          opening: prev.data.opening_closing?.opening || {},
          closing: prev.data.opening_closing?.closing || {},
        },
        food_prep: {
          ...rec.data.food_prep,
          checks: prev.data.food_prep?.checks || {},
        },
      })
      setFlash(`Copied check marks from ${ydISO} — review and submit`)
      setTimeout(() => setFlash(''), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not fetch yesterday\'s record')
    }
  }

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
  // Panel renders a section's header + body. In tab mode (what this page
  // uses) `open` is derived from `activeTab`, so a Panel renders its body
  // only when its tab is active. The header no longer toggles — the tab
  // bar above handles navigation.
  const Panel = useMemo(() => function Panel({
    id, title, children, flag,
  }: { id: string; title: string; children: React.ReactNode; flag?: string }) {
    const isOpen = !!open[id]
    if (!isOpen) return null
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="w-full flex items-center justify-between px-5 py-4 border-b border-white/10 bg-white/[0.03]">
          <span className="flex items-center gap-3">
            <span className="text-white font-bold text-base">{title}</span>
            {flag && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">{flag}</span>}
          </span>
        </div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="px-5 pb-5 pt-4">{children}</div>
        </motion.div>
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

      {/* Quick-fill shortcuts — only shown while editable. Hidden once the
          record is submitted/reviewed to avoid an "overwrite" button on a
          locked form. */}
      {rec && !locked && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white/40 text-xs uppercase tracking-wider font-bold mr-1">Shortcuts</span>
          <button type="button" onClick={markAllGreen}
            className="px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 border border-green-500/30 text-xs font-bold hover:bg-green-500/25 transition">
            ✓ Mark all green
          </button>
          <button type="button" onClick={copyFromYesterday}
            className="px-3 py-1.5 rounded-lg bg-white/5 text-white/70 border border-white/15 text-xs font-bold hover:bg-white/10 transition">
            📋 Copy from yesterday
          </button>
          <span className="text-white/30 text-[11px] ml-1">
            Then edit any exceptions (e.g. a fridge failure) and submit.
          </span>
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

          {/* Tab bar — tablet-friendly navigation between the six MASTER 05A
              sections. Each tab shows the section number, a short label and
              a status chip summarising its content. On a tablet (640px+)
              all six tabs fit on one row; on a phone they wrap. Minimum
              touch target 44px so a wet-handed volunteer doesn't miss. */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-2 flex flex-wrap gap-1.5">
            {([
              { id: 'oc',   label: 'Opening/Closing', num: '§1',
                summary: (() => {
                  const passed = OPENING_CLOSING_CHECKS.filter(c => rec.data.opening_closing.opening[c.key]?.value === true).length
                                 + OPENING_CLOSING_CHECKS.filter(c => rec.data.opening_closing.closing[c.key]?.value === true).length
                  return `${passed} / ${OPENING_CLOSING_CHECKS.length * 2}`
                })(),
                alert: OPENING_CLOSING_CHECKS.some(c =>
                  rec.data.opening_closing.opening[c.key]?.value === false ||
                  rec.data.opening_closing.closing[c.key]?.value === false),
              },
              { id: 'fp',   label: 'Food Prep',       num: '§2',
                summary: `${FOOD_PREP_CHECKS.filter(c => rec.data.food_prep.checks[c.key]?.value === true).length} / ${FOOD_PREP_CHECKS.length}`,
                alert: FOOD_PREP_CHECKS.some(c => rec.data.food_prep.checks[c.key]?.value === false),
              },
              { id: 'don',  label: 'Donations',       num: '§3',
                summary: rec.data.donations.length ? `${rec.data.donations.length}` : '—',
                alert: false },
              { id: 'temp', label: 'Temperatures',    num: '§4',
                summary: rec.data.temperatures.length ? `${rec.data.temperatures.length}` : '—',
                alert: rec.data.temperatures.some(t => !t.passed) },
              { id: 'alg',  label: 'Allergens',       num: '§5',
                summary: rec.data.allergens.length ? `${rec.data.allergens.length}` : '—',
                alert: false },
              { id: 'iss',  label: 'Issues',          num: '§6',
                summary: rec.data.issues.length ? `${rec.data.issues.length}` : '—',
                alert: rec.data.issues.length > 0 },
            ] as const).map(t => {
              const active = activeTab === t.id
              return (
                <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
                  className={`flex-1 min-w-[120px] min-h-[52px] px-3 py-2 rounded-xl transition flex flex-col items-center justify-center gap-0.5 border ${
                    active
                      ? 'bg-saffron-500/20 border-saffron-400/50 text-white'
                      : 'bg-white/[0.03] border-white/10 text-white/60 hover:bg-white/5 hover:text-white/90'
                  }`}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black opacity-70">{t.num}</span>
                    <span className="text-sm font-bold">{t.label}</span>
                    {t.alert && <span className="w-1.5 h-1.5 rounded-full bg-red-400" />}
                  </div>
                  <div className={`text-[11px] font-semibold ${active ? 'text-saffron-300' : 'text-white/40'}`}>{t.summary}</div>
                </button>
              )
            })}
          </div>

          <fieldset disabled={locked} className={locked ? 'opacity-70' : ''}>
            {/* §1 Opening & Closing */}
            <Panel id="oc" title="§1  Opening &amp; Closing Checklist">
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-white/40 text-[11px] uppercase tracking-wider">
                      <th className="text-left py-3 pr-3 font-bold">Check</th>
                      <th className="py-3 px-3 font-bold w-24 text-center">Opening</th>
                      <th className="py-3 px-3 font-bold w-24 text-center">Closing</th>
                      <th className="text-left py-3 pl-3 font-bold">Action / initials</th>
                    </tr>
                  </thead>
                  <tbody>
                    {OPENING_CLOSING_CHECKS.map(c => {
                      const o = rec.data.opening_closing.opening[c.key] || {}
                      const cl = rec.data.opening_closing.closing[c.key] || {}
                      return (
                        <tr key={c.key} className="border-b border-white/5 hover:bg-white/[0.02]">
                          <td className="py-3 pr-3 text-white/85 text-sm leading-snug">{c.label}</td>
                          <td className="py-3 px-3 text-center">
                            <button type="button" onClick={() => setCheckCell('opening', c.key, cycleCheck(o))}
                              className="w-14 h-12 rounded-lg border border-white/15 hover:border-saffron-400/50 hover:bg-white/5 transition active:scale-95">
                              <TriCheck value={o} />
                            </button>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <button type="button" onClick={() => setCheckCell('closing', c.key, cycleCheck(cl))}
                              className="w-14 h-12 rounded-lg border border-white/15 hover:border-saffron-400/50 hover:bg-white/5 transition active:scale-95">
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
                    <div key={c.key} className="grid grid-cols-[1fr_auto_1.4fr] gap-4 items-center border-b border-white/5 py-2.5">
                      <span className="text-white/80 text-sm">{c.label}</span>
                      <button type="button" onClick={() => setFoodCheck(c.key, cycleCheck(v))}
                        className="w-14 h-12 rounded-lg border border-white/15 hover:border-saffron-400/50 hover:bg-white/5 transition active:scale-95">
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

            {/* §3 Donations — card-per-event list, "+ Add" at top so a
                volunteer with ten donations already logged doesn't scroll
                past them to add the eleventh. Each card = a two-row grid:
                top row for who/what/time, bottom row for condition + decision
                + initials + remove. Field labels tucked above each input
                because at ~90px tall per card the hint text pays off. */}
            <Panel id="don" title="§3  Donation / Delivery Receiving Record" flag={rec.data.donations.length > 0 ? `${rec.data.donations.length}` : undefined}>
              <button type="button"
                onClick={() => setData({ donations: [{ time: '', donor_or_supplier: '', food_quantity: '', date_or_batch: '', condition_ok: false, accepted: true, initials: myInitials, reject_action: '' }, ...rec.data.donations] })}
                className="w-full py-3 rounded-xl bg-saffron-500/15 text-saffron-400 border border-dashed border-saffron-500/40 text-sm font-bold hover:bg-saffron-500/25 transition mb-3 min-h-[48px]">
                + Add Donation
              </button>
              {rec.data.donations.length === 0 ? (
                <p className="text-white/40 text-sm text-center py-8">No donations recorded yet today.</p>
              ) : (
                <div className="space-y-3">
                  {rec.data.donations.map((d, i) => (
                    <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-white/20 transition">
                      <div className="grid grid-cols-[80px_1fr_1fr] gap-3 mb-3">
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Time</label>
                          <input placeholder="08:15" value={d.time} onChange={e => setData({ donations: rec.data.donations.map((x, j) => j === i ? { ...x, time: e.target.value } : x) })} className={INP} />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Donor / Supplier</label>
                          <input placeholder="Anonymous donor, or Ambika Sweets" value={d.donor_or_supplier} onChange={e => setData({ donations: rec.data.donations.map((x, j) => j === i ? { ...x, donor_or_supplier: e.target.value } : x) })} className={INP} />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Food / Quantity</label>
                          <input placeholder="12 bananas · 2 kg" value={d.food_quantity} onChange={e => setData({ donations: rec.data.donations.map((x, j) => j === i ? { ...x, food_quantity: e.target.value } : x) })} className={INP} />
                        </div>
                      </div>
                      <div className="grid grid-cols-[1fr_80px_110px_70px_40px] gap-3 items-end">
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Date / Batch</label>
                          <input placeholder="BB 09/10/26" value={d.date_or_batch} onChange={e => setData({ donations: rec.data.donations.map((x, j) => j === i ? { ...x, date_or_batch: e.target.value } : x) })} className={INP} />
                        </div>
                        <label className={`flex items-center justify-center gap-2 min-h-[42px] rounded-lg border transition cursor-pointer ${d.condition_ok ? 'bg-green-500/10 border-green-500/40 text-green-400' : 'bg-white/5 border-white/10 text-white/50'}`}>
                          <input type="checkbox" checked={d.condition_ok} onChange={e => setData({ donations: rec.data.donations.map((x, j) => j === i ? { ...x, condition_ok: e.target.checked } : x) })} className="accent-green-500" />
                          <span className="text-xs font-bold">Cond. OK</span>
                        </label>
                        <select value={d.accepted ? 'accept' : 'reject'} onChange={e => setData({ donations: rec.data.donations.map((x, j) => j === i ? { ...x, accepted: e.target.value === 'accept' } : x) })} className={INP + (d.accepted ? '' : ' text-red-400')}>
                          <option value="accept">✓ Accept</option>
                          <option value="reject">✗ Reject</option>
                        </select>
                        <input placeholder="Init" value={d.initials} onChange={e => setData({ donations: rec.data.donations.map((x, j) => j === i ? { ...x, initials: e.target.value } : x) })} className={INP + ' text-center font-bold'} />
                        <button type="button" onClick={() => setData({ donations: rec.data.donations.filter((_, j) => j !== i) })}
                          className="min-h-[42px] rounded-lg text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition text-lg">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* §4 Temperatures */}
            {/* §4 Temperatures — card-per-reading. Pass/Fail is a prominent
                coloured chip, not a buried select, since temp failures are
                the most consequential finding on this form (food safety). */}
            <Panel id="temp" title="§4  Temperature &amp; Cooking Record" flag={rec.data.temperatures.length > 0 ? `${rec.data.temperatures.length}` : undefined}>
              <button type="button"
                onClick={() => setData({ temperatures: [{ time: '', food_batch: '', stage: '', target: '', actual: '', passed: true, initials: myInitials, corrective_action: '' }, ...rec.data.temperatures] })}
                className="w-full py-3 rounded-xl bg-saffron-500/15 text-saffron-400 border border-dashed border-saffron-500/40 text-sm font-bold hover:bg-saffron-500/25 transition mb-3 min-h-[48px]">
                + Add Temperature Reading
              </button>
              {rec.data.temperatures.length === 0 ? (
                <p className="text-white/40 text-sm text-center py-8">No temperature readings recorded yet today.</p>
              ) : (
                <div className="space-y-3">
                  {rec.data.temperatures.map((t, i) => (
                    <div key={i} className={`rounded-xl border p-4 hover:border-white/20 transition ${t.passed ? 'border-white/10 bg-white/[0.03]' : 'border-red-500/40 bg-red-500/[0.05]'}`}>
                      <div className="grid grid-cols-[80px_1fr_140px] gap-3 mb-3">
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Time</label>
                          <input placeholder="11:20" value={t.time} onChange={e => setData({ temperatures: rec.data.temperatures.map((x, j) => j === i ? { ...x, time: e.target.value } : x) })} className={INP} />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Food / Batch</label>
                          <input placeholder="Khichdi batch A" value={t.food_batch} onChange={e => setData({ temperatures: rec.data.temperatures.map((x, j) => j === i ? { ...x, food_batch: e.target.value } : x) })} className={INP} />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Stage</label>
                          <select value={t.stage} onChange={e => setData({ temperatures: rec.data.temperatures.map((x, j) => j === i ? { ...x, stage: e.target.value } : x) })} className={INP}>
                            <option value="">Choose…</option>
                            {TEMP_STAGES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-[100px_100px_1fr_70px_40px] gap-3 items-end">
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Target</label>
                          <input placeholder="≥75°C" value={t.target} onChange={e => setData({ temperatures: rec.data.temperatures.map((x, j) => j === i ? { ...x, target: e.target.value } : x) })} className={INP} />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Actual</label>
                          <input placeholder="82°C" value={t.actual} onChange={e => setData({ temperatures: rec.data.temperatures.map((x, j) => j === i ? { ...x, actual: e.target.value } : x) })} className={INP + (t.passed ? '' : ' text-red-400 font-bold')} />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Result</label>
                          <button type="button"
                            onClick={() => setData({ temperatures: rec.data.temperatures.map((x, j) => j === i ? { ...x, passed: !x.passed } : x) })}
                            className={`w-full min-h-[42px] rounded-lg border font-bold text-sm transition ${t.passed ? 'bg-green-500/15 text-green-400 border-green-500/40 hover:bg-green-500/25' : 'bg-red-500/15 text-red-400 border-red-500/40 hover:bg-red-500/25'}`}>
                            {t.passed ? '✓ Pass' : '✗ Fail'}
                          </button>
                        </div>
                        <input placeholder="Init" value={t.initials} onChange={e => setData({ temperatures: rec.data.temperatures.map((x, j) => j === i ? { ...x, initials: e.target.value } : x) })} className={INP + ' text-center font-bold'} />
                        <button type="button" onClick={() => setData({ temperatures: rec.data.temperatures.filter((_, j) => j !== i) })}
                          className="min-h-[42px] rounded-lg text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition text-lg">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* §5 Allergens */}
            <Panel id="alg" title="§5  Allergen &amp; Serving Check" flag={rec.data.allergens.length > 0 ? `${rec.data.allergens.length}` : undefined}>
              <button type="button"
                onClick={() => setData({ allergens: [{ food_or_prasad: '', known_allergen: '', separate_utensil: false, info_given: false, initials: myInitials }, ...rec.data.allergens] })}
                className="w-full py-3 rounded-xl bg-saffron-500/15 text-saffron-400 border border-dashed border-saffron-500/40 text-sm font-bold hover:bg-saffron-500/25 transition mb-3 min-h-[48px]">
                + Add Allergen Entry
              </button>
              {rec.data.allergens.length === 0 ? (
                <p className="text-white/40 text-sm text-center py-8">No allergen checks logged yet today.</p>
              ) : (
                <div className="space-y-3">
                  {rec.data.allergens.map((a, i) => (
                    <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-white/20 transition">
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Food / Prasad</label>
                          <input placeholder="Barfi (gift from devotee)" value={a.food_or_prasad} onChange={e => setData({ allergens: rec.data.allergens.map((x, j) => j === i ? { ...x, food_or_prasad: e.target.value } : x) })} className={INP} />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Known Allergen</label>
                          <input placeholder="Peanuts, milk" value={a.known_allergen} onChange={e => setData({ allergens: rec.data.allergens.map((x, j) => j === i ? { ...x, known_allergen: e.target.value } : x) })} className={INP} />
                        </div>
                      </div>
                      <div className="grid grid-cols-[1fr_1fr_80px_40px] gap-3 items-end">
                        <label className={`flex items-center justify-center gap-2 min-h-[42px] rounded-lg border transition cursor-pointer ${a.separate_utensil ? 'bg-green-500/10 border-green-500/40 text-green-400' : 'bg-white/5 border-white/10 text-white/50'}`}>
                          <input type="checkbox" checked={a.separate_utensil} onChange={e => setData({ allergens: rec.data.allergens.map((x, j) => j === i ? { ...x, separate_utensil: e.target.checked } : x) })} className="accent-green-500" />
                          <span className="text-xs font-bold">Separate utensil</span>
                        </label>
                        <label className={`flex items-center justify-center gap-2 min-h-[42px] rounded-lg border transition cursor-pointer ${a.info_given ? 'bg-green-500/10 border-green-500/40 text-green-400' : 'bg-white/5 border-white/10 text-white/50'}`}>
                          <input type="checkbox" checked={a.info_given} onChange={e => setData({ allergens: rec.data.allergens.map((x, j) => j === i ? { ...x, info_given: e.target.checked } : x) })} className="accent-green-500" />
                          <span className="text-xs font-bold">Info given</span>
                        </label>
                        <input placeholder="Init" value={a.initials} onChange={e => setData({ allergens: rec.data.allergens.map((x, j) => j === i ? { ...x, initials: e.target.value } : x) })} className={INP + ' text-center font-bold'} />
                        <button type="button" onClick={() => setData({ allergens: rec.data.allergens.filter((_, j) => j !== i) })}
                          className="min-h-[42px] rounded-lg text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition text-lg">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* §6 Issues — card-per-issue list. Each issue card is bordered
                red to make it obvious a day's compliance record has any
                exceptions at all when a reviewer opens the tab. */}
            <Panel id="iss" title="§6  Daily Issue Record" flag={rec.data.issues.length > 0 ? `${rec.data.issues.length} issue(s)` : undefined}>
              <button type="button"
                onClick={() => setData({ issues: [{ time: '', issue: '', immediate_action: '', reported_to: '', initials: myInitials }, ...rec.data.issues] })}
                className="w-full py-3 rounded-xl bg-saffron-500/15 text-saffron-400 border border-dashed border-saffron-500/40 text-sm font-bold hover:bg-saffron-500/25 transition mb-3 min-h-[48px]">
                + Add Issue
              </button>
              {rec.data.issues.length === 0 ? (
                <p className="text-white/40 text-sm text-center py-8">No issues reported today. ✓</p>
              ) : (
                <div className="space-y-3">
                  {rec.data.issues.map((it, i) => (
                    <div key={i} className="rounded-xl border border-red-500/30 bg-red-500/[0.04] p-4 hover:border-red-500/50 transition">
                      <div className="grid grid-cols-[80px_1fr] gap-3 mb-3">
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Time</label>
                          <input placeholder="08:40" value={it.time} onChange={e => setData({ issues: rec.data.issues.map((x, j) => j === i ? { ...x, time: e.target.value } : x) })} className={INP} />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Issue / Failed Check</label>
                          <input placeholder="Fridge-2 reading 7°C (above 5°C limit)" value={it.issue} onChange={e => setData({ issues: rec.data.issues.map((x, j) => j === i ? { ...x, issue: e.target.value } : x) })} className={INP} />
                        </div>
                      </div>
                      <div className="mb-3">
                        <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Immediate Action Taken</label>
                        <input placeholder="Moved stock to fridge-1, called engineer, isolated unit" value={it.immediate_action} onChange={e => setData({ issues: rec.data.issues.map((x, j) => j === i ? { ...x, immediate_action: e.target.value } : x) })} className={INP} />
                      </div>
                      <div className="grid grid-cols-[1fr_90px_40px] gap-3 items-end">
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Reported To</label>
                          <input placeholder="Branch Mgr (K.Mehta)" value={it.reported_to} onChange={e => setData({ issues: rec.data.issues.map((x, j) => j === i ? { ...x, reported_to: e.target.value } : x) })} className={INP} />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1">Initials</label>
                          <input placeholder="Init" value={it.initials} onChange={e => setData({ issues: rec.data.issues.map((x, j) => j === i ? { ...x, initials: e.target.value } : x) })} className={INP + ' text-center font-bold'} />
                        </div>
                        <button type="button" onClick={() => setData({ issues: rec.data.issues.filter((_, j) => j !== i) })}
                          className="min-h-[42px] rounded-lg text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition text-lg">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
