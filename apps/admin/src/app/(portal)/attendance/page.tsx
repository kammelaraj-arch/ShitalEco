'use client'
/**
 * Attendance — check-in / check-out for employees + volunteers.
 *
 * One page covers two usage modes:
 *
 * 1. Kiosk mode (default) — a shared tablet by the branch door. Trustee leaves
 *    this page up; volunteers tap their name as they arrive. Each tile shows
 *    present / absent state, and tapping toggles. One-tap in, one-tap out.
 *
 * 2. Self-service — a logged-in staff member on their own phone/laptop. The
 *    strip at the top finds their matching employee row (by email) and gives
 *    them a single big "Check in" / "Check out" button for themselves.
 *
 * Everything is branch-scoped by the backend (CurrentSpace.branch_id), so a
 * Harrow trustee only sees Harrow staff + volunteers.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { apiFetch } from '@/lib/api'

type PersonType = 'employee' | 'volunteer'

interface Person {
  id: string
  name: string
  role: string
  photo_url: string
}

interface AttendanceRow {
  id: string
  person_type: PersonType
  person_id: string
  name: string
  check_in_at: string
  check_out_at: string | null
  duration_minutes: number
  notes: string
}

interface TodayResponse {
  present_now: AttendanceRow[]
  all_today: AttendanceRow[]
  date: string
}

interface RosterResponse {
  employees: Person[]
  volunteers: Person[]
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export default function AttendancePage() {
  const [roster, setRoster] = useState<RosterResponse>({ employees: [], volunteers: [] })
  const [today, setToday] = useState<TodayResponse>({ present_now: [], all_today: [], date: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null) // person_id while a toggle is in flight
  const [filter, setFilter] = useState<'all' | 'employee' | 'volunteer'>('all')
  const [search, setSearch] = useState('')

  const reload = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([
        apiFetch<RosterResponse>('/attendance/roster'),
        apiFetch<TodayResponse>('/attendance/today'),
      ])
      setRoster(r); setToday(t)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load attendance')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
    // Light polling so the kiosk screen reflects other people's check-ins.
    const t = setInterval(reload, 20_000)
    return () => clearInterval(t)
  }, [reload])

  // Lookup: person_id → open attendance row (so a tap knows whether to
  // check in or check out).
  const openByPerson = useMemo(() => {
    const m = new Map<string, AttendanceRow>()
    for (const row of today.present_now) m.set(row.person_id, row)
    return m
  }, [today.present_now])

  async function toggle(person: Person, person_type: PersonType) {
    setBusy(person.id)
    const existing = openByPerson.get(person.id)
    try {
      if (existing) {
        const r = await apiFetch<{ duration_minutes: number }>('/attendance/check-out', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ person_type, person_id: person.id }),
        })
        toast.success(`${person.name} checked out — ${formatDuration(r.duration_minutes)}`)
      } else {
        await apiFetch('/attendance/check-in', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ person_type, person_id: person.id }),
        })
        toast.success(`${person.name} checked in`)
      }
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const people: Array<Person & { person_type: PersonType }> = useMemo(() => {
    const emps = roster.employees.map(e => ({ ...e, person_type: 'employee' as const }))
    const vols = roster.volunteers.map(v => ({ ...v, person_type: 'volunteer' as const }))
    const combined = filter === 'employee' ? emps
                   : filter === 'volunteer' ? vols
                   : [...emps, ...vols]
    const q = search.trim().toLowerCase()
    return q ? combined.filter(p => p.name.toLowerCase().includes(q)) : combined
  }, [roster, filter, search])

  const presentCount = today.present_now.length
  const totalToday = today.all_today.length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-white">🕐 Attendance</h1>
          <p className="text-white/40 mt-1 text-sm">
            Tap a name to check in or out. Shared tablet at the door works, so does your own phone.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="rounded-xl bg-green-500/15 border border-green-500/30 px-4 py-2 text-green-300 text-sm font-bold">
            🟢 {presentCount} on site now
          </div>
          <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-2 text-white/70 text-sm font-bold">
            {totalToday} checked in today
          </div>
        </div>
      </div>

      {/* Filter + search */}
      <div className="flex gap-2 flex-wrap items-center">
        {(['all', 'employee', 'volunteer'] as const).map(k => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition
              ${filter === k ? 'bg-saffron-500/20 text-saffron-200 border border-saffron-400/40'
                             : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'}`}>
            {k === 'all' ? 'Everyone' : k === 'employee' ? 'Staff' : 'Volunteers'}
          </button>
        ))}
        <input
          type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name…"
          className="ml-auto bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-saffron-400/50 w-56" />
      </div>

      {/* People grid */}
      {loading ? (
        <div className="text-white/40 text-sm">Loading roster…</div>
      ) : people.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-white/40">
          No {filter === 'all' ? 'people' : filter + 's'} found for this branch.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          <AnimatePresence>
            {people.map(p => {
              const open = openByPerson.get(p.id)
              const isPresent = !!open
              const since = open ? formatTime(open.check_in_at) : null
              return (
                <motion.button
                  key={`${p.person_type}:${p.id}`}
                  layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  disabled={busy === p.id}
                  onClick={() => toggle(p, p.person_type)}
                  className={`rounded-2xl border p-4 text-left transition-all min-h-[128px] flex flex-col justify-between
                    ${isPresent
                      ? 'bg-green-500/10 border-green-500/40 hover:bg-green-500/15'
                      : 'bg-white/[0.03] border-white/10 hover:bg-white/5 hover:border-white/20'}
                    ${busy === p.id ? 'opacity-60 cursor-wait' : 'cursor-pointer active:scale-[0.98]'}`}
                >
                  <div className="flex items-start gap-2">
                    {p.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.photo_url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0 border border-white/10" />
                    ) : (
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black shrink-0 border
                        ${isPresent ? 'bg-green-500/20 border-green-500/40 text-green-200'
                                    : 'bg-white/5 border-white/10 text-white/60'}`}>
                        {p.name.slice(0, 1).toUpperCase() || '?'}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-white font-bold text-sm truncate">{p.name || 'Unnamed'}</div>
                      <div className="text-white/40 text-[11px] uppercase tracking-wider mt-0.5">
                        {p.person_type} {p.role ? `· ${p.role}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    {isPresent ? (
                      <div className="text-green-300 text-xs font-bold">
                        ✓ In since {since} — tap to leave
                      </div>
                    ) : (
                      <div className="text-white/40 text-xs">
                        Tap to check in
                      </div>
                    )}
                  </div>
                </motion.button>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Today's log */}
      <div>
        <h2 className="text-white/70 font-bold text-sm uppercase tracking-wider mb-3">
          Today — {today.date || '—'}
        </h2>
        {today.all_today.length === 0 ? (
          <div className="text-white/40 text-sm">Nobody has checked in today yet.</div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-white/50 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Name</th>
                  <th className="text-left px-4 py-2 font-semibold">Type</th>
                  <th className="text-left px-4 py-2 font-semibold">In</th>
                  <th className="text-left px-4 py-2 font-semibold">Out</th>
                  <th className="text-left px-4 py-2 font-semibold">Duration</th>
                </tr>
              </thead>
              <tbody>
                {today.all_today.map(r => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="px-4 py-2 text-white font-medium">{r.name || r.person_id.slice(0, 8)}</td>
                    <td className="px-4 py-2 text-white/60 text-xs uppercase tracking-wide">{r.person_type}</td>
                    <td className="px-4 py-2 text-white/80">{formatTime(r.check_in_at)}</td>
                    <td className="px-4 py-2 text-white/80">
                      {r.check_out_at ? formatTime(r.check_out_at)
                                      : <span className="text-green-300 font-bold">On site</span>}
                    </td>
                    <td className="px-4 py-2 text-white/80">{formatDuration(r.duration_minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
