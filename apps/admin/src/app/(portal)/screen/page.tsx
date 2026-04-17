'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || '/api/v1'
const SCREEN_BASE = typeof window !== 'undefined'
  ? window.location.origin + '/screen/'
  : '/screen/'

const MODE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  playlist:  { label: 'Playlist',  icon: '▶️',  color: '#60a5fa' },
  live:      { label: 'Live',      icon: '🔴',  color: '#f87171' },
  scheduled: { label: 'Scheduled', icon: '📅',  color: '#a78bfa' },
  temple:    { label: 'Temple',    icon: '🕉️',  color: '#fbbf24' },
}

interface Profile {
  id: string; name: string; location: string; description: string
  branch_id: string; display_mode: string; default_playlist_id: string | null
  live_url: string; live_type: string; is_active: boolean
  playlist_name: string | null; created_at: string
}

interface Playlist { id: string; name: string; item_count: number }

function tok() { return typeof window !== 'undefined' ? localStorage.getItem('shital_access_token') || '' : '' }

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}`, ...(opts.headers || {}) },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || `Error ${res.status}`)
  return data
}

const EMPTY: Partial<Profile> = {
  name: '', location: '', description: '', branch_id: 'main',
  display_mode: 'playlist', default_playlist_id: null,
  live_url: '', live_type: 'stream', is_active: true,
}

export default function ScreenProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Profile> | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, pl] = await Promise.all([
        apiFetch('/screen/profiles'),
        apiFetch('/screen/playlists'),
      ])
      setProfiles(p.profiles || [])
      setPlaylists(pl.playlists || [])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!editing?.name?.trim()) { setErr('Name is required'); return }
    setSaving(true); setErr('')
    try {
      if (editing.id) {
        await apiFetch(`/screen/profiles/${editing.id}`, { method: 'PUT', body: JSON.stringify(editing) })
      } else {
        await apiFetch('/screen/profiles', { method: 'POST', body: JSON.stringify(editing) })
      }
      setEditing(null); await load()
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function del(id: string) {
    if (!confirm('Delete this screen profile?')) return
    await apiFetch(`/screen/profiles/${id}`, { method: 'DELETE' })
    await load()
  }

  const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-red-700/40'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-white">📺 Screen Profiles</h1>
          <p className="text-white/40 mt-1 text-sm">One profile per physical TV screen — controls what it displays</p>
        </div>
        <div className="flex gap-2">
          <Link href="/screen/content" className="px-4 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/5">🎬 Content Library</Link>
          <Link href="/screen/playlists" className="px-4 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/5">▶️ Playlists</Link>
          <button onClick={() => { setEditing({ ...EMPTY }); setErr('') }}
            className="px-5 py-2.5 rounded-xl text-white font-bold text-sm"
            style={{ background: 'linear-gradient(135deg,#b91c1c,#991b1b)' }}>
            + New Screen
          </button>
        </div>
      </div>

      {/* How to use */}
      <div className="rounded-2xl px-4 py-3 flex gap-3 items-start"
        style={{ background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.2)' }}>
        <span className="text-blue-400 text-lg flex-shrink-0">💡</span>
        <p className="text-blue-300/70 text-sm">
          Open <strong className="text-blue-300">shital.org.uk/screen/?profile=ID</strong> on any TV browser to display a screen.
          Each screen can show a playlist, live stream, or your temple's built-in slides.
        </p>
      </div>

      {/* Profile list */}
      {loading ? (
        <div className="text-center py-16 text-white/30">Loading…</div>
      ) : profiles.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <div className="text-5xl mb-4">📺</div>
          <p>No screens yet — create your first profile</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map(p => {
            const modeInfo = MODE_LABELS[p.display_mode] || { label: p.display_mode, icon: '📺', color: '#fff' }
            const url = `${SCREEN_BASE}?profile=${p.id}`
            return (
              <div key={p.id} className="glass rounded-2xl p-5 space-y-3"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white text-lg">{p.name}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold"
                        style={{ background: `${modeInfo.color}18`, color: modeInfo.color, border: `1px solid ${modeInfo.color}30` }}>
                        {modeInfo.icon} {modeInfo.label}
                      </span>
                      {!p.is_active && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-white/5 text-white/30">Inactive</span>
                      )}
                    </div>
                    {p.location && <p className="text-white/40 text-sm mt-0.5">📍 {p.location}</p>}
                    {p.playlist_name && <p className="text-white/40 text-xs mt-0.5">Playlist: {p.playlist_name}</p>}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <a href={url} target="_blank" rel="noreferrer"
                      className="px-3 py-1.5 rounded-xl text-xs font-bold text-green-400 border border-green-400/20 hover:bg-green-400/10">
                      ▶ Open
                    </a>
                    <button onClick={() => { setEditing({ ...p }); setErr('') }}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold text-white/60 border border-white/10 hover:border-white/20">
                      Edit
                    </button>
                    <button onClick={() => del(p.id)}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold text-red-400 border border-red-400/20 hover:bg-red-400/10">
                      ✕
                    </button>
                  </div>
                </div>
                {/* URL */}
                <div className="font-mono text-xs break-all rounded-xl px-3 py-2"
                  style={{ background: 'rgba(0,0,0,0.3)', color: '#86efac', border: '1px solid rgba(134,239,172,0.1)' }}>
                  {url}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Edit / Create drawer */}
      {editing && (
        <div className="fixed inset-0 z-50 flex" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="ml-auto w-full max-w-lg h-full overflow-y-auto p-6 space-y-5"
            style={{ background: '#0f0008', borderLeft: '1px solid rgba(185,28,28,0.3)' }}>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-white">{editing.id ? 'Edit Screen' : 'New Screen Profile'}</h2>
              <button onClick={() => setEditing(null)} className="text-white/40 hover:text-white text-2xl">×</button>
            </div>

            {err && <p className="text-red-400 text-sm rounded-xl bg-red-400/10 px-4 py-3">{err}</p>}

            <div className="space-y-4">
              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Screen Name *</label>
                <input className={inp} placeholder="e.g. Main Hall Screen" value={editing.name || ''}
                  onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Location</label>
                <input className={inp} placeholder="e.g. Main Hall, Entrance, Prayer Room"
                  value={editing.location || ''}
                  onChange={e => setEditing(p => ({ ...p, location: e.target.value }))} />
              </div>
              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Display Mode</label>
                <select className={inp} value={editing.display_mode || 'playlist'}
                  onChange={e => setEditing(p => ({ ...p, display_mode: e.target.value }))}>
                  <option value="temple">🕉️ Temple Mode (built-in slides)</option>
                  <option value="playlist">▶️ Playlist</option>
                  <option value="live">🔴 Live Stream</option>
                  <option value="scheduled">📅 Scheduled</option>
                </select>
              </div>

              {(editing.display_mode === 'playlist' || editing.display_mode === 'scheduled') && (
                <div>
                  <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Default Playlist</label>
                  <select className={inp} value={editing.default_playlist_id || ''}
                    onChange={e => setEditing(p => ({ ...p, default_playlist_id: e.target.value || null }))}>
                    <option value="">— Select playlist —</option>
                    {playlists.map(pl => <option key={pl.id} value={pl.id}>{pl.name} ({pl.item_count} items)</option>)}
                  </select>
                </div>
              )}

              {editing.display_mode === 'live' && (
                <>
                  <div>
                    <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Stream URL</label>
                    <input className={inp} placeholder="https://... (HLS .m3u8, YouTube, RTMP)"
                      value={editing.live_url || ''}
                      onChange={e => setEditing(p => ({ ...p, live_url: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Stream Type</label>
                    <select className={inp} value={editing.live_type || 'stream'}
                      onChange={e => setEditing(p => ({ ...p, live_type: e.target.value }))}>
                      <option value="stream">📡 HLS / RTMP Stream</option>
                      <option value="youtube">▶️ YouTube Live</option>
                      <option value="website">🌐 Website</option>
                      <option value="broadcast">📻 Broadcast</option>
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Description</label>
                <textarea className={inp + ' h-20 resize-none'} placeholder="Optional notes"
                  value={editing.description || ''}
                  onChange={e => setEditing(p => ({ ...p, description: e.target.value }))} />
              </div>

              <div className="flex items-center gap-3">
                <input type="checkbox" id="is_active" checked={!!editing.is_active}
                  onChange={e => setEditing(p => ({ ...p, is_active: e.target.checked }))}
                  className="w-4 h-4 rounded" />
                <label htmlFor="is_active" className="text-white/70 text-sm">Active</label>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditing(null)}
                className="flex-1 py-3 rounded-xl text-white/50 border border-white/10 font-semibold text-sm">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="flex-1 py-3 rounded-xl text-white font-black text-sm disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#b91c1c,#991b1b)' }}>
                {saving ? 'Saving…' : editing.id ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
