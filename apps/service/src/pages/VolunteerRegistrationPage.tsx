import { useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'
import { api, type VolunteerRegistrationPayload, type VolunteerAdvancePayload } from '../api'

const TITLES = ['', 'Dr', 'Mr', 'Mrs', 'Ms', 'Master', 'Other']
const AGE_RANGES = ['18-25', '26-35', '36-45', '46-55', '55+']

const inp = 'w-full px-4 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 focus:border-saffron-400/50 outline-none text-ivory-100 placeholder-white/30'
const lbl = 'block text-xs font-bold uppercase tracking-widest mb-1.5'
const lblGold = { color: 'rgba(212,175,55,0.6)' }

// Temple noticeboard + the seva a new volunteer can help with. Static for now;
// can later be driven by the events/announcements admin.
const EVENTS = [
  { icon: '🔥', title: 'Guru Pournima — special pooja', when: 'This Thursday · all centres' },
  { icon: '🎵', title: 'Weekly bhajans', when: 'Thursdays & Saturdays, evening' },
  { icon: '🍲', title: 'Annadanam (food seva)', when: 'Sundays, after aarti' },
  { icon: '🌺', title: 'Ramnavami celebration', when: 'Coming soon' },
]
const SEVAS = [
  '🍲 Langar / kitchen', '🎉 Events & festivals', '🧹 Cleaning & upkeep',
  '📖 Reception & admin', '🎵 Music / bhajans', '🚗 Setup & logistics',
]

interface Stage0 {
  title: string; first_names: string; last_name: string
  email: string; mobile: string; phone: string; age_range: string
  areas: string[]; interest_note: string
  preferred_branches: string[]
  consent: boolean
}
const EMPTY0: Stage0 = {
  title: '', first_names: '', last_name: '', email: '', mobile: '', phone: '',
  age_range: '', areas: [], interest_note: '', preferred_branches: [], consent: false,
}

interface EnrichForm {
  ec_full_name: string; ec_relationship: string; ec_mobile: string; ec_email: string
  has_health_restrictions: boolean; health_notes: string
  has_criminal_record: boolean; criminal_record_details: string
  ref1_first_names: string; ref1_last_name: string; ref1_email: string; ref1_phone: string
  ref2_first_names: string; ref2_last_name: string; ref2_email: string; ref2_phone: string
  confidentiality_agreed: boolean
}
const EMPTY_ENRICH: EnrichForm = {
  ec_full_name: '', ec_relationship: '', ec_mobile: '', ec_email: '',
  has_health_restrictions: false, health_notes: '',
  has_criminal_record: false, criminal_record_details: '',
  ref1_first_names: '', ref1_last_name: '', ref1_email: '', ref1_phone: '',
  ref2_first_names: '', ref2_last_name: '', ref2_email: '', ref2_phone: '',
  confidentiality_agreed: false,
}

export function VolunteerRegistrationPage() {
  const setScreen = useStore(s => s.setScreen)
  const branchId = useStore(s => s.branchId)

  const [phase, setPhase] = useState<'signup' | 'ladder'>('signup')
  const [f, setF] = useState<Stage0>(EMPTY0)
  const [reference, setReference] = useState('')
  const [stage, setStage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = <K extends keyof Stage0>(k: K, v: Stage0[K]) => setF(p => ({ ...p, [k]: v }))

  async function register() {
    setError('')
    if (!f.first_names.trim() || !f.last_name.trim()) return setError('Please enter your name.')
    if (!f.email.includes('@')) return setError('Please enter a valid email.')
    if (!f.mobile.trim() && !f.phone.trim()) return setError('Please give a contact number.')
    if (!f.age_range) return setError('Please confirm your age range (18+).')
    if (!f.consent) return setError('Please tick the consent box.')
    setBusy(true)
    try {
      const payload: VolunteerRegistrationPayload = {
        title: f.title, first_names: f.first_names.trim(), last_name: f.last_name.trim(),
        address: '', postcode: '', mobile: f.mobile.trim(), phone: f.phone.trim(),
        email: f.email.trim(), age_range: f.age_range,
        ec_title: '', ec_full_name: '', ec_email: '', ec_mobile: '', ec_phone: '', ec_address: '', ec_postcode: '',
        has_health_restrictions: false, health_notes: '',
        has_criminal_record: false, criminal_record_details: '',
        ref1_title: '', ref1_first_names: '', ref1_last_name: '', ref1_address: '', ref1_postcode: '',
        ref1_mobile: '', ref1_phone: '', ref1_email: '',
        ref2_title: '', ref2_first_names: '', ref2_last_name: '', ref2_address: '', ref2_postcode: '',
        ref2_mobile: '', ref2_phone: '', ref2_email: '',
        skills: {}, skills_other_text: '',
        availability: { days: [], times: [], notes: '' }, availability_pattern: '',
        declaration_agreed: f.consent, confidentiality_agreed: false, marketing_consent: false,
        branch_id: branchId, preferred_branches: [branchId || 'main'],
      }
      const res = await api.registerVolunteer(payload)
      setReference(res.reference_number)
      setStage(res.stage ?? 0)
      setPhase('ladder')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registration failed. Please try again.')
    } finally { setBusy(false) }
  }

  // ── Signup (Stage 0) ──────────────────────────────────────────────────────
  if (phase === 'signup') {
    return (
      <div className="max-w-lg mx-auto px-4 py-6 pb-28">
        <button onClick={() => setScreen('browse')} className="text-sm font-medium mb-4" style={{ color: 'rgba(255,248,220,0.4)' }}>← Back</button>
        <div className="text-center mb-5">
          <div className="text-4xl mb-2">🤝</div>
          <h1 className="font-display font-bold text-2xl text-gold-400 mb-1">Volunteer with SHITAL</h1>
          <p className="text-sm" style={{ color: 'rgba(255,248,220,0.55)' }}>
            Takes under a minute to start. Add more later to unlock more seva. Minimum age 18.
          </p>
        </div>

        <div className="temple-card p-5 mb-5 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest" style={lblGold}>Get started</p>
          <div className="flex gap-2">
            <select value={f.title} onChange={e => set('title', e.target.value)} className={`${inp} max-w-[90px]`}>
              {TITLES.map(t => <option key={t} value={t}>{t || 'Title'}</option>)}
            </select>
            <input className={inp} placeholder="First name*" value={f.first_names} onChange={e => set('first_names', e.target.value)} />
          </div>
          <input className={inp} placeholder="Last name*" value={f.last_name} onChange={e => set('last_name', e.target.value)} />
          <input className={inp} type="email" placeholder="Email*" value={f.email} onChange={e => set('email', e.target.value)} />
          <div className="flex gap-2">
            <input className={inp} placeholder="Mobile*" value={f.mobile} onChange={e => set('mobile', e.target.value)} />
            <input className={inp} placeholder="Phone (optional)" value={f.phone} onChange={e => set('phone', e.target.value)} />
          </div>
          <div>
            <label className={lbl} style={lblGold}>Age range (must be 18+)*</label>
            <div className="flex flex-wrap gap-2">
              {AGE_RANGES.map(a => (
                <button key={a} onClick={() => set('age_range', a)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition"
                  style={f.age_range === a
                    ? { background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }
                    : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,248,220,0.7)', border: '1px solid rgba(255,255,255,0.12)' }}>
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="flex items-start gap-3 mb-4 cursor-pointer">
          <input type="checkbox" checked={f.consent} onChange={e => set('consent', e.target.checked)} className="mt-1 accent-gold-500" />
          <span className="text-xs" style={{ color: 'rgba(255,248,220,0.7)' }}>
            I'm 18 or over and happy for SHITAL to contact me about volunteering. I can withdraw anytime.
          </span>
        </label>

        {error && <p className="text-sm mb-3" style={{ color: '#f87171' }}>{error}</p>}

        <button onClick={register} disabled={busy}
          className="w-full py-3.5 rounded-2xl font-black text-base disabled:opacity-50 transition active:scale-[0.99]"
          style={{ background: 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)', color: '#3B0000' }}>
          {busy ? 'Registering…' : 'Register — takes under a minute →'}
        </button>
        <p className="text-center text-xs mt-3" style={{ color: 'rgba(255,248,220,0.35)' }}>
          No references or paperwork needed to start. Add them later to unlock more.
        </p>
      </div>
    )
  }

  // ── Ladder (post-registration progressive enrichment) ─────────────────────
  return <LadderPhase reference={reference} email={f.email.trim()} name={f.first_names.trim()}
    stage={stage} setStage={setStage} setScreen={setScreen} />
}

// ── Post-registration: show the ladder + enrichment sections ────────────────
function LadderPhase({ reference, email, name, stage, setStage, setScreen }: {
  reference: string; email: string; name: string; stage: number
  setStage: (n: number) => void; setScreen: (s: 'browse') => void
}) {
  const [e, setE] = useState<EnrichForm>(EMPTY_ENRICH)
  const [open, setOpen] = useState<1 | 2 | null>(stage < 1 ? 1 : stage < 2 ? 2 : null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const upd = <K extends keyof EnrichForm>(k: K, v: EnrichForm[K]) => setE(p => ({ ...p, [k]: v }))

  // Contact details are optional for now — we always save what's provided and
  // confirm success. If enough was filled to climb a stage, we celebrate that;
  // otherwise we still thank them and keep their details.
  async function save(_which: 1 | 2) {
    setErr(''); setMsg('')
    setBusy(true)
    try {
      const payload: VolunteerAdvancePayload = { reference_number: reference, email, ...e }
      const res = await api.advanceVolunteer(payload)
      setStage(res.stage)
      setMsg(res.stage >= 2 ? '⭐ Saved — thank you! You\'re a full volunteer.'
        : res.stage >= 1 ? '🪔 Saved — thank you! You can now help at a one-day seva.'
        : '✓ Saved — thank you! Your details have been recorded.')
      setOpen(res.stage < 1 ? 1 : res.stage < 2 ? 2 : null)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not save. Please try again.')
    } finally { setBusy(false) }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-8 pb-28">
      <div className="text-center mb-6">
        <div className="text-5xl mb-3">🙏</div>
        <h1 className="font-display font-bold text-2xl text-gold-400 mb-1">Sairam! Welcome to the family{name ? `, ${name}` : ''} 🌸</h1>
        <p className="text-sm" style={{ color: 'rgba(255,248,220,0.6)' }}>
          {stage >= 1 ? 'You can now help at a one-day seva. 🪔' : 'Thank you for joining our seva family.'}
        </p>
        <div className="inline-flex items-center gap-2 mt-3 px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(212,175,55,0.12)', border: '1px solid rgba(212,175,55,0.3)' }}>
          <span className="text-xs" style={{ color: 'rgba(255,248,220,0.5)' }}>Your reference</span>
          <span className="font-mono font-bold text-gold-400 text-sm">{reference}</span>
        </div>
      </div>

      {msg && <p className="text-sm text-center mb-4" style={{ color: '#4ade80' }}>{msg}</p>}

      {/* Stage 1 — emergency contact */}
      {stage < 1 && (
        <div className="temple-card p-5 mb-4">
          <button onClick={() => setOpen(open === 1 ? null : 1)} className="w-full flex items-center justify-between">
            <span className="font-bold text-sm text-gold-400">🪔 Unlock One-Day Seva</span>
            <span style={{ color: 'rgba(255,248,220,0.4)' }}>{open === 1 ? '−' : '+'}</span>
          </button>
          {open === 1 && (
            <div className="space-y-3 mt-4">
              <p className="text-xs" style={{ color: 'rgba(255,248,220,0.5)' }}>An emergency contact so you can safely help at a supervised one-day seva. <b>All optional for now</b> — add what you can.</p>
              <div className="flex gap-2">
                <input className={inp} placeholder="Emergency contact name" value={e.ec_full_name} onChange={ev => upd('ec_full_name', ev.target.value)} />
                <input className={inp} placeholder="Relationship to you" value={e.ec_relationship} onChange={ev => upd('ec_relationship', ev.target.value)} />
              </div>
              <div className="flex gap-2">
                <input className={inp} placeholder="Their mobile" value={e.ec_mobile} onChange={ev => upd('ec_mobile', ev.target.value)} />
                <input className={inp} type="email" placeholder="Their email" value={e.ec_email} onChange={ev => upd('ec_email', ev.target.value)} />
              </div>
              <button onClick={() => save(1)} disabled={busy}
                className="w-full py-3 rounded-xl font-black text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
                {busy ? 'Saving…' : 'Save my details →'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Stage 2 — references + DBS */}
      {stage < 2 && (
        <div className="temple-card p-5 mb-4">
          <button onClick={() => setOpen(open === 2 ? null : 2)} className="w-full flex items-center justify-between">
            <span className="font-bold text-sm text-gold-400">⭐ {stage >= 1 ? 'One last step — full volunteering seva' : 'Become a Full Volunteer'}</span>
            <span style={{ color: 'rgba(255,248,220,0.4)' }}>{open === 2 ? '−' : '+'}</span>
          </button>
          {open === 2 && (
            <div className="space-y-3 mt-4">
              <p className="text-xs" style={{ color: 'rgba(255,248,220,0.5)' }}>Provide two references + a short declaration and you're a full volunteer — long-term roles and more responsibility. <b>Optional for now</b> — you can add these later.</p>
              <p className="text-xs font-bold uppercase tracking-widest" style={lblGold}>Referee 1</p>
              <div className="flex gap-2">
                <input className={inp} placeholder="First name" value={e.ref1_first_names} onChange={ev => upd('ref1_first_names', ev.target.value)} />
                <input className={inp} placeholder="Last name" value={e.ref1_last_name} onChange={ev => upd('ref1_last_name', ev.target.value)} />
              </div>
              <div className="flex gap-2">
                <input className={inp} placeholder="Email" value={e.ref1_email} onChange={ev => upd('ref1_email', ev.target.value)} />
                <input className={inp} placeholder="Phone" value={e.ref1_phone} onChange={ev => upd('ref1_phone', ev.target.value)} />
              </div>
              <p className="text-xs font-bold uppercase tracking-widest" style={lblGold}>Referee 2</p>
              <div className="flex gap-2">
                <input className={inp} placeholder="First name" value={e.ref2_first_names} onChange={ev => upd('ref2_first_names', ev.target.value)} />
                <input className={inp} placeholder="Last name" value={e.ref2_last_name} onChange={ev => upd('ref2_last_name', ev.target.value)} />
              </div>
              <div className="flex gap-2">
                <input className={inp} placeholder="Email" value={e.ref2_email} onChange={ev => upd('ref2_email', ev.target.value)} />
                <input className={inp} placeholder="Phone" value={e.ref2_phone} onChange={ev => upd('ref2_phone', ev.target.value)} />
              </div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={e.confidentiality_agreed} onChange={ev => upd('confidentiality_agreed', ev.target.checked)} className="mt-0.5 accent-gold-500" />
                <span className="text-xs" style={{ color: 'rgba(255,248,220,0.7)' }}>I agree to SHITAL's volunteer & confidentiality declaration and consent to a DBS check where a role requires it.</span>
              </label>
              <button onClick={() => save(2)} disabled={busy}
                className="w-full py-3 rounded-xl font-black text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
                {busy ? 'Saving…' : 'Save my details →'}
              </button>
            </div>
          )}
        </div>
      )}

      {stage >= 2 && (
        <div className="temple-card p-5 mb-4 text-center">
          <p className="text-sm" style={{ color: '#4ade80' }}>⭐ You've completed every step. A trustee will take your references and be in touch about roles. Thank you for your seva! 🙏</p>
        </div>
      )}

      {err && <p className="text-sm mb-3" style={{ color: '#f87171' }}>{err}</p>}

      {/* Temple noticeboard */}
      <div className="temple-card p-5 mb-4">
        <p className="text-xs font-bold uppercase tracking-widest mb-3" style={lblGold}>📅 Upcoming at the temple</p>
        <div className="space-y-2.5">
          {EVENTS.map(ev => (
            <div key={ev.title} className="flex items-start gap-3">
              <span className="text-lg leading-none mt-0.5">{ev.icon}</span>
              <div>
                <p className="text-sm font-bold" style={{ color: 'rgba(255,248,220,0.85)' }}>{ev.title}</p>
                <p className="text-xs" style={{ color: 'rgba(255,248,220,0.45)' }}>{ev.when}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Seva available */}
      <div className="temple-card p-5 mb-5">
        <p className="text-xs font-bold uppercase tracking-widest mb-3" style={lblGold}>🤝 Seva you can help with</p>
        <div className="flex flex-wrap gap-2">
          {SEVAS.map(s => (
            <span key={s} className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,248,220,0.7)', border: '1px solid rgba(212,175,55,0.2)' }}>{s}</span>
          ))}
        </div>
        <p className="text-xs mt-3" style={{ color: 'rgba(255,248,220,0.4)' }}>A trustee will be in touch to match you with seva that suits you. 🙏</p>
      </div>

      <button onClick={() => setScreen('browse')}
        className="w-full py-3 rounded-2xl font-bold text-sm mt-1"
        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.7)', border: '1px solid rgba(255,255,255,0.12)' }}>
        Done for now — back to Home
      </button>
    </div>
  )
}
