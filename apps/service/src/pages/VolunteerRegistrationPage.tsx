import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'
import { api, type VolunteerRegistrationPayload } from '../api'
import { AddressLookup } from '../components/AddressLookup'

const TITLES = ['', 'Dr', 'Mr', 'Mrs', 'Ms', 'Master', 'Other']
const AGE_RANGES = ['18-25', '26-35', '36-45', '46-55', '55+']

// Skills checklist mirrors paper-form V1.2 page 4 layout. Each row is one
// category with its options. Renamed to match how staff describe them.
const SKILLS_CATALOG: Array<{ key: string; label: string; options: string[] }> = [
  { key: 'Administrative',  label: 'Administrative',     options: ['General Office Duties', 'Accountancy', 'Research', 'Secretarial', 'Other'] },
  { key: 'Logistics',       label: 'Logistics',          options: ['Driving', 'Loading / Unloading', 'Warehouse Management', 'Import / Export', 'Other'] },
  { key: 'Cultural',        label: 'Cultural',           options: ['Singing', 'Dancing', 'Drama', 'Other'] },
  { key: 'Communications',  label: 'Communications',     options: ['Marketing / PR', 'Community Relations', 'Cataloguing', 'Conducting Surveys', 'Social Media', 'Other'] },
  { key: 'IT',              label: 'IT',                 options: ['Data Entry', 'Web Developing', 'Networking', 'Other'] },
  { key: 'Religious',       label: 'Religious',          options: ['Bhajans / Shlokas', 'Other'] },
  { key: 'EventManagement', label: 'Event Management',   options: ['Advertising / Publicity', 'Public Relations', 'First Aider', 'Security', 'Other'] },
  { key: 'Education',       label: 'Education',          options: ['Tuition', 'Teaching', 'Counselling', 'Consultancy', 'Language', 'Other'] },
  { key: 'Hospitality',     label: 'Hospitality',        options: ['Care Taker', 'Child Minder', 'Other'] },
  { key: 'CharityServices', label: 'Charity Services',   options: ['Fund Raising', 'Distributing Food', 'Other'] },
  { key: 'Other',           label: 'Other Skills',       options: ['DIY', 'Carpentry', 'Electrical', 'Plumbing', 'Cooking', 'Other'] },
]

const WEEKDAYS: Array<{ key: string; label: string }> = [
  { key: 'monday',    label: 'Monday'    },
  { key: 'tuesday',   label: 'Tuesday'   },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday',  label: 'Thursday'  },
  { key: 'friday',    label: 'Friday'    },
  { key: 'saturday',  label: 'Saturday'  },
  { key: 'sunday',    label: 'Sunday'    },
]

const AVAILABILITY_PATTERNS = ['daily', 'weekly', 'events-only']

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
  availability: Record<string, Record<string, string>>
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
  availability: {}, availability_pattern: '',
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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [reference, setReference] = useState('')

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

  function toggleSkill(category: string, option: string) {
    setForm(p => {
      const current = p.skills[category] || []
      const next = current.includes(option)
        ? current.filter(o => o !== option)
        : [...current, option]
      const skills = { ...p.skills }
      if (next.length) skills[category] = next
      else delete skills[category]
      return { ...p, skills }
    })
  }

  function setAvailSlot(day: string, slot: 'morning' | 'afternoon' | 'evening', value: string) {
    setForm(p => {
      const dayObj = { ...(p.availability[day] || {}) }
      if (value.trim()) dayObj[slot] = value
      else delete dayObj[slot]
      const availability = { ...p.availability }
      if (Object.keys(dayObj).length) availability[day] = dayObj
      else delete availability[day]
      return { ...p, availability }
    })
  }

  async function submit() {
    setError('')
    setSubmitting(true)
    try {
      const payload: VolunteerRegistrationPayload = { ...form, branch_id: branchId }
      const res = await api.registerVolunteer(payload)
      setReference(res.reference_number)
      setStep('done')
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

      <div className="text-center mb-6">
        <div className="text-4xl mb-2">🤝</div>
        <h1 className="font-display font-bold text-2xl text-gold-400 mb-1">{t('page.title', 'Volunteer Registration')}</h1>
        <p className="text-sm" style={{ color: 'rgba(255,248,220,0.5)' }}>
          {t('page.subtitle', 'Join the SHITAL volunteering family. Minimum age 18.')}
        </p>
      </div>

      {/* Personal */}
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

      {/* Where they want to help */}
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

      {/* Health */}
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

      {/* Referees */}
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

      {/* Skills */}
      <Section title={t('section.skills.title', 'Your Skills')}>
        <p className="text-xs mb-3" style={{ color: 'rgba(255,248,220,0.5)' }}>
          {t('section.skills.intro', 'Tick everything that applies. We use this to match you with suitable opportunities.')}
        </p>
        {SKILLS_CATALOG.map(cat => (
          <div key={cat.key} className="mb-3">
            <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.55)' }}>{cat.label}</p>
            <div className="flex flex-wrap gap-2">
              {cat.options.map(opt => {
                const active = (form.skills[cat.key] || []).includes(opt)
                return (
                  <button key={opt} type="button" onClick={() => toggleSkill(cat.key, opt)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                    style={{
                      background: active ? 'linear-gradient(135deg,rgba(212,175,55,0.3),rgba(212,175,55,0.15))' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${active ? '#D4AF37' : 'rgba(255,255,255,0.1)'}`,
                      color: active ? '#FFD980' : 'rgba(255,248,220,0.7)',
                    }}>
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        <div className="mt-4">
          <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>{t('section.skills.other_label', 'Other skills (free-text)')}</label>
          <textarea value={form.skills_other_text} onChange={e => update('skills_other_text', e.target.value)} rows={2}
            className={inp + ' resize-none'} placeholder={t('section.skills.other_placeholder', 'Security, First Aid, Singing, Musical Instruments etc.')} />
        </div>
      </Section>

      {/* Availability */}
      <Section title={t('section.availability.title', 'Availability')}>
        <p className="text-xs mb-3" style={{ color: 'rgba(255,248,220,0.5)' }}>
          {t('section.availability.intro', "Tell us when you're typically free. You can leave any cell blank.")}
        </p>
        <div className="overflow-x-auto -mx-2 mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left" style={{ color: 'rgba(212,175,55,0.55)' }}>
                <th className="px-2 py-1 font-bold uppercase tracking-widest">Day</th>
                <th className="px-2 py-1 font-bold uppercase tracking-widest">Morning</th>
                <th className="px-2 py-1 font-bold uppercase tracking-widest">Afternoon</th>
                <th className="px-2 py-1 font-bold uppercase tracking-widest">Evening</th>
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map(day => (
                <tr key={day.key}>
                  <td className="px-2 py-1 text-ivory-200 font-semibold whitespace-nowrap">{day.label}</td>
                  {(['morning', 'afternoon', 'evening'] as const).map(slot => (
                    <td key={slot} className="px-2 py-1">
                      <input
                        value={form.availability[day.key]?.[slot] || ''}
                        onChange={e => setAvailSlot(day.key, slot, e.target.value)}
                        placeholder="9-12"
                        className="w-full px-2 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 outline-none focus:border-saffron-400/50 text-ivory-100 placeholder-white/25"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Pattern</label>
          <div className="flex gap-2">
            {AVAILABILITY_PATTERNS.map(p => {
              const active = form.availability_pattern === p
              return (
                <button key={p} type="button" onClick={() => update('availability_pattern', active ? '' : p)}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all capitalize"
                  style={{
                    background: active ? 'linear-gradient(135deg,rgba(212,175,55,0.3),rgba(212,175,55,0.15))' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${active ? '#D4AF37' : 'rgba(255,255,255,0.1)'}`,
                    color: active ? '#FFD980' : 'rgba(255,248,220,0.7)',
                  }}>
                  {p.replace('-', ' ')}
                </button>
              )
            })}
          </div>
        </div>
      </Section>

      {/* Declarations */}
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

      {error && (
        <div className="rounded-xl px-4 py-3 mb-4 text-sm font-medium"
          style={{ background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.3)' }}>
          {error}
        </div>
      )}

      <button onClick={submit} disabled={submitting}
        className="w-full py-4 rounded-2xl font-black text-base disabled:opacity-50 transition-all active:scale-[0.99]"
        style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
        {submitting ? 'Submitting…' : t('submit.button', 'Submit Application →')}
      </button>

      <p className="text-center text-xs mt-3" style={{ color: 'rgba(255,248,220,0.3)' }}>
        {t('submit.help', 'After submission, a trustee will review your application. References will be taken before a role is confirmed.')}
      </p>
    </div>
  )
}
