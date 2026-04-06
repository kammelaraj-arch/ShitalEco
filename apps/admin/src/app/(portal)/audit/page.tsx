'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Invocation {
  id: string
  function_name: string
  user_email: string | null
  triggered_by: string
  status: string
  duration_ms: number | null
  created_at: string
  input_data: Record<string, unknown>
  output_data: Record<string, unknown>
  error_message: string | null
  agent_reasoning: string | null
}

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  pending: 'bg-yellow-500/20 text-yellow-400',
  timeout: 'bg-orange-500/20 text-orange-400',
}

const TRIGGER_COLORS: Record<string, string> = {
  manual: 'bg-white/10 text-white/60',
  ai_agent: 'bg-purple-500/20 text-purple-400',
  webhook: 'bg-blue-500/20 text-blue-400',
  schedule: 'bg-orange-500/20 text-orange-400',
  api: 'bg-cyan-500/20 text-cyan-400',
}

export default function AuditPage() {
  const [invocations, setInvocations] = useState<Invocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fnFilter, setFnFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [triggerFilter, setTriggerFilter] = useState('')
  const [selected, setSelected] = useState<Invocation | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams()
      if (fnFilter) params.set('function_name', fnFilter)
      if (statusFilter) params.set('status', statusFilter)
      if (triggerFilter) params.set('triggered_by', triggerFilter)
      params.set('limit', '100')
      const data = await apiFetch<{ invocations: Invocation[] }>(`/functions/audit/log?${params}`)
      setInvocations(data.invocations || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log')
    } finally { setLoading(false) }
  }, [fnFilter, statusFilter, triggerFilter])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-white">Audit Log</h1>
        <p className="text-white/40 mt-1">Complete trail of all system actions and AI invocations</p>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="flex gap-3 flex-wrap">
        <input value={fnFilter} onChange={e => setFnFilter(e.target.value)}
          placeholder="Filter by function…"
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-white/30 outline-none w-56" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none">
          <option value="">All Statuses</option>
          {['success', 'failed', 'pending', 'timeout'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={triggerFilter} onChange={e => setTriggerFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none">
          <option value="">All Triggers</option>
          {['manual', 'ai_agent', 'webhook', 'schedule', 'api'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={load} className="px-4 py-2 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/5">
          ↻ Refresh
        </button>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl overflow-hidden border border-temple-border">
        {loading ? (
          <div className="text-center py-16 text-white/30">Loading audit log…</div>
        ) : invocations.length === 0 ? (
          <div className="text-center py-16 text-white/30">
            <p className="text-4xl mb-3">🔍</p>
            <p>No audit records found.</p>
            <p className="text-xs mt-1 text-white/20">System actions, AI invocations, and API calls will appear here.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {['Timestamp', 'Function', 'User', 'Trigger', 'Status', 'Duration', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invocations.map((inv, i) => (
                <motion.tr key={inv.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.01 }}
                  className="border-b border-white/5 hover:bg-white/3 transition-colors cursor-pointer"
                  onClick={() => setSelected(inv)}>
                  <td className="px-4 py-3 text-white/40 text-xs">{new Date(inv.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-4 py-3">
                    <p className="text-saffron-400 font-mono text-xs">{inv.function_name}</p>
                    {inv.agent_reasoning && <p className="text-white/30 text-xs mt-0.5 truncate max-w-[160px]">🧠 {inv.agent_reasoning}</p>}
                  </td>
                  <td className="px-4 py-3 text-white/50 text-xs">{inv.user_email || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TRIGGER_COLORS[inv.triggered_by] || 'bg-white/5 text-white/40'}`}>
                      {inv.triggered_by}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[inv.status] || 'bg-white/5 text-white/40'}`}>
                      {inv.status === 'success' ? '✓' : inv.status === 'failed' ? '✗' : '○'} {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/40 text-xs">{inv.duration_ms != null ? `${inv.duration_ms}ms` : '—'}</td>
                  <td className="px-4 py-3 text-saffron-400/60 text-xs hover:text-saffron-400">Details</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </motion.div>

      {selected && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setSelected(null)} />
          <div className="fixed right-0 top-0 h-full w-full sm:max-w-[520px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
            <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-white font-black text-base font-mono">{selected.function_name}</h2>
              <button onClick={() => setSelected(null)} className="text-white/40 hover:text-white text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Status', selected.status],
                  ['Triggered By', selected.triggered_by],
                  ['User', selected.user_email || '—'],
                  ['Duration', selected.duration_ms != null ? `${selected.duration_ms}ms` : '—'],
                  ['Time', new Date(selected.created_at).toLocaleString('en-GB')],
                ].map(([k, v]) => (
                  <div key={k} className="bg-white/5 rounded-xl p-3">
                    <p className="text-white/30 text-[10px] uppercase tracking-wide mb-1">{k}</p>
                    <p className="text-white text-xs font-semibold">{v}</p>
                  </div>
                ))}
              </div>
              {selected.agent_reasoning && (
                <div>
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">AI Reasoning</p>
                  <p className="text-white/70 text-sm bg-purple-500/10 rounded-xl p-3">{selected.agent_reasoning}</p>
                </div>
              )}
              <div>
                <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Input</p>
                <pre className="bg-black/30 rounded-xl p-3 text-xs text-green-300 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(selected.input_data, null, 2)}</pre>
              </div>
              {selected.error_message && (
                <div>
                  <p className="text-red-400 text-xs font-semibold uppercase tracking-wide mb-2">Error</p>
                  <p className="text-red-300 text-sm bg-red-500/10 rounded-xl p-3">{selected.error_message}</p>
                </div>
              )}
              {selected.output_data && Object.keys(selected.output_data).length > 0 && (
                <div>
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Output</p>
                  <pre className="bg-black/30 rounded-xl p-3 text-xs text-blue-300 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(selected.output_data, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
