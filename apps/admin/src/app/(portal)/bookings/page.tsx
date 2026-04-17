'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Booking {
  id: string
  title: string
  room: string
  booking_date: string
  start_time: string
  end_time: string
  organiser_name: string
  organiser_email: string
  organiser_phone: string
  attendees: number
  status: string
  description: string
  notes: string
}

interface BookingForm {
  title: string
  room: string
  booking_date: string
  start_time: string
  end_time: string
  organiser_name: string
  organiser_email: string
  organiser_phone: string
  attendees: string
  description: string
  notes: string
}

const ROOMS = ['Main Hall', 'Prayer Room', 'Meeting Room', 'Kitchen', 'Courtyard']

const EMPTY_FORM: BookingForm = {
  title: '', room: 'Main Hall', booking_date: '', start_time: '09:00', end_time: '10:00',
  organiser_name: '', organiser_email: '', organiser_phone: '', attendees: '',
  description: '', notes: '',
}

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED:  'bg-green-500/20 text-green-400 border-green-500/30',
  CANCELLED:  'bg-red-500/20 text-red-400 border-red-500/30',
  PENDING:    'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
}

const ROOM_COLORS: Record<string, string> = {
  'Main Hall':    'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Prayer Room':  'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'Meeting Room': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'Kitchen':      'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'Courtyard':    'bg-green-500/20 text-green-400 border-green-500/30',
}

function getWeekRange(): { from: string; to: string } {
  const today = new Date()
  const day = today.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const mon = new Date(today)
  mon.setDate(today.getDate() + diffToMon)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { from: fmt(mon), to: fmt(sun) }
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

export default function BookingsPage() {
  const { from: defaultFrom, to: defaultTo } = getWeekRange()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fromDate, setFromDate] = useState(defaultFrom)
  const [toDate, setToDate] = useState(defaultTo)
  const [roomFilter, setRoomFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<BookingForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams()
      if (fromDate) params.set('from_date', fromDate)
      if (toDate) params.set('to_date', toDate)
      const res = await apiFetch<{ bookings: Booking[] }>(`/bookings?${params}`)
      setBookings(res.bookings || [])
    } catch {
      setError('Failed to load bookings')
    } finally { setLoading(false) }
  }, [fromDate, toDate])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!form.title.trim()) { setError('Title is required'); return }
    if (!form.booking_date) { setError('Booking date is required'); return }
    setError('')
    setSaving(true)
    try {
      await apiFetch('/bookings', {
        method: 'POST',
        body: JSON.stringify({ ...form, attendees: parseInt(form.attendees) || 0 }),
      })
      setShowForm(false)
      setForm(EMPTY_FORM)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create booking')
    } finally { setSaving(false) }
  }

  const cancel = async (id: string) => {
    if (!confirm('Cancel this booking?')) return
    setCancelling(id)
    try {
      await apiFetch(`/bookings/${id}`, { method: 'DELETE' })
      await load()
    } catch {
      setError('Failed to cancel booking')
    } finally { setCancelling(null) }
  }

  const filtered = roomFilter ? bookings.filter(b => b.room === roomFilter) : bookings
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayCount = bookings.filter(b => b.booking_date.slice(0, 10) === todayStr).length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Bookings</h1>
          <p className="text-white/40 mt-1">Temple hall and room bookings — live from database</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90">
          + New Booking
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Today's Bookings", value: loading ? '—' : String(todayCount), icon: '📅', color: 'from-blue-600 to-indigo-500' },
          { label: 'This Period', value: loading ? '—' : String(bookings.length), icon: '🗓️', color: 'from-green-600 to-emerald-500' },
          { label: 'Total Rooms', value: String(ROOMS.length), icon: '🏛️', color: 'from-amber-600 to-orange-500' },
          { label: 'Confirmed', value: loading ? '—' : String(bookings.filter(b => b.status === 'CONFIRMED').length), icon: '✅', color: 'from-purple-600 to-violet-500' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="glass rounded-2xl p-5 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-lg mb-3`}>{s.icon}</div>
            <p className="text-white/50 text-xs font-medium">{s.label}</p>
            <p className="text-3xl font-black text-white mt-1">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Date range + room filter */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex items-center gap-2">
          <label className="text-white/40 text-xs font-semibold uppercase tracking-wide">From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-saffron-400/50" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-white/40 text-xs font-semibold uppercase tracking-wide">To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-saffron-400/50" />
        </div>
        <div className="h-4 border-l border-white/10" />
        {['', ...ROOMS].map(r => (
          <button key={r || 'all'} onClick={() => setRoomFilter(r)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              roomFilter === r
                ? 'bg-saffron-400/20 text-saffron-400 border-saffron-400/40'
                : 'border-white/10 text-white/40 hover:text-white/70'
            }`}>
            {r || 'All Rooms'}
          </button>
        ))}
      </div>

      {/* Bookings list */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="glass rounded-2xl overflow-hidden border border-temple-border">
        {loading ? (
          <div className="text-center py-16 text-white/30">Loading bookings…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-white/30">
            <p className="text-4xl mb-3">🗓️</p>
            <p>{bookings.length === 0 ? 'No bookings in this period.' : 'No bookings match the filter.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Date', 'Title', 'Room', 'Time', 'Organiser', 'Attendees', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => (
                <motion.tr key={b.id}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                  className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-4 py-3 text-white/70 text-sm font-medium whitespace-nowrap">
                    {new Date(b.booking_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-white font-semibold text-sm">{b.title}</p>
                    {b.description && <p className="text-white/30 text-xs truncate max-w-[180px]">{b.description}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${ROOM_COLORS[b.room] || 'bg-white/5 text-white/40 border-white/10'}`}>
                      {b.room}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/60 text-sm font-mono whitespace-nowrap">
                    {b.start_time} – {b.end_time}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-white/70 text-sm">{b.organiser_name || '—'}</p>
                    {b.organiser_email && <p className="text-white/30 text-xs">{b.organiser_email}</p>}
                  </td>
                  <td className="px-4 py-3 text-white/60 text-sm text-center">{b.attendees || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${STATUS_COLORS[b.status] || 'bg-white/5 text-white/40 border-white/10'}`}>
                      {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {b.status === 'CONFIRMED' && (
                      <button onClick={() => cancel(b.id)} disabled={cancelling === b.id}
                        className="text-white/30 hover:text-red-400 text-xs font-semibold transition-colors disabled:opacity-40">
                        {cancelling === b.id ? '…' : 'Cancel'}
                      </button>
                    )}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table></div>
        )}
      </motion.div>

      {/* New Booking slide-over */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-[500px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">New Booking</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div>
                  <label className={lbl}>Title *</label>
                  <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inp} placeholder="e.g. Satsang Evening" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Room</label>
                    <select value={form.room} onChange={e => setForm(p => ({ ...p, room: e.target.value }))} className={inp}>
                      {ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Date *</label>
                    <input type="date" value={form.booking_date} onChange={e => setForm(p => ({ ...p, booking_date: e.target.value }))} className={inp} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Start Time</label>
                    <input type="time" value={form.start_time} onChange={e => setForm(p => ({ ...p, start_time: e.target.value }))} className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>End Time</label>
                    <input type="time" value={form.end_time} onChange={e => setForm(p => ({ ...p, end_time: e.target.value }))} className={inp} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Organiser Name</label>
                    <input value={form.organiser_name} onChange={e => setForm(p => ({ ...p, organiser_name: e.target.value }))} className={inp} placeholder="Full name" />
                  </div>
                  <div>
                    <label className={lbl}>Attendees</label>
                    <input type="number" min="0" value={form.attendees} onChange={e => setForm(p => ({ ...p, attendees: e.target.value }))} className={inp} placeholder="0" />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Organiser Email</label>
                  <input type="email" value={form.organiser_email} onChange={e => setForm(p => ({ ...p, organiser_email: e.target.value }))} className={inp} placeholder="organiser@example.com" />
                </div>
                <div>
                  <label className={lbl}>Description</label>
                  <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} className={inp + ' resize-none'} placeholder="Brief description of the event" />
                </div>
                <div>
                  <label className={lbl}>Notes</label>
                  <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className={inp + ' resize-none'} placeholder="Any special requirements" />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={save} disabled={saving || !form.title.trim() || !form.booking_date}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {saving ? 'Saving…' : 'Confirm Booking'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
