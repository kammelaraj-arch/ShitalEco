import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'
import { api, type VolunteerRegistrationPayload } from '../api'
import { AddressLookup } from '../components/AddressLookup'

const TITLES = ['', 'Dr', 'Mr', 'Mrs', 'Ms', 'Master', 'Other']
const AGE_RANGES = ['18-25', '26-35', '36-45', '46-55', '55+']

const inp = 'w-full px-4 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 focus:border-saffron-400/50 outline-none text-ivory-100 placeholder-white/30'
const lbl = 'block text-xs font-bold uppercase tracking-widest mb-1.5'

interface Form {
  title: string
  first_names: string
  last_name: string
  address: string
  postcode: string
  uprn: string
  mobile: string
  phone: string
  email: string
  age_range: string

  ec_title: string
  ec_full_name: string
  ec_email: string
  ec_mobile: string
  ec_phone: string
  ec_address: string
  ec_postcode: string
  ec_uprn: string

  has_health_restrictions: boolean
  health_notes: string

  has_criminal_record: boolean
  criminal_record_details: string

  ref1_title: string; ref1_first_names: string; ref1_last_name: string
  ref1_address: string; ref1_postcode: string; ref1_uprn: string
  ref1_mobile: string; ref1_phone: string; ref1_email: string
  ref2_title: string; ref2_first_names: string; ref2_last_name: string
  ref2_address: string; ref2_postcode: string; ref2_uprn: string
  ref2_mobile: string; ref2_phone: string; ref2_email: string

  skills: Record<string, string[]>
  skills_other_text: string
  // New shape: { days: string[], times: string[], notes: string }. Stored
  // as a JSONB blob server-side; admin renders both this and the legacy
  // {day: {slot: time}} shape for backwards compatibility with old rows.
  availability: { days: string[]; times: string[]; notes: string }
  availability_pattern: string

  declaration_agreed: boolean
  confidentiality_agreed: boolean
  marketing_consent: boolean

  preferred_branches: string[]
}

const EMPTY: Form = {
  title: '', first_names: '', last_name: '',
  address: '', postcode: '', uprn: '', mobile: '', phone: '', email: '', age_range: '',
  ec_title: '', ec_full_name: '', ec_email: '', ec_mobile: '', ec_phone: '',
  ec_address: '', ec_postcode: '', ec_uprn: '',
  has_health_restrictions: false, health_notes: '',
  has_criminal_record: false, criminal_record_details: '',
  ref1_title: '', ref1_first_names: '', ref1_last_name: '',
  ref1_address: '', ref1_postcode: '', ref1_uprn: '',
  ref1_mobile: '', ref1_phone: '', ref1_email: '',
  ref2_title: '', ref2_first_names: '', ref2_last_name: '',
  ref2_address: '', ref2_postcode: '', ref2_uprn: '',
  ref2_mobile: '', ref2_phone: '', ref2_email: '',
  skills: {}, skills_other_text: '',
  availability: { days: [], times: [], notes: '' }, availability_pattern: '',
  declaration_agreed: false, confidentiality_agreed: false, marketing_consent: false,
  preferred_branches: [],
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="temple-card p-5 mb-5">
      <h2 className="font-display font-bold text-base text-gold-400 mb-4">{title}</h2>
      {children}
    </div>
  )
}

// Each wizard step. `validate` returns an array of human-readable errors
// for the fields shown on this step — empty array means "you may proceed".
const WIZARD_STEPS: Array<{ key: string; title: string }> = [
  { key: 'about',      title: 'About you'           },
  { key: 'where',      title: 'Where to help'       },
  { key: 'background', title: 'Health & background' },
  { key: 'references', title: 'References'          },
  { key: 'review',     title: 'Review & submit'     },
]

function validateStep(stepIdx: number, f: Form): string[] {
  const errs: string[] = []
  if (stepIdx === 0) {
    if (!f.first_names.trim()) errs.push('First name is required')
    if (!f.last_name.trim())   errs.push('Last name is required')
    if (!f.email.trim() || !f.email.includes('@')) errs.push('A valid email is required')
    if (!f.address.trim() || !f.postcode.trim()) errs.push('Address is required')
    if (!f.mobile.trim() && !f.phone.trim()) errs.push('At least one contact number is required')
    if (!f.age_range) errs.push('Age range is required (minimum 18)')
  }
  if (stepIdx === 1) {
    if (f.preferred_branches.length === 0) errs.push("Pick at least one branch (or remote)")
    if (!f.ec_full_name.trim()) errs.push('Emergency contact name is required')
    if (!f.ec_mobile.trim() && !f.ec_phone.trim()) errs.push('Emergency contact phone is required')
  }
  if (stepIdx === 2) {
    if (f.has_health_restrictions && !f.health_notes.trim())
      errs.push('Please describe how we can help with your health restrictions')
    if (f.has_criminal_record && !f.criminal_record_details.trim())
      errs.push('Please provide the requested criminal-record details')
  }
  if (stepIdx === 3) {
    if (!f.ref1_first_names.trim() || !f.ref1_last_name.trim()) errs.push('Referee 1 name is required')
    if (!f.ref1_email.trim() && !f.ref1_mobile.trim() && !f.ref1_phone.trim())
      errs.push('Referee 1 contact (email or phone) is required')
    if (!f.ref2_first_names.trim() || !f.ref2_last_name.trim()) errs.push('Referee 2 name is required')
    if (!f.ref2_email.trim() && !f.ref2_mobile.trim() && !f.ref2_phone.trim())
      errs.push('Referee 2 contact (email or phone) is required')
  }
  if (stepIdx === 4) {
    if (!f.declaration_agreed) errs.push('You must agree to the volunteer activity declaration')
    if (!f.confidentiality_agreed) errs.push('You must agree to the confidentiality undertaking')
  }
  return errs
}

const DRAFT_STORAGE_KEY = 'volunteer-draft-v1'

// Fetch admin-overridable form text. Falls back silently to the defaults
// passed at each call-site if the API is slow / errors / hasn't been
// reached yet — the form is fully usable on first paint either way.
function useFormText(formKey: string): (key: string, fallback: string) => string {
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  useEffect(() => {
    api.getFormConfig(formKey).then(d => setOverrides(d.fields || {})).catch(() => {})
  }, [formKey])
  return (key, fallback) => overrides[key] ?? fallback
}

export function VolunteerRegistrationPage() {
  const setScreen = useStore(s => s.setScreen)
  const branchId = useStore(s => s.branchId)
  const t = useFormText('volunteer_registration')
  const [form, setForm] = useState<Form>(EMPTY)
  const [step, setStep] = useState<'fill' | 'done'>('fill')
  const [wizardStep, setWizardStep] = useState(0)
  const [stepErrors, setStepErrors] = useState<string[]>([])
  const [hasDraft, setHasDraft] = useState(false)
  const [draftToken, setDraftToken] = useState('')
  const [draftSyncedAt, setDraftSyncedAt] = useState<string>('')
  const [emailLinkBusy, setEmailLinkBusy] = useState(false)
  const [emailLinkMsg, setEmailLinkMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [reference, setReference] = useState('')

  // Restore draft on mount. URL hash `#draft=<token>` wins — that's how
  // resume-on-another-device works. Otherwise fall back to localStorage.
  useEffect(() => {
    let cancelled = false
    async function restore() {
      // 1) Try URL hash token (cross-device resume)
      const m = /[#&]draft=([A-Za-z0-9_-]+)/.exec(window.location.hash || '')
      const hashToken = m?.[1]
      if (hashToken) {
        try {
          const d = await api.getVolunteerDraft(hashToken)
          if (cancelled) return
          if (d.payload && typeof d.payload === 'object') {
            const p = d.payload as Partial<Form> & { __wizardStep?: number }
            setForm({ ...EMPTY, ...p })
            if (typeof p.__wizardStep === 'number') setWizardStep(p.__wizardStep)
            setDraftToken(d.token)
            setHasDraft(true)
            setDraftSyncedAt(d.updated_at || '')
            return
          }
        } catch {
          // Token expired or wrong — fall through to localStorage.
        }
      }
      // 2) Fall back to localStorage (same-device resume)
      try {
        const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw) as { form?: Form; wizardStep?: number; token?: string; savedAt?: string }
        if (parsed.form && typeof parsed.form === 'object') {
          setForm({ ...EMPTY, ...parsed.form })
          if (typeof parsed.wizardStep === 'number') setWizardStep(parsed.wizardStep)
          if (parsed.token) setDraftToken(parsed.token)
          setHasDraft(true)
        }
      } catch {
        // Corrupt draft — ignore.
      }
    }
    restore()
    return () => { cancelled = true }
  }, [])

  // localStorage auto-save (synchronous, every change). Covers tab-close /
  // crash recovery on the same device — lossless.
  useEffect(() => {
    if (step !== 'fill') return
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
        form, wizardStep, token: draftToken, savedAt: new Date().toISOString(),
      }))
    } catch { /* quota / private-mode — fine to skip */ }
  }, [form, wizardStep, step, draftToken])

  // Server-side draft sync (debounced 1.5s). Lets the applicant resume
  // on another device by sharing the URL hash. Quietly no-ops on errors —
  // localStorage is still the primary source of truth for resume.
  useEffect(() => {
    if (step !== 'fill') return
    const tid = setTimeout(async () => {
      try {
        const d = await api.saveVolunteerDraft({
          token: draftToken || undefined,
          payload: { ...form, __wizardStep: wizardStep },
          email: form.email,
          branchId,
        })
        setDraftToken(prev => prev || d.token)
        setDraftSyncedAt(new Date().toISOString())
        if (!draftToken && d.token) {
          // First save → put the token in the URL so a copied link resumes
          window.history.replaceState(null, '', `#draft=${d.token}`)
        }
      } catch { /* ignore — server may be down */ }
    }, 1500)
    return () => clearTimeout(tid)
  }, [form, wizardStep, step, draftToken, branchId])

  async function discardDraft() {
    try { localStorage.removeItem(DRAFT_STORAGE_KEY) } catch { /* ignore */ }
    if (draftToken) {
      try { await api.deleteVolunteerDraft(draftToken) } catch { /* ignore */ }
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setForm(EMPTY); setWizardStep(0); setHasDraft(false); setStepErrors([])
    setDraftToken(''); setDraftSyncedAt('')
  }

  // Active branches (for the "where would you like to volunteer?" picker).
  // Quietly empty if the API is down — the Remote-only option still works.
  const [branches, setBranches] = useState<Array<{ branch_id: string; name: string; city: string }>>([])
  useEffect(() => {
    api.getBranches()
      .then(list => setBranches(list.filter(b => b.is_active)))
      .catch(() => setBranches([]))
  }, [])

  const update = <K extends keyof Form>(k: K, v: Form[K]) => setForm(p => ({ ...p, [k]: v }))

  function togglePreferredBranch(code: string) {
    setForm(p => {
      const has = p.preferred_branches.includes(code)
      return {
        ...p,
        preferred_branches: has
          ? p.preferred_branches.filter(c => c !== code)
          : [...p.preferred_branches, code],
      }
    })
  }

  async function emailMyLink() {
    setEmailLinkMsg(null)
    if (!draftToken) {
      setEmailLinkMsg({ text: "Save in progress — please try again in a moment.", ok: false })
      return
    }
    const target = form.email.trim()
    if (!target || !target.includes('@')) {
      setEmailLinkMsg({ text: 'Enter your email on Step 1 first, then come back.', ok: false })
      return
    }
    setEmailLinkBusy(true)
    try {
      await api.emailVolunteerDraftLink({ token: draftToken, email: target })
      setEmailLinkMsg({ text: `Sent to ${target}. Check your inbox (and spam folder).`, ok: true })
    } catch (e) {
      setEmailLinkMsg({
        text: e instanceof Error ? e.message : 'Email send failed',
        ok: false,
      })
    } finally {
      setEmailLinkBusy(false)
    }
  }

  function goNext() {
    const errs = validateStep(wizardStep, form)
    setStepErrors(errs)
    if (errs.length) {
      // Bring the errors into view
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setWizardStep(s => Math.min(s + 1, WIZARD_STEPS.length - 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function goPrev() {
    setStepErrors([])
    setWizardStep(s => Math.max(s - 1, 0))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submit() {
    // Re-validate the final step (declarations) before sending — defends
    // against state changes that bypass goNext().
    const errs = validateStep(WIZARD_STEPS.length - 1, form)
    if (errs.length) { setStepErrors(errs); return }

    setError(''); setStepErrors([])
    setSubmitting(true)
    try {
      const payload: VolunteerRegistrationPayload = { ...form, branch_id: branchId }
      const res = await api.registerVolunteer(payload)
      setReference(res.reference_number)
      setStep('done')
      // Submission successful — wipe BOTH the local + server draft so a
      // refresh doesn't resurrect it for the next applicant on a shared
      // device, and the resume URL stops working.
      try { localStorage.removeItem(DRAFT_STORAGE_KEY) } catch { /* ignore */ }
      if (draftToken) {
        try { await api.deleteVolunteerDraft(draftToken) } catch { /* ignore */ }
      }
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 'done') {
    return (
      <div className="max-w-xl mx-auto px-4 py-10 pb-24 text-center">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="text-5xl mb-4">🙏</div>
          <h1 className="font-display font-bold text-2xl text-gold-400 mb-3">{t('done.title', 'Application Received')}</h1>
          <p className="text-sm text-ivory-200 mb-5">{t('done.thanks', 'Thank you for offering to volunteer with SHITAL.')}</p>
          <div className="temple-card p-4 mb-5 text-left">
            <p className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: 'rgba(212,175,55,0.6)' }}>{t('done.reference_label', 'Your reference')}</p>
            <p className="font-mono font-bold text-base text-gold-400 break-all">{reference}</p>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,248,220,0.6)' }}>
            {t('done.next_steps', 'A trustee will review your application and contact you by email. References will be taken before a role is confirmed. Please quote the reference above in any correspondence.')}
          </p>
          <button onClick={() => setScreen('browse')}
            className="mt-6 px-6 py-3 rounded-2xl font-black text-sm"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
            {t('done.back_button', 'Back to Home')}
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-32">
      <button onClick={() => setScreen('browse')} className="flex items-center gap-2 text-sm font-medium mb-5"
        style={{ color: 'rgba(255,248,220,0.4)' }}>← Back
      </button>

      <div className="text-center mb-5">
        <div className="text-4xl mb-2">🤝</div>
        <h1 className="font-display font-bold text-2xl text-gold-400 mb-1">{t('page.title', 'Volunteer Registration')}</h1>
        <p className="text-sm" style={{ color: 'rgba(255,248,220,0.5)' }}>
          {t('page.subtitle', 'Join the SHITAL volunteering family. Minimum age 18.')}
        </p>
      </div>

      {/* Step progress + label */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(212,175,55,0.65)' }}>
            Step {wizardStep + 1} of {WIZARD_STEPS.length} · {WIZARD_STEPS[wizardStep].title}
          </p>
          {hasDraft && wizardStep === 0 && (
            <button onClick={discardDraft}
              className="text-[11px] underline" style={{ color: 'rgba(255,248,220,0.4)' }}>
              Start over
            </button>
          )}
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${((wizardStep + 1) / WIZARD_STEPS.length) * 100}%`,
              background: 'linear-gradient(90deg,#D4AF37,#FFD980)',
            }} />
        </div>
      </div>

      {hasDraft && wizardStep === 0 && (
        <div className="rounded-xl px-4 py-3 mb-5 text-xs"
          style={{ background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', color: '#BFDBFE' }}>
          ↩ Picked up where you left off. Tap "Start over" to clear.
        </div>
      )}

      {stepErrors.length > 0 && (
        <div className="rounded-xl px-4 py-3 mb-5 text-sm"
          style={{ background: 'rgba(198,40,40,0.15)', color: '#fca5a5', border: '1px solid rgba(198,40,40,0.3)' }}>
          <p className="font-bold mb-1">Please check the following:</p>
          <ul className="list-disc list-inside space-y-0.5 text-xs">
            {stepErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* ── STEP 0 — About you ───────────────────────────────────────────── */}
      {wizardStep === 0 && (<>
      <Section title={t('section.personal.title', 'Personal Details')}>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Title</label>
            <select value={form.title} onChange={e => update('title', e.target.value)} className={inp}>
              {TITLES.map(t => <option key={t} value={t}>{t || '—'}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Age range *</label>
            <select value={form.age_range} onChange={e => update('age_range', e.target.value)} className={inp}>
              <option value="">— Select —</option>
              {AGE_RANGES.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>First names *</label>
            <input value={form.first_names} onChange={e => update('first_names', e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Last name *</label>
            <input value={form.last_name} onChange={e => update('last_name', e.target.value)} className={inp} />
          </div>
        </div>
        <div className="mb-3">
          <AddressLookup
            postcode={form.postcode} address={form.address} uprn={form.uprn}
            required postcodeLabel="Postcode" addressLabel="Your address"
            onChange={({ postcode, address, uprn }) =>
              setForm(p => ({ ...p, postcode, address, uprn }))
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="col-span-2">
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Email *</label>
            <input type="email" value={form.email} onChange={e => update('email', e.target.value)} className={inp} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Mobile *</label>
            <input value={form.mobile} onChange={e => update('mobile', e.target.value)} className={inp} placeholder="07xxx xxxxxx" />
          </div>
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Phone (optional)</label>
            <input value={form.phone} onChange={e => update('phone', e.target.value)} className={inp} />
          </div>
        </div>
      </Section>

      </>)}

      {/* ── STEP 1 — Where to help + Emergency Contact ───────────────────── */}
      {wizardStep === 1 && (<>
      <Section title={t('section.where.title', 'Where would you like to volunteer?')}>
        <p className="text-xs mb-3" style={{ color: 'rgba(255,248,220,0.5)' }}>
          {t('section.where.intro', 'Pick one or more branches you can travel to, or "Remote / Online" if you want to help from home.')}
        </p>
        <div className="flex flex-wrap gap-2">
          {branches.map(b => {
            const active = form.preferred_branches.includes(b.branch_id)
            return (
              <button key={b.branch_id} type="button"
                onClick={() => togglePreferredBranch(b.branch_id)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                style={{
                  background: active ? 'linear-gradient(135deg,rgba(212,175,55,0.3),rgba(212,175,55,0.15))' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${active ? '#D4AF37' : 'rgba(255,255,255,0.1)'}`,
                  color: active ? '#FFD980' : 'rgba(255,248,220,0.7)',
                }}>
                {b.name}{b.city ? <span className="opacity-60"> · {b.city}</span> : null}
              </button>
            )
          })}
          {(() => {
            const active = form.preferred_branches.includes('remote')
            return (
              <button type="button"
                onClick={() => togglePreferredBranch('remote')}
                className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                style={{
                  background: active ? 'linear-gradient(135deg,rgba(96,165,250,0.3),rgba(96,165,250,0.15))' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${active ? '#60A5FA' : 'rgba(255,255,255,0.1)'}`,
                  color: active ? '#BFDBFE' : 'rgba(255,248,220,0.7)',
                }}>
                🌐 Remote / Online
              </button>
            )
          })()}
        </div>
        {form.preferred_branches.length === 0 && (
          <p className="text-[11px] mt-2" style={{ color: 'rgba(255,248,220,0.4)' }}>
            {t('section.where.help', 'Tap at least one option.')}
          </p>
        )}
      </Section>

      {/* Emergency contact */}
      <Section title={t('section.emergency.title', 'Emergency Contact')}>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Title</label>
            <select value={form.ec_title} onChange={e => update('ec_title', e.target.value)} className={inp}>
              {TITLES.map(t => <option key={t} value={t}>{t || '—'}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Full name *</label>
            <input value={form.ec_full_name} onChange={e => update('ec_full_name', e.target.value)} className={inp} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Mobile *</label>
            <input value={form.ec_mobile} onChange={e => update('ec_mobile', e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Phone</label>
            <input value={form.ec_phone} onChange={e => update('ec_phone', e.target.value)} className={inp} />
          </div>
        </div>
        <div className="mb-3">
          <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Email</label>
          <input type="email" value={form.ec_email} onChange={e => update('ec_email', e.target.value)} className={inp} />
        </div>
        <AddressLookup
          postcode={form.ec_postcode} address={form.ec_address} uprn={form.ec_uprn}
          postcodeLabel="Their postcode" addressLabel="Their address"
          onChange={({ postcode, address, uprn }) =>
            setForm(p => ({ ...p, ec_postcode: postcode, ec_address: address, ec_uprn: uprn }))
          }
        />
      </Section>

      </>)}

      {/* ── STEP 2 — Health + Police-Check Declaration ──────────────────── */}
      {wizardStep === 2 && (<>
      <Section title={t('section.health.title', 'Health')}>
        <p className="text-xs mb-3" style={{ color: 'rgba(255,248,220,0.5)' }}>
          {t('section.health.question', 'Are there any restricting factors or medication that we should be aware of?')}
        </p>
        <label className="flex items-center gap-3 mb-3 cursor-pointer">
          <input type="checkbox" checked={form.has_health_restrictions}
            onChange={e => update('has_health_restrictions', e.target.checked)}
            className="w-4 h-4 rounded accent-saffron-400" />
          <span className="text-sm text-ivory-200">{t('section.health.checkbox_yes', 'Yes — I have a health condition or medication SHITAL should know about')}</span>
        </label>
        {form.has_health_restrictions && (
          <textarea value={form.health_notes} onChange={e => update('health_notes', e.target.value)} rows={3}
            className={inp + ' resize-none'} placeholder={t('section.health.help_placeholder', 'Please specify how we can help you')} />
        )}
      </Section>

      {/* Criminal-record declaration */}
      <Section title={t('section.police_check.title', 'Police-Check Declaration')}>
        <p className="text-xs leading-relaxed mb-3" style={{ color: 'rgba(255,248,220,0.55)' }}>
          {t('section.police_check.intro', 'The volunteering opportunities will involve direct contact with devotees. As such, applications to volunteer are exempt from the Rehabilitation of Offenders Act 1974 — you are required to declare your entire criminal record, including cautions, reprimands, final warnings and convictions categorised "spent" under that legislation. Information will be kept strictly confidential.')}
        </p>
        <label className="flex items-center gap-3 mb-3 cursor-pointer">
          <input type="checkbox" checked={form.has_criminal_record}
            onChange={e => update('has_criminal_record', e.target.checked)}
            className="w-4 h-4 rounded accent-saffron-400" />
          <span className="text-sm text-ivory-200">{t('section.police_check.checkbox_yes', 'Yes — I have been convicted at a Court or cautioned by the Police')}</span>
        </label>
        {form.has_criminal_record && (
          <textarea value={form.criminal_record_details} onChange={e => update('criminal_record_details', e.target.value)} rows={3}
            className={inp + ' resize-none'} placeholder={t('section.police_check.detail_placeholder', 'Please give details, including dates and nature of offences')} />
        )}
      </Section>

      </>)}

      {/* ── STEP 3 — References ─────────────────────────────────────────── */}
      {wizardStep === 3 && (<>
      <Section title={t('section.referee1.title', 'Character Referee 1')}>
        <p className="text-xs mb-3" style={{ color: 'rgba(255,248,220,0.5)' }}>
          {t('section.referee1.intro', 'Please give an independent referee (not a family member).')}
        </p>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Title</label>
            <select value={form.ref1_title} onChange={e => update('ref1_title', e.target.value)} className={inp}>
              {TITLES.map(t => <option key={t} value={t}>{t || '—'}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>First names *</label>
            <input value={form.ref1_first_names} onChange={e => update('ref1_first_names', e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Last name *</label>
            <input value={form.ref1_last_name} onChange={e => update('ref1_last_name', e.target.value)} className={inp} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Mobile</label>
            <input value={form.ref1_mobile} onChange={e => update('ref1_mobile', e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Email</label>
            <input type="email" value={form.ref1_email} onChange={e => update('ref1_email', e.target.value)} className={inp} />
          </div>
        </div>
        <AddressLookup
          postcode={form.ref1_postcode} address={form.ref1_address} uprn={form.ref1_uprn}
          postcodeLabel="Their postcode" addressLabel="Their address"
          onChange={({ postcode, address, uprn }) =>
            setForm(p => ({ ...p, ref1_postcode: postcode, ref1_address: address, ref1_uprn: uprn }))
          }
        />
      </Section>

      <Section title={t('section.referee2.title', 'Character Referee 2')}>
        <p className="text-xs mb-3" style={{ color: 'rgba(255,248,220,0.5)' }}>
          {t('section.referee2.intro', 'A second independent referee (not a family member).')}
        </p>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Title</label>
            <select value={form.ref2_title} onChange={e => update('ref2_title', e.target.value)} className={inp}>
              {TITLES.map(t => <option key={t} value={t}>{t || '—'}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>First names *</label>
            <input value={form.ref2_first_names} onChange={e => update('ref2_first_names', e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Last name *</label>
            <input value={form.ref2_last_name} onChange={e => update('ref2_last_name', e.target.value)} className={inp} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Mobile</label>
            <input value={form.ref2_mobile} onChange={e => update('ref2_mobile', e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Email</label>
            <input type="email" value={form.ref2_email} onChange={e => update('ref2_email', e.target.value)} className={inp} />
          </div>
        </div>
        <AddressLookup
          postcode={form.ref2_postcode} address={form.ref2_address} uprn={form.ref2_uprn}
          postcodeLabel="Their postcode" addressLabel="Their address"
          onChange={({ postcode, address, uprn }) =>
            setForm(p => ({ ...p, ref2_postcode: postcode, ref2_address: address, ref2_uprn: uprn }))
          }
        />
      </Section>

      </>)}

      {/* ── STEP 4 — Review & Submit (declarations) ─────────────────────── */}
      {wizardStep === 4 && (<>
      <Section title="Review">
        <p className="text-xs mb-3" style={{ color: 'rgba(255,248,220,0.5)' }}>
          Quick summary of what you've told us. Tap "Back" to change anything.
        </p>
        <div className="text-xs space-y-1.5" style={{ color: 'rgba(255,248,220,0.75)' }}>
          <p><span className="text-gold-400 font-semibold">Name:</span> {form.title} {form.first_names} {form.last_name}</p>
          <p><span className="text-gold-400 font-semibold">Email:</span> {form.email}</p>
          <p><span className="text-gold-400 font-semibold">Phone:</span> {form.mobile || form.phone || '—'}</p>
          <p><span className="text-gold-400 font-semibold">Address:</span> {form.address}, {form.postcode}</p>
          <p><span className="text-gold-400 font-semibold">Wants to volunteer at:</span> {
            form.preferred_branches.length
              ? form.preferred_branches.map(p => p === 'remote' ? '🌐 Remote' : p.charAt(0).toUpperCase() + p.slice(1)).join(', ')
              : '—'
          }</p>
          <p><span className="text-gold-400 font-semibold">References:</span> {[form.ref1_first_names && form.ref1_last_name, form.ref2_first_names && form.ref2_last_name].filter(Boolean).length} provided</p>
        </div>
      </Section>

      <Section title={t('section.declarations.title', 'Declarations')}>
        <label className="flex items-start gap-3 mb-4 cursor-pointer">
          <input type="checkbox" checked={form.declaration_agreed}
            onChange={e => update('declaration_agreed', e.target.checked)}
            className="w-4 h-4 rounded accent-saffron-400 mt-1 flex-shrink-0" />
          <span className="text-xs leading-relaxed" style={{ color: 'rgba(255,248,220,0.7)' }}>
            <strong className="text-ivory-100">{t('section.declarations.activity_label', 'Volunteer activity declaration')} *</strong> — {t('section.declarations.activity_text', "I am voluntarily participating in the activities of SHITAL's events with the knowledge of the danger involved and that medical facilities may not be immediately available in the event of injury. I confirm that neither I nor anyone on my behalf will demand or expect any remuneration in cash or in kind for my services and time volunteering for SHITAL.")}
          </span>
        </label>
        <label className="flex items-start gap-3 mb-4 cursor-pointer">
          <input type="checkbox" checked={form.confidentiality_agreed}
            onChange={e => update('confidentiality_agreed', e.target.checked)}
            className="w-4 h-4 rounded accent-saffron-400 mt-1 flex-shrink-0" />
          <span className="text-xs leading-relaxed" style={{ color: 'rgba(255,248,220,0.7)' }}>
            <strong className="text-ivory-100">{t('section.declarations.confidentiality_label', 'Confidentiality undertaking')} *</strong> — {t('section.declarations.confidentiality_text', "I agree to abide by SHITAL's Confidentiality Policy and acknowledge that violation may lead to disciplinary action and termination of my volunteering services.")}
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.marketing_consent}
            onChange={e => update('marketing_consent', e.target.checked)}
            className="w-4 h-4 rounded accent-saffron-400 mt-1 flex-shrink-0" />
          <span className="text-xs leading-relaxed" style={{ color: 'rgba(255,248,220,0.7)' }}>
            {t('section.declarations.marketing_text', "I'd like SHITAL to keep me informed about news, events and volunteering opportunities by email or SMS. We never sell or share your details with third parties — you can withdraw at any time.")}
          </span>
        </label>
      </Section>

      </>)}

      {error && (
        <div className="rounded-xl px-4 py-3 mb-4 text-sm font-medium"
          style={{ background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.3)' }}>
          {error}
        </div>
      )}

      <div className="flex gap-3">
        {wizardStep > 0 && (
          <button onClick={goPrev}
            className="flex-1 py-4 rounded-2xl font-bold text-sm transition-all active:scale-[0.99]"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.8)', border: '1px solid rgba(255,255,255,0.1)' }}>
            ← Back
          </button>
        )}
        {wizardStep < WIZARD_STEPS.length - 1 ? (
          <button onClick={goNext}
            className="flex-[2] py-4 rounded-2xl font-black text-base transition-all active:scale-[0.99]"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
            Next →
          </button>
        ) : (
          <button onClick={submit} disabled={submitting}
            className="flex-[2] py-4 rounded-2xl font-black text-base disabled:opacity-50 transition-all active:scale-[0.99]"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
            {submitting ? 'Submitting…' : t('submit.button', 'Submit Application →')}
          </button>
        )}
      </div>

      <p className="text-center text-xs mt-3" style={{ color: 'rgba(255,248,220,0.3)' }}>
        {wizardStep < WIZARD_STEPS.length - 1
          ? draftToken
            ? `💾 Saved. Bookmark this page — you can resume on any device for 30 days.${draftSyncedAt ? '' : ''}`
            : '💾 Your progress is saved automatically. You can come back later.'
          : t('submit.help', 'After submission, a trustee will review your application. References will be taken before a role is confirmed.')}
      </p>

      {/* Email-me-my-resume-link — only on the wizard, never on the
          confirmation screen, and only if there's actually a draft to
          email. The applicant must have entered their email on Step 1. */}
      {wizardStep < WIZARD_STEPS.length - 1 && draftToken && (
        <div className="mt-4 text-center">
          <button onClick={emailMyLink} disabled={emailLinkBusy || !form.email.trim()}
            className="text-xs underline disabled:opacity-50"
            style={{ color: 'rgba(96,165,250,0.85)' }}>
            {emailLinkBusy ? 'Sending…' : '📧 Email me a resume link'}
          </button>
          {emailLinkMsg && (
            <p className="text-xs mt-2"
              style={{ color: emailLinkMsg.ok ? '#86efac' : '#fca5a5' }}>
              {emailLinkMsg.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
