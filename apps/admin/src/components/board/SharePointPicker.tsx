'use client'
// SharePoint document picker — modal shown from the Board Resolution
// wizard's Context step. Admin types a query, the backend proxies to
// Microsoft Graph /search/query against the charity's M365 tenant, and
// the admin picks a file. Selecting a hit adds it as an external link
// on the resolution with source="sharepoint".
//
// Falls back gracefully when the tenant's not configured — a neutral
// "SharePoint not connected" banner replaces the result list.

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface SharePointHit {
  id: string
  name: string
  web_url: string
  modified_at: string
  size_bytes: number
  site_path: string
}

interface SearchResponse {
  items: SharePointHit[]
  configured: boolean
  error?: string
}

function fmtSize(b: number): string {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(iso: string): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString() }
  catch { return iso.slice(0, 10) }
}

export function SharePointPicker({
  resolutionId,
  onClose,
  onPicked,
}: {
  resolutionId: string
  onClose: () => void
  onPicked: () => void
}) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [items, setItems] = useState<SharePointHit[]>([])
  const [configured, setConfigured] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState<string>('')

  // Debounce typing by ~300ms so we don't hammer Graph on each keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    if (!debounced) { setItems([]); setError(''); return }
    let cancelled = false
    setLoading(true); setError('')
    apiFetch<SearchResponse>(
      `/admin/board/sharepoint/search?q=${encodeURIComponent(debounced)}&top=25`,
    ).then(r => {
      if (cancelled) return
      setItems(r.items || [])
      setConfigured(r.configured !== false)
      if (r.error) setError(r.error)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'SharePoint search failed')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debounced])

  async function pick(hit: SharePointHit) {
    setAdding(hit.id); setError('')
    try {
      await apiFetch(`/admin/board/resolutions/${resolutionId}/external-links`, {
        method: 'POST',
        body: JSON.stringify({
          label:  hit.name,
          url:    hit.web_url,
          source: 'sharepoint',
        }),
      })
      onPicked()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add link')
    } finally {
      setAdding('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div>
            <h3 className="font-black text-white text-base">📁 Pick from SharePoint</h3>
            <p className="text-white/50 text-[11px]">Search the charity&rsquo;s M365 document libraries</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-3 border-b border-white/10">
          <input autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search documents (filename, content, anything SharePoint indexes)…"
            className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-white text-sm outline-none focus:border-saffron-400/50"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {!configured && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-amber-200 text-sm">
              SharePoint isn&rsquo;t connected on this tenant. Ask an admin to set <code className="font-mono">MS_TENANT_ID</code>, <code className="font-mono">MS_CLIENT_ID</code> and <code className="font-mono">MS_CLIENT_SECRET</code> with <code className="font-mono">Sites.Read.All</code> consent, then try again.
            </div>
          )}

          {configured && !debounced && (
            <p className="text-white/40 text-sm italic px-3 py-6 text-center">Start typing to search…</p>
          )}

          {configured && debounced && loading && (
            <p className="text-white/40 text-sm italic px-3 py-6 text-center">Searching…</p>
          )}

          {configured && debounced && !loading && items.length === 0 && !error && (
            <p className="text-white/40 text-sm italic px-3 py-6 text-center">No files match &ldquo;{debounced}&rdquo;.</p>
          )}

          {error && (
            <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-red-200 text-xs m-2">{error}</div>
          )}

          <ul className="space-y-1.5">
            {items.map(hit => (
              <li key={hit.id || hit.web_url}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-lg hover:bg-white/5 border border-white/5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span>📄</span>
                    <a href={hit.web_url} target="_blank" rel="noreferrer"
                       className="text-white text-sm font-medium truncate hover:underline">{hit.name}</a>
                  </div>
                  <div className="text-white/40 text-[11px] mt-0.5 truncate">
                    {hit.site_path || ''}
                    {hit.modified_at && <span> · modified {fmtDate(hit.modified_at)}</span>}
                    {hit.size_bytes ? <span> · {fmtSize(hit.size_bytes)}</span> : null}
                  </div>
                </div>
                <button
                  onClick={() => pick(hit)}
                  disabled={!!adding}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-saffron-gradient text-white text-xs font-bold disabled:opacity-40"
                >
                  {adding === hit.id ? 'Adding…' : '+ Attach'}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-white/10 text-white/70 text-sm">Close</button>
        </div>
      </div>
    </div>
  )
}
