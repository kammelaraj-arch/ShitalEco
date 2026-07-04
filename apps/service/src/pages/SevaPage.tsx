import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'
import { api, type SevaShift, type SevaBooking } from '../api'

const inp = 'w-full px-4 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 focus:border-saffron-400/50 outline-none text-ivory-100 placeholder-white/30'

const BRANCH_LABELS: Record<string, string> = {
  wembley: 'Wembley', wembley_main: 'Wembley', leicester: 'Leicester',
  reading: 'Reading', milton_keynes: 'Milton Keynes', main: 'Temple',
}
const branchLabel = (id: string) => BRANCH_LABELS[id] || (id ? id.replace(/_/g, ' ') : 'Temple')

function whenLabel(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

export function SevaPage() {
  const { branchId, donorToken, donorName, donorEmail, setScreen } = useStore()
  const [shifts, setShifts] = useState<SevaShift[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState(donorName || '')
  const [email, setEmail] = useState(donorEmail || '')
  const [busyId, setBusyId] = useState('')
  const [booked, setBooked] = useState<Set<string>>(new Set())
  const [myBookings, setMyBookings] = useState<SevaBooking[]>([])
  const [error, setError] = useState('')
  const [availNote, setAvailNote] = useState('')
  const [availMsg, setAvailMsg] = useState('')

  // Show ALL open seva across the temples — volunteers can help at any branch,
  // and branch codes vary across the system, so we never hide slots behind an
  // exact branch match. Each card shows which temple it's for.
  useEffect(() => {
    api.getSevaShifts()
      .then(d => setShifts(d.shifts || []))
      .catch(() => setError('Could not load seva right now.'))
      .finally(() => setLoading(false))
  }, [])

  // Load the caller's own booked seva (by donor token if signed in, else by
  // the email in the form). Refreshed after each booking.
  async function loadMine(byEmail = email) {
    if (!donorToken && !byEmail.includes('@')) { setMyBookings([]); return }
    try {
      const d = await api.getMySevaBookings(byEmail.trim(), donorToken || undefined)
      setMyBookings(d.bookings || [])
    } catch { /* ignore */ }
  }
  useEffect(() => { loadMine() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Shift ids the caller has already booked — server truth + this session's.
  const bookedIds = new Set<string>([...booked, ...myBookings.map(b => b.shift_id)])

  function ensureIdentity(): boolean {
    if (!name.trim() || !email.includes('@')) {
      setError('Please add your name and email at the top first.')
      return false
    }
    return true
  }

  async function book(s: SevaShift) {
    setError('')
    if (!ensureIdentity()) return
    setBusyId(s.id)
    try {
      await api.bookSeva(s.id, { name: name.trim(), email: email.trim() }, donorToken || undefined)
      setBooked(prev => new Set(prev).add(s.id))
      await loadMine(email.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Booking failed. Please try again.')
    } finally { setBusyId('') }
  }

  async function offer() {
    setError(''); setAvailMsg('')
    if (!ensureIdentity()) return
    try {
      await api.offerSevaAvailability({ name: name.trim(), email: email.trim(), branch_id: branchId || 'main', note: availNote.trim() }, donorToken || undefined)
      setAvailMsg('🙏 Thank you — we\'ll be in touch when there\'s seva that fits.')
      setAvailNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please try again.')
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-28">
      <button onClick={() => setScreen('browse')} className="text-sm font-medium mb-4" style={{ color: 'rgba(255,248,220,0.4)' }}>← Back</button>
      <div className="text-center mb-5">
        <div className="text-4xl mb-2">🤝</div>
        <h1 className="font-display font-bold text-2xl text-gold-400 mb-1">Seva at the temple</h1>
        <p className="text-sm" style={{ color: 'rgba(255,248,220,0.55)' }}>Book a slot to help — every hand is a blessing.</p>
      </div>

      {/* Identity */}
      <div className="temple-card p-4 mb-5 space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(212,175,55,0.6)' }}>You</p>
        <div className="flex gap-2">
          <input className={inp} placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
          <input className={inp} type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)} onBlur={() => loadMine(email)} />
        </div>
      </div>

      {error && <p className="text-sm mb-3" style={{ color: '#f87171' }}>{error}</p>}

      {/* My booked seva */}
      {myBookings.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>My booked seva</p>
          <div className="space-y-2">
            {myBookings.map(b => (
              <div key={b.id} className="temple-card p-4 flex items-start justify-between gap-3"
                style={{ borderColor: 'rgba(34,197,94,0.25)' }}>
                <div className="min-w-0">
                  <p className="font-bold text-gold-400">{b.kind === 'festival' && '🌺 '}{b.title}</p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,248,220,0.5)' }}>
                    🕒 {whenLabel(b.starts_at)} · 📍 {branchLabel(b.branch_id)}
                  </p>
                </div>
                <span className="text-xs font-bold px-3 py-1.5 rounded-lg flex-shrink-0"
                  style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80' }}>✓ Booked</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>Open seva needs</p>
      {loading ? (
        <p className="text-center py-10 text-sm" style={{ color: 'rgba(255,248,220,0.4)' }}>Loading…</p>
      ) : shifts.length === 0 ? (
        <div className="temple-card p-5 text-center mb-6">
          <p className="text-sm" style={{ color: 'rgba(255,248,220,0.6)' }}>No open seva right now. Offer your availability below and we'll call on you. 🙏</p>
        </div>
      ) : (
        <div className="space-y-2 mb-6">
          {shifts.map(s => {
            const isBooked = bookedIds.has(s.id)
            const full = s.spots_left <= 0
            return (
              <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="temple-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-gold-400">{s.title}</p>
                    {s.description && <p className="text-xs mt-0.5" style={{ color: 'rgba(255,248,220,0.55)' }}>{s.description}</p>}
                    <p className="text-xs mt-1" style={{ color: 'rgba(255,248,220,0.45)' }}>
                      🕒 {whenLabel(s.starts_at)} · 📍 {branchLabel(s.branch_id)} · {s.booked}/{s.needed} booked
                    </p>
                  </div>
                  {isBooked ? (
                    <span className="text-xs font-bold px-3 py-1.5 rounded-lg flex-shrink-0" style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80' }}>✓ Booked</span>
                  ) : (
                    <button onClick={() => book(s)} disabled={busyId === s.id || full}
                      className="text-xs font-black px-3 py-1.5 rounded-lg flex-shrink-0 disabled:opacity-50"
                      style={full ? { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.4)' }
                                  : { background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
                      {busyId === s.id ? '…' : full ? 'Full' : `Book · ${s.spots_left} left`}
                    </button>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Availability */}
      <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>Can't make these times?</p>
      <div className="temple-card p-4">
        <p className="text-xs mb-2" style={{ color: 'rgba(255,248,220,0.55)' }}>Tell us when you're free and what you'd like to help with — a trustee will match you.</p>
        <textarea className={inp} rows={2} placeholder="e.g. free Sunday mornings, happy to help with langar"
          value={availNote} onChange={e => setAvailNote(e.target.value)} />
        <button onClick={offer} className="w-full mt-2 py-2.5 rounded-xl font-bold text-sm"
          style={{ background: 'rgba(212,175,55,0.15)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.3)' }}>
          Offer my availability
        </button>
        {availMsg && <p className="text-sm text-center mt-2" style={{ color: '#4ade80' }}>{availMsg}</p>}
      </div>
    </div>
  )
}
