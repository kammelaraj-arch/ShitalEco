'use client'
// External links attached to a resolution (SharePoint, Drive, Confluence,
// anything hosted elsewhere). File uploads continue to use the existing
// attachments panel.

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface LinkRow {
  id: string
  label: string
  url: string
  added_by_name: string
  added_at: string
}

export function ExternalLinksPanel({ resolutionId, locked }: { resolutionId: string; locked?: boolean }) {
  const [items, setItems] = useState<LinkRow[]>([])
  const [label, setLabel] = useState('')
  const [url,   setUrl]   = useState('')
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      const r = await apiFetch<{ items: LinkRow[] }>(`/admin/board/resolutions/${resolutionId}/external-links`)
      setItems(r.items || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load links')
    }
  }
  useEffect(() => { if (resolutionId) load() }, [resolutionId]) // eslint-disable-line

  async function add() {
    if (!label.trim() || !url.trim()) return
    setBusy(true); setError('')
    try {
      await apiFetch(`/admin/board/resolutions/${resolutionId}/external-links`, {
        method: 'POST',
        body: JSON.stringify({ label: label.trim(), url: url.trim() }),
      })
      setLabel(''); setUrl(''); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Add failed') }
    finally   { setBusy(false) }
  }

  async function del(id: string) {
    if (!confirm('Remove this link?')) return
    try {
      await apiFetch(`/admin/board/resolutions/${resolutionId}/external-links/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed') }
  }

  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="text-xs text-gray-500">No links yet.</p>}
      {items.map(l => (
        <div key={l.id} className="flex items-start gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="flex-1 min-w-0">
            <a href={l.url} target="_blank" rel="noreferrer"
               className="font-medium text-sm text-indigo-700 hover:underline break-all">{l.label}</a>
            <div className="text-[11px] text-gray-500 truncate">{l.url}</div>
            <div className="text-[10px] text-gray-400">added by {l.added_by_name || 'unknown'}</div>
          </div>
          {!locked && (
            <button onClick={() => del(l.id)} className="text-xs text-red-600 hover:underline">Remove</button>
          )}
        </div>
      ))}
      {!locked && (
        <div className="flex flex-col gap-2 rounded border border-dashed border-gray-300 p-3">
          <div className="flex gap-2">
            <input placeholder="Label (e.g. Surveyor's report)" value={label} onChange={e => setLabel(e.target.value)}
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
          <div className="flex gap-2">
            <input placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)}
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm font-mono" />
            <button onClick={add} disabled={busy || !label.trim() || !url.trim()}
              className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
              {busy ? 'Adding…' : 'Add link'}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
