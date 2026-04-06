'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Fn {
  id: string
  function_name: string
  display_name: string
  description: string
  fabric: string
  tags: string[]
  version: string
  status: string
  http_endpoint: string | null
  http_method: string
  input_schema: Record<string, unknown>
  output_schema: Record<string, unknown>
  example_input: Record<string, unknown>
  example_output: Record<string, unknown>
  human_in_loop: boolean
  requires_auth: boolean
  required_roles: string[]
  idempotent: boolean
  total_calls: number
  success_count: number
  failure_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
}

interface Invocation {
  id: string
  function_name: string
  branch_id: string
  user_email: string | null
  user_role: string | null
  triggered_by: string
  agent_session_id: string | null
  agent_reasoning: string | null
  agent_query: string | null
  input_data: Record<string, unknown>
  output_data: unknown
  status: string
  error_message: string | null
  duration_ms: number | null
  created_at: string
  completed_at: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active:       'bg-green-500/20 text-green-400 border-green-500/30',
  deprecated:   'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  experimental: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  disabled:     'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

const FABRIC_ICONS: Record<string, string> = {
  finance: '💰', hr: '👥', payroll: '💷', assets: '🏗️', compliance: '⚖️',
  auth: '🔐', notifications: '🔔', payments: '💳', ai: '🧠', basket: '🛒',
  documents: '📁', storage: '💾', data: '📊', integration: '🔗', general: '⚙️',
}

const TRIGGER_COLORS: Record<string, string> = {
  manual:    'bg-white/10 text-white/60',
  ai_agent:  'bg-purple-500/20 text-purple-400',
  webhook:   'bg-blue-500/20 text-blue-400',
  schedule:  'bg-orange-500/20 text-orange-400',
  api:       'bg-cyan-500/20 text-cyan-400',
}

const INV_STATUS: Record<string, string> = {
  success: 'text-green-400',
  failed:  'text-red-400',
  pending: 'text-yellow-400',
  timeout: 'text-orange-400',
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FunctionRegistryPage() {
  const [tab, setTab] = useState<'registry' | 'audit'>('registry')
  const [functions, setFunctions] = useState<Fn[]>([])
  const [invocations, setInvocations] = useState<Invocation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [fabricFilter, setFabricFilter] = useState('')
  const [fabrics, setFabrics] = useState<string[]>([])

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Fn | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<Fn>>({})

  // Detail / invoke panel
  const [selected, setSelected] = useState<Fn | null>(null)
  const [invokeInput, setInvokeInput] = useState('{}')
  const [invokeReason, setInvokeReason] = useState('')
  const [invoking, setInvoking] = useState(false)
  const [invokeResult, setInvokeResult] = useState<Record<string, unknown> | null>(null)

  // Audit filters
  const [auditFn, setAuditFn] = useState('')
  const [auditStatus, setAuditStatus] = useState('')
  const [auditTrigger, setAuditTrigger] = useState('')

  const loadFunctions = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (fabricFilter) params.set('fabric', fabricFilter)
      params.set('limit', '200')
      const data = await apiFetch<{ functions: Fn[] }>(`/functions/?${params}`)
      setFunctions(data.functions || [])
      const allFabrics = [...new Set((data.functions || []).map(f => f.fabric))].sort()
      setFabrics(allFabrics)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }, [search, fabricFilter])

  const loadAudit = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams()
      if (auditFn) params.set('function_name', auditFn)
      if (auditStatus) params.set('status', auditStatus)
      if (auditTrigger) params.set('triggered_by', auditTrigger)
      params.set('limit', '100')
      const data = await apiFetch<{ invocations: Invocation[] }>(`/functions/audit/log?${params}`)
      setInvocations(data.invocations || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit')
    } finally { setLoading(false) }
  }, [auditFn, auditStatus, auditTrigger])

  useEffect(() => {
    if (tab === 'registry') loadFunctions()
    else loadAudit()
  }, [tab, loadFunctions, loadAudit])

  const openNew = () => {
    setEditing(null)
    setForm({ fabric: 'general', status: 'active', http_method: 'POST', version: '1.0.0',
               tags: [], required_roles: [], input_schema: {}, output_schema: {},
               example_input: {}, example_output: {},
               human_in_loop: false, requires_auth: true, idempotent: false })
    setShowForm(true)
  }

  const openEdit = (fn: Fn) => {
    setEditing(fn)
    setForm({ ...fn })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.function_name) return
    setSaving(true)
    try {
      if (editing) {
        await apiFetch(`/functions/${editing.function_name}`, { method: 'PUT', body: JSON.stringify(form) })
      } else {
        await apiFetch('/functions/', { method: 'POST', body: JSON.stringify(form) })
      }
      setShowForm(false)
      loadFunctions()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  const deleteFn = async (fn: Fn) => {
    if (!confirm(`Delete function "${fn.function_name}"?`)) return
    try {
      await apiFetch(`/functions/${fn.function_name}`, { method: 'DELETE' })
      loadFunctions()
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed') }
  }

  const sync = async () => {
    setLoading(true)
    try {
      const r = await apiFetch<{ synced: number; total_capabilities: number; errors: string[] }>('/functions/sync', { method: 'POST' })
      alert(`Synced ${r.synced} of ${r.total_capabilities} capabilities. Errors: ${r.errors.length}`)
      loadFunctions()
    } catch (e) { setError(e instanceof Error ? e.message : 'Sync failed') }
    finally { setLoading(false) }
  }

  const invoke = async () => {
    if (!selected) return
    setInvoking(true); setInvokeResult(null)
    try {
      let inputData: Record<string, unknown> = {}
      try { inputData = JSON.parse(invokeInput) } catch { /* use empty */ }
      const result = await apiFetch(`/functions/${selected.function_name}/invoke`, {
        method: 'POST',
        body: JSON.stringify({
          input_data: inputData,
          triggered_by: 'manual',
          agent_reasoning: invokeReason || null,
        }),
      })
      setInvokeResult(result as Record<string, unknown>)
      // Refresh counters
      loadFunctions()
    } catch (e) { setInvokeResult({ error: e instanceof Error ? e.message : 'Invoke failed' }) }
    finally { setInvoking(false) }
  }

  const fmtDate = (s: string | null) => {
    if (!s) return '—'
    return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Function Registry</h1>
          <p className="text-white/40 mt-1">
            AI-callable capability catalogue · every invocation is audited
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={sync}
            className="px-4 py-2 rounded-xl border border-blue-500/30 text-blue-400 text-sm font-semibold hover:bg-blue-500/10 transition-all">
            ↻ Sync DNA
          </button>
          <button onClick={openNew}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90">
            + Register Function
          </button>
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit">
        {(['registry', 'audit'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all capitalize ${
              tab === t ? 'bg-saffron-gradient text-white shadow-saffron' : 'text-white/50 hover:text-white/80'
            }`}>{t === 'audit' ? '🔍 Audit Log' : '⚙️ Registry'}</button>
        ))}
      </div>

      {/* ── Registry tab ── */}
      {tab === 'registry' && (
        <>
          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search functions…"
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-white/30 outline-none focus:border-saffron-400/50 w-60" />
            <select value={fabricFilter} onChange={e => setFabricFilter(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none">
              <option value="">All Fabrics</option>
              {fabrics.map(f => <option key={f} value={f}>{FABRIC_ICONS[f] || '⚙️'} {f}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="text-center py-20 text-white/30">Loading…</div>
          ) : functions.length === 0 ? (
            <div className="text-center py-20 text-white/30">
              <p className="text-4xl mb-3">⚙️</p>
              <p>No functions registered yet.</p>
              <p className="text-xs mt-1">Click &quot;Sync DNA&quot; to import all Digital DNA capabilities.</p>
            </div>
          ) : (
            <div className="glass rounded-2xl overflow-hidden border border-temple-border">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    {['Function', 'Fabric', 'Status', 'Calls', 'Last Used', ''].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {functions.map((fn, i) => (
                    <motion.tr key={fn.id}
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.015 }}
                      className="border-b border-white/5 hover:bg-white/3 transition-colors cursor-pointer"
                      onClick={() => setSelected(fn)}>
                      <td className="px-4 py-3">
                        <p className="text-white font-semibold text-sm font-mono">{fn.function_name}</p>
                        <p className="text-white/30 text-xs mt-0.5 truncate max-w-xs">{fn.description}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-white/60 text-sm">{FABRIC_ICONS[fn.fabric] || '⚙️'} {fn.fabric}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${STATUS_COLORS[fn.status] || STATUS_COLORS.active}`}>
                          {fn.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <p className="text-white font-bold text-sm">{fn.total_calls}</p>
                        <p className="text-xs">
                          <span className="text-green-400">{fn.success_count}✓</span>
                          {fn.failure_count > 0 && <span className="text-red-400 ml-1">{fn.failure_count}✗</span>}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-white/40 text-xs">{fmtDate(fn.last_used_at)}</td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openEdit(fn)}
                          className="text-white/30 hover:text-saffron-400 text-sm px-2 py-1 mr-1">Edit</button>
                        <button onClick={() => deleteFn(fn)}
                          className="text-white/20 hover:text-red-400 text-sm px-2 py-1">Del</button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Audit tab ── */}
      {tab === 'audit' && (
        <>
          <div className="flex gap-3 flex-wrap">
            <input value={auditFn} onChange={e => setAuditFn(e.target.value)}
              placeholder="Filter by function name…"
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-white/30 outline-none w-56" />
            <select value={auditStatus} onChange={e => setAuditStatus(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none">
              <option value="">All Statuses</option>
              {['success', 'failed', 'pending', 'timeout'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={auditTrigger} onChange={e => setAuditTrigger(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none">
              <option value="">All Triggers</option>
              {['manual', 'ai_agent', 'webhook', 'schedule', 'api'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="text-center py-20 text-white/30">Loading audit log…</div>
          ) : invocations.length === 0 ? (
            <div className="text-center py-20 text-white/30">
              <p className="text-4xl mb-3">🔍</p>
              <p>No invocations recorded yet.</p>
            </div>
          ) : (
            <div className="glass rounded-2xl overflow-hidden border border-temple-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    {['Function', 'Triggered By', 'User', 'Input', 'Status', 'Duration', 'Time', ''].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invocations.map((inv, i) => (
                    <motion.tr key={inv.id}
                      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.01 }}
                      className="border-b border-white/5 hover:bg-white/3 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-saffron-400 font-mono text-xs">{inv.function_name}</p>
                        {inv.agent_reasoning && (
                          <p className="text-white/30 text-xs mt-0.5 truncate max-w-[180px]" title={inv.agent_reasoning}>
                            🧠 {inv.agent_reasoning}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TRIGGER_COLORS[inv.triggered_by] || 'bg-white/5 text-white/40'}`}>
                          {inv.triggered_by}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/50 text-xs">{inv.user_email || '—'}</td>
                      <td className="px-4 py-3">
                        <code className="text-white/30 text-xs bg-white/5 px-1.5 py-0.5 rounded">
                          {JSON.stringify(inv.input_data).slice(0, 40)}…
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-bold text-xs ${INV_STATUS[inv.status] || 'text-white/40'}`}>
                          {inv.status === 'success' ? '✓' : inv.status === 'failed' ? '✗' : '○'} {inv.status}
                        </span>
                        {inv.error_message && (
                          <p className="text-red-400 text-xs mt-0.5 truncate max-w-[120px]" title={inv.error_message}>
                            {inv.error_message}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white/40 text-xs">
                        {inv.duration_ms != null ? `${inv.duration_ms}ms` : '—'}
                      </td>
                      <td className="px-4 py-3 text-white/40 text-xs">{fmtDate(inv.created_at)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => alert(JSON.stringify({ input: inv.input_data, output: inv.output_data, reasoning: inv.agent_reasoning }, null, 2))}
                          className="text-white/20 hover:text-white/60 text-xs">
                          Details
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Function detail + invoke panel ── */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setSelected(null); setInvokeResult(null) }}
              className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-[540px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <div>
                  <h2 className="text-white font-black text-base font-mono">{selected.function_name}</h2>
                  <p className="text-white/40 text-xs mt-0.5">{selected.description}</p>
                </div>
                <button onClick={() => { setSelected(null); setInvokeResult(null) }} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                {/* Meta */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  {[
                    ['Fabric', `${FABRIC_ICONS[selected.fabric] || '⚙️'} ${selected.fabric}`],
                    ['Version', selected.version],
                    ['Status', selected.status],
                    ['Calls', String(selected.total_calls)],
                    ['Human Loop', selected.human_in_loop ? 'Yes' : 'No'],
                    ['Idempotent', selected.idempotent ? 'Yes' : 'No'],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-white/5 rounded-xl p-3">
                      <p className="text-white/30 text-[10px] uppercase tracking-wide mb-1">{k}</p>
                      <p className="text-white font-semibold">{v}</p>
                    </div>
                  ))}
                </div>

                {/* Input Schema */}
                <div>
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Input Schema</p>
                  <pre className="bg-black/30 rounded-xl p-3 text-xs text-green-300 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(selected.input_schema, null, 2)}
                  </pre>
                </div>

                {/* Output Schema */}
                {Object.keys(selected.output_schema || {}).length > 0 && (
                  <div>
                    <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Output Schema</p>
                    <pre className="bg-black/30 rounded-xl p-3 text-xs text-blue-300 overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(selected.output_schema, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Test Invoke */}
                <div className="border-t border-white/5 pt-4">
                  <p className="text-white font-bold mb-3">Test Invoke</p>
                  <div className="space-y-3">
                    <div>
                      <label className={lbl}>Input JSON</label>
                      <textarea value={invokeInput}
                        onChange={e => setInvokeInput(e.target.value)}
                        rows={4}
                        className={inp + ' font-mono text-xs resize-none'}
                        placeholder='{}'
                      />
                    </div>
                    <div>
                      <label className={lbl}>Reasoning (optional)</label>
                      <input value={invokeReason}
                        onChange={e => setInvokeReason(e.target.value)}
                        placeholder="Why are you invoking this function?"
                        className={inp} />
                    </div>
                    <button onClick={invoke} disabled={invoking}
                      className="w-full py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                      {invoking ? 'Invoking…' : '▶ Invoke Function'}
                    </button>
                  </div>
                  {invokeResult && (
                    <div className="mt-3">
                      <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Result</p>
                      <pre className="bg-black/30 rounded-xl p-3 text-xs text-white/70 overflow-x-auto whitespace-pre-wrap max-h-48">
                        {JSON.stringify(invokeResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Create / Edit form ── */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-[520px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editing ? 'Edit Function' : 'Register Function'}</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div>
                  <label className={lbl}>Function Name * (unique key)</label>
                  <input value={form.function_name || ''} disabled={!!editing}
                    onChange={e => setForm(p => ({ ...p, function_name: e.target.value }))}
                    placeholder="e.g. finance.post_journal_entry" className={inp + (editing ? ' opacity-50' : '')} />
                </div>
                <div>
                  <label className={lbl}>Display Name</label>
                  <input value={form.display_name || ''} onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className={lbl}>Description</label>
                  <textarea value={form.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    rows={2} className={inp + ' resize-none'} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={lbl}>Fabric</label>
                    <select value={form.fabric || 'general'} onChange={e => setForm(p => ({ ...p, fabric: e.target.value }))} className={inp}>
                      {['finance','hr','payroll','assets','compliance','auth','notifications','payments','ai','basket','documents','general'].map(f =>
                        <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Status</label>
                    <select value={form.status || 'active'} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={inp}>
                      {['active','experimental','deprecated','disabled'].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Version</label>
                    <input value={form.version || '1.0.0'} onChange={e => setForm(p => ({ ...p, version: e.target.value }))} className={inp} />
                  </div>
                </div>
                <div>
                  <label className={lbl}>HTTP Endpoint</label>
                  <input value={form.http_endpoint || ''} onChange={e => setForm(p => ({ ...p, http_endpoint: e.target.value }))}
                    placeholder="/api/v1/finance/journal" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Input Schema (JSON Schema)</label>
                  <textarea value={JSON.stringify(form.input_schema || {}, null, 2)}
                    onChange={e => { try { setForm(p => ({ ...p, input_schema: JSON.parse(e.target.value) })) } catch { /* invalid json */ } }}
                    rows={5} className={inp + ' font-mono text-xs resize-none'} />
                </div>
                <div>
                  <label className={lbl}>Output Schema (JSON Schema)</label>
                  <textarea value={JSON.stringify(form.output_schema || {}, null, 2)}
                    onChange={e => { try { setForm(p => ({ ...p, output_schema: JSON.parse(e.target.value) })) } catch { /* invalid json */ } }}
                    rows={3} className={inp + ' font-mono text-xs resize-none'} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { key: 'human_in_loop', label: 'Human in Loop' },
                    { key: 'requires_auth', label: 'Requires Auth' },
                    { key: 'idempotent', label: 'Idempotent' },
                  ].map(({ key, label }) => (
                    <div key={key} className="bg-white/5 rounded-xl px-4 py-3 flex items-center justify-between">
                      <p className="text-white text-xs font-bold">{label}</p>
                      <button onClick={() => setForm(p => ({ ...p, [key]: !p[key as keyof typeof p] }))}
                        className={`w-9 h-5 rounded-full transition-all relative ${(form as Record<string, unknown>)[key] ? 'bg-green-500' : 'bg-white/10'}`}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${(form as Record<string, unknown>)[key] ? 'left-4' : 'left-0.5'}`} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={save} disabled={saving || !form.function_name}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Register'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
