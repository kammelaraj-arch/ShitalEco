'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || '/api/v1'

const CONTENT_TYPES = [
  { value: 'IMAGE',       label: '🖼️ Image',             hint: 'URL to JPG, PNG, GIF, WebP' },
  { value: 'VIDEO',       label: '🎥 Video',             hint: 'URL to MP4, WebM, or HLS .m3u8' },
  { value: 'AUDIO',       label: '🎵 Audio',             hint: 'URL to MP3, AAC, OGG' },
  { value: 'IMAGE_AUDIO', label: '🖼️🎵 Image + Audio',   hint: 'Image with background audio playing' },
  { value: 'YOUTUBE',     label: '▶️ YouTube',           hint: 'YouTube video URL or video ID' },
  { value: 'WEBSITE',     label: '🌐 Website',           hint: 'URL to embed in fullscreen iframe' },
  { value: 'STREAM',      label: '📡 Live Stream',       hint: 'HLS/RTMP stream URL (.m3u8)' },
  { value: 'BROADCAST',   label: '📻 Broadcast',         hint: 'Live broadcast or recording URL' },
]

const TYPE_ICONS: Record<string, string> = {
  IMAGE: '🖼️', VIDEO: '🎥', AUDIO: '🎵', IMAGE_AUDIO: '🖼️🎵',
  YOUTUBE: '▶️', WEBSITE: '🌐', STREAM: '📡', BROADCAST: '📻',
}

interface ContentItem {
  id: string; title: string; content_type: string; media_url: string
  audio_url: string; thumbnail_url: string; duration_secs: number
  is_live: boolean; youtube_id: string; website_url: string
  description: string; tags: string; created_at: string
}

function tok() { return typeof window !== 'undefined' ? localStorage.getItem('access_token') || '' : '' }

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}`, ...(opts.headers || {}) },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || `Error ${res.status}`)
  return data
}

const EMPTY = {
  title: '', content_type: 'IMAGE', media_url: '', audio_url: '',
  thumbnail_url: '', duration_secs: 10, is_live: false,
  youtube_id: '', website_url: '', description: '', tags: '', branch_id: 'main',
}

export default function ContentLibraryPage() {
  const [items, setItems] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/screen/content' + (typeFilter ? `?content_type=${typeFilter}` : ''))
      setItems(data.items || [])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [typeFilter])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!(editing as Record<string,string>)?.title?.trim()) { setErr('Title required'); return }
    setSaving(true); setErr('')
    try {
      const id = (editing as Record<string,string>).id
      if (id) {
        await apiFetch(`/screen/content/${id}`, { method: 'PUT', body: JSON.stringify(editing) })
      } else {
        await apiFetch('/screen/content', { method: 'POST', body: JSON.stringify(editing) })
      }
      setEditing(null); await load()
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function del(id: string) {
    if (!confirm('Delete this content item?')) return
    await apiFetch(`/screen/content/${id}`, { method: 'DELETE' })
    await load()
  }

  const filtered = items.filter(i =>
    (!filter || i.title.toLowerCase().includes(filter.toLowerCase()) || (i.tags || '').toLowerCase().includes(filter.toLowerCase()))
  )

  const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-red-700/40'
  const ct = (editing as Record<string,string>)?.content_type || 'IMAGE'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-white">🎬 Content Library</h1>
          <p className="text-white/40 mt-1 text-sm">Images, videos, audio, streams, YouTube, websites — add to playlists</p>
        </div>
        <div className="flex gap-2">
          <Link href="/screen" className="px-4 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/5">📺 Profiles</Link>
          <button onClick={() => { setEditing({ ...EMPTY }); setErr('') }}
            className="px-5 py-2.5 rounded-xl text-white font-bold text-sm"
            style={{ background: 'linear-gradient(135deg,#b91c1c,#991b1b)' }}>
            + Add Content
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search…"
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-red-700/40 w-56" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none">
          <option value="">All Types</option>
          {CONTENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center py-16 text-white/30">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <div className="text-5xl mb-4">🎬</div>
          <p>{items.length === 0 ? 'No content yet — add your first item' : 'No items match your search'}</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map(item => (
            <div key={item.id} className="glass rounded-2xl overflow-hidden"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              {/* Thumbnail */}
              <div className="h-36 flex items-center justify-center relative"
                style={{ background: 'rgba(0,0,0,0.4)' }}>
                {item.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-5xl">{TYPE_ICONS[item.content_type] || '🎬'}</span>
                )}
                <span className="absolute top-2 left-2 px-2 py-0.5 rounded-lg text-xs font-bold bg-black/60 text-white/80">
                  {TYPE_ICONS[item.content_type]} {item.content_type}
                </span>
                {item.is_live && (
                  <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-xs font-bold bg-red-600/80 text-white">LIVE</span>
                )}
              </div>
              <div className="p-4 space-y-2">
                <div className="font-bold text-white text-sm truncate">{item.title}</div>
                {item.description && <p className="text-white/40 text-xs truncate">{item.description}</p>}
                <div className="flex items-center justify-between">
                  <span className="text-white/30 text-xs">⏱ {item.duration_secs}s</span>
                  {item.tags && <span className="text-white/25 text-xs truncate">{item.tags}</span>}
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => { setEditing({ ...item }); setErr('') }}
                    className="flex-1 py-1.5 rounded-xl text-xs font-bold text-white/60 border border-white/10 hover:border-white/20">
                    Edit
                  </button>
                  <button onClick={() => del(item.id)}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold text-red-400 border border-red-400/20 hover:bg-red-400/10">
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit side drawer */}
      {editing && (
        <div className="fixed inset-0 z-50 flex" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="ml-auto w-full max-w-lg h-full overflow-y-auto p-6 space-y-5"
            style={{ background: '#0f0008', borderLeft: '1px solid rgba(185,28,28,0.3)' }}>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-white">{(editing as Record<string,string>).id ? 'Edit Content' : 'Add Content'}</h2>
              <button onClick={() => setEditing(null)} className="text-white/40 hover:text-white text-2xl">×</button>
            </div>
            {err && <p className="text-red-400 text-sm rounded-xl bg-red-400/10 px-4 py-3">{err}</p>}

            <div className="space-y-4">
              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Title *</label>
                <input className={inp} placeholder="e.g. Temple Entrance Photo"
                  value={(editing as Record<string,string>).title || ''}
                  onChange={e => setEditing(p => ({ ...p!, title: e.target.value }))} />
              </div>

              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Content Type</label>
                <select className={inp} value={ct}
                  onChange={e => setEditing(p => ({ ...p!, content_type: e.target.value }))}>
                  {CONTENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <p className="text-white/30 text-xs mt-1 ml-1">{CONTENT_TYPES.find(t => t.value === ct)?.hint}</p>
              </div>

              {/* Media URL */}
              {['IMAGE','VIDEO','AUDIO','STREAM','BROADCAST','IMAGE_AUDIO'].includes(ct) && (
                <div>
                  <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">
                    {ct === 'IMAGE' || ct === 'IMAGE_AUDIO' ? 'Image URL' : ct === 'AUDIO' ? 'Audio URL' : 'Video / Stream URL'}
                  </label>
                  <input className={inp} placeholder="https://..."
                    value={(editing as Record<string,string>).media_url || ''}
                    onChange={e => setEditing(p => ({ ...p!, media_url: e.target.value }))} />
                </div>
              )}

              {/* Audio URL (for IMAGE_AUDIO) */}
              {ct === 'IMAGE_AUDIO' && (
                <div>
                  <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Audio URL (plays with image)</label>
                  <input className={inp} placeholder="https://.../audio.mp3"
                    value={(editing as Record<string,string>).audio_url || ''}
                    onChange={e => setEditing(p => ({ ...p!, audio_url: e.target.value }))} />
                </div>
              )}

              {/* YouTube */}
              {ct === 'YOUTUBE' && (
                <div>
                  <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">YouTube URL or Video ID</label>
                  <input className={inp} placeholder="https://youtube.com/watch?v=... or dQw4w9WgXcQ"
                    value={(editing as Record<string,string>).youtube_id || (editing as Record<string,string>).media_url || ''}
                    onChange={e => setEditing(p => ({ ...p!, youtube_id: e.target.value, media_url: e.target.value }))} />
                </div>
              )}

              {/* Website */}
              {ct === 'WEBSITE' && (
                <div>
                  <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Website URL</label>
                  <input className={inp} placeholder="https://shital.org.uk"
                    value={(editing as Record<string,string>).website_url || ''}
                    onChange={e => setEditing(p => ({ ...p!, website_url: e.target.value, media_url: e.target.value }))} />
                </div>
              )}

              {/* Thumbnail */}
              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Thumbnail URL (optional)</label>
                <input className={inp} placeholder="https://.../thumb.jpg"
                  value={(editing as Record<string,string>).thumbnail_url || ''}
                  onChange={e => setEditing(p => ({ ...p!, thumbnail_url: e.target.value }))} />
              </div>

              {/* Duration */}
              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">
                  Duration (seconds) — 0 = natural length
                </label>
                <input className={inp} type="number" min={0} max={3600}
                  value={(editing as Record<string,number>).duration_secs ?? 10}
                  onChange={e => setEditing(p => ({ ...p!, duration_secs: parseInt(e.target.value) || 0 }))} />
              </div>

              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Description</label>
                <textarea className={inp + ' h-16 resize-none'} placeholder="Optional"
                  value={(editing as Record<string,string>).description || ''}
                  onChange={e => setEditing(p => ({ ...p!, description: e.target.value }))} />
              </div>

              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Tags (comma separated)</label>
                <input className={inp} placeholder="temple, navratri, donation"
                  value={(editing as Record<string,string>).tags || ''}
                  onChange={e => setEditing(p => ({ ...p!, tags: e.target.value }))} />
              </div>

              <div className="flex items-center gap-3">
                <input type="checkbox" id="is_live" checked={!!(editing as Record<string,boolean>).is_live}
                  onChange={e => setEditing(p => ({ ...p!, is_live: e.target.checked }))} className="w-4 h-4 rounded" />
                <label htmlFor="is_live" className="text-white/70 text-sm">🔴 Live content (don't auto-advance)</label>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditing(null)}
                className="flex-1 py-3 rounded-xl text-white/50 border border-white/10 font-semibold text-sm">Cancel</button>
              <button onClick={save} disabled={saving}
                className="flex-1 py-3 rounded-xl text-white font-black text-sm disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#b91c1c,#991b1b)' }}>
                {saving ? 'Saving…' : (editing as Record<string,string>).id ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
