'use client'
// Trustees' Annual Report — SORP §1.21.
// List previous reports + "Generate 2026 TAR" action that pulls from
// every Governance Core source and pre-drafts each section.

import { useCallback, useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'

type Status = 'DRAFT' | 'REVIEWING' | 'FINALISED' | 'FILED'

interface ReportRow {
  id: string
  title: string
  period_start: string
  period_end: string
  status: Status
  signed_at: string | null
  filed_with_commission_at: string | null
  created_at: string
}

export default function AnnualReportPage() {
  const [rows, setRows] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState({
    title: '', period_start: '', period_end: '',
  })
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await apiFetch<{ reports: ReportRow[] }>('/admin/annual-reports')
      setRows(r.reports || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function create() {
    if (!draft.title.trim() || !draft.period_start || !draft.period_end) {
      setError('Title, period start and period end are required')
      return
    }
    try {
      const r = await apiFetch<{ id: string; sections_drafted: number }>('/admin/annual-reports', {
        method: 'POST', body: JSON.stringify(draft),
      })
      setShowForm(false)
      setDraft({ title: '', period_start: '', period_end: '' })
      await load()
      setOpenId(r.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }

  function presetThisFY() {
    const now = new Date()
    const y = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear()
    setDraft({
      title: `Trustees' Annual Report ${y}-${(y + 1).toString().slice(2)}`,
      period_start: `${y}-04-01`,
      period_end: `${y + 1}-03-31`,
    })
  }

  return (
    <div className="p-6 space-y-6 text-white max-w-[1400px] mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black">Trustees' Annual Report</h1>
          <p className="text-white/50 text-sm mt-0.5">
            SORP §1.21 — the trustees' narrative report, auto-drafted from the Governance Core.
          </p>
        </div>
        <button onClick={() => setShowForm(s => !s)}
          className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
          {showForm ? 'Close' : '+ New annual report'}
        </button>
      </header>

      {error && (
        <div className="bg-red-500/15 border border-red-500/40 text-red-200 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}

      {showForm && (
        <section className="rounded-2xl border border-saffron-400/30 bg-saffron-400/5 p-5 space-y-3">
          <h2 className="text-saffron-300 text-xs uppercase tracking-widest font-black">New annual report</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-3">
              <label className="block text-white/50 text-xs font-bold mb-1">Title</label>
              <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm"
                placeholder="Trustees' Annual Report 2025-26" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Period start</label>
              <input type="date" value={draft.period_start} onChange={e => setDraft(d => ({ ...d, period_start: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Period end</label>
              <input type="date" value={draft.period_end} onChange={e => setDraft(d => ({ ...d, period_end: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="flex items-end">
              <button onClick={presetThisFY}
                className="px-3 py-2 rounded-xl border border-white/15 text-white/70 text-xs font-bold hover:bg-white/5">
                Use current UK FY (1 Apr → 31 Mar)
              </button>
            </div>
          </div>
          <button onClick={create}
            className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
            Generate — pulls data from every Governance Core module
          </button>
        </section>
      )}

      {loading ? (
        <p className="text-white/50 text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-white/40 text-sm italic">No annual reports yet. Create one for your reporting period.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-xs uppercase tracking-widest">
              <tr>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Period</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Signed</th>
                <th className="px-3 py-2 text-left">Filed</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-3 py-2 font-bold">{r.title}</td>
                  <td className="px-3 py-2 text-white/70 text-xs">
                    {new Date(r.period_start).toLocaleDateString()} – {new Date(r.period_end).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    <span className={
                      'px-2 py-0.5 rounded-full text-[10px] font-black border ' +
                      (r.status === 'FILED' ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30'
                        : r.status === 'FINALISED' ? 'bg-sky-500/20 text-sky-200 border-sky-400/30'
                        : r.status === 'REVIEWING' ? 'bg-amber-500/20 text-amber-200 border-amber-400/30'
                        : 'bg-white/10 text-white/60 border-white/20')
                    }>{r.status}</span>
                  </td>
                  <td className="px-3 py-2 text-white/60 text-xs">
                    {r.signed_at ? new Date(r.signed_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-white/60 text-xs">
                    {r.filed_with_commission_at ? new Date(r.filed_with_commission_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setOpenId(r.id)}
                      className="px-3 py-1.5 rounded-lg border border-saffron-400/40 text-saffron-300 text-xs font-bold hover:bg-saffron-400/10">
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && <ReportEditor reportId={openId} onClose={() => { setOpenId(null); void load() }} />}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Report editor — right-side drawer with section list + preview pane
// ────────────────────────────────────────────────────────────────────────

interface SectionMeta { key: string; label: string }

function ReportEditor({ reportId, onClose }: { reportId: string; onClose: () => void }) {
  const [report, setReport] = useState<Record<string, unknown> | null>(null)
  const [sections, setSections] = useState<SectionMeta[]>([])
  const [active, setActive] = useState<string>('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')

  const load = useCallback(async () => {
    const [r, s] = await Promise.all([
      apiFetch<{ report: Record<string, unknown> }>(`/admin/annual-reports/${reportId}`),
      apiFetch<{ sections: SectionMeta[] }>('/admin/annual-reports/sections'),
    ])
    setReport(r.report)
    setSections(s.sections || [])
    if (!active && s.sections?.length) setActive(s.sections[0].key)
  }, [reportId, active])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!report || !active) return
    const ns = (report.narrative_sections || {}) as Record<string, { html?: string }>
    setDraft(ns[active]?.html || '')
  }, [report, active])

  async function saveSection() {
    if (!active) return
    setBusy(true)
    try {
      await apiFetch(`/admin/annual-reports/${reportId}/sections/${active}`, {
        method: 'PUT', body: JSON.stringify({ html: draft }),
      })
      await load()
    } finally { setBusy(false) }
  }

  async function regenerate() {
    if (!confirm('Refresh every section draft from current Governance Core data? Sections you’ve already edited by hand are kept.')) return
    setBusy(true)
    try {
      await apiFetch(`/admin/annual-reports/${reportId}/regenerate`, { method: 'POST' })
      await load()
    } finally { setBusy(false) }
  }

  async function finalise() {
    if (!confirm('Finalise this report? Finalising locks the text and freezes a snapshot of the Governance Core data.')) return
    setBusy(true)
    try {
      await apiFetch(`/admin/annual-reports/${reportId}/finalise`, { method: 'POST' })
      await load()
    } finally { setBusy(false) }
  }

  async function markFiled() {
    const ref = window.prompt('Charity Commission reference / confirmation (optional)') || ''
    try {
      await apiFetch(`/admin/annual-reports/${reportId}/mark-filed`, {
        method: 'POST', body: JSON.stringify({ commission_reference: ref }),
      })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function loadPreview() {
    try {
      const r = await apiFetch<{ html: string }>(`/admin/annual-reports/${reportId}/preview`)
      setPreview(r.html || '')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  const locked = report?.status === 'FINALISED' || report?.status === 'FILED'

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/60 z-40" />
      <div className="fixed right-0 top-0 h-full w-full lg:max-w-[1200px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-white font-black text-lg">{report?.title as string || 'Annual report'}</h2>
            <p className="text-white/50 text-xs">
              {report?.period_start as string} – {report?.period_end as string} · {report?.status as string}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {!locked && (
              <>
                <button onClick={regenerate} disabled={busy}
                  className="px-3 py-1.5 rounded-lg border border-white/15 text-white/80 text-xs font-bold hover:bg-white/5 disabled:opacity-40">
                  ↻ Regenerate from data
                </button>
                <button onClick={finalise} disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-sky-500 text-white text-xs font-black">
                  Finalise
                </button>
              </>
            )}
            {report?.status === 'FINALISED' && (
              <button onClick={markFiled}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-black">
                Mark filed
              </button>
            )}
            <button onClick={loadPreview}
              className="px-3 py-1.5 rounded-lg bg-saffron-gradient text-white text-xs font-black shadow-saffron">
              Preview
            </button>
            <button onClick={onClose} className="text-white/60 hover:text-white text-xl px-1">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="overflow-y-auto border-r border-white/5 p-3 space-y-1">
            {sections.map(s => (
              <button key={s.key} onClick={() => setActive(s.key)}
                className={'w-full text-left px-3 py-2 rounded-lg text-xs font-bold ' +
                  (active === s.key ? 'bg-saffron-400/15 text-saffron-300' : 'text-white/60 hover:bg-white/5')}>
                {s.label}
              </button>
            ))}
          </aside>
          <div className="overflow-y-auto p-5 space-y-3">
            {preview ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-white/50 text-xs uppercase tracking-widest font-black">Rendered preview</p>
                  <button onClick={() => setPreview('')} className="text-white/60 text-xs hover:text-white">← back to editor</button>
                </div>
                <article className="prose prose-invert prose-sm max-w-none rounded-xl border border-white/10 bg-white/3 p-5"
                  dangerouslySetInnerHTML={{ __html: preview }} />
                <button onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-lg border border-white/15 text-white/70 text-xs font-bold">
                  Print / save as PDF
                </button>
              </>
            ) : (
              <>
                <p className="text-white/50 text-xs uppercase tracking-widest font-black">
                  Edit: {sections.find(s => s.key === active)?.label || '—'}
                </p>
                <textarea rows={22} value={draft} onChange={e => setDraft(e.target.value)}
                  disabled={locked}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono resize-vertical" />
                <div className="flex gap-2">
                  <button onClick={saveSection} disabled={busy || locked}
                    className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron disabled:opacity-40">
                    {busy ? 'Saving…' : 'Save section'}
                  </button>
                </div>
                <p className="text-white/40 text-[10px]">
                  Tip: edit the HTML directly. The regenerate action keeps any section you&apos;ve edited manually.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
