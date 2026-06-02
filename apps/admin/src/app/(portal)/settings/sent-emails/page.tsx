'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, API_BASE, getToken } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SentEmailRow {
  id: string
  template_key: string
  to_email: string
  subject: string
  status: 'PENDING' | 'SENT' | 'FAILED' | string
  error: string
  attempts: number
  last_attempt_at: string | null
  sent_at: string | null
  related_type: string
  related_id: string
  created_at: string
}

interface SentDetail extends SentEmailRow {
  from_email: string
  html_body: string
  text_body: string
  variables: Record<string, unknown>
  triggered_by: string
}

const STATUSES = ['', 'PENDING', 'SENT', 'FAILED'] as const
const PAGE_SIZE = 50

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAge(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!t) return iso
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60)     return `${Math.floor(s)}s ago`
  if (s < 3600)   return `${Math.floor(s / 60)}m ago`
  if (s < 86400)  return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function statusTone(s: string): string {
  if (s === 'SENT')    return 'bg-green-500/15 border-green-500/30 text-green-300'
  if (s === 'FAILED')  return 'bg-red-500/15 border-red-500/30 text-red-300'
  if (s === 'PENDING') return 'bg-amber-500/15 border-amber-500/30 text-amber-300'
  return 'bg-white/5 border-white/10 text-white/40'
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SentEmailsPage() {
  const [items, setItems]       = useState<SentEmailRow[]>([])
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [err, setErr]           = useState('')

  const [statusFilter, setStatusFilter] = useState<string>('')
  const [search, setSearch]             = useState<string>('')
  const [templateKey, setTemplateKey]   = useState<string>('')
  const [offset, setOffset]             = useState<number>(0)

  const [open, setOpen]         = useState<SentDetail | null>(null)
  const [resending, setResend]  = useState<string>('')
  const [actionMsg, setMsg]     = useState<{ text: string; ok: boolean } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const qs = new URLSearchParams({
        limit:  String(PAGE_SIZE),
        offset: String(offset),
      })
      if (statusFilter) qs.set('status_filter', statusFilter)
      if (templateKey)  qs.set('template_key',  templateKey)
      if (search)       qs.set('search',        search)
      const d = await apiFetch<{ items: SentEmailRow[]; total: number }>(
        `/email-templates/sent?${qs}`
      )
      setItems(d.items); setTotal(d.total)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load sent emails')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, templateKey, search, offset])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 60 s, but only when the user is on the FAILED filter
  // — that's the one where a new event matters and the user is likely waiting.
  // Pending / Sent / All don't poll: avoids hammering the API for an audit log.
  useEffect(() => {
    if (statusFilter !== 'FAILED') return
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [statusFilter, load])

  async function openRow(id: string) {
    try {
      const d = await apiFetch<SentDetail>(`/email-templates/sent/${id}`)
      setOpen(d)
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Failed to load email', ok: false })
    }
  }

  async function resend(id: string) {
    if (!confirm('Resend this email? The original row stays — a new attempt is recorded.')) return
    setResend(id); setMsg(null)
    try {
      const res = await fetch(`${API_BASE}/email-templates/sent/${id}/resend`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      setMsg({ text: 'Resend triggered', ok: true })
      await load()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Resend failed', ok: false })
    } finally {
      setResend('')
    }
  }

  // Counts for the filter chip-row (best-effort — we know exact counts only
  // for the currently-fetched window, so we just show "Active" highlight).
  const onPage = items.length
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)
  const pageIdx  = Math.floor(offset / PAGE_SIZE)

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">📨 Sent Emails</h1>
          <p className="text-white/40 mt-1">
            Audit log of every outgoing email. Filter by status, search by recipient or subject, click a row for the full body. Failed emails can be resent.
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="glass rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
          {STATUSES.map(s => (
            <button key={s || 'all'} onClick={() => { setOffset(0); setStatusFilter(s) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                statusFilter === s ? 'bg-saffron-gradient text-white shadow' : 'text-white/40 hover:text-white/70'
              }`}>{s || 'All'}</button>
          ))}
        </div>

        <input
          value={search}
          onChange={e => { setOffset(0); setSearch(e.target.value) }}
          placeholder="Search recipient or subject…"
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-white text-sm outline-none w-72"
        />

        <input
          value={templateKey}
          onChange={e => { setOffset(0); setTemplateKey(e.target.value) }}
          placeholder="Template key (e.g. donation_receipt)"
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-white text-sm outline-none w-72"
        />

        <button onClick={load}
          className="ml-auto px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 text-xs hover:bg-white/10">
          ↻ Refresh
        </button>
      </div>

      {actionMsg && (
        <p className={`text-sm rounded-lg px-3 py-2 ${actionMsg.ok ? 'bg-green-500/15 text-green-300 border border-green-500/30' : 'bg-red-500/15 text-red-300 border border-red-500/30'}`}>
          {actionMsg.text}
        </p>
      )}

      {err && (
        <p className="text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</p>
      )}

      {/* Counts */}
      <div className="text-xs text-white/40">
        {loading ? 'Loading…' : `Showing ${onPage} of ${total} • page ${pageIdx + 1}/${lastPage + 1}`}
        {statusFilter === 'FAILED' && <span className="ml-3">· auto-refresh every 60 s</span>}
      </div>

      {/* Table */}
      <div className="glass rounded-2xl p-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-white/40 text-xs uppercase tracking-wider">
            <tr className="text-left border-b border-white/10">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">To</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Template</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Attempts</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="text-white/80">
            {items.map(r => (
              <tr key={r.id} className="border-t border-white/5 hover:bg-white/3 cursor-pointer" onClick={() => openRow(r.id)}>
                <td className="px-3 py-2 text-white/60 text-xs">{fmtAge(r.created_at)}</td>
                <td className="px-3 py-2">{r.to_email}</td>
                <td className="px-3 py-2 max-w-md truncate">{r.subject || <span className="text-white/30">(no subject)</span>}</td>
                <td className="px-3 py-2 text-white/50 text-xs font-mono">{r.template_key || '—'}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${statusTone(r.status)}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-white/40">{r.attempts}</td>
                <td className="px-3 py-2 text-right">
                  {r.status === 'FAILED' && (
                    <button
                      onClick={e => { e.stopPropagation(); resend(r.id) }}
                      disabled={resending === r.id}
                      className="px-2 py-1 rounded text-xs font-semibold bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/25 disabled:opacity-50"
                    >
                      {resending === r.id ? 'Resending…' : 'Resend'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-white/40">No emails match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center gap-2 justify-end text-xs">
          <button onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={pageIdx === 0}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-30">‹ Prev</button>
          <span className="text-white/40">{pageIdx + 1} / {lastPage + 1}</span>
          <button onClick={() => setOffset(offset + PAGE_SIZE)} disabled={pageIdx >= lastPage}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-30">Next ›</button>
        </div>
      )}

      {/* Detail drawer */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setOpen(null)}>
          <div className="w-full max-w-2xl h-full bg-[#0f0008] border-l border-white/10 overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">{open.template_key || '—'}</p>
                <h2 className="text-xl font-bold text-white">{open.subject || '(no subject)'}</h2>
                <p className="text-white/60 text-sm mt-1">to {open.to_email}{open.from_email && ` · from ${open.from_email}`}</p>
              </div>
              <button onClick={() => setOpen(null)} className="text-white/40 hover:text-white text-xl">✕</button>
            </div>

            <div className="flex items-center gap-3 text-xs flex-wrap mb-4">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${statusTone(open.status)}`}>{open.status}</span>
              <span className="text-white/40">Attempts: {open.attempts}</span>
              <span className="text-white/40">Created: {fmtAge(open.created_at)}</span>
              {open.sent_at && <span className="text-green-400/80">Sent: {fmtAge(open.sent_at)}</span>}
              {open.last_attempt_at && <span className="text-white/40">Last try: {fmtAge(open.last_attempt_at)}</span>}
              {open.triggered_by && <span className="text-white/40">By: {open.triggered_by}</span>}
            </div>

            {open.error && (
              <div className="rounded-xl p-3 mb-4 bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-mono whitespace-pre-wrap break-all">
                {open.error}
              </div>
            )}

            {open.related_type && (
              <p className="text-white/40 text-xs mb-3">Related: <span className="font-mono">{open.related_type}/{open.related_id}</span></p>
            )}

            {open.status === 'FAILED' && (
              <button onClick={() => resend(open.id)} disabled={resending === open.id}
                className="px-4 py-2 rounded-xl text-sm font-bold bg-orange-500/20 border border-orange-500/40 text-orange-300 hover:bg-orange-500/30 disabled:opacity-50 mb-4">
                {resending === open.id ? 'Resending…' : '↻ Resend'}
              </button>
            )}

            {/* Body preview — HTML in a sandboxed iframe so any styles can't bleed into the admin */}
            {open.html_body && (
              <>
                <p className="text-white/60 text-xs font-bold uppercase tracking-wider mb-2 mt-4">HTML preview</p>
                <div className="rounded-xl overflow-hidden bg-white">
                  <iframe srcDoc={open.html_body} sandbox="allow-same-origin" className="w-full h-[420px] border-0" title="HTML preview" />
                </div>
              </>
            )}

            {open.text_body && (
              <>
                <p className="text-white/60 text-xs font-bold uppercase tracking-wider mb-2 mt-4">Plain text</p>
                <pre className="rounded-xl p-3 bg-white/5 border border-white/10 text-white/70 text-xs whitespace-pre-wrap break-all">{open.text_body}</pre>
              </>
            )}

            {open.variables && Object.keys(open.variables).length > 0 && (
              <>
                <p className="text-white/60 text-xs font-bold uppercase tracking-wider mb-2 mt-4">Template variables</p>
                <pre className="rounded-xl p-3 bg-white/5 border border-white/10 text-white/70 text-xs font-mono">{JSON.stringify(open.variables, null, 2)}</pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
