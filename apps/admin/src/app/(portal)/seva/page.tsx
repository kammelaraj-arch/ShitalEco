'use client'
import { useState, useEffect, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || '/api/v1'
function token() { return typeof window !== 'undefined' ? (localStorage.getItem('shital_access_token') || '') : '' }
function authHeaders() { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` } }

interface Shift {
  id: string; branch_id: string; title: string; description: string
  starts_at: string; ends_at: string | null; needed: number; status: string
  created_at: string; booked: number
}
interface Booking { id: string; name: string; email: string; phone: string; status: string; booked_at: string }
interface Avail { id: string; name: string; email: string; branch_id: string; note: string; created_at: string }

const EMPTY = { branch_id: 'main', title: '', description: '', starts_at: '', needed: 4 }
const BRANCHES = ['wembley', 'leicester', 'reading', 'milton_keynes', 'main']

export default function SevaPage() {
  const [shifts, setShifts] = useState<Shift[]>([])
  const [avail, setAvail] = useState<Avail[]>([])
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [openBookings, setOpenBookings] = useState<Record<string, Booking[]>>({})

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        fetch(`${API}/admin/seva/shifts`, { headers: authHeaders() }).then(r => r.json()),
        fetch(`${API}/admin/seva/availability`, { headers: authHeaders() }).then(r => r.json()),
      ])
      setShifts(s.shifts || [])
      setAvail(a.availability || [])
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { load() }, [load])

  async function create() {
    setMsg('')
    if (!form.title.trim() || !form.starts_at) { setMsg('Title and date/time are required.'); return }
    setSaving(true)
    try {
      const r = await fetch(`${API}/admin/seva/shifts`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ ...form, needed: Number(form.needed) || 1 }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setForm({ ...EMPTY })
      setMsg('✓ Seva published.')
      await load()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed to publish') }
    finally { setSaving(false) }
  }

  async function setStatus(id: string, status: string) {
    await fetch(`${API}/admin/seva/shifts/${id}?status=${status}`, { method: 'PATCH', headers: authHeaders() })
    await load()
  }
  async function toggleBookings(id: string) {
    if (openBookings[id]) { setOpenBookings(p => { const n = { ...p }; delete n[id]; return n }); return }
    const d = await fetch(`${API}/admin/seva/shifts/${id}/bookings`, { headers: authHeaders() }).then(r => r.json())
    setOpenBookings(p => ({ ...p, [id]: d.bookings || [] }))
  }

  const fmt = (s: string) => s ? new Date(s).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <div className="p-6 max-w-4xl mx-auto text-white/90">
      <h1 className="text-2xl font-black mb-1">Seva shifts</h1>
      <p className="text-white/40 text-sm mb-6">Publish a seva need — e.g. “4 people at 12:30 to fill the food containers”. Volunteers book on the service portal / app.</p>

      {/* Publish */}
      <div className="rounded-2xl p-5 mb-8" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p className="text-xs font-bold uppercase tracking-widest text-amber-300/70 mb-3">Publish a seva need</p>
        <div className="grid grid-cols-2 gap-3">
          <input className="col-span-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" placeholder="What's needed (e.g. Fill food containers)"
            value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <input className="col-span-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" placeholder="Details (optional)"
            value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <label className="text-xs text-white/50">Date &amp; time
            <input type="datetime-local" className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm"
              value={form.starts_at} onChange={e => setForm({ ...form, starts_at: e.target.value })} />
          </label>
          <label className="text-xs text-white/50">People needed
            <input type="number" min={1} className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm"
              value={form.needed} onChange={e => setForm({ ...form, needed: Number(e.target.value) })} />
          </label>
          <label className="text-xs text-white/50 col-span-2">Temple
            <select className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm"
              value={form.branch_id} onChange={e => setForm({ ...form, branch_id: e.target.value })}>
              {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
        </div>
        <button onClick={create} disabled={saving}
          className="mt-3 px-5 py-2 rounded-xl font-bold text-sm bg-amber-500 text-black disabled:opacity-50">
          {saving ? 'Publishing…' : 'Publish seva'}
        </button>
        {msg && <span className="ml-3 text-sm text-amber-300">{msg}</span>}
      </div>

      {/* Shifts */}
      <p className="text-xs font-bold uppercase tracking-widest text-amber-300/70 mb-2">Published seva</p>
      <div className="space-y-2 mb-8">
        {shifts.length === 0 && <p className="text-white/40 text-sm">None yet.</p>}
        {shifts.map(s => (
          <div key={s.id} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-bold">{s.title} <span className="text-white/40 text-xs">· {s.branch_id}</span></p>
                <p className="text-xs text-white/50">🕒 {fmt(s.starts_at)} · <b className="text-amber-300">{s.booked}/{s.needed}</b> booked · {s.status}</p>
                {s.description && <p className="text-xs text-white/40 mt-0.5">{s.description}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => toggleBookings(s.id)} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/15">
                  {openBookings[s.id] ? 'Hide' : 'Bookings'}
                </button>
                {s.status === 'OPEN'
                  ? <button onClick={() => setStatus(s.id, 'CLOSED')} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/15">Close</button>
                  : <button onClick={() => setStatus(s.id, 'OPEN')} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/15">Reopen</button>}
              </div>
            </div>
            {openBookings[s.id] && (
              <div className="mt-3 border-t border-white/10 pt-2 space-y-1">
                {openBookings[s.id].length === 0 && <p className="text-xs text-white/40">No bookings yet.</p>}
                {openBookings[s.id].map(b => (
                  <div key={b.id} className="flex justify-between text-xs text-white/70">
                    <span>{b.name} · {b.email}{b.phone ? ` · ${b.phone}` : ''}</span>
                    <span className="text-white/40">{fmt(b.booked_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Availability */}
      <p className="text-xs font-bold uppercase tracking-widest text-amber-300/70 mb-2">Volunteers who offered availability</p>
      <div className="space-y-1">
        {avail.length === 0 && <p className="text-white/40 text-sm">None yet.</p>}
        {avail.map(a => (
          <div key={a.id} className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <span className="font-bold">{a.name}</span> <span className="text-white/40">· {a.email} · {a.branch_id}</span>
            {a.note && <p className="text-xs text-white/50 mt-0.5">{a.note}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
