'use client'
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

interface Shift {
  id: string; branch_id: string; title: string; description: string
  starts_at: string; needed: number; status: string; created_at: string
  kind: string; recurrence: string; series_id: string | null; booked: number
}
interface Booking { id: string; name: string; email: string; phone: string; status: string; booked_at: string }
interface Avail { id: string; name: string; email: string; branch_id: string; note: string; created_at: string }
interface Group {
  id: string; branch_id: string; name: string; description: string; status: string
  members: number; staff: number; volunteers: number
}
interface Member { id: string; member_type: string; name: string; email: string; phone: string; added_at: string }

const BRANCHES = [
  { id: 'wembley', label: 'Wembley' }, { id: 'leicester', label: 'Leicester' },
  { id: 'reading', label: 'Reading' }, { id: 'milton_keynes', label: 'Milton Keynes' },
  { id: 'main', label: 'All / Main' },
]
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
type Rec = 'once' | 'weekly' | 'daily'

const EMPTY = {
  branch_id: 'wembley', title: '', description: '', needed: 4, kind: 'regular' as 'regular' | 'festival',
  recurrence: 'once' as Rec, starts_at: '', time: '12:30', weekdays: [] as number[], weeks: 8, days: 30, start_date: '',
}

const card = 'glass rounded-2xl p-5'
const field = 'w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 outline-none focus:border-saffron-400/50'
const lbl = 'text-xs font-semibold text-white/50 mb-1 block'

export default function SevaPage() {
  const [shifts, setShifts] = useState<Shift[]>([])
  const [avail, setAvail] = useState<Avail[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [f, setF] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [openBookings, setOpenBookings] = useState<Record<string, Booking[]>>({})

  // Groups
  const [gForm, setGForm] = useState({ name: '', description: '', branch_id: 'wembley' })
  const [gMsg, setGMsg] = useState('')
  const [openMembers, setOpenMembers] = useState<Record<string, Member[]>>({})
  const [mForm, setMForm] = useState<Record<string, { name: string; email: string; phone: string; member_type: string }>>({})

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF(p => ({ ...p, [k]: v }))

  const load = useCallback(async () => {
    try {
      const [s, a, g] = await Promise.all([
        apiFetch<{ shifts: Shift[] }>('/admin/seva/shifts'),
        apiFetch<{ availability: Avail[] }>('/admin/seva/availability'),
        apiFetch<{ groups: Group[] }>('/admin/seva/groups'),
      ])
      setShifts(s.shifts || []); setAvail(a.availability || []); setGroups(g.groups || [])
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { load() }, [load])

  async function createGroup() {
    setGMsg('')
    if (!gForm.name.trim()) { setGMsg('Give the group a name.'); return }
    try {
      await apiFetch('/admin/seva/groups', { method: 'POST', body: JSON.stringify(gForm) })
      setGForm({ name: '', description: '', branch_id: gForm.branch_id }); setGMsg('✓ Group created.')
      await load()
    } catch (e) { setGMsg(e instanceof Error ? e.message : 'Failed to create group') }
  }
  async function archiveGroup(id: string, status: string) {
    await apiFetch(`/admin/seva/groups/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await load()
  }
  async function toggleMembers(id: string) {
    if (openMembers[id]) { setOpenMembers(p => { const n = { ...p }; delete n[id]; return n }); return }
    const d = await apiFetch<{ members: Member[] }>(`/admin/seva/groups/${id}/members`)
    setOpenMembers(p => ({ ...p, [id]: d.members || [] }))
  }
  async function addMember(id: string) {
    const m = mForm[id] || { name: '', email: '', phone: '', member_type: 'volunteer' }
    if (!m.name.trim() || !m.email.includes('@')) { setGMsg('Member needs a name and a valid email.'); return }
    setGMsg('')
    try {
      await apiFetch(`/admin/seva/groups/${id}/members`, { method: 'POST', body: JSON.stringify(m) })
      setMForm(p => ({ ...p, [id]: { name: '', email: '', phone: '', member_type: m.member_type } }))
      const d = await apiFetch<{ members: Member[] }>(`/admin/seva/groups/${id}/members`)
      setOpenMembers(p => ({ ...p, [id]: d.members || [] }))
      await load()
    } catch (e) { setGMsg(e instanceof Error ? e.message : 'Failed to add member') }
  }
  async function removeMember(gid: string, mid: string) {
    await apiFetch(`/admin/seva/groups/${gid}/members/${mid}`, { method: 'DELETE' })
    const d = await apiFetch<{ members: Member[] }>(`/admin/seva/groups/${gid}/members`)
    setOpenMembers(p => ({ ...p, [gid]: d.members || [] }))
    await load()
  }
  const mSet = (gid: string, k: 'name' | 'email' | 'phone' | 'member_type', v: string) =>
    setMForm(p => {
      const cur = p[gid] || { name: '', email: '', phone: '', member_type: 'volunteer' }
      return { ...p, [gid]: { ...cur, [k]: v } }
    })

  async function publish() {
    setMsg('')
    if (!f.title.trim()) { setMsg('Add what\'s needed.'); return }
    if (f.recurrence === 'once' && !f.starts_at) { setMsg('Pick a date & time.'); return }
    if (f.recurrence === 'weekly' && f.weekdays.length === 0) { setMsg('Pick at least one day of the week.'); return }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        branch_id: f.branch_id, title: f.title, description: f.description,
        needed: Number(f.needed) || 1, kind: f.kind, recurrence: f.recurrence,
      }
      if (f.recurrence === 'once') body.starts_at = f.starts_at
      else { body.time = f.time; body.start_date = f.start_date; if (f.recurrence === 'weekly') { body.weekdays = f.weekdays; body.weeks = f.weeks } else body.days = f.days }
      const r = await apiFetch<{ created: number }>('/admin/seva/shifts', { method: 'POST', body: JSON.stringify(body) })
      setF({ ...EMPTY }); setMsg(`✓ Published ${r.created} seva ${r.created === 1 ? 'slot' : 'slots'}.`)
      await load()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed to publish') }
    finally { setSaving(false) }
  }

  async function closeShift(id: string, status: string) {
    await apiFetch(`/admin/seva/shifts/${id}?status=${status}`, { method: 'PATCH' }); await load()
  }
  async function closeSeries(seriesId: string) {
    await apiFetch(`/admin/seva/series/${seriesId}?status=CLOSED`, { method: 'PATCH' }); await load()
  }
  async function toggleBookings(id: string) {
    if (openBookings[id]) { setOpenBookings(p => { const n = { ...p }; delete n[id]; return n }); return }
    const d = await apiFetch<{ bookings: Booking[] }>(`/admin/seva/shifts/${id}/bookings`)
    setOpenBookings(p => ({ ...p, [id]: d.bookings || [] }))
  }
  const toggleWeekday = (i: number) => set('weekdays', f.weekdays.includes(i) ? f.weekdays.filter(x => x !== i) : [...f.weekdays, i])
  const fmt = (s: string) => s ? new Date(s).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

  const seg = (active: boolean) => `px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${active ? 'bg-saffron-gradient text-white' : 'bg-white/5 text-white/60 border border-white/10'}`

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-black text-white">Seva Shifts</h1>
        <p className="text-white/40 mt-1">Publish a seva need — one-off, a weekly day (e.g. every Monday), daily, or a festival. Volunteers book on the service portal / app.</p>
      </div>

      {/* Publish */}
      <div className={card}>
        <p className="text-xs font-bold uppercase tracking-widest text-saffron-300 mb-4">Publish a seva need</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={lbl}>What&apos;s needed</label>
            <input className={field} placeholder="e.g. Fill the food containers" value={f.title} onChange={e => set('title', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Details (optional)</label>
            <input className={field} placeholder="Anything volunteers should know" value={f.description} onChange={e => set('description', e.target.value)} />
          </div>

          {/* Repeats */}
          <div className="sm:col-span-2">
            <label className={lbl}>Repeats</label>
            <div className="flex gap-2 flex-wrap">
              <button type="button" className={seg(f.recurrence === 'once')} onClick={() => set('recurrence', 'once')}>One-off date</button>
              <button type="button" className={seg(f.recurrence === 'weekly')} onClick={() => set('recurrence', 'weekly')}>Weekly (days)</button>
              <button type="button" className={seg(f.recurrence === 'daily')} onClick={() => set('recurrence', 'daily')}>Daily</button>
            </div>
          </div>

          {f.recurrence === 'once' && (
            <div className="sm:col-span-2">
              <label className={lbl}>Date &amp; time</label>
              <input type="datetime-local" className={field} value={f.starts_at} onChange={e => set('starts_at', e.target.value)} />
            </div>
          )}

          {f.recurrence === 'weekly' && (
            <>
              <div className="sm:col-span-2">
                <label className={lbl}>On these days</label>
                <div className="flex gap-1.5 flex-wrap">
                  {WEEKDAYS.map((w, i) => (
                    <button key={w} type="button" onClick={() => toggleWeekday(i)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold ${f.weekdays.includes(i) ? 'bg-saffron-gradient text-white' : 'bg-white/5 text-white/60 border border-white/10'}`}>{w}</button>
                  ))}
                </div>
              </div>
              <div><label className={lbl}>Time</label><input type="time" className={field} value={f.time} onChange={e => set('time', e.target.value)} /></div>
              <div><label className={lbl}>For how many weeks</label><input type="number" min={1} max={12} className={field} value={f.weeks} onChange={e => set('weeks', Number(e.target.value))} /></div>
            </>
          )}

          {f.recurrence === 'daily' && (
            <>
              <div><label className={lbl}>Time</label><input type="time" className={field} value={f.time} onChange={e => set('time', e.target.value)} /></div>
              <div><label className={lbl}>For how many days</label><input type="number" min={1} max={60} className={field} value={f.days} onChange={e => set('days', Number(e.target.value))} /></div>
            </>
          )}
          {f.recurrence !== 'once' && (
            <div className="sm:col-span-2"><label className={lbl}>Starting from (optional — defaults to today)</label>
              <input type="date" className={field} value={f.start_date} onChange={e => set('start_date', e.target.value)} /></div>
          )}

          <div><label className={lbl}>People needed</label><input type="number" min={1} className={field} value={f.needed} onChange={e => set('needed', Number(e.target.value))} /></div>
          <div><label className={lbl}>Temple</label>
            <select className={field} value={f.branch_id} onChange={e => set('branch_id', e.target.value)}>
              {BRANCHES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>

          <label className="sm:col-span-2 flex items-center gap-2 cursor-pointer mt-1">
            <input type="checkbox" checked={f.kind === 'festival'} onChange={e => set('kind', e.target.checked ? 'festival' : 'regular')} className="accent-saffron-400" />
            <span className="text-sm text-white/70">🌺 Festival / special day</span>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={publish} disabled={saving} className="px-6 py-2 rounded-xl font-black text-sm bg-saffron-gradient text-white disabled:opacity-50">
            {saving ? 'Publishing…' : 'Publish seva'}
          </button>
          {msg && <span className="text-sm text-saffron-300">{msg}</span>}
        </div>
      </div>

      {/* Published */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-saffron-300 mb-3">Published seva</p>
        <div className="space-y-2">
          {shifts.length === 0 && <p className="text-white/40 text-sm">None yet.</p>}
          {shifts.map(s => (
            <div key={s.id} className={card + ' !p-4'}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-bold text-white">
                    {s.kind === 'festival' && <span className="mr-1">🌺</span>}{s.title}
                    <span className="text-white/40 text-xs font-normal"> · {s.branch_id}</span>
                    {s.status !== 'OPEN' && <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-white/50">{s.status}</span>}
                  </p>
                  <p className="text-xs text-white/50 mt-0.5">🕒 {fmt(s.starts_at)} · <b className="text-saffron-300">{s.booked}/{s.needed}</b> booked
                    {s.recurrence && s.recurrence !== 'ONCE' && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">{s.recurrence.toLowerCase()}</span>}</p>
                  {s.description && <p className="text-xs text-white/40 mt-0.5">{s.description}</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => toggleBookings(s.id)} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70">{openBookings[s.id] ? 'Hide' : 'Bookings'}</button>
                  {s.status === 'OPEN'
                    ? <button onClick={() => closeShift(s.id, 'CLOSED')} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70">Close</button>
                    : <button onClick={() => closeShift(s.id, 'OPEN')} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70">Reopen</button>}
                  {s.series_id && <button onClick={() => closeSeries(s.series_id!)} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-300">Close series</button>}
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
      </div>

      {/* Groups */}
      <div className={card}>
        <p className="text-xs font-bold uppercase tracking-widest text-saffron-300 mb-1">Groups</p>
        <p className="text-white/40 text-sm mb-4">Create a group (e.g. Palki group, cooking help) and add staff &amp; volunteer members.</p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className={lbl}>Group name</label>
            <input className={field} placeholder="e.g. Palki group" value={gForm.name} onChange={e => setGForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Temple</label>
            <select className={field} value={gForm.branch_id} onChange={e => setGForm(p => ({ ...p, branch_id: e.target.value }))}>
              {BRANCHES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={createGroup} className="w-full px-4 py-2 rounded-xl font-black text-sm bg-saffron-gradient text-white">Create group</button>
          </div>
          <div className="sm:col-span-4">
            <label className={lbl}>What the group is for (optional)</label>
            <input className={field} placeholder="Short description" value={gForm.description} onChange={e => setGForm(p => ({ ...p, description: e.target.value }))} />
          </div>
        </div>
        {gMsg && <p className="text-sm text-saffron-300 mt-3">{gMsg}</p>}

        <div className="space-y-2 mt-5">
          {groups.length === 0 && <p className="text-white/40 text-sm">No groups yet.</p>}
          {groups.map(g => (
            <div key={g.id} className="rounded-xl p-4 bg-white/[0.03] border border-white/5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-bold text-white">
                    {g.name}
                    <span className="text-white/40 text-xs font-normal"> · {g.branch_id}</span>
                    {g.status !== 'ACTIVE' && <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-white/50">{g.status}</span>}
                  </p>
                  <p className="text-xs text-white/50 mt-0.5">
                    👥 <b className="text-saffron-300">{g.members}</b> members · {g.staff} staff · {g.volunteers} volunteers
                  </p>
                  {g.description && <p className="text-xs text-white/40 mt-0.5">{g.description}</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => toggleMembers(g.id)} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70">{openMembers[g.id] ? 'Hide' : 'Members'}</button>
                  {g.status === 'ACTIVE'
                    ? <button onClick={() => archiveGroup(g.id, 'ARCHIVED')} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70">Archive</button>
                    : <button onClick={() => archiveGroup(g.id, 'ACTIVE')} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70">Restore</button>}
                </div>
              </div>

              {openMembers[g.id] && (
                <div className="mt-3 border-t border-white/10 pt-3 space-y-2">
                  {openMembers[g.id].length === 0 && <p className="text-xs text-white/40">No members yet.</p>}
                  {openMembers[g.id].map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-white/70">
                        <span className={`mr-1.5 px-1.5 py-0.5 rounded ${m.member_type === 'staff' ? 'bg-saffron-400/20 text-saffron-300' : 'bg-white/10 text-white/50'}`}>{m.member_type}</span>
                        <b className="text-white">{m.name}</b> · {m.email}{m.phone ? ` · ${m.phone}` : ''}
                      </span>
                      <button onClick={() => removeMember(g.id, m.id)} className="text-red-300/70 hover:text-red-300 px-2">Remove</button>
                    </div>
                  ))}
                  {/* Add member */}
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-2">
                    <input className={field + ' sm:col-span-1'} placeholder="Name" value={mForm[g.id]?.name || ''} onChange={e => mSet(g.id, 'name', e.target.value)} />
                    <input className={field + ' sm:col-span-2'} placeholder="Email" value={mForm[g.id]?.email || ''} onChange={e => mSet(g.id, 'email', e.target.value)} />
                    <input className={field} placeholder="Phone (optional)" value={mForm[g.id]?.phone || ''} onChange={e => mSet(g.id, 'phone', e.target.value)} />
                    <div className="flex gap-1">
                      <select className={field} value={mForm[g.id]?.member_type || 'volunteer'} onChange={e => mSet(g.id, 'member_type', e.target.value)}>
                        <option value="volunteer">Volunteer</option>
                        <option value="staff">Staff</option>
                      </select>
                      <button onClick={() => addMember(g.id)} className="px-3 rounded-xl font-black text-sm bg-saffron-gradient text-white">Add</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Availability */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-saffron-300 mb-3">Volunteers who offered availability</p>
        <div className="space-y-1.5">
          {avail.length === 0 && <p className="text-white/40 text-sm">None yet.</p>}
          {avail.map(a => (
            <div key={a.id} className="rounded-xl px-4 py-2.5 bg-white/[0.03] border border-white/5">
              <span className="font-bold text-white text-sm">{a.name}</span>
              <span className="text-white/40 text-xs"> · {a.email} · {a.branch_id}</span>
              {a.note && <p className="text-xs text-white/50 mt-0.5">{a.note}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
