'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const ROOMS = ['Main Hall', 'Prayer Room', 'Meeting Room', 'Kitchen', 'Courtyard']

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getWeekDays() {
  const today = new Date()
  const day = today.getDay()
  const diff = today.getDate() - day + (day === 0 ? -6 : 1)
  return DAYS.map((d, i) => {
    const date = new Date(today.setDate(diff + i))
    return { label: d, date: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }
  })
}

export default function BookingsPage() {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', room: ROOMS[0], date: '', start_time: '09:00', end_time: '10:00', purpose: '' })
  const [notice, setNotice] = useState('')
  const weekDays = getWeekDays()

  const submit = () => {
    setShowForm(false)
    setNotice('Booking feature coming soon — this will save to the bookings database in the next release.')
    setTimeout(() => setNotice(''), 5000)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Bookings</h1>
          <p className="text-white/40 mt-1">Temple hall and room bookings</p>
        </div>
        <button onClick={() => setShowForm(true)} className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90">
          + New Booking
        </button>
      </div>

      {notice && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 text-blue-300 text-sm">
          ℹ️ {notice}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Today's Bookings", value: '0', icon: '📅' },
          { label: 'This Week', value: '0', icon: '🗓️' },
          { label: 'This Month', value: '0', icon: '📆' },
          { label: 'Total Rooms', value: String(ROOMS.length), icon: '🏛️' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="glass rounded-2xl p-5">
            <div className="text-2xl mb-2">{s.icon}</div>
            <p className="text-white/50 text-xs font-medium">{s.label}</p>
            <p className="text-3xl font-black text-white mt-1">{s.value}</p>
          </motion.div>
        ))}
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6 overflow-x-auto">
        <h2 className="text-white font-bold text-lg mb-4">This Week</h2>
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left py-3 text-white/40 text-xs font-semibold uppercase tracking-wider pr-4 w-32">Room</th>
              {weekDays.map(d => (
                <th key={d.label} className="text-center py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">
                  <p>{d.label}</p>
                  <p className="text-white/20 font-normal">{d.date}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROOMS.map(room => (
              <tr key={room} className="border-b border-white/5">
                <td className="py-4 text-white/70 text-sm font-medium pr-4">{room}</td>
                {DAYS.map(d => (
                  <td key={d} className="py-4 text-center">
                    <div className="mx-1 h-12 rounded-lg bg-white/3 border border-white/5 flex items-center justify-center text-white/20 text-xs">—</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>

      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-[460px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">New Booking</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-amber-400 text-xs">
                  🚧 Bookings database module coming soon. This form preview is for reference.
                </div>
                <div>
                  <label className={lbl}>Booked By</label>
                  <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inp} placeholder="Booking person name" />
                </div>
                <div>
                  <label className={lbl}>Room</label>
                  <select value={form.room} onChange={e => setForm(p => ({ ...p, room: e.target.value }))} className={inp}>
                    {ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Date</label>
                  <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} className={inp} />
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
                <div>
                  <label className={lbl}>Purpose</label>
                  <input value={form.purpose} onChange={e => setForm(p => ({ ...p, purpose: e.target.value }))} className={inp} placeholder="e.g. Satsang, Meeting" />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={submit} className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm">Request Booking</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
