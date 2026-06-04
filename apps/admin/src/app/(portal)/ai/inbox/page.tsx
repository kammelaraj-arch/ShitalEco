'use client'
import { useState, useEffect, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

interface Link {
  record_type: string
  record_id: string
  note: string
}

interface AgentMessage {
  id: string
  mailbox: string
  subject: string
  sender_email: string
  sender_name: string
  received_at: string | null
  classification: string
  agent_summary: string
  status: string
  needs_human_review: boolean
  escalation_reason: string
  processed_at: string | null
  links: Link[]
}

interface InboxResponse {
  messages: AgentMessage[]
  total: number
  by_classification: Record<string, number>
  needs_review_count: number
}

const CLASS_STYLE: Record<string, string> = {
  invoice:              'bg-saffron-500/20 text-saffron-300 border-saffron-500/30',
  payment_confirmation: 'bg-green-500/20  text-green-300  border-green-500/30',
  complaint:            'bg-red-500/20    text-red-300    border-red-500/30',
  action_item:          'bg-blue-500/20   text-blue-300   border-blue-500/30',
  statement:            'bg-purple-500/20 text-purple-300 border-purple-500/30',
  other:                'bg-white/10      text-white/40   border-white/10',
}

const LINK_LABEL: Record<string, string> = {
  purchase_invoice: 'Invoice',
  case:             'Case',
  task:             'Task',
  crm_account:      'Account',
}

const LINK_PATH: Record<string, string> = {
  purchase_invoice: '/finance/purchase-invoices',
  case:             '/cases',
  task:             '/tasks',
  crm_account:      '/accounts',
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('shital_access_token') || ''}` }
}

export default function AIInboxPage() {
  const [data, setData] = useState<InboxResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mailbox, setMailbox] = useState('')
  const [classification, setClassification] = useState('')
  const [needsReview, setNeedsReview] = useState(false)
  const [sweeping, setSweeping] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams()
      if (mailbox)         params.set('mailbox', mailbox)
      if (classification)  params.set('classification', classification)
      if (needsReview)     params.set('needs_review', 'true')
      const res = await fetch(`${API}/mail-agent/inbox?${params}`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`${res.status}`)
      setData(await res.json())
    } catch (e: unknown) {
      setError(`Failed to load: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally { setLoading(false) }
  }, [mailbox, classification, needsReview])

  useEffect(() => { load() }, [load])

  async function sweep() {
    setSweeping(true)
    try {
      const res = await fetch(`${API}/mail-agent/sweep`, { method: 'POST', headers: authHeaders() })
      if (!res.ok) throw new Error(`${res.status}`)
      await load()
    } catch (e: unknown) {
      setError(`Sweep failed: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally { setSweeping(false) }
  }

  async function deepSweep() {
    if (!confirm('Scan the last 20 days of every watched mailbox? This may take a couple of minutes.')) return
    setSweeping(true)
    try {
      const res = await fetch(`${API}/mail-agent/deep-sweep?days=20`,
        { method: 'POST', headers: authHeaders() })
      if (!res.ok) throw new Error(`${res.status}`)
      await load()
    } catch (e: unknown) {
      setError(`Deep sweep failed: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally { setSweeping(false) }
  }

  async function clearReview(id: string) {
    try {
      await fetch(`${API}/mail-agent/clear-review/${id}`, { method: 'POST', headers: authHeaders() })
      await load()
    } catch { /* swallow — banner shows next sweep */ }
  }

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }) : '—'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">AI Inbox</h1>
          <p className="text-white/40 mt-1">
            Claude reads <strong className="text-white/70">accounts@</strong> /
            <strong className="text-white/70"> trustees@</strong> /
            <strong className="text-white/70"> info@</strong> and creates invoices,
            cases, and tasks automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={sweep} disabled={sweeping}
            className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-bold shadow-saffron hover:opacity-90 disabled:opacity-40">
            {sweeping ? 'Sweeping…' : '🔄 Sweep mailboxes now'}
          </button>
          <button onClick={deepSweep} disabled={sweeping}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-bold hover:bg-white/10 disabled:opacity-40"
            title="Re-scan the last 20 days, ignoring the per-mailbox cursor. Use after turning the agent on or adding a new mailbox.">
            ⏪ Deep sweep (20 days)
          </button>
          <button onClick={load}
            className="px-4 py-2 rounded-xl border border-white/10 text-white/60 text-sm font-medium hover:bg-white/5">↻ Refresh</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
        {[
          { label: 'Total', value: data?.total ?? 0, key: '' },
          { label: 'Invoices', value: data?.by_classification?.invoice ?? 0, key: 'invoice' },
          { label: 'Payments', value: data?.by_classification?.payment_confirmation ?? 0, key: 'payment_confirmation' },
          { label: 'Complaints', value: data?.by_classification?.complaint ?? 0, key: 'complaint' },
          { label: 'Actions', value: data?.by_classification?.action_item ?? 0, key: 'action_item' },
          { label: 'Statements', value: data?.by_classification?.statement ?? 0, key: 'statement' },
          { label: 'Other', value: data?.by_classification?.other ?? 0, key: 'other' },
        ].map(c => (
          <button key={c.label} onClick={() => setClassification(c.key)}
            className={`glass rounded-2xl p-3 border text-left transition-all ${
              classification === c.key ? 'border-saffron-500/60 bg-saffron-500/5' : 'border-temple-border hover:bg-white/3'
            }`}>
            <p className="text-2xl font-black text-white">{c.value}</p>
            <p className="text-white/40 text-xs">{c.label}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="glass rounded-2xl p-4 border border-temple-border flex flex-wrap gap-3 items-center">
        <select value={mailbox} onChange={e => setMailbox(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-saffron-500/50">
          <option value="">All mailboxes</option>
          <option value="accounts@shirdisai.org.uk">accounts@</option>
          <option value="trustees@shirdisai.org.uk">trustees@</option>
          <option value="info@shirdisai.org.uk">info@</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={needsReview} onChange={e => setNeedsReview(e.target.checked)}
            className="rounded border-white/20" />
          Needs review only
          {data && data.needs_review_count > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 text-xs font-bold">
              {data.needs_review_count}
            </span>
          )}
        </label>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {loading ? (
        <div className="text-center py-20 text-white/30">Loading…</div>
      ) : !data || data.messages.length === 0 ? (
        <div className="text-center py-20 text-white/30">
          <p className="text-4xl mb-3">📥</p>
          <p>Nothing in the inbox — agent will pick up new email automatically.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.messages.map(m => (
            <div key={m.id} className={`glass rounded-xl border ${
              m.needs_human_review ? 'border-red-500/40 bg-red-500/5' : 'border-temple-border'
            }`}>
              <button onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                className="w-full text-left p-4 flex items-start gap-3 hover:bg-white/3 transition-all">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${CLASS_STYLE[m.classification] || CLASS_STYLE.other}`}>
                  {m.classification || '—'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <p className="text-white font-bold text-sm truncate">{m.subject || '(no subject)'}</p>
                    <span className="text-white/40 text-xs whitespace-nowrap">{fmt(m.received_at)}</span>
                  </div>
                  <p className="text-white/50 text-xs truncate mt-0.5">
                    {m.sender_name || m.sender_email} • <span className="text-white/30">{m.mailbox}</span>
                  </p>
                  <p className="text-white/70 text-sm mt-1.5">{m.agent_summary || '(no summary)'}</p>
                  {m.links.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {m.links.map((l, i) => (
                        <a key={i} href={`${LINK_PATH[l.record_type] || '#'}`}
                           onClick={e => e.stopPropagation()}
                           className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-white/10">
                          → {LINK_LABEL[l.record_type] || l.record_type} {l.record_id.slice(0, 8)}
                        </a>
                      ))}
                    </div>
                  )}
                  {m.needs_human_review && m.escalation_reason && (
                    <div className="mt-2 text-xs text-red-300">
                      ⚠️ Escalated: {m.escalation_reason}
                    </div>
                  )}
                </div>
              </button>
              {expanded === m.id && (
                <div className="border-t border-white/10 p-4 space-y-2 text-xs text-white/60">
                  <div className="flex gap-4">
                    <span><strong>Status:</strong> {m.status}</span>
                    <span><strong>Processed:</strong> {fmt(m.processed_at)}</span>
                  </div>
                  {m.needs_human_review && (
                    <button onClick={() => clearReview(m.id)}
                      className="px-3 py-1 rounded bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-bold hover:bg-red-500/30">
                      Mark as reviewed
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
