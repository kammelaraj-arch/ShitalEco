'use client'
// Organisation Risk Register — CC26 compliant log of every open and
// closed risk across the charity. Rows auto-promote here from
// resolutions when `auto_promote` is set at publish time, so this
// screen is the canonical list trustees review at every board meeting.

import { useCallback, useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'

type Scope = 'STRATEGIC' | 'OPERATIONAL' | 'COMPLIANCE' | 'PROJECT'
type RiskStatus = 'OPEN' | 'MITIGATING' | 'CLOSED' | 'REALISED'

interface RiskRow {
  id: string
  risk_ref: string
  title: string
  description: string
  category: string
  scope: Scope
  likelihood: number
  impact: number
  score: number
  treatment: string
  mitigation_plan: string
  status: RiskStatus
  review_date: string | null
  source_type: string
  source_id: string | null
  created_at: string
  updated_at: string
}

interface TaxonomyRow { code: string; label: string; description?: string }
interface LevelBand { code: string; label: string; min_score: number; max_score: number; colour_hex: string }
interface Taxonomy {
  categories: TaxonomyRow[]
  levels: LevelBand[]
  treatments: TaxonomyRow[]
  scopes: TaxonomyRow[]
}

const emptyDraft = {
  title: '', description: '', category: 'OPERATIONAL',
  scope: 'OPERATIONAL' as Scope,
  likelihood: 2, impact: 2,
  treatment: 'TREAT', mitigation_plan: '',
  status: 'OPEN' as RiskStatus,
  review_date: '',
}

function levelFor(score: number, bands: LevelBand[]): LevelBand | undefined {
  return bands.find(b => score >= b.min_score && score <= b.max_score)
}

export default function RiskRegisterPage() {
  const [rows, setRows] = useState<RiskRow[]>([])
  const [tax, setTax] = useState<Taxonomy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [filterScope, setFilterScope] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('OPEN')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const q = new URLSearchParams()
      if (filterScope)  q.set('scope', filterScope)
      if (filterStatus) q.set('status', filterStatus)
      const [r, t] = await Promise.all([
        apiFetch<{ risks: RiskRow[] }>(`/admin/risk-register${q.toString() ? '?' + q.toString() : ''}`),
        tax ? Promise.resolve({ ...tax }) : apiFetch<Taxonomy>('/admin/risk-register/taxonomy'),
      ])
      setRows(r.risks || [])
      if (!tax) setTax(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filterScope, filterStatus, tax])

  useEffect(() => { void load() }, [load])

  async function save() {
    if (!draft.title.trim()) { setError('Title is required'); return }
    setSaving(true); setError('')
    try {
      await apiFetch('/admin/risk-register', {
        method: 'POST', body: JSON.stringify(draft),
      })
      setDraft(emptyDraft)
      setShowForm(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function closeRisk(id: string) {
    if (!confirm('Close this risk? The row stays in the register for audit.')) return
    try {
      await apiFetch(`/admin/risk-register/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to close')
    }
  }

  const score = draft.likelihood * draft.impact
  const draftLevel = tax ? levelFor(score, tax.levels) : undefined

  return (
    <div className="p-6 space-y-6 text-white max-w-[1400px] mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black">Organisation Risk Register</h1>
          <p className="text-white/50 text-sm mt-0.5">CC26 — the single log of every open risk. Rows auto-promote here from resolutions at publish.</p>
        </div>
        <button onClick={() => setShowForm(s => !s)}
          className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
          {showForm ? 'Close form' : '+ New risk'}
        </button>
      </header>

      {error && (
        <div className="bg-red-500/15 border border-red-500/40 text-red-200 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-white/50 text-xs">Scope:</label>
        <select value={filterScope} onChange={e => setFilterScope(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All</option>
          {tax?.scopes.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
        <label className="text-white/50 text-xs">Status:</label>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All</option>
          {['OPEN', 'MITIGATING', 'CLOSED', 'REALISED'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {showForm && tax && (
        <section className="rounded-2xl border border-saffron-400/30 bg-saffron-400/5 p-5 space-y-4">
          <h2 className="text-saffron-300 text-xs uppercase tracking-widest font-black">New risk</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Title *</label>
              <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm"
                placeholder="e.g. Fire-safety capacity at Wembley branch" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Category</label>
              <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm">
                {tax.categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Scope</label>
              <select value={draft.scope} onChange={e => setDraft(d => ({ ...d, scope: e.target.value as Scope }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm">
                {tax.scopes.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Treatment (4Ts)</label>
              <select value={draft.treatment} onChange={e => setDraft(d => ({ ...d, treatment: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm">
                {tax.treatments.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Likelihood (1-5)</label>
              <input type="range" min={1} max={5} value={draft.likelihood}
                onChange={e => setDraft(d => ({ ...d, likelihood: parseInt(e.target.value) }))}
                className="w-full accent-saffron-400" />
              <p className="text-white/50 text-xs">{draft.likelihood} — {
                ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'][draft.likelihood - 1]
              }</p>
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Impact (1-5)</label>
              <input type="range" min={1} max={5} value={draft.impact}
                onChange={e => setDraft(d => ({ ...d, impact: parseInt(e.target.value) }))}
                className="w-full accent-saffron-400" />
              <p className="text-white/50 text-xs">{draft.impact} — {
                ['Insignificant', 'Minor', 'Moderate', 'Major', 'Severe'][draft.impact - 1]
              }</p>
            </div>
            <div className="md:col-span-2 flex items-center gap-3 flex-wrap">
              <span className="text-white/60 text-sm">Score:</span>
              <span className="px-3 py-1 rounded-full text-sm font-black"
                style={{ backgroundColor: draftLevel?.colour_hex || '#888', color: '#fff' }}>
                {score} · {draftLevel?.label || '—'}
              </span>
            </div>
            <div className="md:col-span-2">
              <label className="block text-white/50 text-xs font-bold mb-1">Description</label>
              <textarea rows={3} value={draft.description}
                onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm resize-none"
                placeholder="What could go wrong, who is affected, and why it matters now." />
            </div>
            <div className="md:col-span-2">
              <label className="block text-white/50 text-xs font-bold mb-1">Mitigation plan</label>
              <textarea rows={3} value={draft.mitigation_plan}
                onChange={e => setDraft(d => ({ ...d, mitigation_plan: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm resize-none"
                placeholder="The controls in place or planned, plus the owner responsible." />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Review date</label>
              <input type="date" value={draft.review_date}
                onChange={e => setDraft(d => ({ ...d, review_date: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !draft.title.trim()}
              className="px-4 py-2.5 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron disabled:opacity-40">
              {saving ? 'Saving…' : 'Create risk'}
            </button>
            <button onClick={() => { setDraft(emptyDraft); setShowForm(false) }}
              className="px-4 py-2.5 rounded-xl border border-white/15 text-white/70 text-sm font-bold hover:bg-white/5">
              Cancel
            </button>
          </div>
        </section>
      )}

      <section>
        {loading ? (
          <p className="text-white/50 text-sm">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-white/50 text-sm italic">No risks in this filter.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-white/60 text-xs uppercase tracking-widest">
                <tr>
                  <th className="px-3 py-2 text-left">Ref</th>
                  <th className="px-3 py-2 text-left">Title</th>
                  <th className="px-3 py-2 text-left">Scope</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-left">Score · Level</th>
                  <th className="px-3 py-2 text-left">Treatment</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Source</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const level = tax ? levelFor(r.score, tax.levels) : undefined
                  return (
                    <tr key={r.id} className="border-t border-white/5 hover:bg-white/3">
                      <td className="px-3 py-2 font-mono text-xs text-saffron-300">{r.risk_ref}</td>
                      <td className="px-3 py-2">
                        <div className="font-bold text-white">{r.title}</div>
                        {r.description && <div className="text-white/50 text-xs mt-0.5 line-clamp-2">{r.description}</div>}
                      </td>
                      <td className="px-3 py-2 text-white/70">{r.scope}</td>
                      <td className="px-3 py-2 text-white/70">{r.category.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-2">
                        <span className="px-2 py-0.5 rounded-full text-xs font-black"
                          style={{ backgroundColor: level?.colour_hex || '#888', color: '#fff' }}>
                          {r.score} · {level?.label || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-white/70">{r.treatment}</td>
                      <td className="px-3 py-2 text-white/70">{r.status}</td>
                      <td className="px-3 py-2 text-white/50 text-xs">
                        {r.source_type}{r.source_id ? ` · ${r.source_id.slice(0, 8)}` : ''}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.status !== 'CLOSED' && (
                          <button onClick={() => closeRisk(r.id)}
                            className="text-red-400/70 hover:text-red-300 text-xs">Close</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
