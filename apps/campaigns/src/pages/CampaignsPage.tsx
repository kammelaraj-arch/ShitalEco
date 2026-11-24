// Phase 1c-γ — campaign composer. Picks a saved segment + saved
// template, name, optional scheduled_at, and fires send-now. Replaces
// the Phase 1b single-contact send-test (keeps the same page so admin
// nav still works).

import { useEffect, useState } from 'react'
import { api, HttpError } from '../api'

type Status = 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED'

interface CampaignRow {
  id: string
  name: string
  status: Status
  scheduled_at: string | null
  sent_at: string | null
  stats: Record<string, unknown>
  updated_at: string
  segment_name: string | null
  template_name: string | null
}

interface CampaignFull {
  id: string
  name: string
  segment_id: string | null
  template_id: string | null
  variables: Record<string, string>
  scheduled_at: string | null
  status: Status
  stats: {
    attempted?: number; sent?: number; skipped_opted_out?: number;
    failed?: number; failed_detail?: Array<{ email: string; reason: string }>
  }
  segment_name: string | null
  template_name: string | null
  subject: string | null
  html_body: string | null
}

export function CampaignsPage() {
  const [items, setItems] = useState<CampaignRow[]>([])
  const [editing, setEditing] = useState<CampaignFull | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [segments, setSegments] = useState<Array<{ id: string; name: string }>>([])
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; status: string }>>([])
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [sending, setSending] = useState(false)

  async function loadLists() {
    try {
      const [s, t] = await Promise.all([api.listSegments(), api.listTemplates()])
      setSegments(s.items)
      setTemplates(t.items)
    } catch (e) { setError(e instanceof HttpError ? e.message : 'Lists load failed') }
  }
  async function loadCampaigns() {
    try { setItems((await api.listCampaigns()).items) }
    catch (e) { setError(e instanceof HttpError ? e.message : 'Load failed') }
  }
  useEffect(() => { loadLists(); loadCampaigns() }, [])

  async function openCampaign(id: string) {
    try {
      const r = await api.getCampaign(id)
      setEditing(r.campaign)
      try { setPreviewCount((await api.previewCampaignCount(id)).total_unique) } catch { setPreviewCount(null) }
    } catch (e) { setError(e instanceof HttpError ? e.message : 'Open failed') }
  }
  async function createCampaign(name: string) {
    try {
      const r = await api.createCampaign({ name })
      setCreating(false)
      await loadCampaigns()
      await openCampaign(r.id)
    } catch (e) { setError(e instanceof HttpError ? e.message : 'Create failed') }
  }
  async function save() {
    if (!editing) return
    try {
      await api.updateCampaign(editing.id, {
        name: editing.name,
        segment_id: editing.segment_id || '',
        template_id: editing.template_id || '',
        variables: editing.variables,
      })
      await loadCampaigns()
      await openCampaign(editing.id)
    } catch (e) { setError(e instanceof HttpError ? e.message : 'Save failed') }
  }
  async function sendNow() {
    if (!editing) return
    if (!confirm(`Send to ~${previewCount ?? '?'} recipients now? This cannot be undone.`)) return
    setSending(true); setError('')
    try {
      await api.sendCampaignNow(editing.id)
      await openCampaign(editing.id)
      await loadCampaigns()
    } catch (e) { setError(e instanceof HttpError ? e.message : 'Send failed') }
    finally   { setSending(false) }
  }
  async function cancel() {
    if (!editing) return
    if (!confirm('Cancel this campaign?')) return
    try { await api.cancelCampaign(editing.id); setEditing(null); await loadCampaigns() }
    catch (e) { setError(e instanceof HttpError ? e.message : 'Cancel failed') }
  }

  return (
    <div className="p-6 max-w-5xl grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* List */}
      <section className="lg:col-span-1 space-y-2">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">Campaigns</h2>
          <button onClick={() => setCreating(true)} className="text-xs text-yellow-400 hover:underline">+ New</button>
        </div>
        {creating && <CreateRow onCreate={createCampaign} onCancel={() => setCreating(false)} />}
        {items.length === 0 && !creating && <p className="text-sm opacity-50">No campaigns yet.</p>}
        {items.map(c => (
          <button key={c.id} onClick={() => openCampaign(c.id)}
            className={`w-full text-left rounded-lg border p-3 transition-colors ${
              editing?.id === c.id ? 'border-yellow-500/50 bg-yellow-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
            }`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm">{c.name}</span>
              <StatusPill status={c.status} />
            </div>
            <p className="text-xs opacity-60 mt-1">
              {c.segment_name || <em>no segment</em>} · {c.template_name || <em>no template</em>}
            </p>
            {c.sent_at && (
              <p className="text-[11px] opacity-50 mt-0.5">
                Sent {new Date(c.sent_at).toLocaleString('en-GB')}
              </p>
            )}
          </button>
        ))}
      </section>

      {/* Editor */}
      <section className="lg:col-span-2">
        {!editing && (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-8 text-sm opacity-60 text-center">
            Pick a campaign to edit, or hit <b>+ New</b>.
          </div>
        )}
        {editing && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <input value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                className="flex-1 rounded-lg px-3 py-2 text-sm bg-black/40 border border-white/10 outline-none focus:border-yellow-500" />
              <StatusPill status={editing.status} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">
                <span className="block mb-1 opacity-60 uppercase tracking-widest">Audience</span>
                <select value={editing.segment_id ?? ''}
                  onChange={e => setEditing({ ...editing, segment_id: e.target.value || null })}
                  disabled={editing.status !== 'DRAFT'}
                  className="w-full rounded-lg px-2 py-2 text-sm bg-black/40 border border-white/10 disabled:opacity-60">
                  <option value="">— pick a segment —</option>
                  {segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="text-xs">
                <span className="block mb-1 opacity-60 uppercase tracking-widest">Template</span>
                <select value={editing.template_id ?? ''}
                  onChange={e => setEditing({ ...editing, template_id: e.target.value || null })}
                  disabled={editing.status !== 'DRAFT'}
                  className="w-full rounded-lg px-2 py-2 text-sm bg-black/40 border border-white/10 disabled:opacity-60">
                  <option value="">— pick a template —</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.status === 'ARCHIVED' ? '(archived)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {editing.template_name && editing.subject !== undefined && (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <p className="text-[11px] uppercase tracking-widest opacity-60 mb-1">Preview (will merge recipient variables at send time)</p>
                <p className="text-sm font-bold mb-2">{editing.subject || <em>(no subject)</em>}</p>
                <div className="prose prose-sm prose-invert max-w-none"
                     dangerouslySetInnerHTML={{ __html: editing.html_body || '' }} />
              </div>
            )}

            {(editing.status === 'DRAFT' || editing.status === 'SCHEDULED') && (
              <div className="pt-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={save} className="rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 px-3 py-2 text-sm">
                    Save
                  </button>
                  <button onClick={sendNow}
                    disabled={sending || !editing.segment_id || !editing.template_id || editing.status === 'SCHEDULED'}
                    className="rounded-lg bg-yellow-500 text-black px-4 py-2 text-sm font-bold disabled:opacity-50">
                    {sending ? 'Sending…' : `Send now${previewCount ? ` (~${previewCount})` : ''}`}
                  </button>
                  <div className="flex-1" />
                  <button onClick={cancel} className="rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 px-3 py-2 text-sm">
                    Cancel
                  </button>
                </div>
                <SchedulingRow editing={editing} onSaved={() => openCampaign(editing.id)} setError={setError} />
              </div>
            )}

            {editing.status === 'SENT' && editing.stats && (
              <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
                <p className="font-bold text-sm mb-1">Send complete</p>
                <p className="text-xs opacity-80">
                  Attempted <b>{editing.stats.attempted ?? 0}</b> · Sent <b>{editing.stats.sent ?? 0}</b> ·
                  Skipped (opted out) <b>{editing.stats.skipped_opted_out ?? 0}</b> ·
                  Failed <b>{editing.stats.failed ?? 0}</b>
                </p>
                {editing.stats.failed_detail && editing.stats.failed_detail.length > 0 && (
                  <details className="mt-2 text-[11px]">
                    <summary className="cursor-pointer opacity-60">Show failures</summary>
                    <ul className="mt-1 space-y-0.5">
                      {editing.stats.failed_detail.slice(0, 20).map((f, i) => (
                        <li key={i}><code>{f.email}</code> — {f.reason}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        )}
      </section>
      {error && <p className="col-span-full text-xs text-red-400">{error}</p>}
    </div>
  )
}

function SchedulingRow({
  editing, onSaved, setError,
}: {
  editing: CampaignFull
  onSaved: () => void
  setError: (s: string) => void
}) {
  // Default to one hour from now in the input, rounded to the minute.
  const defaultLocal = (() => {
    const d = new Date(Date.now() + 60 * 60 * 1000)
    d.setSeconds(0, 0)
    // datetime-local input wants YYYY-MM-DDTHH:MM in LOCAL time (no tz).
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })()
  const [when, setWhen] = useState<string>(
    editing.scheduled_at ? new Date(editing.scheduled_at).toISOString().slice(0, 16) : defaultLocal,
  )
  const [busy, setBusy] = useState(false)

  async function schedule() {
    setBusy(true); setError('')
    try {
      // Parse as local time, then convert to ISO (toISOString → UTC).
      const iso = new Date(when).toISOString()
      await api.scheduleCampaign(editing.id, iso)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Schedule failed')
    } finally {
      setBusy(false)
    }
  }
  async function unschedule() {
    setBusy(true); setError('')
    try { await api.unscheduleCampaign(editing.id); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unschedule failed') }
    finally   { setBusy(false) }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs opacity-70 uppercase tracking-widest">Or schedule</span>
      <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
        className="rounded px-2 py-1 bg-black/40 border border-white/10 text-sm" />
      {editing.status === 'SCHEDULED' ? (
        <>
          <button onClick={unschedule} disabled={busy}
            className="rounded-lg bg-white/5 border border-white/15 text-white/70 px-3 py-1.5 text-xs">
            {busy ? '…' : 'Unschedule'}
          </button>
          <span className="text-[11px] text-indigo-300">
            Fires at {new Date(editing.scheduled_at || '').toLocaleString('en-GB')}
          </span>
        </>
      ) : (
        <button onClick={schedule} disabled={busy || !editing.segment_id || !editing.template_id}
          className="rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 px-3 py-1.5 text-xs font-bold disabled:opacity-50">
          {busy ? 'Scheduling…' : 'Schedule send'}
        </button>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: Status }) {
  const cls =
    status === 'SENT'     ? 'bg-green-500/15 text-green-300' :
    status === 'SENDING'  ? 'bg-blue-500/15 text-blue-300' :
    status === 'SCHEDULED'? 'bg-indigo-500/15 text-indigo-300' :
    status === 'CANCELLED'? 'bg-gray-500/15 text-gray-400' :
                            'bg-amber-500/15 text-amber-300'
  return <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${cls}`}>{status}</span>
}

function CreateRow({ onCreate, onCancel }: { onCreate: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  return (
    <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-2 flex items-center gap-2">
      <input value={name} onChange={e => setName(e.target.value)} autoFocus
        placeholder="Campaign name" className="flex-1 rounded px-2 py-1 bg-black/40 border border-white/10 text-sm" />
      <button onClick={() => name.trim() && onCreate(name.trim())}
        disabled={!name.trim()} className="text-xs rounded bg-yellow-500 text-black px-2 py-1 font-bold disabled:opacity-50">
        Create
      </button>
      <button onClick={onCancel} className="text-xs text-white/60">×</button>
    </div>
  )
}
