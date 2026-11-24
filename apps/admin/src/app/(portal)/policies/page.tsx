'use client'
// Policy register — Charity Governance Code principle 7.
// Lists every policy with its current version + next review date,
// colour-coded by distance to review. Admins create / edit / archive
// and bump new versions here.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { apiFetch } from '@/lib/api'

type PolicyStatus = 'DRAFT' | 'ACTIVE' | 'UNDER_REVIEW' | 'ARCHIVED'

interface Policy {
  id: string
  title: string
  category: string
  summary: string
  current_version: number
  owner_name: string
  review_period_months: number
  adopted_at: string | null
  next_review_date: string | null
  status: PolicyStatus
  updated_at: string
}

const CATEGORY_LABEL: Record<string, string> = {
  SAFEGUARDING: 'Safeguarding',
  FINANCE: 'Finance',
  HR: 'HR',
  GOVERNANCE: 'Governance',
  DATA_PROTECTION: 'Data Protection',
  EQUALITY: 'Equality, Diversity & Inclusion',
  RESERVES: 'Reserves',
  WHISTLEBLOWING: 'Whistleblowing',
  HEALTH_SAFETY: 'Health & Safety',
  ENVIRONMENT: 'Environment',
  COMPLAINTS: 'Complaints',
  FUNDRAISING: 'Fundraising',
  INVESTMENT: 'Investment',
  OTHER: 'Other',
}

function daysTo(dateStr: string | null): number | null {
  if (!dateStr) return null
  const ms = new Date(dateStr).getTime() - Date.now()
  return Math.round(ms / 864e5)
}

export default function PoliciesPage() {
  const [rows, setRows] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Policy | null>(null)
  const [draft, setDraft] = useState({
    title: '', category: 'GOVERNANCE', summary: '', owner_name: '',
    review_period_months: 12, adopted_at: '', status: 'DRAFT' as PolicyStatus,
  })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await apiFetch<{ policies: Policy[] }>('/admin/policies')
      setRows(r.policies || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function save() {
    if (!draft.title.trim()) { setError('Title is required'); return }
    try {
      if (editing) {
        await apiFetch(`/admin/policies/${editing.id}`, {
          method: 'PUT', body: JSON.stringify({
            ...draft,
            adopted_at: draft.adopted_at || null,
          }),
        })
      } else {
        await apiFetch('/admin/policies', {
          method: 'POST', body: JSON.stringify({
            ...draft,
            adopted_at: draft.adopted_at || null,
          }),
        })
      }
      setShowForm(false); setEditing(null)
      setDraft({ title: '', category: 'GOVERNANCE', summary: '', owner_name: '',
        review_period_months: 12, adopted_at: '', status: 'DRAFT' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function archive(p: Policy) {
    if (!confirm(`Archive "${p.title}"? Its version history stays searchable.`)) return
    try {
      await apiFetch(`/admin/policies/${p.id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function bumpVersion(p: Policy) {
    const notes = window.prompt(`New version ${p.current_version + 1} — summary of changes`, '')
    if (!notes) return
    try {
      await apiFetch(`/admin/policies/${p.id}/new-version`, {
        method: 'POST', body: JSON.stringify({ summary_of_changes: notes }),
      })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  function openEdit(p: Policy) {
    setEditing(p)
    setDraft({
      title: p.title, category: p.category, summary: p.summary,
      owner_name: p.owner_name, review_period_months: p.review_period_months,
      adopted_at: p.adopted_at ? p.adopted_at.slice(0, 10) : '',
      status: p.status,
    })
    setShowForm(true)
  }

  const grouped = useMemo(() => {
    const m: Record<string, Policy[]> = {}
    rows.forEach(p => {
      if (!m[p.category]) m[p.category] = []
      m[p.category].push(p)
    })
    return m
  }, [rows])

  const dueSoon = rows.filter(p => {
    const d = daysTo(p.next_review_date)
    return p.status !== 'ARCHIVED' && d !== null && d <= 60
  }).length

  return (
    <div className="p-6 space-y-6 text-white max-w-[1400px] mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black">Policy Register</h1>
          <p className="text-white/50 text-sm mt-0.5">Charity Governance Code principle 7 — adopt, review, retire.</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true) }}
          className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
          + New policy
        </button>
      </header>

      {error && (
        <div className="bg-red-500/15 border border-red-500/40 text-red-200 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}

      {dueSoon > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200 text-sm">
          ⚠ {dueSoon} polic{dueSoon === 1 ? 'y is' : 'ies are'} due for review within 60 days.
        </div>
      )}

      {showForm && (
        <section className="rounded-2xl border border-saffron-400/30 bg-saffron-400/5 p-5 space-y-4">
          <h2 className="text-saffron-300 text-xs uppercase tracking-widest font-black">{editing ? 'Edit policy' : 'New policy'}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Title *</label>
              <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm"
                placeholder="e.g. Safeguarding Policy" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Category</label>
              <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm">
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Owner</label>
              <input value={draft.owner_name} onChange={e => setDraft(d => ({ ...d, owner_name: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm"
                placeholder="Trustee / officer responsible" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Review period (months)</label>
              <input type="number" min={1} max={60} value={draft.review_period_months}
                onChange={e => setDraft(d => ({ ...d, review_period_months: parseInt(e.target.value) || 12 }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Adopted on</label>
              <input type="date" value={draft.adopted_at}
                onChange={e => setDraft(d => ({ ...d, adopted_at: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Status</label>
              <select value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value as PolicyStatus }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm">
                {(['DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'ARCHIVED'] as PolicyStatus[]).map(s =>
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-white/50 text-xs font-bold mb-1">Summary</label>
              <textarea rows={3} value={draft.summary}
                onChange={e => setDraft(d => ({ ...d, summary: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm resize-none"
                placeholder="Who it applies to, what it governs, where the full text lives." />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={save}
              className="px-4 py-2.5 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
              {editing ? 'Save changes' : 'Create policy'}
            </button>
            <button onClick={() => { setShowForm(false); setEditing(null) }}
              className="px-4 py-2.5 rounded-xl border border-white/15 text-white/70 text-sm font-bold hover:bg-white/5">
              Cancel
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <p className="text-white/50 text-sm">Loading…</p>
      ) : (
        <div className="space-y-6">
          {Object.keys(grouped).sort().map(cat => (
            <section key={cat}>
              <h2 className="text-white/60 text-xs uppercase tracking-widest font-black mb-2">
                {CATEGORY_LABEL[cat] || cat.replace(/_/g, ' ')}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {grouped[cat].map(p => {
                  const d = daysTo(p.next_review_date)
                  const dueColour =
                    p.status === 'ARCHIVED' ? 'border-white/10 bg-white/3'
                    : d === null ? 'border-white/10 bg-white/3'
                    : d < 0 ? 'border-red-500/40 bg-red-500/10'
                    : d <= 30 ? 'border-amber-500/40 bg-amber-500/10'
                    : d <= 90 ? 'border-sky-500/30 bg-sky-500/5'
                    : 'border-emerald-500/30 bg-emerald-500/5'
                  return (
                    <div key={p.id} className={'rounded-xl border p-3 ' + dueColour}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div>
                          <p className="text-white font-bold text-sm">{p.title}</p>
                          <p className="text-white/40 text-[10px] uppercase tracking-widest">
                            v{p.current_version} · {p.status.replace(/_/g, ' ')}
                            {p.owner_name && ' · ' + p.owner_name}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(p)} className="text-white/60 hover:text-white text-xs">✎</button>
                          <button onClick={() => bumpVersion(p)} className="text-saffron-300 text-xs" title="New version">+v</button>
                          <button onClick={() => archive(p)} className="text-red-400/60 hover:text-red-400 text-xs">✕</button>
                        </div>
                      </div>
                      {p.summary && <p className="text-white/60 text-xs line-clamp-2">{p.summary}</p>}
                      <p className="text-white/50 text-xs mt-1.5">
                        {p.next_review_date
                          ? <>Next review: <b>{new Date(p.next_review_date).toLocaleDateString()}</b> {d !== null && (d < 0 ? ` (overdue by ${-d}d)` : ` (${d}d)`)}</>
                          : <span className="italic">No review date set</span>}
                      </p>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
