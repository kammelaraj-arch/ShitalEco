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
  const [pinMsg, setPinMsg] = useState('')       // "your cancellation PIN is …"
  const [cancelId, setCancelId] = useState('')   // booking id being withdrawn
  const [cancelPin, setCancelPin] = useState('')
  const [cancelErr, setCancelErr] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)

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
  // Hide slots the caller already booked from "Open seva needs" so they can't
  // book the same slot twice — those appear in the "My booked seva" section.
  const openShifts = shifts.filter(s => !bookedIds.has(s.id))

  function ensureIdentity(): boolean {
    if (!name.trim() || !email.includes('@')) {
      setError('Please add your name and email at the top first.')
      return false
    }
    return true
  }

  async function book(s: SevaShift) {
    setError(''); setPinMsg('')
    if (!ensureIdentity()) return
    setBusyId(s.id)
    try {
      const r = await api.bookSeva(s.id, { name: name.trim(), email: email.trim() }, donorToken || undefined)
      setBooked(prev => new Set(prev).add(s.id))
      if (r.cancel_pin) setPinMsg(`✓ Booked! Your cancellation PIN is ${r.cancel_pin} — keep it if you might need to withdraw.`)
      await loadMine(email.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Booking failed. Please try again.')
    } finally { setBusyId('') }
  }

  function startCancel(b: SevaBooking) {
    setCancelErr(''); setCancelPin(b.cancel_pin || ''); setCancelId(b.id)
  }
  async function confirmCancel() {
    setCancelErr('')
    if (!cancelPin.trim()) { setCancelErr('Enter your PIN.'); return }
    setCancelBusy(true)
    try {
      await api.cancelSevaBooking(cancelId, cancelPin.trim(), donorToken || undefined)
      setCancelId(''); setCancelPin(''); setBooked(new Set())
      await loadMine(email.trim())
    } catch (e) {
      setCancelErr(e instanceof Error ? e.message : 'Could not cancel.')
    } finally { setCancelBusy(false) }
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
        <a href="https://github.com/kammelaraj-arch/ShitalEco/releases/download/kiosk-latest/shital-seva-latest.apk"
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 mt-3 text-xs font-bold px-3 py-1.5 rounded-lg"
          style={{ background: 'rgba(212,175,55,0.15)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.3)' }}>
          📲 Get the Seva app (Android)
        </a>
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
      {pinMsg && (
        <p className="text-sm mb-3 px-3 py-2 rounded-lg"
          style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#86efac' }}>{pinMsg}</p>
      )}

      {/* My booked seva */}
      {myBookings.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>My booked seva</p>
          <div className="space-y-2">
            {myBookings.map(b => (
              <div key={b.id} className="temple-card p-4" style={{ borderColor: 'rgba(34,197,94,0.25)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-gold-400">{b.kind === 'festival' && '🌺 '}{b.title}</p>
                    <p className="text-xs mt-1" style={{ color: 'rgba(255,248,220,0.5)' }}>
                      🕒 {whenLabel(b.starts_at)} · 📍 {branchLabel(b.branch_id)}
                    </p>
                    {b.cancel_pin && (
                      <p className="text-[11px] mt-1" style={{ color: 'rgba(212,175,55,0.6)' }}>🔑 Cancellation PIN: <b>{b.cancel_pin}</b></p>
                    )}
                  </div>
                  <span className="text-xs font-bold px-3 py-1.5 rounded-lg flex-shrink-0"
                    style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80' }}>✓ Booked</span>
                </div>

                {cancelId === b.id ? (
                  <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <p className="text-xs" style={{ color: 'rgba(255,248,220,0.6)' }}>Enter your PIN to withdraw this booking:</p>
                    <div className="flex gap-2">
                      <input className={inp} inputMode="numeric" maxLength={8} placeholder="PIN"
                        value={cancelPin} onChange={e => setCancelPin(e.target.value.replace(/\D/g, ''))} />
                      <button onClick={confirmCancel} disabled={cancelBusy}
                        className="text-xs font-black px-4 py-2 rounded-lg flex-shrink-0 disabled:opacity-50"
                        style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}>
                        {cancelBusy ? '…' : 'Withdraw'}
                      </button>
                      <button onClick={() => { setCancelId(''); setCancelErr('') }}
                        className="text-xs font-bold px-3 py-2 rounded-lg flex-shrink-0"
                        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.6)' }}>Keep</button>
                    </div>
                    {cancelErr && <p className="text-xs" style={{ color: '#f87171' }}>{cancelErr}</p>}
                  </div>
                ) : (
                  <button onClick={() => startCancel(b)}
                    className="mt-3 text-xs font-bold px-3 py-1.5 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,248,220,0.6)', border: '1px solid rgba(255,255,255,0.12)' }}>
                    I can't make it →
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>Open seva needs</p>
      {loading ? (
        <p className="text-center py-10 text-sm" style={{ color: 'rgba(255,248,220,0.4)' }}>Loading…</p>
      ) : openShifts.length === 0 ? (
        <div className="temple-card p-5 text-center mb-6">
          <p className="text-sm" style={{ color: 'rgba(255,248,220,0.6)' }}>
            {myBookings.length > 0
              ? 'You\'ve booked all the open seva — thank you! 🙏 Offer more availability below.'
              : 'No open seva right now. Offer your availability below and we\'ll call on you. 🙏'}
          </p>
        </div>
      ) : (
        <div className="space-y-2 mb-6">
          {openShifts.map(s => {
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
                  <button onClick={() => book(s)} disabled={busyId === s.id || full}
                    className="text-xs font-black px-3 py-1.5 rounded-lg flex-shrink-0 disabled:opacity-50"
                    style={full ? { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.4)' }
                                : { background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
                    {busyId === s.id ? '…' : full ? 'Full' : `Book · ${s.spots_left} left`}
                  </button>
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
