'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

type MeetingType = 'TRUSTEE_MEETING' | 'COMMITTEE' | 'AGM' | 'EMERGENCY'
type MeetingMode = 'IN_PERSON' | 'VIRTUAL' | 'HYBRID'
type MeetingStatus = 'SCHEDULED' | 'OPENED' | 'CLOSED' | 'CANCELLED'

interface Meeting {
  id: string
  meeting_type: MeetingType
  mode: MeetingMode
  title: string
  scheduled_at: string
  location: string
  video_link: string
  organiser_id: string | null
  agenda: string
  status: MeetingStatus
  minutes_status: 'NOT_STARTED' | 'DRAFT' | 'APPROVED'
  minutes_text: string
  notes: string
  created_at: string
}

interface Trustee {
  id: string
  full_name: string
  role: string
}

interface Form {
  meeting_type: MeetingType
  mode: MeetingMode
  title: string
  scheduled_at: string
  location: string
  video_link: string
  organiser_id: string
  agenda: string
  notes: string
}

const EMPTY: Form = {
  meeting_type: 'TRUSTEE_MEETING', mode: 'IN_PERSON', title: '',
  scheduled_at: '', location: '', video_link: '', organiser_id: '',
  agenda: '', notes: '',
}

const STATUS_BADGE: Record<MeetingStatus, string> = {
  SCHEDULED: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  OPENED:    'bg-blue-500/20 text-blue-400 border-blue-500/30',
  CLOSED:    'bg-green-500/20 text-green-400 border-green-500/30',
  CANCELLED: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

export default function MeetingsPage() {
  const [items, setItems] = useState<Meeting[]>([])
  const [trustees, setTrustees] = useState<Trustee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<MeetingStatus | ''>('')

  const [editing, setEditing] = useState<Meeting | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ limit: '100' })
      if (statusFilter) qs.set('status_filter', statusFilter)
      const [m, t] = await Promise.all([
        apiFetch<{ items: Meeting[]; total: number }>(`/admin/board/meetings?${qs}`),
        apiFetch<{ items: Trustee[]; total: number }>('/admin/board/trustees?is_active=true&limit=200'),
      ])
      setItems(m.items || [])
      setTrustees(t.items || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load meetings')
    } finally { setLoading(false) }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  function openNew() {
    setEditing(null); setForm(EMPTY); setShowForm(true); setError('')
  }
  function openEdit(m: Meeting) {
    setEditing(m)
    setForm({
      meeting_type: m.meeting_type, mode: m.mode, title: m.title,
      scheduled_at: m.scheduled_at ? m.scheduled_at.slice(0, 16) : '',
      location: m.location, video_link: m.video_link,
      organiser_id: m.organiser_id || '',
      agenda: m.agenda, notes: m.notes,
    })
    setShowForm(true); setError('')
  }

  async function save() {
    if (!form.scheduled_at) { setError('Date & time are required'); return }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { ...form }
      if (!form.organiser_id) delete body.organiser_id
      if (editing) {
        await apiFetch(`/admin/board/meetings/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
      } else {
        await apiFetch('/admin/board/meetings', { method: 'POST', body: JSON.stringify(body) })
      }
      setShowForm(false)
      await load()
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Failed to save'
      try { const p = JSON.parse(msg); if (p?.detail?.errors) msg = p.detail.errors.join(' · ') } catch { /* not JSON */ }
      setError(msg)
    } finally { setSaving(false) }
  }

  async function cancelMeeting(m: Meeting) {
    if (!confirm(`Cancel "${m.title || m.meeting_type}" scheduled for ${fmtWhen(m.scheduled_at)}?`)) return
    try {
      await apiFetch(`/admin/board/meetings/${m.id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Failed to cancel'
      try { const p = JSON.parse(msg); if (p?.detail) msg = typeof p.detail === 'string' ? p.detail : JSON.stringify(p.detail) } catch { /* not JSON */ }
      setError(msg)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Board Meetings</h1>
          <p className="text-white/40 mt-1">Schedule, run, minute. Resolutions + voting come in PR 2.</p>
        </div>
        <button onClick={openNew}
          className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90">
          + Schedule Meeting
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1 w-fit">
        {(['', 'SCHEDULED', 'OPENED', 'CLOSED', 'CANCELLED'] as const).map(s => (
          <button key={s || 'ALL'} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize ${
              statusFilter === s ? 'bg-saffron-gradient text-white' : 'text-white/40 hover:text-white/70'
            }`}>{s.toLowerCase() || 'all'}</button>
        ))}
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 border-b border-white/10">
              <tr className="text-white/60 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-semibold">When</th>
                <th className="px-4 py-3 text-left font-semibold">Type</th>
                <th className="px-4 py-3 text-left font-semibold">Title</th>
                <th className="px-4 py-3 text-left font-semibold">Mode</th>
                <th className="px-4 py-3 text-left font-semibold">Location</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Minutes</th>
                <th className="px-4 py-3 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-4 py-12 text-center text-white/40">Loading…</td></tr>}
              {!loading && items.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-white/40">
                  No meetings match. Click + Schedule Meeting to add one.
                </td></tr>
              )}
              {items.map(m => (
                <tr key={m.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3 text-white whitespace-nowrap">{fmtWhen(m.scheduled_at)}</td>
                  <td className="px-4 py-3 text-white/70 text-xs">{m.meeting_type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-white">{m.title || <span className="text-white/30">— untitled —</span>}</td>
                  <td className="px-4 py-3 text-white/60 text-xs">{m.mode}</td>
                  <td className="px-4 py-3 text-white/60 text-xs">
                    {m.mode === 'VIRTUAL' ? (m.video_link ? '🔗 Online' : '—') : (m.location || '—')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${STATUS_BADGE[m.status]}`}>{m.status}</span>
                  </td>
                  <td className="px-4 py-3 text-white/60 text-xs">{m.minutes_status.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(m)} className="text-white/50 hover:text-white text-xs">Edit</button>
                      {m.status === 'SCHEDULED' &&
                        <button onClick={() => cancelMeeting(m)} className="text-red-400/60 hover:text-red-400 text-xs">Cancel</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-[520px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editing ? 'Edit Meeting' : 'Schedule Meeting'}</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl p-1">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div>
                  <label className={lbl}>Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['TRUSTEE_MEETING', 'COMMITTEE', 'AGM', 'EMERGENCY'] as MeetingType[]).map(t => (
                      <button key={t} type="button" onClick={() => setForm(p => ({ ...p, meeting_type: t }))}
                        className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                          form.meeting_type === t ? 'bg-saffron-gradient text-white' : 'bg-white/5 text-white/60 border border-white/10'
                        }`}>{t.replace(/_/g, ' ')}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={lbl}>Mode</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['IN_PERSON', 'VIRTUAL', 'HYBRID'] as MeetingMode[]).map(m => (
                      <button key={m} type="button" onClick={() => setForm(p => ({ ...p, mode: m }))}
                        className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                          form.mode === m ? 'bg-saffron-gradient text-white' : 'bg-white/5 text-white/60 border border-white/10'
                        }`}>{m.replace(/_/g, ' ')}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={lbl}>Title</label>
                  <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inp} placeholder="e.g. November Trustee Meeting" />
                </div>
                <div>
                  <label className={lbl}>Date &amp; Time *</label>
                  <input type="datetime-local" value={form.scheduled_at} onChange={e => setForm(p => ({ ...p, scheduled_at: e.target.value }))} className={inp} />
                </div>
                {(form.mode === 'IN_PERSON' || form.mode === 'HYBRID') && (
                  <div>
                    <label className={lbl}>Location</label>
                    <input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} className={inp}
                      placeholder="e.g. Wembley temple, back office" />
                  </div>
                )}
                {(form.mode === 'VIRTUAL' || form.mode === 'HYBRID') && (
                  <div>
                    <label className={lbl}>Video link</label>
                    <input value={form.video_link} onChange={e => setForm(p => ({ ...p, video_link: e.target.value }))} className={inp}
                      placeholder="Teams / Zoom URL" />
                  </div>
                )}
                <div>
                  <label className={lbl}>Organiser</label>
                  <select value={form.organiser_id} onChange={e => setForm(p => ({ ...p, organiser_id: e.target.value }))} className={inp}>
                    <option value="">— Select trustee —</option>
                    {trustees.map(t => (
                      <option key={t.id} value={t.id}>{t.full_name} ({t.role})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Agenda (markdown)</label>
                  <textarea value={form.agenda} onChange={e => setForm(p => ({ ...p, agenda: e.target.value }))} rows={6} className={inp + ' resize-none font-mono text-xs'}
                    placeholder="1. Apologies&#10;2. Minutes of previous meeting&#10;3. Treasurer&apos;s report&#10;4. ..." />
                </div>
                <div>
                  <label className={lbl}>Internal notes</label>
                  <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={3} className={inp + ' resize-none'} />
                </div>
                {editing && <ActionsPanel meetingId={editing.id} meetings={items} />}
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={save} disabled={saving}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Schedule'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Charity Governance Code 6.5 — action-item tracker ─────────────────

interface ActionRow {
  id: string
  title: string
  description: string
  owner_name: string
  due_date: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' | 'CARRIED_FORWARD'
  done_at: string | null
  done_note: string
}

function ActionsPanel({ meetingId, meetings }: { meetingId: string; meetings: Meeting[] }) {
  const [rows, setRows] = useState<ActionRow[]>([])
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({
    title: '', description: '', owner_name: '', due_date: '',
    priority: 'MEDIUM' as 'LOW' | 'MEDIUM' | 'HIGH',
  })
  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ actions: ActionRow[] }>(`/admin/board/meetings/${meetingId}/actions`)
      setRows(r.actions || [])
    } catch { /* quiet */ }
  }, [meetingId])
  useEffect(() => { void load() }, [load])

  async function add() {
    if (!draft.title.trim()) { alert('Title is required'); return }
    setBusy(true)
    try {
      await apiFetch(`/admin/board/meetings/${meetingId}/actions`, {
        method: 'POST', body: JSON.stringify({
          ...draft,
          due_date: draft.due_date || null,
        }),
      })
      setDraft({ title: '', description: '', owner_name: '', due_date: '', priority: 'MEDIUM' })
      setAdding(false)
      await load()
    } finally { setBusy(false) }
  }

  async function updateStatus(a: ActionRow, next: ActionRow['status']) {
    setBusy(true)
    try {
      const body: Record<string, string> = { status: next }
      if (next === 'DONE') {
        const note = window.prompt('Completion note (optional)', '') || ''
        body.done_note = note
      }
      await apiFetch(`/admin/board/meetings/${meetingId}/actions/${a.id}`, {
        method: 'PUT', body: JSON.stringify(body),
      })
      await load()
    } finally { setBusy(false) }
  }

  async function remove(id: string) {
    if (!confirm('Delete this action?')) return
    try {
      await apiFetch(`/admin/board/meetings/${meetingId}/actions/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function carryFrom(fromId: string) {
    if (!confirm('Copy every OPEN action from that meeting into this one?')) return
    setBusy(true)
    try {
      const r = await apiFetch<{ copied: number }>(
        `/admin/board/meetings/${meetingId}/actions/carry-forward`,
        { method: 'POST', body: JSON.stringify({ from_meeting_id: fromId }) },
      )
      alert(`Copied ${r.copied} action(s).`)
      await load()
    } finally { setBusy(false) }
  }

  const prevMeetings = meetings.filter(m => m.id !== meetingId).slice(0, 10)

  return (
    <div className="rounded-2xl border border-white/10 bg-white/3 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-white/70 text-xs uppercase tracking-widest font-bold">✅ Actions</p>
          <p className="text-white/40 text-[10px]">Governance Code 6.5 — decisions are followed through.</p>
        </div>
        <div className="flex items-center gap-2">
          {prevMeetings.length > 0 && (
            <select onChange={e => { if (e.target.value) void carryFrom(e.target.value); e.currentTarget.value = '' }}
              defaultValue=""
              className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white/70">
              <option value="">Carry forward from…</option>
              {prevMeetings.map(m => <option key={m.id} value={m.id}>{new Date(m.scheduled_at).toLocaleDateString()} — {m.title || m.meeting_type.replace(/_/g, ' ')}</option>)}
            </select>
          )}
          <button type="button" onClick={() => setAdding(s => !s)}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/80 text-xs font-bold hover:bg-white/10">
            {adding ? 'Cancel' : '+ Add action'}
          </button>
        </div>
      </div>

      {adding && (
        <div className="rounded-xl border border-saffron-400/30 bg-saffron-400/5 p-3 space-y-2">
          <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            placeholder="Action — verb first"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs" />
          <textarea rows={2} value={draft.description}
            onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
            placeholder="Context (optional)"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs resize-none" />
          <div className="grid grid-cols-3 gap-2">
            <input value={draft.owner_name} onChange={e => setDraft(d => ({ ...d, owner_name: e.target.value }))}
              placeholder="Owner"
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs" />
            <input type="date" value={draft.due_date} onChange={e => setDraft(d => ({ ...d, due_date: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs" />
            <select value={draft.priority} onChange={e => setDraft(d => ({ ...d, priority: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' }))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs">
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </div>
          <button type="button" onClick={add} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-saffron-gradient text-white text-xs font-black shadow-saffron disabled:opacity-40">
            {busy ? 'Saving…' : 'Create action'}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-white/30 text-xs italic">No actions yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(a => {
            const dueSoon = a.due_date && new Date(a.due_date) <= new Date(Date.now() + 7 * 864e5)
            const overdue = a.due_date && new Date(a.due_date) < new Date() && a.status !== 'DONE' && a.status !== 'CANCELLED'
            return (
              <li key={a.id} className={
                'rounded-xl border p-2.5 ' +
                (a.status === 'DONE' ? 'border-emerald-500/20 bg-emerald-500/5'
                  : overdue ? 'border-red-500/30 bg-red-500/5'
                  : 'border-white/10 bg-white/3')
              }>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className={'text-sm font-bold ' + (a.status === 'DONE' ? 'text-emerald-200 line-through' : 'text-white')}>{a.title}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap text-[10px] uppercase tracking-widest">
                      <span className={
                        a.priority === 'HIGH' ? 'text-red-300' : a.priority === 'MEDIUM' ? 'text-amber-300' : 'text-white/50'
                      }>{a.priority}</span>
                      {a.owner_name && <span className="text-white/60">· {a.owner_name}</span>}
                      {a.due_date && <span className={overdue ? 'text-red-300' : dueSoon ? 'text-amber-300' : 'text-white/50'}>· due {new Date(a.due_date).toLocaleDateString()}</span>}
                      <span className="text-white/40">· {a.status.replace(/_/g, ' ')}</span>
                    </div>
                    {a.description && <p className="text-white/60 text-xs mt-1">{a.description}</p>}
                    {a.done_note && <p className="text-emerald-200/70 text-[10px] italic mt-1">Done: {a.done_note}</p>}
                  </div>
                  <div className="flex gap-1">
                    {a.status !== 'DONE' && a.status !== 'CANCELLED' && (
                      <>
                        {a.status === 'OPEN' && (
                          <button type="button" onClick={() => updateStatus(a, 'IN_PROGRESS')}
                            className="text-sky-300 hover:text-sky-200 text-[10px] font-bold px-1">▶ Start</button>
                        )}
                        <button type="button" onClick={() => updateStatus(a, 'DONE')}
                          className="text-emerald-300 hover:text-emerald-200 text-[10px] font-bold px-1">✓ Done</button>
                      </>
                    )}
                    <button type="button" onClick={() => remove(a.id)}
                      className="text-red-400/60 hover:text-red-400 text-xs">✕</button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
