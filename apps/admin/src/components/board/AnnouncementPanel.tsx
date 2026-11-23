'use client'
// Phase B — "When this resolution passes, tell the following people" panel.
// Lives on the Review step. Actual send happens in Phase D after chair
// sign-off. Author sets subject + rich-text body + channels + audience
// rows; UI shows the estimated recipient count and flags whether chair
// approval will be required (external_list audience → yes).

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { RichTextEditor } from './RichTextEditor'

type Channel = 'email' | 'sms' | 'whatsapp'
type AudienceKind =
  | 'all_contacts' | 'volunteers' | 'recent_donors'
  | 'trustees' | 'individuals' | 'external_list'

interface AudienceRow {
  id: string
  kind: AudienceKind
  params: Record<string, unknown>
  added_by_name: string
  created_at: string
}
interface PlanState {
  plan: {
    id: string
    subject: string
    body_html: string
    channels: Channel[]
    requires_chair_approval: boolean
    status: string
  }
  audiences: AudienceRow[]
}
interface PreviewRow { id: string; kind: AudienceKind; count: number }
interface PreviewState { total: number; per_audience: PreviewRow[] }

const KIND_LABELS: Record<AudienceKind, string> = {
  all_contacts:   'All contacts',
  volunteers:     'Active volunteers',
  recent_donors:  'Donors (recent)',
  trustees:       'Active trustees',
  individuals:    'Specific contacts',
  external_list:  'External email list',
}

export function AnnouncementPanel({ resolutionId, locked }: { resolutionId: string; locked?: boolean }) {
  const [state, setState] = useState<PlanState | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [error, setError] = useState('')

  // Form fields for editing
  const [subject,   setSubject]  = useState('')
  const [body,      setBody]     = useState('')
  const [channels,  setChannels] = useState<Channel[]>(['email'])

  // Audience-add form
  const [kind, setKind] = useState<AudienceKind>('all_contacts')
  const [months, setMonths] = useState<number>(12)
  const [extRaw, setExtRaw] = useState<string>('')
  const [individuals, setIndividuals] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const dirty = useMemo(() => {
    if (!state) return false
    return (
      subject !== state.plan.subject ||
      body !== state.plan.body_html ||
      JSON.stringify(channels.slice().sort()) !== JSON.stringify((state.plan.channels || []).slice().sort())
    )
  }, [state, subject, body, channels])

  async function load() {
    try {
      const r = await apiFetch<PlanState>(`/admin/board/resolutions/${resolutionId}/announcement`)
      setState(r)
      setSubject(r.plan.subject)
      setBody(r.plan.body_html)
      setChannels((r.plan.channels || ['email']) as Channel[])
      refreshPreview()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
  }
  async function refreshPreview() {
    try {
      const r = await apiFetch<PreviewState>(
        `/admin/board/resolutions/${resolutionId}/announcement/preview-count`,
        { method: 'POST' },
      )
      setPreview(r)
    } catch { /* non-fatal */ }
  }

  useEffect(() => { if (resolutionId) load() }, [resolutionId]) // eslint-disable-line

  async function savePlan() {
    setBusy(true); setError('')
    try {
      await apiFetch(`/admin/board/resolutions/${resolutionId}/announcement`, {
        method: 'PUT',
        body: JSON.stringify({ subject, body_html: body, channels }),
      })
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally   { setBusy(false) }
  }

  async function addAudience() {
    setBusy(true); setError('')
    let params: Record<string, unknown> = {}
    try {
      if (kind === 'recent_donors') params = { months }
      if (kind === 'individuals') {
        const ids = individuals.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
        if (!ids.length) throw new Error('Paste contact UUIDs (comma or newline separated)')
        params = { contact_ids: ids }
      }
      if (kind === 'external_list') {
        const people = extRaw.split('\n').map(line => {
          const [email, ...rest] = line.split(',').map(s => s.trim())
          return { email: email || '', name: rest.join(' ') || '' }
        }).filter(p => p.email.includes('@'))
        if (!people.length) throw new Error('One email per line, optional ",Name" suffix')
        params = { people }
      }
      await apiFetch(`/admin/board/resolutions/${resolutionId}/announcement/audiences`, {
        method: 'POST',
        body: JSON.stringify({ kind, params }),
      })
      setExtRaw(''); setIndividuals('')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Add failed') }
    finally   { setBusy(false) }
  }

  async function delAudience(id: string) {
    if (!confirm('Remove this audience?')) return
    try {
      await apiFetch(`/admin/board/resolutions/${resolutionId}/announcement/audiences/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed') }
  }

  const toggleChannel = (c: Channel) =>
    setChannels(p => p.includes(c) ? p.filter(x => x !== c) : [...p, c])

  if (!state) return <p className="text-xs text-white/50">Loading announcement…</p>

  const needsApproval = state.plan.requires_chair_approval
  const previewByAud = Object.fromEntries((preview?.per_audience || []).map(p => [p.id, p.count]))

  return (
    <div className="space-y-4">
      {/* Message body */}
      <div className="rounded-xl bg-white/90 p-3 space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Message when passed</p>
        <input disabled={locked} value={subject} onChange={e => setSubject(e.target.value)}
          placeholder="Subject (seen in email / SMS preview)"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
        <RichTextEditor value={body} onChange={setBody} disabled={locked} minHeight={120}
          placeholder="What should recipients hear about this decision?" />
        <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
          <div className="flex items-center gap-3 text-xs text-gray-700">
            <span>Channels:</span>
            {(['email', 'sms', 'whatsapp'] as Channel[]).map(c => (
              <label key={c} className="flex items-center gap-1">
                <input type="checkbox" disabled={locked} checked={channels.includes(c)}
                  onChange={() => toggleChannel(c)} />
                <span>{c}</span>
              </label>
            ))}
          </div>
          {dirty && !locked && (
            <button onClick={savePlan} disabled={busy}
              className="rounded bg-indigo-600 text-white px-3 py-1 text-xs font-medium disabled:opacity-50">
              {busy ? 'Saving…' : 'Save message'}
            </button>
          )}
        </div>
      </div>

      {/* Audiences */}
      <div className="rounded-xl bg-white/90 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Audiences</p>
          {preview && (
            <p className="text-xs text-gray-500">
              Est. <b className="text-indigo-700">{preview.total}</b> recipient{preview.total === 1 ? '' : 's'}
              {preview.total > 0 && ' (approximate — de-dup happens at send time)'}
            </p>
          )}
        </div>

        {state.audiences.length === 0 && (
          <p className="text-xs text-gray-500">No audiences yet — add one below.</p>
        )}
        {state.audiences.map(a => (
          <div key={a.id} className="flex items-start gap-3 rounded border border-gray-200 bg-gray-50 p-2 text-sm">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium rounded-full bg-indigo-100 text-indigo-700 px-2 py-0.5">
                  {KIND_LABELS[a.kind]}
                </span>
                <span className="text-[11px] text-gray-500">by {a.added_by_name || '?'}</span>
                <span className="text-[11px] text-gray-500">· ~{previewByAud[a.id] ?? '?'} recipients</span>
              </div>
              {a.kind === 'recent_donors' && (
                <p className="text-[11px] text-gray-500 mt-0.5">Last {(a.params as { months?: number })?.months ?? 12} months</p>
              )}
              {a.kind === 'external_list' && (
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {((a.params as { people?: { email: string }[] })?.people || []).length} external contact(s)
                </p>
              )}
            </div>
            {!locked && (
              <button onClick={() => delAudience(a.id)} className="text-red-600 hover:underline text-xs">Remove</button>
            )}
          </div>
        ))}

        {!locked && (
          <div className="rounded border border-dashed border-gray-300 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-gray-700 flex items-center gap-1">
                <span>Kind:</span>
                <select value={kind} onChange={e => setKind(e.target.value as AudienceKind)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs">
                  {(Object.keys(KIND_LABELS) as AudienceKind[]).map(k => (
                    <option key={k} value={k}>{KIND_LABELS[k]}</option>
                  ))}
                </select>
              </label>
              {kind === 'recent_donors' && (
                <label className="text-xs text-gray-700 flex items-center gap-1">
                  <span>Months:</span>
                  <input type="number" min={1} max={60} value={months}
                    onChange={e => setMonths(Number(e.target.value))}
                    className="w-16 rounded border border-gray-300 px-1 py-0.5 text-xs" />
                </label>
              )}
              <button onClick={addAudience} disabled={busy}
                className="ml-auto rounded bg-indigo-600 text-white px-3 py-1 text-xs font-medium disabled:opacity-50">
                {busy ? 'Adding…' : 'Add audience'}
              </button>
            </div>

            {kind === 'external_list' && (
              <textarea value={extRaw} onChange={e => setExtRaw(e.target.value)} rows={4}
                placeholder="One per line: email,optional name  (e.g. mp@parliament.uk,Dr Smith)"
                className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono" />
            )}
            {kind === 'individuals' && (
              <textarea value={individuals} onChange={e => setIndividuals(e.target.value)} rows={3}
                placeholder="Contact UUIDs, comma or newline separated"
                className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono" />
            )}
          </div>
        )}
      </div>

      {/* Approval flag */}
      {needsApproval && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⓘ This announcement includes an external audience, so it will <b>require chair approval</b>
          after the resolution passes (Phase D).
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
