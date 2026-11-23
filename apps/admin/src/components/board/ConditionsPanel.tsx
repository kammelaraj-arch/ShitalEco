'use client'
// Phase C — chair-side panel listing every FOR_WITH_CONDITIONS vote's
// conditions and letting the chair accept / reject / defer each one
// with a reason. Resolution can't reach chair sign-off (Phase D) until
// no PENDING conditions remain.

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface ConditionRow {
  id: string
  text: string
  attachment_id?: string | null
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'DEFERRED'
  resolution_reason: string
  resolved_at: string | null
  created_at: string
  trustee_id: string
  trustee_name: string
}

export function ConditionsPanel({ resolutionId, locked, onChange }: {
  resolutionId: string
  locked?: boolean
  onChange?: (anyPending: boolean) => void
}) {
  const [pending,  setPending]  = useState<ConditionRow[]>([])
  const [resolved, setResolved] = useState<ConditionRow[]>([])
  const [reason, setReason] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function load() {
    try {
      const r = await apiFetch<{ pending: ConditionRow[]; resolved: ConditionRow[]; any_pending: boolean }>(
        `/admin/board/resolutions/${resolutionId}/conditions`,
      )
      setPending(r.pending || [])
      setResolved(r.resolved || [])
      onChange?.(!!r.any_pending)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
  }
  useEffect(() => { if (resolutionId) load() }, [resolutionId]) // eslint-disable-line

  async function act(id: string, action: 'accept' | 'reject' | 'defer') {
    setBusy(id); setError('')
    try {
      await apiFetch(`/admin/board/resolutions/${resolutionId}/conditions/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ action, reason: reason[id] || '' }),
      })
      setReason(p => { const n = { ...p }; delete n[id]; return n })
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally   { setBusy(null) }
  }

  if (!pending.length && !resolved.length) {
    return <p className="text-white/40 text-xs italic">No conditions from any trustee.</p>
  }

  const pillColor = (s: ConditionRow['status']) =>
    s === 'ACCEPTED' ? 'bg-green-500/15 text-green-300'
      : s === 'REJECTED' ? 'bg-red-500/15 text-red-300'
      : s === 'DEFERRED' ? 'bg-indigo-500/15 text-indigo-300'
      : 'bg-amber-500/15 text-amber-300'

  return (
    <div className="space-y-3">
      {pending.map(c => (
        <div key={c.id} className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
          <div className="flex items-start justify-between flex-wrap gap-2 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5 ${pillColor(c.status)}`}>
                {c.status}
              </span>
              <span className="text-xs text-white/70">by {c.trustee_name}</span>
            </div>
            <span className="text-[11px] text-white/40">{new Date(c.created_at).toLocaleString('en-GB')}</span>
          </div>
          <p className="text-sm text-white/90 whitespace-pre-wrap">{c.text}</p>
          {c.attachment_id && (
            <a href={`/api/v1/admin/board/resolutions/${resolutionId}/attachments/${c.attachment_id}/download`}
               className="text-xs text-saffron-300 hover:underline">Download evidence</a>
          )}
          {!locked && (
            <div className="mt-3 space-y-2">
              <textarea value={reason[c.id] || ''}
                onChange={e => setReason(p => ({ ...p, [c.id]: e.target.value }))}
                placeholder="Reason (shown to trustee + printed in PDF appendix)"
                rows={2}
                className="w-full rounded-lg px-3 py-2 text-xs bg-white/5 border border-white/10 text-white outline-none focus:border-saffron-400/50" />
              <div className="flex gap-2">
                <button disabled={busy === c.id} onClick={() => act(c.id, 'accept')}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-500/20 border border-green-500/40 text-green-300 disabled:opacity-40">Accept</button>
                <button disabled={busy === c.id} onClick={() => act(c.id, 'reject')}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/20 border border-red-500/40 text-red-300 disabled:opacity-40">Reject</button>
                <button disabled={busy === c.id} onClick={() => act(c.id, 'defer')}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 disabled:opacity-40">Defer</button>
              </div>
            </div>
          )}
        </div>
      ))}
      {resolved.length > 0 && (
        <div className="pt-2">
          <p className="text-[10px] uppercase tracking-widest font-bold text-white/40 mb-2">Resolved</p>
          {resolved.map(c => (
            <div key={c.id} className="rounded-lg border border-white/5 bg-white/3 p-2 mb-1.5">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${pillColor(c.status)}`}>
                  {c.status}
                </span>
                <span className="text-[11px] text-white/40">{c.trustee_name}</span>
              </div>
              <p className="text-xs text-white/80">{c.text}</p>
              {c.resolution_reason && (
                <p className="text-[11px] text-white/50 mt-1 italic">— {c.resolution_reason}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  )
}
