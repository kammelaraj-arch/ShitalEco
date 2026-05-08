'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

type ResStatus = 'DRAFT' | 'OPEN' | 'CLOSED' | 'ARCHIVED'
type Category = 'OPERATIONAL' | 'OFFICER_ELECTION' | 'POLICY' | 'CONTRACT' | 'CONSTITUTIONAL'
type DecisionType = 'BOARD_MEETING' | 'WRITTEN_RESOLUTION' | 'RETROSPECTIVE'
type Choice = 'FOR' | 'AGAINST' | 'ABSTAIN'

interface Resolution {
  id: string
  meeting_id: string | null
  title: string
  background: string
  recommendation: string
  risk_impact: string
  budget_impact: string
  category: Category
  decision_type: DecisionType
  status: ResStatus
  decision_date: string | null
  is_retrospective: boolean
  retrospective_reason: string
  outcome: string
  outcome_summary: string
  tally_for: number
  tally_against: number
  tally_abstain: number
  casting_vote_used: boolean
  casting_vote_choice: string
  effective_quorum_at_close: number | null
  quorum_at_close: number | null
  published_at: string | null
  closed_at: string | null
  created_at: string
}

interface Vote {
  id: string
  trustee_id: string | null
  trustee_name: string | null
  trustee_role: string | null
  choice: Choice
  comment: string
  anonymous: boolean
  voted_at: string
}

interface Trustee {
  id: string
  full_name: string
  role: string
  is_active: boolean
}

interface Meeting {
  id: string
  title: string
  scheduled_at: string
  meeting_type: string
}

const STATUS_BADGE: Record<ResStatus, string> = {
  DRAFT:    'bg-white/10 text-white/70 border-white/20',
  OPEN:     'bg-blue-500/20 text-blue-400 border-blue-500/30',
  CLOSED:   'bg-green-500/20 text-green-400 border-green-500/30',
  ARCHIVED: 'bg-white/5 text-white/40 border-white/10',
}

const OUTCOME_BADGE: Record<string, string> = {
  CARRIED:     'bg-green-500/20 text-green-400 border-green-500/30',
  NOT_CARRIED: 'bg-red-500/20 text-red-400 border-red-500/30',
  DEFERRED:    'bg-amber-500/20 text-amber-300 border-amber-500/30',
  TIED:        'bg-saffron-400/20 text-saffron-300 border-saffron-400/30',
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

interface Form {
  title: string
  background: string
  recommendation: string
  risk_impact: string
  budget_impact: string
  category: Category
  decision_type: DecisionType
  meeting_id: string
  decision_date: string
  is_retrospective: boolean
  retrospective_reason: string
}

const EMPTY: Form = {
  title: '', background: '', recommendation: '', risk_impact: '', budget_impact: '',
  category: 'OPERATIONAL', decision_type: 'BOARD_MEETING',
  meeting_id: '', decision_date: '',
  is_retrospective: false, retrospective_reason: '',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso }
}

export default function ResolutionsPage() {
  const [items, setItems] = useState<Resolution[]>([])
  const [trustees, setTrustees] = useState<Trustee[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<ResStatus | ''>('')

  const [editing, setEditing] = useState<Resolution | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [selected, setSelected] = useState<Resolution | null>(null)
  const [votes, setVotes] = useState<Vote[]>([])
  const [castingDir, setCastingDir] = useState<'FOR' | 'AGAINST' | ''>('')
  const [sendingInvites, setSendingInvites] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ limit: '200' })
      if (statusFilter) qs.set('status_filter', statusFilter)
      const [r, t, m] = await Promise.all([
        apiFetch<{ items: Resolution[] }>(`/admin/board/resolutions?${qs}`),
        apiFetch<{ items: Trustee[] }>(`/admin/board/trustees?is_active=true&limit=200`),
        apiFetch<{ items: Meeting[] }>(`/admin/board/meetings?limit=100`),
      ])
      setItems(r.items || [])
      setTrustees(t.items || [])
      setMeetings(m.items || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  async function loadDetail(id: string) {
    try {
      const data = await apiFetch<{ resolution: Resolution; votes: Vote[] }>(`/admin/board/resolutions/${id}`)
      setSelected(data.resolution)
      setVotes(data.votes || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load detail')
    }
  }

  function openNew() {
    setEditing(null); setForm(EMPTY); setShowForm(true); setError('')
  }
  function openEdit(r: Resolution) {
    setEditing(r)
    setForm({
      title: r.title, background: r.background, recommendation: r.recommendation,
      risk_impact: r.risk_impact, budget_impact: r.budget_impact,
      category: r.category, decision_type: r.decision_type,
      meeting_id: r.meeting_id || '',
      decision_date: r.decision_date ? r.decision_date.slice(0, 10) : '',
      is_retrospective: r.is_retrospective,
      retrospective_reason: r.retrospective_reason,
    })
    setShowForm(true); setError('')
  }

  async function save() {
    if (!form.title.trim()) { setError('Title is required'); return }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { ...form }
      if (!body.meeting_id) delete body.meeting_id
      if (!body.decision_date) delete body.decision_date
      if (editing) {
        await apiFetch(`/admin/board/resolutions/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
      } else {
        await apiFetch('/admin/board/resolutions', { method: 'POST', body: JSON.stringify(body) })
      }
      setShowForm(false)
      await load()
      if (editing) await loadDetail(editing.id)
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Failed to save'
      try { const p = JSON.parse(msg); if (p?.detail?.errors) msg = p.detail.errors.join(' · ') } catch { /* not JSON */ }
      setError(msg)
    } finally { setSaving(false) }
  }

  async function publish(r: Resolution) {
    if (!confirm(`Publish "${r.title}"? Voting opens immediately. The text becomes locked once published — amendments require a new sibling resolution.`)) return
    try {
      await apiFetch(`/admin/board/resolutions/${r.id}/publish`, { method: 'POST' })
      await load()
      await loadDetail(r.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to publish') }
  }

  async function sendInvites(r: Resolution) {
    if (!confirm(`Email a magic-link to every active trustee for "${r.title}"? Each trustee will get a personalised link to read + vote with their PIN. Re-sending is safe — same tokens are reused.`)) return
    setSendingInvites(true)
    try {
      const data = await apiFetch<{ trustees_total: number; tokens_created: number; tokens_reused: number; email_failed: string[] }>(
        `/admin/board/resolutions/${r.id}/send-vote-invites`,
        { method: 'POST' },
      )
      const fails = data.email_failed?.length || 0
      alert(
        `Sent to ${data.trustees_total} trustees.\n` +
        `New tokens: ${data.tokens_created}, reused: ${data.tokens_reused}.\n` +
        (fails > 0 ? `\nEmail failures (${fails}):\n${data.email_failed.join('\n')}` : `\nAll emails sent successfully.`),
      )
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Failed to send invites'
      try { const p = JSON.parse(msg); if (p?.detail?.errors) msg = p.detail.errors.join(' · ') } catch { /* not JSON */ }
      setError(msg)
    } finally { setSendingInvites(false) }
  }

  async function closeVote(r: Resolution) {
    if (!confirm(`Close voting on "${r.title}"? Outcome will be computed against effective quorum.`)) return
    try {
      await apiFetch(`/admin/board/resolutions/${r.id}/close`, { method: 'POST' })
      await load()
      await loadDetail(r.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to close') }
  }

  async function castVote(trusteeId: string, choice: Choice) {
    if (!selected) return
    try {
      await apiFetch(`/admin/board/resolutions/${selected.id}/votes`, {
        method: 'POST', body: JSON.stringify({ trustee_id: trusteeId, choice }),
      })
      await loadDetail(selected.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to cast vote') }
  }

  async function rescindVote(trusteeId: string) {
    if (!selected) return
    if (!confirm('Remove this vote?')) return
    try {
      await apiFetch(`/admin/board/resolutions/${selected.id}/votes/${trusteeId}`, { method: 'DELETE' })
      await loadDetail(selected.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to rescind') }
  }

  async function castingVote() {
    if (!selected || !castingDir) return
    if (!confirm(`Cast Chair's casting vote ${castingDir}? This breaks the tie and closes the resolution.`)) return
    try {
      await apiFetch(`/admin/board/resolutions/${selected.id}/casting-vote`, {
        method: 'POST', body: JSON.stringify({ choice: castingDir }),
      })
      setCastingDir('')
      await load()
      await loadDetail(selected.id)
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Failed to cast'
      try { const p = JSON.parse(msg); if (p?.detail) msg = typeof p.detail === 'string' ? p.detail : JSON.stringify(p.detail) } catch { /* not JSON */ }
      setError(msg)
    }
  }

  const trusteeMap = new Map(trustees.map(t => [t.id, t]))
  const trusteesById: Record<string, Trustee | undefined> = Object.fromEntries(trustees.map(t => [t.id, t]))
  const ownVoteByTrustee: Record<string, Vote | undefined> = Object.fromEntries(
    votes.filter(v => v.trustee_id).map(v => [v.trustee_id!, v]),
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Resolutions &amp; Voting</h1>
          <p className="text-white/40 mt-1">
            Board acts collectively. Officers execute, board decides. Every action audit-logged.
          </p>
        </div>
        <button onClick={openNew}
          className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90">
          + New Resolution
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1 w-fit">
        {(['', 'DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED'] as const).map(s => (
          <button key={s || 'ALL'} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize ${
              statusFilter === s ? 'bg-saffron-gradient text-white' : 'text-white/40 hover:text-white/70'
            }`}>{s.toLowerCase() || 'all'}</button>
        ))}
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 border-b border-white/10">
              <tr className="text-white/60 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-semibold">Title</th>
                <th className="px-4 py-3 text-left font-semibold">Category</th>
                <th className="px-4 py-3 text-left font-semibold">Type</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Outcome</th>
                <th className="px-4 py-3 text-left font-semibold">Tally</th>
                <th className="px-4 py-3 text-left font-semibold">Decision Date</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="px-4 py-12 text-center text-white/40">Loading…</td></tr>}
              {!loading && items.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-white/40">
                  No resolutions yet. Click + New Resolution to start drafting.
                </td></tr>
              )}
              {items.map(r => (
                <tr key={r.id} onClick={() => loadDetail(r.id)}
                  className={`border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors ${selected?.id === r.id ? 'bg-saffron-400/10' : ''}`}>
                  <td className="px-4 py-3 text-white font-semibold">
                    {r.is_retrospective && <span className="text-amber-400 text-xs mr-1.5" title="Retrospective record">⏪</span>}
                    {r.title}
                  </td>
                  <td className="px-4 py-3 text-white/60 text-xs">{r.category.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-white/60 text-xs">{r.decision_type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${STATUS_BADGE[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {r.outcome
                      ? <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${OUTCOME_BADGE[r.outcome] || 'bg-white/10 text-white/60 border-white/20'}`}>{r.outcome.replace(/_/g, ' ')}</span>
                      : <span className="text-white/30 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-white/70 text-xs font-mono">
                    {r.status === 'DRAFT' ? '—' : `${r.tally_for}/${r.tally_against}/${r.tally_abstain}`}
                  </td>
                  <td className="px-4 py-3 text-white/60 text-xs">{fmtDate(r.decision_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="glass rounded-2xl p-6">
          <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${STATUS_BADGE[selected.status]}`}>{selected.status}</span>
                {selected.outcome && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${OUTCOME_BADGE[selected.outcome] || ''}`}>
                    {selected.outcome.replace(/_/g, ' ')}
                  </span>
                )}
                {selected.is_retrospective && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold border bg-amber-500/20 text-amber-300 border-amber-500/30">⏪ Retrospective</span>
                )}
                <span className="text-white/40 text-xs">{selected.category.replace(/_/g, ' ')} · {selected.decision_type.replace(/_/g, ' ')}</span>
              </div>
              <h2 className="text-2xl font-black text-white">{selected.title}</h2>
            </div>
            <div className="flex gap-2 flex-wrap">
              {selected.status === 'DRAFT' && (
                <>
                  <button onClick={() => openEdit(selected)} className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 text-sm">Edit</button>
                  <button onClick={() => publish(selected)} className="px-3 py-1.5 rounded-lg bg-saffron-gradient text-white text-sm font-bold">Publish for Voting →</button>
                </>
              )}
              {selected.status === 'OPEN' && (
                <button onClick={() => sendInvites(selected)} disabled={sendingInvites}
                  className="px-3 py-1.5 rounded-lg border border-saffron-400/40 text-saffron-300 text-sm font-bold hover:bg-saffron-400/10 disabled:opacity-40">
                  {sendingInvites ? 'Sending…' : '📧 Email vote invites'}
                </button>
              )}
              {selected.status === 'OPEN' && selected.outcome !== 'TIED' && (
                <button onClick={() => closeVote(selected)} className="px-3 py-1.5 rounded-lg bg-saffron-gradient text-white text-sm font-bold">Close Voting</button>
              )}
            </div>
          </div>

          {selected.is_retrospective && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 mb-4">
              <p className="text-amber-300 text-xs font-bold uppercase tracking-wide mb-1">Retrospective Record</p>
              <p className="text-white/80 text-sm">This is a record of a decision already made on {fmtDate(selected.decision_date)}.
                Trustees confirm the accuracy of the record — they are not re-making the decision.</p>
              <p className="text-white/60 text-xs italic mt-1">Reason: {selected.retrospective_reason || '—'}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            {selected.background && (
              <Card title="Background"><p className="whitespace-pre-wrap">{selected.background}</p></Card>
            )}
            {selected.recommendation && (
              <Card title="Recommendation"><p className="whitespace-pre-wrap">{selected.recommendation}</p></Card>
            )}
            {selected.risk_impact && (
              <Card title="Risk / Impact"><p className="whitespace-pre-wrap">{selected.risk_impact}</p></Card>
            )}
            {selected.budget_impact && (
              <Card title="Budget Impact"><p className="whitespace-pre-wrap">{selected.budget_impact}</p></Card>
            )}
          </div>

          {/* Voting panel */}
          {(selected.status === 'OPEN' || selected.status === 'CLOSED') && (
            <div className="rounded-xl border border-white/10 p-5">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <h3 className="font-black text-white">Voting</h3>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-white/50">Quorum {selected.quorum_at_close ?? (selected.tally_for + selected.tally_against + selected.tally_abstain)} / {selected.effective_quorum_at_close ?? '—'}</span>
                  <span className="text-green-400 font-bold text-sm">FOR {selected.tally_for}</span>
                  <span className="text-red-400 font-bold text-sm">AGAINST {selected.tally_against}</span>
                  <span className="text-white/60 font-bold text-sm">ABSTAIN {selected.tally_abstain}</span>
                </div>
              </div>

              {selected.outcome === 'TIED' && selected.status === 'OPEN' && (
                <div className="rounded-xl border border-saffron-400/40 bg-saffron-400/10 p-4 mb-4">
                  <p className="text-saffron-300 font-bold text-sm mb-2">Vote tied — Chair casting vote required</p>
                  <p className="text-white/70 text-xs mb-3">
                    Per governing rules, the Chair may cast a casting vote to break the tie. This action is logged separately
                    in the audit trail and decides the outcome.
                  </p>
                  <div className="flex gap-2 flex-wrap items-center">
                    <button onClick={() => setCastingDir('FOR')}
                      className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${castingDir === 'FOR' ? 'bg-green-500/30 text-green-300 border border-green-400' : 'bg-white/5 text-white/70 border border-white/10'}`}>Casting FOR</button>
                    <button onClick={() => setCastingDir('AGAINST')}
                      className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${castingDir === 'AGAINST' ? 'bg-red-500/30 text-red-300 border border-red-400' : 'bg-white/5 text-white/70 border border-white/10'}`}>Casting AGAINST</button>
                    <button onClick={castingVote} disabled={!castingDir}
                      className="px-3 py-1.5 rounded-lg bg-saffron-gradient text-white text-sm font-bold disabled:opacity-40">Confirm casting vote</button>
                  </div>
                </div>
              )}

              {selected.status === 'OPEN' && (
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-widest font-bold text-white/50 mb-2">Trustees</p>
                  {trustees.map(t => {
                    const v = ownVoteByTrustee[t.id]
                    return (
                      <div key={t.id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-white/3">
                        <div>
                          <p className="text-white text-sm font-semibold">{t.full_name}</p>
                          <p className="text-white/40 text-xs">{t.role}{v && ` · voted ${v.choice}`}</p>
                        </div>
                        <div className="flex gap-1">
                          {(['FOR', 'AGAINST', 'ABSTAIN'] as Choice[]).map(c => (
                            <button key={c} onClick={() => castVote(t.id, c)}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                                v?.choice === c
                                  ? c === 'FOR' ? 'bg-green-500/30 text-green-300 border border-green-400'
                                  : c === 'AGAINST' ? 'bg-red-500/30 text-red-300 border border-red-400'
                                  : 'bg-white/15 text-white border border-white/30'
                                  : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
                              }`}>{c}</button>
                          ))}
                          {v && <button onClick={() => rescindVote(t.id)} className="text-red-400/60 hover:text-red-400 text-xs ml-1 px-1">✕</button>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {selected.status === 'CLOSED' && (
                <>
                  {selected.outcome_summary && <p className="text-white/80 text-sm mb-3">{selected.outcome_summary}</p>}
                  {selected.casting_vote_used && (
                    <p className="text-saffron-300 text-xs italic mb-3">
                      Chair cast a casting vote {selected.casting_vote_choice} to break the tie.
                    </p>
                  )}
                  <p className="text-xs uppercase tracking-widest font-bold text-white/50 mb-2">Vote record</p>
                  <div className="space-y-1.5">
                    {votes.map(v => {
                      const t = v.trustee_id ? trusteesById[v.trustee_id] : undefined
                      return (
                        <div key={v.id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-white/3 text-xs">
                          <span className="text-white">{v.anonymous && !t ? <em className="text-white/50">Anonymous</em> : (t?.full_name || v.trustee_name || 'Unknown')}</span>
                          <span className={`font-bold ${
                            v.choice === 'FOR' ? 'text-green-400'
                              : v.choice === 'AGAINST' ? 'text-red-400'
                              : 'text-white/60'
                          }`}>{v.choice}</span>
                        </div>
                      )
                    })}
                    {votes.length === 0 && <p className="text-white/30 text-xs italic">No votes recorded.</p>}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Builder slide-over */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-2xl bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editing ? 'Edit DRAFT Resolution' : 'New Resolution'}</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl p-1">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div>
                  <label className={lbl}>Title *</label>
                  <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inp}
                    placeholder="e.g. Approve Diwali budget of £15,000" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Category</label>
                    <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value as Category }))} className={inp}>
                      {(['OPERATIONAL', 'OFFICER_ELECTION', 'POLICY', 'CONTRACT', 'CONSTITUTIONAL'] as Category[]).map(c =>
                        <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Decision Type</label>
                    <select value={form.decision_type} onChange={e => setForm(p => ({ ...p, decision_type: e.target.value as DecisionType }))} className={inp}>
                      {(['BOARD_MEETING', 'WRITTEN_RESOLUTION', 'RETROSPECTIVE'] as DecisionType[]).map(d =>
                        <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                </div>
                {form.decision_type === 'BOARD_MEETING' && (
                  <div>
                    <label className={lbl}>Linked Meeting</label>
                    <select value={form.meeting_id} onChange={e => setForm(p => ({ ...p, meeting_id: e.target.value }))} className={inp}>
                      <option value="">— Not linked —</option>
                      {meetings.map(m => <option key={m.id} value={m.id}>{fmtDate(m.scheduled_at)} — {m.title || m.meeting_type.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.is_retrospective}
                      onChange={e => setForm(p => ({ ...p, is_retrospective: e.target.checked, decision_type: e.target.checked ? 'RETROSPECTIVE' : p.decision_type }))}
                      className="w-4 h-4 rounded accent-saffron-400" />
                    <span className="text-white/80 text-sm font-bold">⏪ Record retrospective decision</span>
                  </label>
                  <p className="text-white/40 text-xs mt-1 ml-6">Marks this as a record of a past decision, not a new one. Disabled for Constitutional / Officer Election categories.</p>
                </div>
                {form.is_retrospective && (
                  <>
                    <div>
                      <label className={lbl}>Reason for retrospective record *</label>
                      <textarea value={form.retrospective_reason} onChange={e => setForm(p => ({ ...p, retrospective_reason: e.target.value }))} rows={2} className={inp + ' resize-none'}
                        placeholder="e.g. Emergency action taken on phone, agreed by all trustees, recorded after the fact" />
                    </div>
                    <div>
                      <label className={lbl}>Decision date *</label>
                      <input type="date" value={form.decision_date} onChange={e => setForm(p => ({ ...p, decision_date: e.target.value }))} className={inp} />
                    </div>
                  </>
                )}
                <div>
                  <label className={lbl}>Background</label>
                  <textarea value={form.background} onChange={e => setForm(p => ({ ...p, background: e.target.value }))} rows={4} className={inp + ' resize-none'}
                    placeholder="Why is this resolution being put to the board?" />
                </div>
                <div>
                  <label className={lbl}>Recommendation</label>
                  <textarea value={form.recommendation} onChange={e => setForm(p => ({ ...p, recommendation: e.target.value }))} rows={3} className={inp + ' resize-none'}
                    placeholder="What is the proposer's recommendation?" />
                </div>
                <div>
                  <label className={lbl}>Risk / Impact</label>
                  <textarea value={form.risk_impact} onChange={e => setForm(p => ({ ...p, risk_impact: e.target.value }))} rows={2} className={inp + ' resize-none'} />
                </div>
                <div>
                  <label className={lbl}>Budget Impact</label>
                  <textarea value={form.budget_impact} onChange={e => setForm(p => ({ ...p, budget_impact: e.target.value }))} rows={2} className={inp + ' resize-none'} />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={save} disabled={saving}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Draft'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/5 p-4 bg-white/2.5">
      <p className="text-white/50 text-xs font-bold uppercase tracking-widest mb-1.5">{title}</p>
      <div className="text-white/80 text-sm">{children}</div>
    </div>
  )
}
