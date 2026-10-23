'use client'
/**
 * Audit Log — who changed what, when, from where.
 *
 * Branch-scoped by default. SUPER_ADMIN can toggle 'All branches'.
 * Filters: entity_type, actor_email, action. Paginated.
 *
 * Clicking a row expands it to show before/after diff — the exact field
 * values that changed, so an incident like "SumUp reader flipped to
 * Stripe" is traceable to the exact commit, actor and timestamp.
 */

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { apiFetch } from '@/lib/api'

interface AuditRow {
  id: string
  actor_email: string
  actor_role: string | null
  action: string
  entity_type: string
  entity_id: string
  branch_id: string | null
  source_endpoint: string | null
  changed_fields: string[] | null
  diff_summary: string | null
  created_at: string
}

interface AuditDetail extends AuditRow {
  before_json: Record<string, unknown> | null
  after_json: Record<string, unknown> | null
}

interface ListResponse {
  items: AuditRow[]
  total: number
  limit: number
  offset: number
}

function timeAgo(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

const ACTION_STYLES: Record<string, string> = {
  create:                 'bg-green-500/15 text-green-300 border-green-500/30',
  update:                 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  delete:                 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  assign_user:            'bg-blue-500/15 text-blue-200 border-blue-500/30',
  assign_reader_create:   'bg-blue-500/15 text-blue-200 border-blue-500/30',
  assign_reader_update:   'bg-amber-500/15 text-amber-200 border-amber-500/30',
}

export default function AuditLogPage() {
  const [items, setItems] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [limit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [filterType, setFilterType] = useState('')
  const [filterActor, setFilterActor] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterEntityId, setFilterEntityId] = useState('')
  const [crossBranch, setCrossBranch] = useState(false)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, AuditDetail>>({})

  // Deep-link support: /settings/system/audit?entity=terminal_devices&id=<uuid>
  // Pre-fills the filters so clicking the 📜 button on a specific row
  // takes you straight to its history.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    const e = p.get('entity'); const i = p.get('id')
    if (e) setFilterType(e)
    if (i) setFilterEntityId(i)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // When a specific entity_id is pinned, hit the per-entity endpoint
      // so we get the full history unpaginated (bounded at 500 server-side).
      if (filterEntityId && filterType) {
        const r = await apiFetch<AuditRow[]>(
          `/audit-log/entity/${filterType}/${filterEntityId}?limit=500`
        )
        setItems(r); setTotal(r.length)
      } else {
        const q = new URLSearchParams({
          limit: String(limit), offset: String(offset),
          ...(filterType  && { entity_type: filterType }),
          ...(filterActor && { actor_email: filterActor }),
          ...(filterAction && { action: filterAction }),
          ...(crossBranch && { cross_branch: 'true' }),
        })
        const r = await apiFetch<ListResponse>(`/audit-log/?${q.toString()}`)
        setItems(r.items); setTotal(r.total)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }, [limit, offset, filterType, filterActor, filterAction, filterEntityId, crossBranch])

  useEffect(() => { load() }, [load])

  async function expand(row: AuditRow) {
    if (expandedId === row.id) { setExpandedId(null); return }
    setExpandedId(row.id)
    if (!detail[row.id]) {
      try {
        const r = await apiFetch<AuditDetail[]>(`/audit-log/entity/${row.entity_type}/${row.entity_id}?limit=1`)
        // find the row by id
        const match = r.find(x => x.id === row.id) || r[0]
        if (match) setDetail(prev => ({ ...prev, [row.id]: match }))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not load row details')
      }
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-white">📜 Audit Log</h1>
        <p className="text-white/40 mt-1 text-sm">
          Every admin-side mutation on tracked tables — who, what, when, from where.
          Rows are branch-scoped unless you tick &quot;All branches&quot; (SUPER_ADMIN only).
        </p>
      </div>

      <div className="flex gap-2 flex-wrap items-center rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <input value={filterType} onChange={e => { setFilterType(e.target.value); setOffset(0) }}
          placeholder="entity type (e.g. terminal_devices)"
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm min-w-[220px]" />
        <input value={filterActor} onChange={e => { setFilterActor(e.target.value); setOffset(0) }}
          placeholder="actor email"
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm min-w-[220px]" />
        <input value={filterAction} onChange={e => { setFilterAction(e.target.value); setOffset(0) }}
          placeholder="action (create / update / delete …)"
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm min-w-[200px]" />
        {filterEntityId && (
          <div className="flex items-center gap-2 bg-indigo-500/15 border border-indigo-400/30 rounded-lg px-3 py-2 text-indigo-200 text-xs">
            Pinned to {filterType}:<code className="font-mono">{filterEntityId.slice(0, 8)}…</code>
            <button onClick={() => { setFilterEntityId(''); setOffset(0) }}
              className="text-indigo-300 hover:text-white" title="Clear pin">✕</button>
          </div>
        )}
        <label className="flex items-center gap-1 text-xs text-white/70 ml-auto">
          <input type="checkbox" checked={crossBranch} onChange={e => { setCrossBranch(e.target.checked); setOffset(0) }}
            className="accent-saffron-400" />
          All branches
        </label>
        <button onClick={() => load()}
          className="px-3 py-2 rounded-lg bg-saffron-500/20 text-saffron-200 border border-saffron-400/40 text-xs font-bold">
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-white/40 text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-white/40">
          No audit entries match the current filters.
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] text-white/50 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Who</th>
                <th className="text-left px-3 py-2">Action</th>
                <th className="text-left px-3 py-2">Entity</th>
                <th className="text-left px-3 py-2">Changed</th>
                <th className="text-left px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => (
                <AnimatePresence key={r.id}>
                  <motion.tr layout
                    onClick={() => expand(r)}
                    className="border-t border-white/5 cursor-pointer hover:bg-white/[0.03]">
                    <td className="px-3 py-2 text-white/70 text-xs" title={r.created_at}>
                      {timeAgo(r.created_at)}
                    </td>
                    <td className="px-3 py-2 text-white/80 text-xs">
                      {r.actor_email || <span className="text-white/30 italic">(none)</span>}
                      {r.actor_role && <span className="text-white/30 ml-1">· {r.actor_role}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${ACTION_STYLES[r.action] || 'bg-white/5 text-white/60 border-white/10'}`}>
                        {r.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-white/70 text-xs">
                      <code className="text-saffron-300">{r.entity_type}</code>
                      <span className="text-white/30 ml-1 font-mono text-[10px]">{r.entity_id.slice(0, 8)}…</span>
                    </td>
                    <td className="px-3 py-2 text-white/80 text-xs">
                      {r.diff_summary || (r.changed_fields?.length
                        ? r.changed_fields.join(', ')
                        : <span className="text-white/30">—</span>)}
                    </td>
                    <td className="px-3 py-2 text-white/40 text-[11px] font-mono">
                      {r.source_endpoint || '—'}
                    </td>
                  </motion.tr>
                  {expandedId === r.id && (
                    <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <td colSpan={6} className="px-3 py-3 bg-white/[0.02] border-t border-white/5">
                        {detail[r.id] ? (
                          <DiffViewer before={detail[r.id].before_json} after={detail[r.id].after_json} />
                        ) : (
                          <div className="text-white/40 text-xs">Loading diff…</div>
                        )}
                      </td>
                    </motion.tr>
                  )}
                </AnimatePresence>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-white/50">
        <div>Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}</div>
        <div className="flex gap-2">
          <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}
            className="px-3 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-30">
            ← Prev
          </button>
          <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total}
            className="px-3 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-30">
            Next →
          </button>
        </div>
      </div>
    </div>
  )
}


function DiffViewer({ before, after }: {
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}) {
  // Build the union key list, drop timestamp noise, show only changed keys
  const noise = new Set(['updated_at', 'created_at'])
  const keys = Array.from(new Set([
    ...Object.keys(before || {}), ...Object.keys(after || {}),
  ])).filter(k => !noise.has(k))

  const changed = keys.filter(k => JSON.stringify((before || {})[k]) !== JSON.stringify((after || {})[k]))
  if (changed.length === 0) {
    return <div className="text-white/40 text-xs italic">No field-level diff (metadata-only change)</div>
  }
  return (
    <div className="space-y-1 text-xs font-mono">
      {changed.map(k => (
        <div key={k} className="flex gap-2 items-start">
          <span className="text-saffron-300 min-w-[160px] shrink-0">{k}</span>
          <span className="text-rose-300/90">{renderVal((before || {})[k])}</span>
          <span className="text-white/30">→</span>
          <span className="text-green-300/90">{renderVal((after || {})[k])}</span>
        </div>
      ))}
    </div>
  )
}

function renderVal(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v || '""'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
