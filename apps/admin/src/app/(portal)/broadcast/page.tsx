'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

/**
 * TV Channel admin — three tabs in one page:
 *   1. Live     — schedule / start / stop live events (YouTube broadcasts)
 *   2. Schedule — weekly grid of what plays when between live events
 *   3. Library  — content library (uploaded recordings + YouTube refs)
 *
 * Surfaces the same data the public /tv page consumes via /broadcast/*.
 * Once the YouTube channel handle is added to API Keys the live-detection
 * banner here flips automatically.
 */

const KINDS = ['AARTI', 'BHAJAN', 'KIRTAN', 'DISCOURSE', 'FESTIVAL', 'INTERVIEW', 'ANNOUNCEMENT', 'OTHER']
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const LIVE_STATUSES = ['SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED']

interface Asset {
  id: string; title: string; description: string; kind: string; language: string
  branch_id: string | null; source_url: string; youtube_video_id: string | null
  duration_seconds: number; thumbnail_url: string; rights_cleared: boolean
  tags: string[] | string; created_at: string
}
interface ScheduleBlock {
  id: string; branch_id: string | null; day_of_week: number; start_time: string
  duration_min: number; asset_id: string | null; title_override: string
  is_live_slot: boolean; recurring: boolean
  asset_title: string | null; asset_kind: string | null
  asset_thumb: string | null; asset_yt: string | null
}
interface LiveEvent {
  id: string; branch_id: string | null; title: string; description: string
  scheduled_at: string | null; started_at: string | null; ended_at: string | null
  platform: string; youtube_video_id: string | null; stream_url: string
  recording_url: string; viewer_count_peak: number; status: string
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-[10px] font-semibold uppercase tracking-wide mb-1'

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmtTime(s: string | null): string {
  if (!s) return ''
  const t = s.split(':'); return `${t[0]}:${t[1] || '00'}`
}

export default function BroadcastPage() {
  const [tab, setTab] = useState<'live' | 'schedule' | 'library' | 'branding'>('live')
  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">📺 TV Channel</h1>
          <p className="text-white/40 text-sm mt-1 max-w-2xl">
            Manage live broadcasts, the weekly schedule, and the content library for{' '}
            <a href="https://shital.org.uk/tv" target="_blank" rel="noreferrer" className="text-saffron-300 hover:underline">shital.org.uk/tv</a>.
            Streams ride on YouTube — paste video IDs from streams you've started on{' '}
            <a href="https://studio.youtube.com" target="_blank" rel="noreferrer" className="text-saffron-300 hover:underline">YouTube Studio</a>.
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-white/10">
        {([
          ['live', '🔴 Live Events'],
          ['schedule', '📅 Schedule'],
          ['library', '📚 Content Library'],
          ['branding', '🎨 Branding'],
        ] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${tab === t ? 'border-saffron-400 text-saffron-400' : 'border-transparent text-white/50 hover:text-white/80'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'live'     && <LiveTab />}
      {tab === 'schedule' && <ScheduleTab />}
      {tab === 'library'  && <LibraryTab />}
      {tab === 'branding' && <BrandingTab />}
    </div>
  )
}

// ─── Branding Tab ───────────────────────────────────────────────────────────

const BRANCHES: Array<{ id: string; label: string }> = [
  { id: '',          label: 'Default (all branches)' },
  { id: 'wembley',   label: 'Wembley' },
  { id: 'leicester', label: 'Leicester' },
  { id: 'reading',   label: 'Reading' },
  { id: 'milton',    label: 'Milton Keynes' },
]
const THEMES: Array<{ id: string; label: string }> = [
  { id: 'dark',    label: 'Dark (default)' },
  { id: 'ivory',   label: 'Ivory (light)' },
  { id: 'crimson', label: 'Crimson' },
  { id: 'saffron', label: 'Saffron' },
  { id: 'indigo',  label: 'Indigo' },
]

interface Channel {
  branch_id: string | null; channel_name: string; channel_subtitle: string
  theme_id: string; banner_url: string; secondary_logo_url: string
}

function BrandingTab() {
  const [branch, setBranch] = useState('')
  const [ch, setCh] = useState<Channel | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async (bid: string) => {
    setLoading(true); setMsg('')
    try {
      const q = bid ? `?branch_id=${encodeURIComponent(bid)}` : ''
      const d = await apiFetch<Channel>(`/admin/broadcast/channel${q}`)
      setCh(d)
    } catch { setCh(null) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(branch) }, [branch, load])

  async function save() {
    if (!ch) return
    setSaving(true); setMsg('')
    try {
      await apiFetch('/admin/broadcast/channel', {
        method: 'PATCH',
        body: JSON.stringify({ ...ch, branch_id: branch || null }),
      })
      setMsg('✓ Saved')
      setTimeout(() => setMsg(''), 2500)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  const upd = (k: keyof Channel, v: string) => setCh(c => c ? { ...c, [k]: v } : c)
  const tvUrl = `https://shital.org.uk/tv${branch ? `?branch_id=${branch}` : ''}`

  return (
    <div className="max-w-2xl space-y-5">
      <div className="glass-card rounded-2xl p-5 space-y-4">
        <div>
          <label className={lbl}>Channel for</label>
          <select className={inp} value={branch} onChange={e => setBranch(e.target.value)}>
            {BRANCHES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          <p className="text-white/30 text-[11px] mt-1">Each branch can have its own channel skin. “Default” is used when a branch has no override.</p>
        </div>

        {loading || !ch ? (
          <p className="text-white/40 text-sm">Loading…</p>
        ) : (
          <>
            <div>
              <label className={lbl}>Channel name</label>
              <input className={inp} value={ch.channel_name} onChange={e => upd('channel_name', e.target.value)} placeholder="SHITAL TV" />
            </div>
            <div>
              <label className={lbl}>Subtitle / tagline</label>
              <input className={inp} value={ch.channel_subtitle} onChange={e => upd('channel_subtitle', e.target.value)} placeholder="Live bhajans · aarti · festivals" />
            </div>
            <div>
              <label className={lbl}>Theme</label>
              <select className={inp} value={ch.theme_id} onChange={e => upd('theme_id', e.target.value)}>
                {THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Logo URL (optional)</label>
              <input className={inp} value={ch.secondary_logo_url} onChange={e => upd('secondary_logo_url', e.target.value)} placeholder="https://…/logo.png" />
            </div>
            <div>
              <label className={lbl}>Banner image URL (optional)</label>
              <input className={inp} value={ch.banner_url} onChange={e => upd('banner_url', e.target.value)} placeholder="https://…/banner.jpg" />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button onClick={save} disabled={saving} className="px-5 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-bold disabled:opacity-50">
                {saving ? 'Saving…' : 'Save branding'}
              </button>
              <a href={tvUrl} target="_blank" rel="noreferrer" className="text-saffron-300 text-sm hover:underline">Preview channel ↗</a>
              {msg && <span className="text-sm text-green-300">{msg}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Live Events Tab ────────────────────────────────────────────────────────

function LiveTab() {
  const [items, setItems] = useState<LiveEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    title: '', description: '', branch_id: '', scheduled_at: '',
    youtube_video_id: '', stream_url: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<{ items: LiveEvent[] }>('/admin/broadcast/live?limit=100')
      setItems(data.items || [])
    } catch { setItems([]) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function create() {
    if (!form.title.trim()) return
    try {
      await apiFetch('/admin/broadcast/live', { method: 'POST', body: JSON.stringify(form) })
      setShowForm(false)
      setForm({ title: '', description: '', branch_id: '', scheduled_at: '', youtube_video_id: '', stream_url: '' })
      load()
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed') }
  }
  async function setState(id: string, status: string) {
    try {
      await apiFetch(`/admin/broadcast/live/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      load()
    } catch { /* ignore */ }
  }
  async function remove(id: string) {
    if (!confirm('Delete this event?')) return
    try { await apiFetch(`/admin/broadcast/live/${id}`, { method: 'DELETE' }); load() }
    catch { /* ignore */ }
  }

  const liveNow = items.filter(i => i.status === 'LIVE')
  const upcoming = items.filter(i => i.status === 'SCHEDULED').slice(0, 10)
  const past = items.filter(i => ['ENDED', 'CANCELLED'].includes(i.status)).slice(0, 20)

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-white/60 text-sm">
          {liveNow.length > 0
            ? <span className="text-red-400 font-bold">🔴 {liveNow.length} live now</span>
            : <span>No live broadcasts at this moment.</span>}
        </p>
        <button onClick={() => setShowForm(s => !s)} className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-bold">
          {showForm ? 'Cancel' : '+ Schedule new event'}
        </button>
      </div>

      {showForm && (
        <div className="glass rounded-2xl p-5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Title *</label>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Morning bhajans — Wembley" className={inp} />
            </div>
            <div>
              <label className={lbl}>Branch (optional)</label>
              <input value={form.branch_id} onChange={e => setForm({ ...form, branch_id: e.target.value })}
                placeholder="main, leicester, reading, mk" className={inp} />
            </div>
            <div>
              <label className={lbl}>Scheduled time (optional)</label>
              <input type="datetime-local" value={form.scheduled_at} onChange={e => setForm({ ...form, scheduled_at: e.target.value })} className={inp} />
            </div>
            <div>
              <label className={lbl}>YouTube video ID OR full URL</label>
              <input value={form.youtube_video_id} onChange={e => setForm({ ...form, youtube_video_id: e.target.value })}
                placeholder="dQw4w9WgXcQ or youtube.com/watch?v=…" className={inp} />
            </div>
            <div className="md:col-span-2">
              <label className={lbl}>Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                rows={2} className={`${inp} resize-none`} placeholder="What devotees will see + any context" />
            </div>
          </div>
          <button onClick={create} className="px-4 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold">Create event</button>
        </div>
      )}

      {liveNow.length > 0 && (
        <Section title="🔴 Live now">
          {liveNow.map(e => <LiveRow key={e.id} e={e} onSet={setState} onRemove={remove} />)}
        </Section>
      )}
      <Section title={`📅 Upcoming (${upcoming.length})`}>
        {upcoming.length === 0
          ? <p className="text-white/30 text-sm text-center py-6">No upcoming events scheduled.</p>
          : upcoming.map(e => <LiveRow key={e.id} e={e} onSet={setState} onRemove={remove} />)}
      </Section>
      <Section title={`📦 Past broadcasts (${past.length})`}>
        {past.length === 0
          ? <p className="text-white/30 text-sm text-center py-6">{loading ? 'Loading…' : 'No past broadcasts yet.'}</p>
          : past.map(e => <LiveRow key={e.id} e={e} onSet={setState} onRemove={remove} />)}
      </Section>
    </div>
  )
}

function LiveRow({ e, onSet, onRemove }: { e: LiveEvent; onSet: (id: string, status: string) => void; onRemove: (id: string) => void }) {
  return (
    <div className="rounded-xl p-3 bg-white/5 border border-white/10 flex items-start justify-between gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <p className="text-white font-semibold">{e.title}</p>
        <p className="text-white/40 text-xs">
          {e.branch_id || 'no branch'} · {e.platform}
          {e.scheduled_at && <> · scheduled {fmtDate(e.scheduled_at)}</>}
          {e.started_at && <> · started {fmtDate(e.started_at)}</>}
          {e.viewer_count_peak > 0 && <> · peak {e.viewer_count_peak} viewers</>}
        </p>
        {e.youtube_video_id && (
          <a href={`https://youtube.com/watch?v=${e.youtube_video_id}`} target="_blank" rel="noreferrer"
            className="text-saffron-300 text-xs hover:underline">YouTube ↗</a>
        )}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <select value={e.status} onChange={ev => onSet(e.id, ev.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white">
          {LIVE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => onRemove(e.id)} className="text-red-400 text-xs px-2 hover:underline">✕</button>
      </div>
    </div>
  )
}

// ─── Schedule Tab ───────────────────────────────────────────────────────────

function ScheduleTab() {
  const [items, setItems] = useState<ScheduleBlock[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    branch_id: '', day_of_week: 0, start_time: '08:00',
    duration_min: 60, asset_id: '', title_override: '', is_live_slot: false, recurring: true,
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [schedRes, assetsRes] = await Promise.all([
        apiFetch<{ items: ScheduleBlock[] }>('/admin/broadcast/schedule'),
        apiFetch<{ items: Asset[] }>('/admin/broadcast/assets?limit=200'),
      ])
      setItems(schedRes.items || [])
      setAssets(assetsRes.items || [])
    } catch { setItems([]); setAssets([]) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function create() {
    try {
      await apiFetch('/admin/broadcast/schedule', { method: 'POST', body: JSON.stringify(form) })
      setShowForm(false); load()
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed') }
  }
  async function remove(id: string) {
    if (!confirm('Remove this schedule block?')) return
    try { await apiFetch(`/admin/broadcast/schedule/${id}`, { method: 'DELETE' }); load() }
    catch { /* ignore */ }
  }

  const byDay: ScheduleBlock[][] = [[], [], [], [], [], [], []]
  for (const x of items) byDay[x.day_of_week]?.push(x)

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-white/60 text-sm">Weekly schedule grid. Live events automatically take over their slot.</p>
        <button onClick={() => setShowForm(s => !s)} className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-bold">
          {showForm ? 'Cancel' : '+ Add slot'}
        </button>
      </div>

      {showForm && (
        <div className="glass rounded-2xl p-5 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className={lbl}>Day</label>
              <select value={form.day_of_week} onChange={e => setForm({ ...form, day_of_week: parseInt(e.target.value) })} className={inp}>
                {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Start time</label>
              <input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} className={inp} />
            </div>
            <div>
              <label className={lbl}>Duration (min)</label>
              <input type="number" min="1" value={form.duration_min} onChange={e => setForm({ ...form, duration_min: parseInt(e.target.value || '0') })} className={inp} />
            </div>
            <div>
              <label className={lbl}>Branch (optional)</label>
              <input value={form.branch_id} onChange={e => setForm({ ...form, branch_id: e.target.value })} placeholder="any branch" className={inp} />
            </div>
            <div>
              <label className={lbl}>Mode</label>
              <select value={form.is_live_slot ? 'live' : 'asset'} onChange={e => setForm({ ...form, is_live_slot: e.target.value === 'live' })} className={inp}>
                <option value="asset">Play asset</option>
                <option value="live">Live takeover</option>
              </select>
            </div>
            <div className="md:col-span-3">
              <label className={lbl}>Asset to play (optional for live)</label>
              <select value={form.asset_id} onChange={e => setForm({ ...form, asset_id: e.target.value })} className={inp}>
                <option value="">— pick from library —</option>
                {assets.map(a => <option key={a.id} value={a.id}>{a.title} · {a.kind}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={lbl}>Title override (optional)</label>
              <input value={form.title_override} onChange={e => setForm({ ...form, title_override: e.target.value })}
                placeholder="Display label different from asset title" className={inp} />
            </div>
          </div>
          <button onClick={create} className="px-4 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold">Add slot</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
        {byDay.map((blocks, i) => (
          <div key={i} className="rounded-xl p-3 bg-white/3 border border-white/10 space-y-2 min-h-[200px]">
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">{DAY_NAMES[i]}</p>
            {blocks.length === 0 && <p className="text-white/20 text-xs text-center py-3">No slots</p>}
            {blocks.map(b => (
              <div key={b.id} className={`rounded-lg p-2 text-xs ${b.is_live_slot ? 'bg-red-500/10 border border-red-500/30' : 'bg-white/5 border border-white/10'}`}>
                <div className="flex justify-between gap-1">
                  <span className="text-saffron-300 font-mono font-bold">{fmtTime(b.start_time)}</span>
                  <button onClick={() => remove(b.id)} className="text-red-400 hover:text-red-300">✕</button>
                </div>
                <p className="text-white truncate">{b.title_override || b.asset_title || (b.is_live_slot ? 'Live takeover' : 'Empty slot')}</p>
                <p className="text-white/40">{b.duration_min} min{b.asset_kind ? ` · ${b.asset_kind.toLowerCase()}` : ''}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
      {loading && <p className="text-white/30 text-sm text-center py-3">Loading…</p>}
    </div>
  )
}

// ─── Library Tab ────────────────────────────────────────────────────────────

function LibraryTab() {
  const [items, setItems] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    title: '', description: '', kind: 'BHAJAN', language: 'en',
    branch_id: '', source_url: '', youtube_video_id: '',
    duration_seconds: 0, thumbnail_url: '', rights_cleared: true, tags: [] as string[],
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ limit: '200' })
      if (search) qs.set('search', search)
      if (kindFilter) qs.set('kind', kindFilter)
      const data = await apiFetch<{ items: Asset[] }>(`/admin/broadcast/assets?${qs}`)
      setItems(data.items || [])
    } catch { setItems([]) } finally { setLoading(false) }
  }, [search, kindFilter])
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load])

  async function create() {
    if (!form.title.trim()) return
    try {
      await apiFetch('/admin/broadcast/assets', { method: 'POST', body: JSON.stringify(form) })
      setShowForm(false)
      setForm({ ...form, title: '', description: '', source_url: '', youtube_video_id: '' })
      load()
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed') }
  }
  async function remove(id: string) {
    if (!confirm('Delete this asset? The schedule blocks that reference it will be left orphaned.')) return
    try { await apiFetch(`/admin/broadcast/assets/${id}`, { method: 'DELETE' }); load() }
    catch { /* ignore */ }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title / description…"
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white min-w-[200px]" />
          <select value={kindFilter} onChange={e => setKindFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
            <option value="">All kinds</option>
            {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <button onClick={() => setShowForm(s => !s)} className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-bold">
          {showForm ? 'Cancel' : '+ Add asset'}
        </button>
      </div>

      {showForm && (
        <div className="glass rounded-2xl p-5 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className={lbl}>Title *</label>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Sai Bhajan — Sai Tera Aalam" className={inp} />
            </div>
            <div>
              <label className={lbl}>Kind</label>
              <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className={inp}>
                {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Language</label>
              <select value={form.language} onChange={e => setForm({ ...form, language: e.target.value })} className={inp}>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="gu">Gujarati</option>
                <option value="mr">Marathi</option>
                <option value="ta">Tamil</option>
                <option value="te">Telugu</option>
                <option value="sa">Sanskrit</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={lbl}>YouTube URL or video ID</label>
              <input value={form.source_url} onChange={e => setForm({ ...form, source_url: e.target.value })}
                placeholder="youtube.com/watch?v=… (we extract the ID)" className={inp} />
            </div>
            <div>
              <label className={lbl}>Branch (optional)</label>
              <input value={form.branch_id} onChange={e => setForm({ ...form, branch_id: e.target.value })}
                placeholder="main, leicester…" className={inp} />
            </div>
            <div>
              <label className={lbl}>Duration (seconds)</label>
              <input type="number" value={form.duration_seconds}
                onChange={e => setForm({ ...form, duration_seconds: parseInt(e.target.value || '0') })} className={inp} />
            </div>
            <div className="md:col-span-4">
              <label className={lbl}>Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                rows={2} className={`${inp} resize-none`} placeholder="Notes for trustees scheduling this asset" />
            </div>
            <div className="md:col-span-4 flex items-center gap-2">
              <input type="checkbox" id="rights" checked={form.rights_cleared}
                onChange={e => setForm({ ...form, rights_cleared: e.target.checked })} />
              <label htmlFor="rights" className="text-white/70 text-sm">Rights cleared — safe to broadcast publicly. (Tick only if it's original temple recording or licensed music.)</label>
            </div>
          </div>
          <button onClick={create} className="px-4 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold">Add asset</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {loading && <p className="text-white/30 text-sm col-span-3 text-center py-6">Loading…</p>}
        {!loading && items.length === 0 && (
          <p className="text-white/30 text-sm col-span-3 text-center py-6">
            No assets yet. Add YouTube videos here to use them in the schedule.
          </p>
        )}
        {items.map(a => (
          <div key={a.id} className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
            <div className="aspect-video bg-black/40 relative">
              {a.thumbnail_url && <img src={a.thumbnail_url} alt={a.title} className="w-full h-full object-cover" />}
              {a.youtube_video_id && (
                <a href={`https://youtube.com/watch?v=${a.youtube_video_id}`} target="_blank" rel="noreferrer"
                  className="absolute bottom-1 right-1 bg-black/60 text-white text-[10px] px-2 py-1 rounded">▶ YouTube ↗</a>
              )}
            </div>
            <div className="p-3 space-y-1">
              <p className="text-white font-semibold text-sm">{a.title}</p>
              <p className="text-white/40 text-[10px]">
                <span className="font-mono">{a.kind}</span> · {a.language}{a.branch_id ? ` · ${a.branch_id}` : ''}
                {!a.rights_cleared && <span className="text-amber-400 ml-1">⚠ rights unverified</span>}
              </p>
              {a.description && <p className="text-white/50 text-xs mt-1 line-clamp-2">{a.description}</p>}
              <div className="flex justify-end pt-1">
                <button onClick={() => remove(a.id)} className="text-red-400 text-xs hover:underline">Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── helpers ────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-white/40 text-xs uppercase tracking-wider mb-2 mt-3">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
