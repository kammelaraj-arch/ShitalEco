import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore, SHITAL_LOGO_URL } from '../store'

const API = (import.meta.env.VITE_API_URL as string) || '/api/v1'

interface RefContext {
  applicant_name: string
  referee_name: string
  already_submitted: boolean
}

const inp = 'w-full px-4 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 focus:border-saffron-400/50 outline-none text-ivory-100 placeholder-white/30'
const lbl = 'block text-xs font-bold uppercase tracking-widest mb-1.5'

// Public form rendered when a referee taps the magic-link in the
// volunteer-reference-request email. Token comes from the URL hash
// (#token=…) and authorises the submission — no login required.
export function ReferenceResponsePage() {
  const setScreen = useStore(s => s.setScreen)

  const [token, setToken] = useState('')
  const [ctx, setCtx] = useState<RefContext | null>(null)
  const [loadError, setLoadError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  // Form fields
  const [relationship, setRelationship] = useState('')
  const [knownYears, setKnownYears] = useState('')
  const [knownIn, setKnownIn] = useState('')
  const [honest, setHonest] = useState('')
  const [suitable, setSuitable] = useState('')
  const [safeguarding, setSafeguarding] = useState('')
  const [safeDetails, setSafeDetails] = useState('')
  const [other, setOther] = useState('')

  useEffect(() => {
    const m = /[#&]token=([A-Za-z0-9_-]+)/.exec(window.location.hash || '')
    const t = m?.[1]
    if (!t) {
      setLoadError('No token in URL — please open the link from your email again.')
      return
    }
    setToken(t)
    fetch(`${API}/public/volunteers/reference/${encodeURIComponent(t)}`)
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.detail || 'Link not found'))))
      .then(setCtx)
      .catch(e => setLoadError(e.message))
  }, [])

  async function submit() {
    setErr('')
    if (!relationship.trim() || !knownIn.trim() || !honest || !suitable || !safeguarding) {
      setErr('Please fill all required fields')
      return
    }
    if (safeguarding === 'yes' && !safeDetails.trim()) {
      setErr('Please describe the safeguarding concerns')
      return
    }
    setSubmitting(true)
    try {
      const r = await fetch(`${API}/public/volunteers/reference/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relationship,
          known_for_years: knownYears,
          known_in_capacity: knownIn,
          is_honest_reliable: honest,
          suitable_for_volunteering: suitable,
          safeguarding_concerns: safeguarding,
          safeguarding_details: safeDetails,
          other_comments: other,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.detail || `Submission failed (HTTP ${r.status})`)
      setDone(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Submission failed')
    } finally { setSubmitting(false) }
  }

  if (loadError) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <p className="text-sm text-ivory-200 mb-2">{loadError}</p>
        <button onClick={() => setScreen('browse')}
          className="mt-4 text-xs underline" style={{ color: 'rgba(255,248,220,0.5)' }}>
          Back to home
        </button>
      </div>
    )
  }

  if (!ctx) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center text-sm" style={{ color: 'rgba(255,248,220,0.5)' }}>
        Loading…
      </div>
    )
  }

  if (done || ctx.already_submitted) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="text-5xl mb-4">🙏</div>
          <h1 className="font-display font-bold text-2xl text-gold-400 mb-3">
            {done ? 'Reference Received' : 'Already Submitted'}
          </h1>
          <p className="text-sm text-ivory-200 mb-2">
            Thank you, {ctx.referee_name}. Your reference for {ctx.applicant_name} is on file with the SHITAL trustees.
          </p>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-32">
      <div className="text-center mb-6">
        <div className="w-16 h-16 rounded-2xl overflow-hidden mx-auto mb-3"
          style={{ background: 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)' }}>
          <img src={SHITAL_LOGO_URL} alt="SHITAL" className="w-full h-full object-contain p-1.5" />
        </div>
        <h1 className="font-display font-bold text-xl text-gold-400 mb-1">Volunteer Reference</h1>
        <p className="text-sm" style={{ color: 'rgba(255,248,220,0.6)' }}>
          For <strong>{ctx.applicant_name}</strong> — provided by {ctx.referee_name}
        </p>
      </div>

      <div className="temple-card p-5 mb-5">
        <h2 className="font-display font-bold text-base text-gold-400 mb-4">About the applicant</h2>

        <div className="mb-3">
          <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>How do you know them? *</label>
          <input value={relationship} onChange={e => setRelationship(e.target.value)} className={inp}
            placeholder="e.g. Manager, Friend, Teacher, Neighbour" />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Known for (years)</label>
            <input value={knownYears} onChange={e => setKnownYears(e.target.value)} className={inp}
              placeholder="e.g. 5" />
          </div>
        </div>

        <div className="mb-3">
          <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>In what capacity? *</label>
          <textarea value={knownIn} onChange={e => setKnownIn(e.target.value)} rows={2}
            className={inp + ' resize-none'}
            placeholder="e.g. Worked together at XYZ Ltd; neighbours since 2020" />
        </div>
      </div>

      <div className="temple-card p-5 mb-5">
        <h2 className="font-display font-bold text-base text-gold-400 mb-4">Suitability</h2>

        {[
          { key: 'honest', label: 'Are they honest and reliable? *', value: honest, set: setHonest },
          { key: 'suitable', label: 'Suitable for volunteering with vulnerable people / children? *', value: suitable, set: setSuitable },
          { key: 'safe', label: 'Any safeguarding concerns you would like to raise? *', value: safeguarding, set: setSafeguarding },
        ].map(q => (
          <div key={q.key} className="mb-4">
            <p className="text-sm mb-2" style={{ color: 'rgba(255,248,220,0.85)' }}>{q.label}</p>
            <div className="flex gap-2">
              {['yes', 'no', 'unsure'].map(opt => {
                const active = q.value === opt
                return (
                  <button key={opt} type="button" onClick={() => q.set(opt)}
                    className="px-4 py-1.5 rounded-full text-xs font-bold capitalize"
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

        {safeguarding === 'yes' && (
          <div className="mb-3">
            <label className={lbl} style={{ color: '#fca5a5' }}>Please describe (required) *</label>
            <textarea value={safeDetails} onChange={e => setSafeDetails(e.target.value)} rows={3}
              className={inp + ' resize-none'} />
          </div>
        )}

        <div>
          <label className={lbl} style={{ color: 'rgba(212,175,55,0.6)' }}>Any other comments? (optional)</label>
          <textarea value={other} onChange={e => setOther(e.target.value)} rows={3}
            className={inp + ' resize-none'} placeholder="Strengths, particular skills, anything you want SHITAL to know" />
        </div>
      </div>

      {err && (
        <div className="rounded-xl px-4 py-3 mb-4 text-sm font-medium"
          style={{ background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.3)' }}>
          {err}
        </div>
      )}

      <button onClick={submit} disabled={submitting}
        className="w-full py-4 rounded-2xl font-black text-base disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
        {submitting ? 'Submitting…' : 'Submit Reference →'}
      </button>

      <p className="text-center text-xs mt-3" style={{ color: 'rgba(255,248,220,0.3)' }}>
        Confidential — only SHITAL trustees will see your response.
      </p>
    </div>
  )
}
