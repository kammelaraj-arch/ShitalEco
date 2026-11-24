'use client'
// Serious Incident Report register — Charity Commission CC28.
// Full access gated to CHAIR / SECRETARY / SAFEGUARDING_LEAD /
// SUPER_ADMIN. Other viewers see redacted rows.

import { useCallback, useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'

type Status = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'REFERRED'
type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

interface Incident {
  id: string
  ref: string
  category: string
  severity: Severity
  title: string
  status: Status
  summary?: string
  commission_reportable?: boolean
  reported_to_commission?: boolean
  commission_reference?: string
  created_at: string
  redacted?: boolean
}

interface IncidentDetail extends Incident {
  summary: string
  date_occurred: string | null
  date_discovered: string | null
  affected_parties: string
  impact_assessment: string
  actions_taken: string
  further_actions_planned: string
  commission_reportable: boolean
  reported_to_commission: boolean
  commission_reference: string
  reported_to_police: boolean
  police_reference: string
  reported_to_ico: boolean
  reported_to_insurer: boolean
  resolution_summary: string
  reporter_name: string
}

interface SIRUpdate {
  id: string; body: string; author_name: string; created_at: string
}

const CATEGORIES = [
  'SAFEGUARDING', 'FRAUD', 'FINANCIAL_LOSS', 'CRIMINAL',
  'REPUTATIONAL', 'DATA_BREACH', 'OTHER',
]
const SEVERITIES: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

const CC28_URL = 'https://www.gov.uk/guidance/how-to-report-a-serious-incident-in-your-charity'

export default function SIRPage() {
  const [rows, setRows] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [restricted, setRestricted] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    category: 'SAFEGUARDING', severity: 'MEDIUM' as Severity,
    title: '', summary: '',
    date_occurred: '', date_discovered: '',
    affected_parties: '', impact_assessment: '',
    actions_taken: '', further_actions_planned: '',
    commission_reportable: false, reporter_name: '',
  })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await apiFetch<{ incidents: Incident[]; restricted: boolean }>('/admin/compliance/sir')
      setRows(r.incidents || [])
      setRestricted(r.restricted)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function create() {
    if (!draft.title.trim()) { setError('Title is required'); return }
    try {
      await apiFetch('/admin/compliance/sir', {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          date_occurred: draft.date_occurred || null,
          date_discovered: draft.date_discovered || null,
        }),
      })
      setShowForm(false)
      setDraft({
        category: 'SAFEGUARDING', severity: 'MEDIUM',
        title: '', summary: '',
        date_occurred: '', date_discovered: '',
        affected_parties: '', impact_assessment: '',
        actions_taken: '', further_actions_planned: '',
        commission_reportable: false, reporter_name: '',
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }

  const openCount = rows.filter(r => r.status === 'OPEN' || r.status === 'INVESTIGATING').length
  const reportable = rows.filter(r => r.commission_reportable && !r.reported_to_commission).length

  return (
    <div className="p-6 space-y-6 text-white max-w-[1400px] mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black">Serious Incident Register</h1>
          <p className="text-white/50 text-sm mt-0.5">
            Charity Commission CC28 — trustees must report serious incidents promptly. Access is restricted.
          </p>
        </div>
        {!restricted && (
          <button onClick={() => setShowForm(s => !s)}
            className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-black">
            {showForm ? 'Close' : '+ Record incident'}
          </button>
        )}
      </header>

      {error && <div className="bg-red-500/15 border border-red-500/40 text-red-200 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {restricted && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200 text-sm">
          🔒 Full access to the SIR register is limited to the Chair, Secretary, Safeguarding Lead and SUPER_ADMIN. Row titles and summaries are redacted on your view.
        </div>
      )}

      {!restricted && (openCount > 0 || reportable > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="text-red-300 text-xs font-black uppercase tracking-widest">Open</p>
            <p className="text-4xl font-black text-white mt-1">{openCount}</p>
            <p className="text-red-200/70 text-xs mt-1">Incidents still under investigation</p>
          </div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <p className="text-amber-300 text-xs font-black uppercase tracking-widest">Un-reported</p>
            <p className="text-4xl font-black text-white mt-1">{reportable}</p>
            <p className="text-amber-200/70 text-xs mt-1">Flagged as Commission-reportable but not yet filed</p>
          </div>
        </div>
      )}

      {showForm && !restricted && (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5 space-y-3">
          <h2 className="text-red-300 text-xs uppercase tracking-widest font-black">Record incident</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-3">
              <label className="block text-white/50 text-xs font-bold mb-1">Title *</label>
              <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Category</label>
              <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm">
                {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Severity</label>
              <select value={draft.severity} onChange={e => setDraft(d => ({ ...d, severity: e.target.value as Severity }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm">
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Reporter</label>
              <input value={draft.reporter_name} onChange={e => setDraft(d => ({ ...d, reporter_name: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm"
                placeholder="(defaults to current user)" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Date occurred</label>
              <input type="datetime-local" value={draft.date_occurred}
                onChange={e => setDraft(d => ({ ...d, date_occurred: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Date discovered</label>
              <input type="datetime-local" value={draft.date_discovered}
                onChange={e => setDraft(d => ({ ...d, date_discovered: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-white/50 text-xs font-bold mb-1">Summary</label>
                <textarea rows={3} value={draft.summary}
                  onChange={e => setDraft(d => ({ ...d, summary: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm resize-none" />
              </div>
              <div>
                <label className="block text-white/50 text-xs font-bold mb-1">Affected parties</label>
                <textarea rows={3} value={draft.affected_parties}
                  onChange={e => setDraft(d => ({ ...d, affected_parties: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm resize-none" />
              </div>
              <div>
                <label className="block text-white/50 text-xs font-bold mb-1">Impact assessment</label>
                <textarea rows={3} value={draft.impact_assessment}
                  onChange={e => setDraft(d => ({ ...d, impact_assessment: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm resize-none" />
              </div>
              <div>
                <label className="block text-white/50 text-xs font-bold mb-1">Actions already taken</label>
                <textarea rows={3} value={draft.actions_taken}
                  onChange={e => setDraft(d => ({ ...d, actions_taken: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm resize-none" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-white/50 text-xs font-bold mb-1">Further actions planned</label>
                <textarea rows={2} value={draft.further_actions_planned}
                  onChange={e => setDraft(d => ({ ...d, further_actions_planned: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm resize-none" />
              </div>
            </div>
            <div className="md:col-span-3 flex items-center gap-2">
              <input type="checkbox" checked={draft.commission_reportable}
                onChange={e => setDraft(d => ({ ...d, commission_reportable: e.target.checked }))}
                className="accent-red-500" />
              <label className="text-white/80 text-sm">
                Flag as Charity Commission reportable (see <a href={CC28_URL} target="_blank" rel="noreferrer" className="text-sky-300 underline">CC28 guidance</a>)
              </label>
            </div>
          </div>
          <button onClick={create}
            className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-black">
            Record incident
          </button>
        </section>
      )}

      {loading ? (
        <p className="text-white/50 text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-white/40 text-sm italic">No serious incidents on record.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-xs uppercase tracking-widest">
              <tr>
                <th className="px-3 py-2 text-left">Ref</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Severity</th>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Commission</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-3 py-2 font-mono text-xs text-red-300">{r.ref}</td>
                  <td className="px-3 py-2 text-white/70 text-xs">{r.category.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2">
                    <span className={
                      'px-1.5 py-0.5 rounded-full text-[10px] font-black border ' +
                      (r.severity === 'CRITICAL' ? 'bg-red-500/30 text-red-100 border-red-400/40'
                        : r.severity === 'HIGH' ? 'bg-red-500/20 text-red-200 border-red-400/30'
                        : r.severity === 'MEDIUM' ? 'bg-amber-500/20 text-amber-200 border-amber-400/30'
                        : 'bg-sky-500/20 text-sky-200 border-sky-400/30')
                    }>{r.severity}</span>
                  </td>
                  <td className={'px-3 py-2 ' + (r.redacted ? 'italic text-white/40' : 'text-white')}>
                    {r.title}
                  </td>
                  <td className="px-3 py-2 text-white/70 text-xs">{r.status}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.commission_reportable && !r.reported_to_commission && (
                      <span className="text-amber-300 font-bold">⚠ Not reported</span>
                    )}
                    {r.reported_to_commission && (
                      <span className="text-emerald-300">✓ Reported {r.commission_reference ? `(${r.commission_reference})` : ''}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!r.redacted && (
                      <button onClick={() => setOpenId(r.id)}
                        className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-300 text-xs font-bold hover:bg-red-500/10">
                        Open
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && <IncidentDrawer sirId={openId} onClose={() => { setOpenId(null); void load() }} />}
    </div>
  )
}

function IncidentDrawer({ sirId, onClose }: { sirId: string; onClose: () => void }) {
  const [incident, setIncident] = useState<IncidentDetail | null>(null)
  const [updates, setUpdates] = useState<SIRUpdate[]>([])
  const [newUpdate, setNewUpdate] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await apiFetch<{ incident: IncidentDetail; updates: SIRUpdate[] }>(`/admin/compliance/sir/${sirId}`)
    setIncident(r.incident)
    setUpdates(r.updates || [])
  }, [sirId])
  useEffect(() => { void load() }, [load])

  async function append() {
    if (!newUpdate.trim()) return
    setBusy(true)
    try {
      await apiFetch(`/admin/compliance/sir/${sirId}/updates`, {
        method: 'POST', body: JSON.stringify({ body: newUpdate }),
      })
      setNewUpdate('')
      await load()
    } finally { setBusy(false) }
  }

  async function markReported() {
    const ref = window.prompt('Charity Commission reference / confirmation (optional)') || ''
    setBusy(true)
    try {
      await apiFetch(`/admin/compliance/sir/${sirId}/mark-reported`, {
        method: 'POST', body: JSON.stringify({ commission_reference: ref }),
      })
      await load()
    } finally { setBusy(false) }
  }

  async function resolve() {
    const rs = window.prompt('Resolution summary', '') || ''
    if (!rs) return
    setBusy(true)
    try {
      await apiFetch(`/admin/compliance/sir/${sirId}/resolve`, {
        method: 'POST', body: JSON.stringify({ resolution_summary: rs }),
      })
      await load()
    } finally { setBusy(false) }
  }

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/70 z-40" />
      <div className="fixed right-0 top-0 h-full w-full lg:max-w-[720px] bg-temple-deep border-l border-red-500/30 z-50 flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-white font-black text-lg">
              <span className="text-red-300 font-mono text-sm mr-2">{incident?.ref}</span>
              {incident?.title}
            </h2>
            <p className="text-white/50 text-xs">
              {incident?.category.replace(/_/g, ' ')} · {incident?.severity} · {incident?.status}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {incident?.commission_reportable && !incident?.reported_to_commission && (
              <button onClick={markReported} disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-black">
                Mark reported to Commission
              </button>
            )}
            {incident?.status !== 'RESOLVED' && (
              <button onClick={resolve} disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-black">
                Resolve
              </button>
            )}
            <button onClick={onClose} className="text-white/60 hover:text-white text-xl px-1">✕</button>
          </div>
        </div>
        {incident && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
            <div>
              <p className="text-white/50 text-xs uppercase tracking-widest font-black mb-1">Summary</p>
              <p className="text-white/80 whitespace-pre-wrap">{incident.summary || '—'}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <KV label="Affected parties" value={incident.affected_parties} />
              <KV label="Impact assessment" value={incident.impact_assessment} />
              <KV label="Actions taken" value={incident.actions_taken} />
              <KV label="Further actions planned" value={incident.further_actions_planned} />
              {incident.resolution_summary && <KV label="Resolution" value={incident.resolution_summary} full />}
            </div>
            <div className="flex gap-3 flex-wrap text-xs text-white/60">
              {incident.date_occurred && <span>Occurred: {new Date(incident.date_occurred).toLocaleString()}</span>}
              {incident.date_discovered && <span>Discovered: {new Date(incident.date_discovered).toLocaleString()}</span>}
            </div>

            <div>
              <p className="text-white/50 text-xs uppercase tracking-widest font-black mb-1">Reporting</p>
              <ul className="space-y-1 text-xs text-white/70">
                <li>Charity Commission: {incident.reported_to_commission ? `✓ ${incident.commission_reference || ''}` : 'Not reported'}</li>
                <li>Police: {incident.reported_to_police ? `✓ ${incident.police_reference || ''}` : 'No'}</li>
                <li>ICO: {incident.reported_to_ico ? '✓' : 'No'}</li>
                <li>Insurer: {incident.reported_to_insurer ? '✓' : 'No'}</li>
              </ul>
              <a href={CC28_URL} target="_blank" rel="noreferrer"
                 className="inline-block mt-2 text-sky-300 underline text-xs">
                Open CC28 online form →
              </a>
            </div>

            <div>
              <p className="text-white/50 text-xs uppercase tracking-widest font-black mb-2">Timeline</p>
              <div className="rounded-xl border border-white/10 bg-white/3 p-3 space-y-2">
                {updates.length === 0 ? (
                  <p className="text-white/30 text-xs italic">No updates yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {updates.map(u => (
                      <li key={u.id} className="text-xs">
                        <div className="text-white/50">
                          {new Date(u.created_at).toLocaleString()} — {u.author_name}
                        </div>
                        <div className="text-white/80 whitespace-pre-wrap mt-0.5">{u.body}</div>
                      </li>
                    ))}
                  </ul>
                )}
                <textarea rows={2} value={newUpdate} onChange={e => setNewUpdate(e.target.value)}
                  placeholder="Append timeline note…"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs resize-none" />
                <button onClick={append} disabled={busy || !newUpdate.trim()}
                  className="px-3 py-1.5 rounded-lg bg-saffron-gradient text-white text-xs font-black shadow-saffron disabled:opacity-40">
                  {busy ? 'Saving…' : 'Append'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function KV({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? 'md:col-span-2' : ''}>
      <p className="text-white/50 text-xs uppercase tracking-widest font-black">{label}</p>
      <p className="text-white/80 text-sm whitespace-pre-wrap">{value || '—'}</p>
    </div>
  )
}
