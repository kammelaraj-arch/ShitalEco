'use client'
// Information Requests — chair asks a manager / expert / external contact
// to supply info / document / media before the resolution goes to vote.
// Required requests gate the Publish button.

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface ResponseRow {
  response_id: string
  body_html: string
  attachment_id?: string | null
  submitted_by_email: string
  submitted_at: string
  locked_at?: string | null
  content_hash: string
}
interface RequestRow {
  id: string
  target_email: string
  target_name: string
  prompt: string
  expected_type: 'text' | 'document' | 'image' | 'video' | 'audio'
  is_required: boolean
  due_at?: string | null
  status: 'OPEN' | 'SUBMITTED' | 'CANCELLED'
  requested_by_name: string
  created_at: string
  responses: ResponseRow[]
}

export function InfoRequestsPanel({
  resolutionId, locked, onChange,
}: {
  resolutionId: string
  locked?: boolean
  onChange?: (hasOpenRequired: boolean) => void
}) {
  const [items, setItems] = useState<RequestRow[]>([])
  const [targetEmail, setTargetEmail] = useState('')
  const [targetName,  setTargetName]  = useState('')
  const [prompt, setPrompt] = useState('')
  const [etype,  setEtype]  = useState<'text' | 'document' | 'image' | 'video' | 'audio'>('text')
  const [required, setRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [inviteUrl, setInviteUrl] = useState<string>('')

  async function load() {
    try {
      const r = await apiFetch<{ items: RequestRow[]; has_open_required: boolean }>(
        `/admin/board/resolutions/${resolutionId}/info-requests`,
      )
      setItems(r.items || [])
      onChange?.(r.has_open_required)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
  }
  useEffect(() => { if (resolutionId) load() }, [resolutionId]) // eslint-disable-line

  async function create() {
    if (!targetEmail.trim() || !prompt.trim()) return
    setBusy(true); setError(''); setInviteUrl('')
    try {
      const r = await apiFetch<{ id: string; invite_url: string }>(
        `/admin/board/resolutions/${resolutionId}/info-requests`,
        {
          method: 'POST',
          body: JSON.stringify({
            target_email: targetEmail.trim(),
            target_name:  targetName.trim(),
            prompt:       prompt.trim(),
            expected_type: etype,
            is_required: required,
          }),
        },
      )
      await apiFetch(`/admin/board/resolutions/${resolutionId}/info-requests/${r.id}/send-invite`, {
        method: 'POST',
      })
      setInviteUrl(r.invite_url)
      setTargetEmail(''); setTargetName(''); setPrompt(''); setEtype('text'); setRequired(false)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Create failed') }
    finally   { setBusy(false) }
  }

  async function cancel(id: string) {
    if (!confirm('Cancel this request?')) return
    try {
      await apiFetch(`/admin/board/resolutions/${resolutionId}/info-requests/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Cancel failed') }
  }

  async function resend(id: string) {
    try {
      const r = await apiFetch<{ url: string }>(
        `/admin/board/resolutions/${resolutionId}/info-requests/${id}/send-invite`,
        { method: 'POST' },
      )
      setInviteUrl(r.url)
    } catch (e) { setError(e instanceof Error ? e.message : 'Resend failed') }
  }

  const pillColor = (s: RequestRow['status']) =>
    s === 'OPEN'      ? 'bg-amber-100 text-amber-700' :
    s === 'SUBMITTED' ? 'bg-green-100 text-green-700' :
                        'bg-gray-100 text-gray-500'

  return (
    <div className="space-y-4">
      {items.length === 0 && (
        <p className="text-xs text-gray-500">
          No information requests. Ask a manager, expert or external contact to add info before you publish.
        </p>
      )}
      {items.map(q => (
        <div key={q.id} className="rounded border border-gray-200 bg-white p-3 text-sm">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${pillColor(q.status)}`}>
                {q.status}
              </span>
              {q.is_required && (
                <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-red-100 text-red-700">REQUIRED</span>
              )}
              <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-gray-100 text-gray-600">{q.expected_type}</span>
              <span className="text-[11px] text-gray-500">→ {q.target_name || q.target_email}</span>
            </div>
            {q.status === 'OPEN' && !locked && (
              <div className="flex items-center gap-2 text-xs">
                <button onClick={() => resend(q.id)} className="text-indigo-600 hover:underline">Resend</button>
                <button onClick={() => cancel(q.id)} className="text-red-600 hover:underline">Cancel</button>
              </div>
            )}
          </div>
          <div className="text-gray-800 whitespace-pre-wrap">{q.prompt}</div>
          {q.responses.map(r => (
            <div key={r.response_id} className="mt-2 rounded border border-green-200 bg-green-50 px-3 py-2">
              <div className="text-[11px] text-gray-600 mb-1">
                Locked by {r.submitted_by_email} on {new Date(r.locked_at || r.submitted_at).toLocaleString('en-GB')}
                <span className="ml-2 font-mono opacity-60">hash: {r.content_hash.slice(0, 12)}…</span>
              </div>
              <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: r.body_html }} />
              {r.attachment_id && (
                <a href={`/api/v1/admin/board/resolutions/${resolutionId}/attachments/${r.attachment_id}/download`}
                   className="text-xs text-indigo-700 hover:underline">Download attachment</a>
              )}
            </div>
          ))}
        </div>
      ))}

      {!locked && (
        <div className="rounded border border-dashed border-gray-300 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Email (manager@…)" value={targetEmail} onChange={e => setTargetEmail(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm" />
            <input placeholder="Name (optional)" value={targetName} onChange={e => setTargetName(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2}
            placeholder="What do you need? e.g. Confirm the grant terms."
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm resize-none" />
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-gray-700 flex items-center gap-1">
              <span>Type:</span>
              <select value={etype} onChange={e => setEtype(e.target.value as 'text' | 'document' | 'image' | 'video' | 'audio')}
                className="rounded border border-gray-300 px-2 py-1 text-xs">
                <option value="text">Text</option>
                <option value="document">Document</option>
                <option value="image">Image</option>
                <option value="video">Video</option>
                <option value="audio">Audio</option>
              </select>
            </label>
            <label className="text-xs text-gray-700 flex items-center gap-1">
              <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} />
              <span>Required to publish</span>
            </label>
            <div className="flex-1" />
            <button onClick={create} disabled={busy || !targetEmail.trim() || !prompt.trim()}
              className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {busy ? 'Sending…' : 'Send request'}
            </button>
          </div>
          {inviteUrl && (
            <p className="text-[11px] text-gray-500 break-all">
              Invite URL (also emailed): <a href={inviteUrl} className="text-indigo-600 hover:underline">{inviteUrl}</a>
            </p>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
