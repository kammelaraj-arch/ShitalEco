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
