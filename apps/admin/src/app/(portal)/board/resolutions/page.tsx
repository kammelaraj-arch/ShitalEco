'use client'
import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
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

interface Trustee { id: string; full_name: string; role: string; is_active: boolean }
interface Meeting { id: string; title: string; scheduled_at: string; meeting_type: string }

interface Attachment {
  id: string
  filename: string
  content_type: string
  size_bytes: number
  url: string
  uploaded_at: string
  source: 'upload' | 'meeting' | 'ai'
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
  title: string; background: string; recommendation: string
  risk_impact: string; budget_impact: string
  category: Category; decision_type: DecisionType
  meeting_id: string; decision_date: string
  is_retrospective: boolean; retrospective_reason: string
}
const EMPTY: Form = {
  title: '', background: '', recommendation: '', risk_impact: '', budget_impact: '',
  category: 'OPERATIONAL', decision_type: 'BOARD_MEETING',
  meeting_id: '', decision_date: '',
  is_retrospective: false, retrospective_reason: '',
}

type StepKey = 'basics' | 'context' | 'impact' | 'review' | 'vote'
const STEPS: { key: StepKey; title: string; hint: string }[] = [
  { key: 'basics',  title: 'Basics',      hint: 'What is being decided' },
  { key: 'context', title: 'Context',     hint: 'Background, recommendation, attachments & AI draft' },
  { key: 'impact',  title: 'Impact',      hint: 'Risk & budget' },
  { key: 'review',  title: 'Review',      hint: 'Preview & publish' },
  { key: 'vote',    title: 'Vote & Close', hint: 'Live tally & outcome' },
]

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso }
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function ResolutionsPage() {
  const [items, setItems] = useState<Resolution[]>([])
  const [trustees, setTrustees] = useState<Trustee[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<ResStatus | ''>('')

  const [wizOpen, setWizOpen] = useState(false)
  const [wizStep, setWizStep] = useState<StepKey>('basics')
  const [editing, setEditing] = useState<Resolution | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [votes, setVotes] = useState<Vote[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiNote, setAiNote] = useState('')
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

  const loadDetail = useCallback(async (id: string) => {
    try {
      const data = await apiFetch<{ resolution: Resolution; votes: Vote[] }>(`/admin/board/resolutions/${id}`)
      setEditing(data.resolution)
      setVotes(data.votes || [])
      // Attachments live on a separate endpoint — load in parallel.
      try {
        const a = await apiFetch<{ items: Attachment[] }>(`/admin/board/resolutions/${id}/attachments`)
        setAttachments(a.items || [])
      } catch { setAttachments([]) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load detail') }
  }, [])

  function openNew() {
    setEditing(null); setForm(EMPTY); setVotes([]); setAttachments([]); setAiNote('')
    setWizStep('basics'); setWizOpen(true); setError('')
  }

  async function openExisting(r: Resolution) {
    setForm({
      title: r.title, background: r.background, recommendation: r.recommendation,
      risk_impact: r.risk_impact, budget_impact: r.budget_impact,
      category: r.category, decision_type: r.decision_type,
      meeting_id: r.meeting_id || '',
      decision_date: r.decision_date ? r.decision_date.slice(0, 10) : '',
      is_retrospective: r.is_retrospective,
      retrospective_reason: r.retrospective_reason,
    })
    const start: StepKey =
      r.status === 'DRAFT' ? 'review' :
      (r.status === 'OPEN' || r.status === 'CLOSED') ? 'vote' :
      'basics'
    setWizStep(start); setWizOpen(true); setError('')
    await loadDetail(r.id)
  }

  function closeWizard() {
    setWizOpen(false); setError(''); setCastingDir('')
  }

  // ─── attachments ───
  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    let targetId = editing?.id
    if (!targetId) {
      const saved = await saveDraft(true)
      if (!saved) return
      targetId = saved.id
    }
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        await apiFetch(`/admin/board/resolutions/${targetId}/attachments`, {
          method: 'POST', body: fd,
        })
      }
      await loadDetail(targetId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally { setUploading(false) }
  }

  async function removeAttachment(attId: string) {
    if (!editing) return
    if (!confirm('Remove this attachment?')) return
    try {
      await apiFetch(`/admin/board/resolutions/${editing.id}/attachments/${attId}`, { method: 'DELETE' })
      await loadDetail(editing.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to remove') }
  }

  async function pullMeetingFiles() {
    if (!form.meeting_id) { setError('Pick a meeting in the Basics step first.'); return }
    let targetId = editing?.id
    if (!targetId) {
      const saved = await saveDraft(true)
      if (!saved) return
      targetId = saved.id
    }
    setUploading(true)
    try {
      await apiFetch(`/admin/board/resolutions/${targetId}/attachments/pull-from-meeting`, {
        method: 'POST', body: JSON.stringify({ meeting_id: form.meeting_id }),
      })
      await loadDetail(targetId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not pull meeting files')
    } finally { setUploading(false) }
  }

  // ─── AI draft ───
  async function aiDraft(mode: 'draft' | 'finalise') {
    if (mode === 'draft' && !form.meeting_id && attachments.length === 0) {
      setError('Link a meeting or attach notes first — the AI needs context.')
      return
    }
    let targetId = editing?.id
    if (!targetId) {
      const saved = await saveDraft(true)
      if (!saved) return
      targetId = saved.id
    }
    setAiBusy(true); setError('')
    try {
      const body = {
        mode,
        meeting_id: form.meeting_id || null,
        instruction: aiNote.trim() || null,
        current: {
          title: form.title, background: form.background, recommendation: form.recommendation,
          risk_impact: form.risk_impact, budget_impact: form.budget_impact,
          category: form.category, decision_type: form.decision_type,
        },
      }
      const out = await apiFetch<{
        draft: { title?: string; background?: string; recommendation?: string; risk_impact?: string; budget_impact?: string; category?: Category; decision_type?: DecisionType }
        source: string
      }>(`/admin/board/resolutions/${targetId}/ai-draft`, { method: 'POST', body: JSON.stringify(body) })
      const d = out.draft || {}
      setForm(p => ({
        ...p,
        title:          d.title          ?? p.title,
        background:     d.background     ?? p.background,
        recommendation: d.recommendation ?? p.recommendation,
        risk_impact:    d.risk_impact    ?? p.risk_impact,
        budget_impact:  d.budget_impact  ?? p.budget_impact,
        category:       d.category       ?? p.category,
        decision_type:  d.decision_type  ?? p.decision_type,
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI draft failed')
    } finally { setAiBusy(false) }
  }

  // ─── step validity + navigation ───
  const stepValid: Record<StepKey, boolean> = {
    basics:  Boolean(form.title.trim()) && (!form.is_retrospective || (form.retrospective_reason.trim().length > 0 && form.decision_date.length > 0)),
    context: true,
    impact:  true,
    review:  Boolean(form.title.trim()),
    vote:    Boolean(editing),
  }
  function goNext() {
    const idx = STEPS.findIndex(s => s.key === wizStep)
    setWizStep(STEPS[Math.min(idx + 1, STEPS.length - 1)].key)
  }
  function goPrev() {
    const idx = STEPS.findIndex(s => s.key === wizStep)
    setWizStep(STEPS[Math.max(idx - 1, 0)].key)
  }

  // ─── mutations ───
  async function saveDraft(silent = false): Promise<Resolution | null> {
    if (!form.title.trim()) { setError('Title is required'); return null }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { ...form }
      if (!body.meeting_id) delete body.meeting_id
      if (!body.decision_date) delete body.decision_date
      let saved: Resolution
      if (editing) {
        const r = await apiFetch<{ resolution: Resolution }>(`/admin/board/resolutions/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
        saved = r.resolution
      } else {
        const r = await apiFetch<{ resolution: Resolution }>('/admin/board/resolutions', { method: 'POST', body: JSON.stringify(body) })
        saved = r.resolution
      }
      setEditing(saved)
      if (!silent) await load()
      return saved
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Failed to save'
      try { const p = JSON.parse(msg); if (p?.detail?.errors) msg = p.detail.errors.join(' · ') } catch { /* not JSON */ }
      setError(msg)
      return null
    } finally { setSaving(false) }
  }

  async function publishNow(opts: { sendInvites: boolean }) {
    const confirmMsg = opts.sendInvites
      ? 'Publish this resolution and email vote-invites to every active trustee? Text becomes locked once published.'
      : 'Publish this resolution? Voting opens immediately. Text becomes locked once published.'
    if (!confirm(confirmMsg)) return
    setPublishing(true)
    try {
      const saved = await saveDraft(true)
      if (!saved) { setPublishing(false); return }
      await apiFetch(`/admin/board/resolutions/${saved.id}/publish`, { method: 'POST' })
      if (opts.sendInvites) {
        try {
          const res = await apiFetch<{ trustees_total: number; tokens_created: number; tokens_reused: number; email_failed: string[] }>(
            `/admin/board/resolutions/${saved.id}/send-vote-invites`, { method: 'POST' },
          )
          const fails = res.email_failed?.length || 0
          alert(
            `Published.\nSent to ${res.trustees_total} trustees ` +
            `(new tokens ${res.tokens_created}, reused ${res.tokens_reused}).` +
            (fails > 0 ? `\n\nEmail failures (${fails}):\n${res.email_failed.join('\n')}` : ''),
          )
        } catch (e) {
          alert(`Published, but failed to send invites: ${e instanceof Error ? e.message : 'unknown'}`)
        }
      }
      await load()
      await loadDetail(saved.id)
      setWizStep('vote')
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to publish') }
    finally { setPublishing(false) }
  }

  async function sendInvitesOnly() {
    if (!editing) return
    if (!confirm('Email a magic-link to every active trustee? Re-sending is safe — same tokens are reused.')) return
    setSendingInvites(true)
    try {
      const data = await apiFetch<{ trustees_total: number; tokens_created: number; tokens_reused: number; email_failed: string[] }>(
        `/admin/board/resolutions/${editing.id}/send-vote-invites`, { method: 'POST' },
      )
      const fails = data.email_failed?.length || 0
      alert(
        `Sent to ${data.trustees_total} trustees.\n` +
        `New: ${data.tokens_created}, reused: ${data.tokens_reused}.\n` +
        (fails > 0 ? `\nEmail failures (${fails}):\n${data.email_failed.join('\n')}` : `\nAll emails sent successfully.`),
      )
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Failed to send invites'
      try { const p = JSON.parse(msg); if (p?.detail?.errors) msg = p.detail.errors.join(' · ') } catch { /* not JSON */ }
      setError(msg)
    } finally { setSendingInvites(false) }
  }

  async function closeVote() {
    if (!editing) return
    if (!confirm(`Close voting on "${editing.title}"? Outcome will be computed against effective quorum.`)) return
    try {
      await apiFetch(`/admin/board/resolutions/${editing.id}/close`, { method: 'POST' })
      await load()
      await loadDetail(editing.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to close') }
  }

  async function castVote(trusteeId: string, choice: Choice) {
    if (!editing) return
    try {
      await apiFetch(`/admin/board/resolutions/${editing.id}/votes`, {
        method: 'POST', body: JSON.stringify({ trustee_id: trusteeId, choice }),
      })
      await loadDetail(editing.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to cast vote') }
  }

  async function rescindVote(trusteeId: string) {
    if (!editing) return
    if (!confirm('Remove this vote?')) return
    try {
      await apiFetch(`/admin/board/resolutions/${editing.id}/votes/${trusteeId}`, { method: 'DELETE' })
      await loadDetail(editing.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to rescind') }
  }

  async function castingVoteConfirm() {
    if (!editing || !castingDir) return
    if (!confirm(`Cast Chair's casting vote ${castingDir}? This breaks the tie and closes the resolution.`)) return
    try {
      await apiFetch(`/admin/board/resolutions/${editing.id}/casting-vote`, {
        method: 'POST', body: JSON.stringify({ choice: castingDir }),
      })
      setCastingDir('')
      await load()
      await loadDetail(editing.id)
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Failed to cast'
      try { const p = JSON.parse(msg); if (p?.detail) msg = typeof p.detail === 'string' ? p.detail : JSON.stringify(p.detail) } catch { /* not JSON */ }
      setError(msg)
    }
  }

  const trusteesById: Record<string, Trustee | undefined> = Object.fromEntries(trustees.map(t => [t.id, t]))
  const ownVoteByTrustee: Record<string, Vote | undefined> = Object.fromEntries(
    votes.filter(v => v.trustee_id).map(v => [v.trustee_id!, v]),
  )

  const locked = Boolean(editing && editing.status !== 'DRAFT')
  const currentStepIdx = STEPS.findIndex(s => s.key === wizStep)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Resolutions &amp; Voting</h1>
          <p className="text-white/40 mt-1">Guided end-to-end — draft, review, publish, vote, close. Every action audit-logged.</p>
        </div>
        <button onClick={openNew}
          className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90">
          + New Resolution
        </button>
      </div>

      {error && !wizOpen && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

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
                  No resolutions yet. Click + New Resolution to start the wizard.
                </td></tr>
              )}
              {items.map(r => (
                <tr key={r.id} onClick={() => openExisting(r)}
                  className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors">
                  <td className="px-4 py-3 text-white font-semibold">
                    {r.is_retrospective && <span className="text-amber-400 text-xs mr-1.5" title="Retrospective record">⏪</span>}
                    {r.title}
                  </td>
                  <td className="px-4 py-3 text-white/60 text-xs">{r.category.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-white/60 text-xs">{r.decision_type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
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

      {/* Wizard */}
      <AnimatePresence>
        {wizOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={closeWizard} className="fixed inset-0 bg-black/70 z-40 backdrop-blur-sm" />
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              transition={{ type: 'spring', damping: 26, stiffness: 240 }}
              className="fixed inset-0 z-50 flex flex-col
                         bg-temple-deep border-0 overflow-hidden shadow-2xl">
              {/* Top app-bar */}
              <div className="px-6 py-3 bg-[#0b1220] border-b border-white/5 flex items-center gap-3">
                <button className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 text-white/70 flex items-center justify-center" title="Menu">
                  <span className="text-base leading-none">☰</span>
                </button>
                <div className="min-w-0 flex-1">
                  <h2 className="text-white font-black text-base truncate leading-tight">
                    {editing ? editing.title || 'Untitled resolution' : 'New resolution'}
                  </h2>
                  <p className="text-white/40 text-[11px]">Board Resolution · {editing ? `Ref ${editing.id.slice(0, 8)}` : 'draft'}</p>
                </div>
                <button onClick={closeWizard} title="Close wizard"
                  className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 flex items-center justify-center leading-none">✕</button>
              </div>

              {/* Numbered stepper */}
              <div className="px-6 py-3 bg-[#0b1220] border-b border-white/5 overflow-x-auto">
                <div className="flex items-center gap-1 min-w-max">
                  {STEPS.map((s, i) => {
                    const active = s.key === wizStep
                    const done = i < currentStepIdx
                    const unlocked = i === 0 || Boolean(editing) || done
                    return (
                      <div key={s.key} className="flex items-center">
                        <button onClick={() => unlocked && setWizStep(s.key)} disabled={!unlocked}
                          className={`flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full text-xs font-bold transition-all group ${
                            active ? 'bg-red-600 text-white shadow-lg shadow-red-900/40'
                              : done ? 'bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30'
                              : unlocked ? 'text-white/60 hover:bg-white/5'
                              : 'text-white/25 cursor-not-allowed'
                          }`}>
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black ${
                            active ? 'bg-white text-red-600'
                              : done ? 'bg-emerald-500 text-white'
                              : 'bg-white/10 text-white/60'
                          }`}>{done ? '✓' : i + 1}</span>
                          <span className="uppercase tracking-wide">{s.title}</span>
                          <span title={s.hint}
                            className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                              active ? 'bg-white/25 text-white' : 'bg-white/10 text-white/50 group-hover:bg-white/20'
                            }`}>?</span>
                        </button>
                        {i < STEPS.length - 1 && <span className="text-white/20 text-sm px-1">›</span>}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Info strip (always-visible context) */}
              <div className="px-6 py-3 bg-[#0e1626] border-b border-white/5 flex flex-wrap gap-x-10 gap-y-3 text-[11px]">
                {[
                  { label: 'Status', value: editing ? editing.status : 'NEW', accent: 'text-emerald-300' },
                  { label: 'Category', value: (form.category || '—').replace(/_/g, ' ') },
                  { label: 'Decision Type', value: (form.decision_type || '—').replace(/_/g, ' ') },
                  { label: 'Decision Date', value: fmtDate(editing?.decision_date ?? form.decision_date) },
                  { label: 'Attachments', value: `${attachments.length} file${attachments.length === 1 ? '' : 's'}` },
                  { label: 'Tally', value: editing ? `FOR ${editing.tally_for} · AGAINST ${editing.tally_against} · ABSTAIN ${editing.tally_abstain}` : '—' },
                  { label: 'Outcome', value: editing?.outcome ? editing.outcome.replace(/_/g, ' ') : 'Pending vote', accent: editing?.outcome === 'CARRIED' ? 'text-emerald-300' : editing?.outcome === 'NOT_CARRIED' ? 'text-red-300' : 'text-amber-300' },
                ].map(it => (
                  <div key={it.label} className="min-w-0">
                    <div className="text-white/40 font-bold uppercase tracking-wider">{it.label}</div>
                    <div className={`font-black ${it.accent || 'text-white'} truncate`}>{it.value}</div>
                  </div>
                ))}
              </div>

              {error && <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

              {/* Body: main form + right rail */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-6 py-6 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 max-w-[1600px] mx-auto">
                  <div className="min-w-0 space-y-6">
                    {/* Step title bar — matches "SELECTED ASSET / Change asset" row */}
                    <div className="rounded-2xl border border-white/10 bg-white/3 px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-white/40 text-[11px] font-bold uppercase tracking-widest">Step {currentStepIdx + 1} of {STEPS.length}</p>
                        <p className="text-white font-black text-base">{STEPS[currentStepIdx]?.title}</p>
                        <p className="text-white/50 text-xs mt-0.5">{STEPS[currentStepIdx]?.hint}</p>
                      </div>
                      {editing && wizStep !== 'basics' && (
                        <button onClick={() => setWizStep('basics')}
                          className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/80 text-xs font-bold hover:bg-white/10">
                          Change basics
                        </button>
                      )}
                    </div>

                {wizStep === 'basics' && (
                  <div className="w-full space-y-4">
                    <div>
                      <label className={lbl}>Title *</label>
                      <input disabled={locked} value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inp}
                        placeholder="e.g. Approve Diwali budget of £15,000" />
                      <p className="text-white/40 text-xs mt-1">Write it like a motion — clear, specific, actionable.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>Category</label>
                        <select disabled={locked} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value as Category }))} className={inp}>
                          {(['OPERATIONAL', 'OFFICER_ELECTION', 'POLICY', 'CONTRACT', 'CONSTITUTIONAL'] as Category[]).map(c =>
                            <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={lbl}>Decision Type</label>
                        <select disabled={locked} value={form.decision_type} onChange={e => setForm(p => ({ ...p, decision_type: e.target.value as DecisionType }))} className={inp}>
                          {(['BOARD_MEETING', 'WRITTEN_RESOLUTION', 'RETROSPECTIVE'] as DecisionType[]).map(d =>
                            <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                    </div>
                    {form.decision_type === 'BOARD_MEETING' && (
                      <div>
                        <label className={lbl}>Linked Meeting</label>
                        <select disabled={locked} value={form.meeting_id} onChange={e => setForm(p => ({ ...p, meeting_id: e.target.value }))} className={inp}>
                          <option value="">— Not linked —</option>
                          {meetings.map(m => <option key={m.id} value={m.id}>{fmtDate(m.scheduled_at)} — {m.title || m.meeting_type.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                    )}
                    <div className="rounded-xl border border-white/10 bg-white/3 p-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input disabled={locked} type="checkbox" checked={form.is_retrospective}
                          onChange={e => setForm(p => ({ ...p, is_retrospective: e.target.checked, decision_type: e.target.checked ? 'RETROSPECTIVE' : p.decision_type }))}
                          className="w-4 h-4 rounded accent-saffron-400" />
                        <span className="text-white/80 text-sm font-bold">⏪ Record retrospective decision</span>
                      </label>
                      <p className="text-white/40 text-xs mt-1 ml-6">Marks this as a record of a past decision. Disabled for Constitutional / Officer Election categories.</p>
                      {form.is_retrospective && (
                        <div className="mt-3 space-y-3 ml-6">
                          <div>
                            <label className={lbl}>Reason for retrospective record *</label>
                            <textarea disabled={locked} value={form.retrospective_reason} onChange={e => setForm(p => ({ ...p, retrospective_reason: e.target.value }))} rows={2} className={inp + ' resize-none'}
                              placeholder="e.g. Emergency action taken on phone, recorded after the fact" />
                          </div>
                          <div>
                            <label className={lbl}>Decision date *</label>
                            <input disabled={locked} type="date" value={form.decision_date} onChange={e => setForm(p => ({ ...p, decision_date: e.target.value }))} className={inp} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {wizStep === 'context' && (
                  <div className="w-full space-y-5">
                    {/* AI draft */}
                    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-violet-300 text-sm font-black">✨ Draft with AI (Microsoft Copilot)</span>
                      </div>
                      <p className="text-white/60 text-xs mb-3">
                        {form.meeting_id
                          ? 'Pulls minutes + attached files from the linked meeting and writes a first-pass draft for you to edit.'
                          : 'Link a meeting in the Basics step (or attach notes below) so the AI has something to work from.'}
                      </p>
                      <textarea disabled={locked || aiBusy} value={aiNote} onChange={e => setAiNote(e.target.value)} rows={2}
                        className={inp + ' resize-none text-xs'}
                        placeholder="Optional guidance for the AI — e.g. &quot;focus on the Diwali budget decision, retain our usual tone&quot;" />
                      <div className="flex gap-2 flex-wrap mt-3">
                        <button onClick={() => aiDraft('draft')} disabled={locked || aiBusy}
                          className="px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-400/40 text-violet-200 text-xs font-bold hover:bg-violet-500/30 disabled:opacity-40">
                          {aiBusy ? 'Thinking…' : '✨ Draft from meeting'}
                        </button>
                        <button onClick={() => aiDraft('finalise')} disabled={locked || aiBusy || !form.title.trim()}
                          className="px-3 py-1.5 rounded-lg border border-violet-400/40 text-violet-200 text-xs font-bold hover:bg-violet-500/10 disabled:opacity-40">
                          {aiBusy ? 'Polishing…' : '🪄 Polish & finalise'}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className={lbl}>Background</label>
                      <textarea disabled={locked} value={form.background} onChange={e => setForm(p => ({ ...p, background: e.target.value }))} rows={6} className={inp + ' resize-none'}
                        placeholder="Why is this resolution being put to the board?" />
                    </div>
                    <div>
                      <label className={lbl}>Recommendation</label>
                      <textarea disabled={locked} value={form.recommendation} onChange={e => setForm(p => ({ ...p, recommendation: e.target.value }))} rows={5} className={inp + ' resize-none'}
                        placeholder="State the motion the board will vote on." />
                    </div>

                    {/* Attachments */}
                    <div className="rounded-2xl border border-white/10 bg-white/3 p-4">
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                        <p className="text-white/70 text-xs uppercase tracking-widest font-bold">📎 Supporting files</p>
                        <div className="flex gap-2 flex-wrap">
                          <label className="px-3 py-1.5 rounded-lg border border-white/10 text-white/80 text-xs font-bold hover:bg-white/5 cursor-pointer">
                            {uploading ? 'Uploading…' : '+ Add files'}
                            <input type="file" multiple hidden disabled={locked || uploading}
                              onChange={e => { void uploadFiles(e.target.files); e.currentTarget.value = '' }} />
                          </label>
                          {form.meeting_id && (
                            <button onClick={pullMeetingFiles} disabled={locked || uploading}
                              className="px-3 py-1.5 rounded-lg border border-saffron-400/40 text-saffron-300 text-xs font-bold hover:bg-saffron-400/10 disabled:opacity-40">
                              📥 Pull meeting files
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-white/40 text-xs mb-3">Minutes, quotes, prior correspondence. Trustees see these linked from the vote-invite.</p>
                      {attachments.length === 0 ? (
                        <p className="text-white/30 text-xs italic">No files attached yet.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {attachments.map(a => (
                            <li key={a.id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-white/3 text-xs">
                              <div className="min-w-0 flex-1 flex items-center gap-2">
                                <span className="text-white/40">{a.source === 'meeting' ? '📅' : a.source === 'ai' ? '✨' : '📎'}</span>
                                <a href={a.url} target="_blank" rel="noreferrer" className="text-saffron-300 hover:underline truncate">{a.filename}</a>
                                <span className="text-white/40">· {fmtBytes(a.size_bytes)}</span>
                              </div>
                              {!locked && (
                                <button onClick={() => removeAttachment(a.id)} className="text-red-400/60 hover:text-red-400 px-1">✕</button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                {wizStep === 'impact' && (
                  <div className="w-full space-y-4">
                    <div>
                      <label className={lbl}>Risk / Impact</label>
                      <textarea disabled={locked} value={form.risk_impact} onChange={e => setForm(p => ({ ...p, risk_impact: e.target.value }))} rows={4} className={inp + ' resize-none'}
                        placeholder="What could go wrong? Who is affected? What does success look like?" />
                    </div>
                    <div>
                      <label className={lbl}>Budget Impact</label>
                      <textarea disabled={locked} value={form.budget_impact} onChange={e => setForm(p => ({ ...p, budget_impact: e.target.value }))} rows={4} className={inp + ' resize-none'}
                        placeholder="One-off vs recurring. Which fund / budget line. Any match-funding." />
                    </div>
                    <p className="text-white/40 text-xs">Optional, but strongly recommended for any spending or policy change.</p>
                  </div>
                )}

                {wizStep === 'review' && (
                  <div className="w-full space-y-4">
                    <p className="text-white/50 text-xs uppercase tracking-widest font-bold">Preview — this is what trustees will see</p>
                    <div className="rounded-2xl border border-white/10 bg-white/3 p-5 space-y-4">
                      <div>
                        <div className="flex flex-wrap gap-2 mb-2">
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold border bg-white/10 text-white/70 border-white/20">{form.category.replace(/_/g, ' ')}</span>
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold border bg-white/10 text-white/70 border-white/20">{form.decision_type.replace(/_/g, ' ')}</span>
                          {form.is_retrospective && <span className="px-2 py-0.5 rounded-full text-xs font-bold border bg-amber-500/20 text-amber-300 border-amber-500/30">⏪ Retrospective</span>}
                        </div>
                        <h3 className="text-2xl font-black text-white">{form.title || <em className="text-white/30">(No title yet)</em>}</h3>
                      </div>
                      {form.is_retrospective && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
                          <p className="text-amber-300 text-xs font-bold uppercase tracking-wide mb-1">Retrospective Record</p>
                          <p className="text-white/80 text-sm">Decision made on {fmtDate(form.decision_date || null)}.</p>
                          <p className="text-white/60 text-xs italic mt-1">Reason: {form.retrospective_reason || '—'}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <PreviewField title="Background" value={form.background} />
                        <PreviewField title="Recommendation" value={form.recommendation} />
                        <PreviewField title="Risk / Impact" value={form.risk_impact} />
                        <PreviewField title="Budget Impact" value={form.budget_impact} />
                      </div>
                      {attachments.length > 0 && (
                        <div className="rounded-xl border border-white/5 p-4 bg-white/2.5">
                          <p className="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">📎 Attachments ({attachments.length})</p>
                          <ul className="space-y-1">
                            {attachments.map(a => (
                              <li key={a.id} className="flex items-center gap-2 text-xs">
                                <span className="text-white/40">{a.source === 'meeting' ? '📅' : a.source === 'ai' ? '✨' : '📎'}</span>
                                <a href={a.url} target="_blank" rel="noreferrer" className="text-saffron-300 hover:underline truncate">{a.filename}</a>
                                <span className="text-white/40">· {fmtBytes(a.size_bytes)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {!editing || editing.status === 'DRAFT' ? (
                      <div className="rounded-2xl border border-saffron-400/30 bg-saffron-400/5 p-5">
                        <p className="text-saffron-300 text-xs uppercase tracking-widest font-bold mb-2">Ready to proceed</p>
                        <p className="text-white/70 text-sm mb-4">Save it as a draft to come back later, or publish it now — publishing locks the text and opens voting.</p>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => saveDraft()} disabled={saving || !form.title.trim()}
                            className="px-4 py-2.5 rounded-xl border border-white/10 text-white/80 text-sm font-bold hover:bg-white/5 disabled:opacity-40">
                            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Save as Draft'}
                          </button>
                          <button onClick={() => publishNow({ sendInvites: false })} disabled={publishing || !form.title.trim()}
                            className="px-4 py-2.5 rounded-xl border border-saffron-400/40 text-saffron-300 text-sm font-bold hover:bg-saffron-400/10 disabled:opacity-40">
                            {publishing ? 'Publishing…' : 'Publish for voting'}
                          </button>
                          <button onClick={() => publishNow({ sendInvites: true })} disabled={publishing || !form.title.trim()}
                            className="px-4 py-2.5 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron disabled:opacity-40">
                            {publishing ? 'Working…' : '🚀 Publish & email invites →'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/3 p-4 text-white/60 text-sm">
                        This resolution is {editing.status}. Text is locked. Jump to <b className="text-saffron-300">Vote &amp; Close</b> to manage voting.
                      </div>
                    )}
                  </div>
                )}

                {wizStep === 'vote' && (
                  <div className="w-full space-y-4">
                    {!editing && (
                      <div className="rounded-xl border border-white/10 bg-white/3 p-4 text-white/60 text-sm">
                        Save and publish the resolution first. The Review step has the buttons.
                      </div>
                    )}

                    {editing && editing.status === 'DRAFT' && (
                      <div className="rounded-xl border border-white/10 bg-white/3 p-4 text-white/60 text-sm">
                        This resolution is still DRAFT. Go to <b className="text-saffron-300">Review</b> and publish it to open voting.
                      </div>
                    )}

                    {editing && (editing.status === 'OPEN' || editing.status === 'CLOSED') && (
                      <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
                        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                          <h3 className="font-black text-white">Live tally</h3>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-white/50">Quorum {editing.quorum_at_close ?? (editing.tally_for + editing.tally_against + editing.tally_abstain)} / {editing.effective_quorum_at_close ?? '—'}</span>
                            <span className="text-green-400 font-bold text-sm">FOR {editing.tally_for}</span>
                            <span className="text-red-400 font-bold text-sm">AGAINST {editing.tally_against}</span>
                            <span className="text-white/60 font-bold text-sm">ABSTAIN {editing.tally_abstain}</span>
                          </div>
                        </div>

                        {editing.status === 'OPEN' && (
                          <div className="flex flex-wrap gap-2 mb-4">
                            <button onClick={sendInvitesOnly} disabled={sendingInvites}
                              className="px-3 py-1.5 rounded-lg border border-saffron-400/40 text-saffron-300 text-sm font-bold hover:bg-saffron-400/10 disabled:opacity-40">
                              {sendingInvites ? 'Sending…' : '📧 Email vote invites'}
                            </button>
                            {editing.outcome !== 'TIED' && (
                              <button onClick={closeVote} className="px-3 py-1.5 rounded-lg bg-saffron-gradient text-white text-sm font-bold">Close voting</button>
                            )}
                          </div>
                        )}

                        {editing.outcome === 'TIED' && editing.status === 'OPEN' && (
                          <div className="rounded-xl border border-saffron-400/40 bg-saffron-400/10 p-4 mb-4">
                            <p className="text-saffron-300 font-bold text-sm mb-2">Vote tied — Chair casting vote required</p>
                            <p className="text-white/70 text-xs mb-3">Per governing rules, the Chair may cast a casting vote to break the tie. Logged separately in the audit trail.</p>
                            <div className="flex gap-2 flex-wrap items-center">
                              <button onClick={() => setCastingDir('FOR')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${castingDir === 'FOR' ? 'bg-green-500/30 text-green-300 border border-green-400' : 'bg-white/5 text-white/70 border border-white/10'}`}>Casting FOR</button>
                              <button onClick={() => setCastingDir('AGAINST')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${castingDir === 'AGAINST' ? 'bg-red-500/30 text-red-300 border border-red-400' : 'bg-white/5 text-white/70 border border-white/10'}`}>Casting AGAINST</button>
                              <button onClick={castingVoteConfirm} disabled={!castingDir}
                                className="px-3 py-1.5 rounded-lg bg-saffron-gradient text-white text-sm font-bold disabled:opacity-40">Confirm casting vote</button>
                            </div>
                          </div>
                        )}

                        {editing.status === 'OPEN' && (
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

                        {editing.status === 'CLOSED' && (
                          <>
                            {editing.outcome_summary && <p className="text-white/80 text-sm mb-3">{editing.outcome_summary}</p>}
                            {editing.casting_vote_used && (
                              <p className="text-saffron-300 text-xs italic mb-3">
                                Chair cast a casting vote {editing.casting_vote_choice} to break the tie.
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
                  </div>
                  {/* Right rail */}
                  <aside className="min-w-0 space-y-4">
                    <div className="rounded-2xl border border-white/10 bg-[#0e1626] p-4">
                      <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-2">Resolution record</p>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-white font-black text-sm truncate">{editing ? `RES-${editing.id.slice(0, 8).toUpperCase()}` : 'Not saved yet'}</p>
                          <p className="text-white/50 text-xs mt-0.5">
                            {editing
                              ? `${(editing.category || '').replace(/_/g, ' ')} · ${(editing.decision_type || '').replace(/_/g, ' ')}`
                              : 'Save a draft to assign a reference.'}
                          </p>
                        </div>
                        {editing && (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${STATUS_BADGE[editing.status]}`}>
                            {editing.status}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-[#0e1626] p-4">
                      <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-2">Linked meeting</p>
                      {(() => {
                        const m = meetings.find(mm => mm.id === form.meeting_id)
                        if (!m) return <p className="text-white/50 text-xs">No meeting linked. Pick one in the Basics step for AI draft context.</p>
                        return (
                          <div>
                            <p className="text-white font-bold text-sm">{m.title || m.meeting_type.replace(/_/g, ' ')}</p>
                            <p className="text-white/50 text-xs mt-0.5">{fmtDate(m.scheduled_at)}</p>
                          </div>
                        )
                      })()}
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-[#0e1626] p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest">Supporting files</p>
                        <span className="text-white/60 text-xs font-bold">{attachments.length}</span>
                      </div>
                      {attachments.length === 0 ? (
                        <p className="text-white/50 text-xs">No files attached yet.</p>
                      ) : (
                        <ul className="space-y-1">
                          {attachments.slice(0, 4).map(a => (
                            <li key={a.id} className="flex items-center gap-2 text-xs">
                              <span className="text-white/40">{a.source === 'meeting' ? '📅' : a.source === 'ai' ? '✨' : '📎'}</span>
                              <a href={a.url} target="_blank" rel="noreferrer" className="text-saffron-300 hover:underline truncate flex-1">{a.filename}</a>
                            </li>
                          ))}
                          {attachments.length > 4 && <li className="text-white/40 text-xs">+ {attachments.length - 4} more…</li>}
                        </ul>
                      )}
                    </div>

                    {editing && (editing.status === 'OPEN' || editing.status === 'CLOSED') && (
                      <div className="rounded-2xl border border-white/10 bg-[#0e1626] p-4">
                        <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-3">Vote tally</p>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="rounded-lg bg-emerald-600/15 border border-emerald-600/30 py-2">
                            <div className="text-emerald-300 font-black text-lg">{editing.tally_for}</div>
                            <div className="text-emerald-300/70 text-[10px] font-bold uppercase">For</div>
                          </div>
                          <div className="rounded-lg bg-red-600/15 border border-red-600/30 py-2">
                            <div className="text-red-300 font-black text-lg">{editing.tally_against}</div>
                            <div className="text-red-300/70 text-[10px] font-bold uppercase">Against</div>
                          </div>
                          <div className="rounded-lg bg-amber-600/15 border border-amber-600/30 py-2">
                            <div className="text-amber-300 font-black text-lg">{editing.tally_abstain}</div>
                            <div className="text-amber-300/70 text-[10px] font-bold uppercase">Abstain</div>
                          </div>
                        </div>
                        {editing.outcome && (
                          <div className="mt-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-black border ${OUTCOME_BADGE[editing.outcome] || 'bg-white/10 text-white/60 border-white/20'}`}>
                              {editing.outcome.replace(/_/g, ' ')}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </aside>
                </div>
              </div>

              {/* Footer: Back / progress circle + Save draft + Continue */}
              <div className="px-6 py-4 bg-[#0b1220] border-t border-white/5 flex items-center justify-between gap-3 flex-wrap">
                <button onClick={goPrev} disabled={currentStepIdx === 0}
                  className="px-5 py-2.5 rounded-xl border border-white/15 text-white/80 text-sm font-bold hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed">
                  ← Back
                </button>
                <div className="flex items-center gap-3">
                  {/* Progress ring */}
                  {(() => {
                    const pct = Math.round(((currentStepIdx + 1) / STEPS.length) * 100)
                    const circ = 2 * Math.PI * 18
                    const dash = (pct / 100) * circ
                    return (
                      <div className="relative w-12 h-12" title={`${pct}% complete`}>
                        <svg viewBox="0 0 44 44" className="w-12 h-12 -rotate-90">
                          <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
                          <circle cx="22" cy="22" r="18" fill="none" stroke="#dc2626" strokeWidth="4" strokeLinecap="round"
                            strokeDasharray={`${dash} ${circ}`} />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-white text-[11px] font-black">{pct}%</span>
                      </div>
                    )
                  })()}
                  {!locked && (
                    <button onClick={() => saveDraft()} disabled={saving || !form.title.trim()}
                      className="px-5 py-2.5 rounded-xl border border-white/15 text-white text-sm font-bold hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed">
                      {saving ? 'Saving…' : 'Save draft'}
                    </button>
                  )}
                  {wizStep !== 'review' && wizStep !== 'vote' ? (
                    <button onClick={goNext} disabled={!stepValid[wizStep]}
                      className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-black shadow-lg shadow-red-900/40 disabled:opacity-40 disabled:cursor-not-allowed">
                      Continue
                    </button>
                  ) : wizStep === 'review' && editing && editing.status !== 'DRAFT' ? (
                    <button onClick={() => setWizStep('vote')}
                      className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-black shadow-lg shadow-red-900/40">
                      Go to Vote &amp; Close
                    </button>
                  ) : null}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function PreviewField({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 p-4 bg-white/2.5">
      <p className="text-white/50 text-xs font-bold uppercase tracking-widest mb-1.5">{title}</p>
      <div className="text-white/80 text-sm whitespace-pre-wrap">{value || <em className="text-white/30">(empty)</em>}</div>
    </div>
  )
}
