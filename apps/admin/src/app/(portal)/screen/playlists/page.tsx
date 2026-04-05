'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || '/api/v1'

const TYPE_ICONS: Record<string, string> = {
  IMAGE: '🖼️', VIDEO: '🎥', AUDIO: '🎵', IMAGE_AUDIO: '🖼️🎵',
  YOUTUBE: '▶️', WEBSITE: '🌐', STREAM: '📡', BROADCAST: '📻',
}

interface Playlist {
  id: string; name: string; description: string
  shuffle: boolean; loop_playlist: boolean; item_count: number
}
interface ContentItem {
  id: string; title: string; content_type: string; duration_secs: number; thumbnail_url: string
}
interface PlaylistItem {
  playlist_item_id: string; sort_order: number; id: string; title: string
  content_type: string; duration_secs: number; thumbnail_url: string
}

function tok() { return typeof window !== 'undefined' ? sessionStorage.getItem('shital_access_token') || '' : '' }

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}`, ...(opts.headers || {}) },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || `Error ${res.status}`)
  return data
}

export default function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [allContent, setAllContent] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Playlist | null>(null)
  const [items, setItems] = useState<PlaylistItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [showNewPl, setShowNewPl] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pl, ct] = await Promise.all([
        apiFetch('/screen/playlists'),
        apiFetch('/screen/content'),
      ])
      setPlaylists(pl.playlists || [])
      setAllContent(ct.items || [])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function loadItems(pl: Playlist) {
    setSelected(pl); setLoadingItems(true)
    try {
      const data = await apiFetch(`/screen/playlists/${pl.id}/items`)
      setItems(data.items || [])
    } catch { setItems([]) }
    finally { setLoadingItems(false) }
  }

  async function createPlaylist() {
    if (!newName.trim()) { setErr('Name required'); return }
    setSaving(true)
    try {
      await apiFetch('/screen/playlists', { method: 'POST', body: JSON.stringify({ name: newName, description: newDesc }) })
      setShowNewPl(false); setNewName(''); setNewDesc('')
      await load()
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  async function deletePl(id: string) {
    if (!confirm('Delete playlist?')) return
    await apiFetch(`/screen/playlists/${id}`, { method: 'DELETE' })
    if (selected?.id === id) setSelected(null)
    await load()
  }

  async function addItem(contentId: string) {
    if (!selected) return
    const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.sort_order)) + 1 : 0
    await apiFetch(`/screen/playlists/${selected.id}/items`, {
      method: 'POST',
      body: JSON.stringify({ content_item_id: contentId, sort_order: maxOrder }),
    })
    await loadItems(selected)
  }

  async function removeItem(playlistItemId: string) {
    if (!selected) return
    await apiFetch(`/screen/playlists/${selected.id}/items/${playlistItemId}`, { method: 'DELETE' })
    await loadItems(selected)
  }

  const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-red-700/40'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-white">▶️ Playlists</h1>
          <p className="text-white/40 mt-1 text-sm">Ordered lists of content — assign to screen profiles</p>
        </div>
        <div className="flex gap-2">
          <Link href="/screen" className="px-4 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/5">📺 Profiles</Link>
          <Link href="/screen/content" className="px-4 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/5">🎬 Content</Link>
          <button onClick={() => { setShowNewPl(true); setErr('') }}
            className="px-5 py-2.5 rounded-xl text-white font-bold text-sm"
            style={{ background: 'linear-gradient(135deg,#b91c1c,#991b1b)' }}>
            + New Playlist
          </button>
        </div>
      </div>

      {err && <p className="text-red-400 text-sm rounded-xl bg-red-400/10 px-4 py-3">{err}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Playlist list */}
        <div className="space-y-3">
          <h2 className="text-white/50 text-xs font-bold uppercase tracking-wider">Playlists ({playlists.length})</h2>
          {loading ? (
            <div className="text-white/30 text-sm py-8 text-center">Loading…</div>
          ) : playlists.length === 0 ? (
            <div className="text-white/30 text-sm py-8 text-center">No playlists yet</div>
          ) : (
            playlists.map(pl => (
              <div key={pl.id}
                onClick={() => loadItems(pl)}
                className="glass rounded-2xl p-4 cursor-pointer transition-all"
                style={{
                  border: selected?.id === pl.id
                    ? '1px solid rgba(185,28,28,0.5)'
                    : '1px solid rgba(255,255,255,0.07)',
                  background: selected?.id === pl.id ? 'rgba(185,28,28,0.1)' : undefined,
                }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-white text-sm truncate">{pl.name}</div>
                    <div className="text-white/35 text-xs mt-0.5">{pl.item_count} items</div>
                    {pl.description && <div className="text-white/30 text-xs mt-0.5 truncate">{pl.description}</div>}
                  </div>
                  <button onClick={e => { e.stopPropagation(); deletePl(pl.id) }}
                    className="flex-shrink-0 text-red-400/60 hover:text-red-400 text-sm px-2">✕</button>
                </div>
                <div className="flex gap-2 mt-2">
                  {pl.shuffle && <span className="px-1.5 py-0.5 rounded text-xs bg-white/5 text-white/40">🔀 Shuffle</span>}
                  {pl.loop_playlist && <span className="px-1.5 py-0.5 rounded text-xs bg-white/5 text-white/40">🔁 Loop</span>}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Playlist items */}
        <div className="lg:col-span-2 space-y-4">
          {!selected ? (
            <div className="text-center py-16 text-white/30">
              <div className="text-4xl mb-3">▶️</div>
              <p>Select a playlist to manage its items</p>
            </div>
          ) : (
            <>
              <h2 className="text-white font-black text-lg">{selected.name}</h2>

              {/* Current items */}
              <div className="glass rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                  <span className="text-white/60 text-sm font-bold">{items.length} items in playlist</span>
                </div>
                {loadingItems ? (
                  <div className="text-center py-8 text-white/30 text-sm">Loading…</div>
                ) : items.length === 0 ? (
                  <div className="text-center py-8 text-white/30 text-sm">Empty — add content below</div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {items.map((item, idx) => (
                      <div key={item.playlist_item_id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/2">
                        <span className="text-white/25 text-sm w-6 text-center font-mono">{idx + 1}</span>
                        <span className="text-xl">{TYPE_ICONS[item.content_type] || '🎬'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-sm font-semibold truncate">{item.title}</div>
                          <div className="text-white/35 text-xs">{item.content_type} · {item.duration_secs}s</div>
                        </div>
                        <button onClick={() => removeItem(item.playlist_item_id)}
                          className="text-red-400/50 hover:text-red-400 text-sm px-2 flex-shrink-0">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add from content library */}
              <div className="glass rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="px-4 py-3 border-b border-white/5">
                  <span className="text-white/60 text-sm font-bold">Add from Content Library</span>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-white/5">
                  {allContent.filter(c => !items.find(i => i.id === c.id)).map(c => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/3">
                      <span className="text-lg">{TYPE_ICONS[c.content_type] || '🎬'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm truncate">{c.title}</div>
                        <div className="text-white/35 text-xs">{c.content_type} · {c.duration_secs}s</div>
                      </div>
                      <button onClick={() => addItem(c.id)}
                        className="px-3 py-1 rounded-lg text-xs font-bold text-green-400 border border-green-400/20 hover:bg-green-400/10 flex-shrink-0">
                        + Add
                      </button>
                    </div>
                  ))}
                  {allContent.filter(c => !items.find(i => i.id === c.id)).length === 0 && (
                    <div className="text-center py-6 text-white/30 text-sm">All content is already in this playlist</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* New playlist drawer */}
      {showNewPl && (
        <div className="fixed inset-0 z-50 flex" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="ml-auto w-full max-w-md h-full overflow-y-auto p-6 space-y-5"
            style={{ background: '#0f0008', borderLeft: '1px solid rgba(185,28,28,0.3)' }}>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-white">New Playlist</h2>
              <button onClick={() => setShowNewPl(false)} className="text-white/40 hover:text-white text-2xl">×</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Name *</label>
                <input className={inp} placeholder="e.g. Navratri Programme" value={newName}
                  onChange={e => setNewName(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1.5 block">Description</label>
                <textarea className={inp + ' h-16 resize-none'} placeholder="Optional"
                  value={newDesc} onChange={e => setNewDesc(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowNewPl(false)}
                className="flex-1 py-3 rounded-xl text-white/50 border border-white/10 font-semibold text-sm">Cancel</button>
              <button onClick={createPlaylist} disabled={saving}
                className="flex-1 py-3 rounded-xl text-white font-black text-sm disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#b91c1c,#991b1b)' }}>
                {saving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
