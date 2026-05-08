'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'

const API = process.env.NEXT_PUBLIC_API_URL || '/api/v1'

type Choice = 'FOR' | 'AGAINST' | 'ABSTAIN'

interface Resolution {
  id: string
  title: string
  background: string
  recommendation: string
  risk_impact: string
  budget_impact: string
  category: string
  decision_type: string
  status: string
  decision_date: string | null
  is_retrospective: boolean
  retrospective_reason: string
  outcome: string
  outcome_summary: string
  tally_for: number
  tally_against: number
  tally_abstain: number
  casting_vote_used: boolean
  casting_vote_choice: string
  published_at: string | null
  closed_at: string | null
}

interface MyVote {
  choice: Choice
  comment: string
  voted_at: string
  updated_at: string
}

interface Trustee {
  full_name: string
  role: string
  email_masked: string
  needs_pin_setup: boolean
}

interface LoadResponse {
  resolution: Resolution
  trustee: Trustee
  my_vote: MyVote | null
}

const CARD_BG = 'rgba(255,255,255,0.04)'
const CARD_BORDER = 'rgba(255,255,255,0.10)'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso }
}

export default function MagicLinkVotePage() {
  const params = useParams<{ token: string }>()
  const token = (params?.token as string) || ''

  const [data, setData] = useState<LoadResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [choice, setChoice] = useState<Choice | ''>('')
  const [comment, setComment] = useState('')

  const [showPinModal, setShowPinModal] = useState(false)
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch(`${API}/public/board/vote/${encodeURIComponent(token)}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.detail || `Failed to load (${r.status})`)
      setData(d)
      if (d.my_vote) {
        setChoice(d.my_vote.choice)
        setComment(d.my_vote.comment || '')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  async function submitVote() {
    if (!choice || pin.length < 4) return
    setSubmitting(true); setError('')
    try {
      const r = await fetch(`${API}/public/board/vote/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice, pin, comment }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg = typeof d?.detail === 'string' ? d.detail : 'Failed to vote'
        throw new Error(msg)
      }
      setShowPinModal(false)
      setPin('')
      setSuccess(true)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to vote')
    } finally { setSubmitting(false) }
  }

  async function setUpPin() {
    if (pin.length < 4 || pin !== confirmPin) {
      setError('PINs must match and be 4-6 digits'); return
    }
    setSubmitting(true); setError('')
    try {
      const r = await fetch(`${API}/public/board/trustee/set-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_pin: pin, confirm_pin: confirmPin }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(typeof d?.detail === 'string' ? d.detail : 'Failed to set PIN')
      setShowSetupModal(false)
      setPin('')
      setConfirmPin('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set PIN')
    } finally { setSubmitting(false) }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-white/60 text-sm">Loading…</div>
  }
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <h1 className="text-white font-black text-xl mb-2">Link unavailable</h1>
          <p className="text-white/60 text-sm">{error || 'Invalid or expired magic-link.'}</p>
          <p className="text-white/40 text-xs mt-3">If you think this is a mistake, contact the Chair or Secretary.</p>
        </div>
      </div>
    )
  }

  const { resolution, trustee, my_vote } = data
  const closed = resolution.status === 'CLOSED' || resolution.status === 'ARCHIVED'

  return (
    <div className="min-h-screen text-white" style={{ background: 'linear-gradient(180deg,#180a0a 0%,#0d0404 100%)' }}>
      <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
        {/* Header */}
        <div className="text-center mb-6">
          <p className="text-saffron-300 text-xs font-bold uppercase tracking-widest mb-1">SHITAL Board Resolution</p>
          <h1 className="font-black text-2xl text-white mb-1">{resolution.title}</h1>
          <p className="text-white/40 text-xs">
            {resolution.category.replace(/_/g, ' ')} · {resolution.decision_type.replace(/_/g, ' ')} ·
            Published {fmtDate(resolution.published_at)}
          </p>
        </div>

        {/* Trustee identity panel */}
        <div className="rounded-2xl p-4 mb-5 text-center" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
          <p className="text-white/40 text-xs">Voting as</p>
          <p className="font-bold text-white text-base">{trustee.full_name}</p>
          <p className="text-white/50 text-xs">{trustee.role} · {trustee.email_masked}</p>
        </div>

        {resolution.is_retrospective && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 mb-4">
            <p className="text-amber-300 text-xs font-bold uppercase tracking-wide mb-1">Retrospective Record</p>
            <p className="text-white/80 text-sm">This is a record of a decision already taken on {fmtDate(resolution.decision_date)}. Trustees confirm the accuracy of the record — they are not re-making the decision.</p>
          </div>
        )}

        {success && (
          <div className="rounded-xl bg-green-500/15 border border-green-500/30 px-4 py-3 mb-4 text-green-300 text-sm">
            ✓ Your vote ({my_vote?.choice}) has been recorded. You can change it any time before voting closes.
          </div>
        )}

        {error && !showPinModal && !showSetupModal && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 mb-4 text-red-300 text-sm">{error}</div>
        )}

        {/* Resolution content */}
        <div className="space-y-3 mb-5">
          {resolution.background && (
            <Card title="Background"><p className="whitespace-pre-wrap">{resolution.background}</p></Card>
          )}
          {resolution.recommendation && (
            <Card title="Recommendation"><p className="whitespace-pre-wrap">{resolution.recommendation}</p></Card>
          )}
          {resolution.risk_impact && (
            <Card title="Risk / Impact"><p className="whitespace-pre-wrap">{resolution.risk_impact}</p></Card>
          )}
          {resolution.budget_impact && (
            <Card title="Budget Impact"><p className="whitespace-pre-wrap">{resolution.budget_impact}</p></Card>
          )}
        </div>

        {/* Tally panel */}
        <div className="rounded-2xl p-4 mb-5 grid grid-cols-3 gap-3 text-center" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
          <div>
            <p className="text-green-400 font-black text-2xl">{resolution.tally_for}</p>
            <p className="text-white/50 text-xs uppercase tracking-wide">For</p>
          </div>
          <div>
            <p className="text-red-400 font-black text-2xl">{resolution.tally_against}</p>
            <p className="text-white/50 text-xs uppercase tracking-wide">Against</p>
          </div>
          <div>
            <p className="text-white/70 font-black text-2xl">{resolution.tally_abstain}</p>
            <p className="text-white/50 text-xs uppercase tracking-wide">Abstain</p>
          </div>
        </div>

        {/* Voting panel */}
        {!closed && (
          <div className="rounded-2xl p-5" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
            <h2 className="font-black text-white mb-3">Your vote</h2>
            {my_vote && (
              <p className="text-saffron-300 text-xs mb-3">
                Your current vote: <strong>{my_vote.choice}</strong>. You can change it until voting closes.
              </p>
            )}

            <div className="grid grid-cols-3 gap-2 mb-4">
              {(['FOR', 'AGAINST', 'ABSTAIN'] as Choice[]).map(c => (
                <button key={c} onClick={() => setChoice(c)}
                  className="py-3 rounded-xl text-sm font-black transition-all"
                  style={{
                    background:
                      choice === c
                        ? c === 'FOR' ? 'rgba(34,197,94,0.25)'
                        : c === 'AGAINST' ? 'rgba(239,68,68,0.25)'
                        : 'rgba(255,255,255,0.15)'
                        : 'rgba(255,255,255,0.04)',
                    border: `1.5px solid ${
                      choice === c
                        ? c === 'FOR' ? '#22c55e'
                        : c === 'AGAINST' ? '#ef4444'
                        : 'rgba(255,255,255,0.4)'
                        : 'rgba(255,255,255,0.1)'
                    }`,
                    color:
                      choice === c
                        ? c === 'FOR' ? '#4ade80'
                        : c === 'AGAINST' ? '#fca5a5'
                        : 'white'
                        : 'rgba(255,255,255,0.6)',
                  }}>{c}</button>
              ))}
            </div>

            <textarea value={comment} onChange={e => setComment(e.target.value)}
              placeholder="Optional comment (visible to other trustees in the audit log)"
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50 resize-none mb-4" />

            <button onClick={() => {
              setError('')
              if (trustee.needs_pin_setup) setShowSetupModal(true)
              else setShowPinModal(true)
            }} disabled={!choice}
              className="w-full py-3.5 rounded-xl font-black text-sm disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
              {trustee.needs_pin_setup ? 'Set PIN to vote →' : (my_vote ? `Update vote · enter PIN →` : 'Confirm vote · enter PIN →')}
            </button>
          </div>
        )}

        {closed && (
          <div className="rounded-2xl p-5 text-center" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
            <p className="text-white/40 text-xs uppercase tracking-wide font-bold mb-2">Voting Closed</p>
            <p className="text-white text-base font-black">{resolution.outcome.replace(/_/g, ' ')}</p>
            {resolution.outcome_summary && <p className="text-white/70 text-xs mt-2">{resolution.outcome_summary}</p>}
          </div>
        )}

        <p className="text-center text-white/30 text-xs mt-6">
          SHITAL · UK Charity 1138530 · Audit-logged action.
        </p>
      </div>

      {/* PIN entry modal */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="fixed inset-0 bg-black/80" onClick={() => !submitting && setShowPinModal(false)} />
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="relative bg-[#1a0a0a] border border-white/10 rounded-2xl p-6 max-w-sm w-full text-center">
            <p className="text-saffron-300 text-xs font-bold uppercase tracking-widest mb-2">Confirm Vote</p>
            <h3 className="text-white font-black text-lg mb-1">Enter your PIN</h3>
            <p className="text-white/60 text-xs mb-5">Voting <strong className="text-white">{choice}</strong> as {trustee.full_name}</p>
            <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6}
              autoFocus
              value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white text-2xl text-center tracking-[0.5em] outline-none focus:border-saffron-400/50 mb-3" />
            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setShowPinModal(false); setPin(''); setError('') }}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm font-semibold">Cancel</button>
              <button onClick={submitVote} disabled={submitting || pin.length < 4}
                className="flex-[2] py-2.5 rounded-xl text-white text-sm font-black disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)' }}>
                {submitting ? 'Submitting…' : 'Submit Vote'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* PIN setup modal */}
      {showSetupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="fixed inset-0 bg-black/80" onClick={() => !submitting && setShowSetupModal(false)} />
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="relative bg-[#1a0a0a] border border-white/10 rounded-2xl p-6 max-w-sm w-full">
            <p className="text-saffron-300 text-xs font-bold uppercase tracking-widest mb-2">First-time setup</p>
            <h3 className="text-white font-black text-lg mb-1">Choose your PIN</h3>
            <p className="text-white/60 text-xs mb-4">Pick a 4-6 digit PIN. You'll use this to confirm every vote on resolutions sent to you.</p>
            <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6}
              value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="New PIN"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white text-xl text-center tracking-[0.5em] outline-none focus:border-saffron-400/50 mb-2" />
            <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6}
              value={confirmPin} onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="Confirm PIN"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white text-xl text-center tracking-[0.5em] outline-none focus:border-saffron-400/50 mb-3" />
            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setShowSetupModal(false); setPin(''); setConfirmPin(''); setError('') }}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm font-semibold">Cancel</button>
              <button onClick={setUpPin} disabled={submitting || pin.length < 4 || pin !== confirmPin}
                className="flex-[2] py-2.5 rounded-xl text-white text-sm font-black disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)' }}>
                {submitting ? 'Saving…' : 'Set PIN'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
      <p className="text-white/40 text-xs font-bold uppercase tracking-widest mb-1.5">{title}</p>
      <div className="text-white/90 text-sm">{children}</div>
    </div>
  )
}
