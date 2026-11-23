'use client'
// Comments thread on a draft resolution — internal discussion before the
// resolution is published for voting. Rich-text so people can paste
// agendas, bullet points, or short notes.

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { RichTextEditor } from './RichTextEditor'

interface CommentRow {
  id: string
  author_name: string
  body_html: string
  created_at: string
}

export function CommentsPanel({ resolutionId, locked }: { resolutionId: string; locked?: boolean }) {
  const [items, setItems] = useState<CommentRow[]>([])
  const [draft, setDraft] = useState('')
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      const r = await apiFetch<{ items: CommentRow[] }>(`/admin/board/resolutions/${resolutionId}/comments`)
      setItems(r.items || [])
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load comments') }
  }
  useEffect(() => { if (resolutionId) load() }, [resolutionId]) // eslint-disable-line

  async function post() {
    if (!draft.trim() || draft === '<p></p>') return
    setBusy(true); setError('')
    try {
      await apiFetch(`/admin/board/resolutions/${resolutionId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body_html: draft }),
      })
      setDraft(''); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Post failed') }
    finally   { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      {items.length === 0 && <p className="text-xs text-gray-500">No comments yet — start the discussion.</p>}
      {items.map(c => (
        <div key={c.id} className="rounded border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
            <span>{c.author_name || 'Unknown'}</span>
            <span>{new Date(c.created_at).toLocaleString('en-GB')}</span>
          </div>
          <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: c.body_html }} />
        </div>
      ))}
      {!locked && (
        <div>
          <RichTextEditor value={draft} onChange={setDraft} minHeight={100}
            placeholder="Share your thoughts, questions, or edits…" />
          <div className="mt-2 flex justify-end">
            <button onClick={post} disabled={busy || !draft.trim()}
              className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {busy ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
