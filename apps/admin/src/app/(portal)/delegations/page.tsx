'use client'
// Delegations register — Charities Act 2011 §280 + SORP §9.17.
// Every standing authority the board has delegated to an officer /
// trustee / employee, with a limit, a period, and a review date.

import { useCallback, useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'

type Status = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'REVOKED'

interface Delegation {
  id: string
  title: string
  area: string
  delegate_name: string
  delegate_role: string
  scope_description: string
  limit_amount_gbp: number | null
  limit_period: string
  conditions: string
  start_date: string | null
  end_date: string | null
  review_date: string | null
  status: Status
  source_resolution_id: string | null
  revoked_at: string | null
  revoked_reason: string
}

const AREAS = ['FINANCE', 'HR', 'PROPERTY', 'MARKETING', 'OPERATIONS', 'SAFEGUARDING', 'GOVERNANCE', 'OTHER']
const PERIODS = ['PER_TRANSACTION', 'MONTH', 'QUARTER', 'YEAR', 'PROJECT', 'NONE']

function daysTo(d: string | null): number | null {
  if (!d) return null
  return Math.round((new Date(d).getTime() - Date.now()) / 864e5)
}

export default function DelegationsPage() {
  const [rows, setRows] = useState<Delegation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterArea, setFilterArea] = useState('')
  const [filterStatus, setFilterStatus] = useState<Status | ''>('ACTIVE')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Delegation | null>(null)
  const [draft, setDraft] = useState({
    title: '', area: 'FINANCE', delegate_name: '', delegate_role: '',
    scope_description: '', limit_amount_gbp: '' as string | number,
    limit_period: 'YEAR', conditions: '',
    start_date: '', end_date: '', review_date: '',
    status: 'ACTIVE' as Status,
  })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const q = new URLSearchParams()
      if (filterArea)   q.set('area', filterArea)
      if (filterStatus) q.set('status', filterStatus)
      const r = await apiFetch<{ delegations: Delegation[] }>(
        `/admin/board/delegations${q.toString() ? '?' + q.toString() : ''}`,
      )
      setRows(r.delegations || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filterArea, filterStatus])
  useEffect(() => { void load() }, [load])

  async function save() {
    if (!draft.title.trim()) { setError('Title is required'); return }
    const body = {
      ...draft,
      limit_amount_gbp: draft.limit_amount_gbp === '' ? null : Number(draft.limit_amount_gbp),
      start_date: draft.start_date || null,
      end_date:   draft.end_date   || null,
      review_date: draft.review_date || null,
    }
    try {
      if (editing) {
        await apiFetch(`/admin/board/delegations/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
      } else {
        await apiFetch('/admin/board/delegations', { method: 'POST', body: JSON.stringify(body) })
      }
      setShowForm(false); setEditing(null)
      setDraft({
        title: '', area: 'FINANCE', delegate_name: '', delegate_role: '',
        scope_description: '', limit_amount_gbp: '',
        limit_period: 'YEAR', conditions: '',
        start_date: '', end_date: '', review_date: '',
        status: 'ACTIVE',
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function revoke(d: Delegation) {
    const reason = window.prompt('Reason for revocation', '')
    if (!reason) return
    try {
      await apiFetch(`/admin/board/delegations/${d.id}/revoke`, {
        method: 'POST', body: JSON.stringify({ reason }),
      })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  function openEdit(d: Delegation) {
    setEditing(d)
    setDraft({
      title: d.title, area: d.area,
      delegate_name: d.delegate_name, delegate_role: d.delegate_role,
      scope_description: d.scope_description,
      limit_amount_gbp: d.limit_amount_gbp ?? '',
      limit_period: d.limit_period, conditions: d.conditions,
      start_date: d.start_date?.slice(0, 10) || '',
      end_date:   d.end_date?.slice(0, 10) || '',
      review_date: d.review_date?.slice(0, 10) || '',
      status: d.status,
    })
    setShowForm(true)
  }

  const expiringCount = rows.filter(r => {
    if (r.status !== 'ACTIVE') return false
    const dr = daysTo(r.review_date)
    const de = daysTo(r.end_date)
    return (dr !== null && dr <= 60) || (de !== null && de <= 60)
  }).length

  return (
    <div className="p-6 space-y-6 text-white max-w-[1400px] mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black">Delegations register</h1>
          <p className="text-white/50 text-sm mt-0.5">Charities Act 2011 §280 · SORP §9.17. Every standing authority the board has delegated.</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true) }}
          className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
          + New delegation
        </button>
      </header>

      {error && <div className="bg-red-500/15 border border-red-500/40 text-red-200 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {expiringCount > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200 text-sm">
          ⚠ {expiringCount} delegation{expiringCount === 1 ? '' : 's'} expir{expiringCount === 1 ? 'es' : 'e'} within 60 days.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-white/50 text-xs">Area:</label>
        <select value={filterArea} onChange={e => setFilterArea(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All</option>
          {AREAS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
        </select>
        <label className="text-white/50 text-xs">Status:</label>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as Status | '')}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All</option>
          {(['DRAFT', 'ACTIVE', 'EXPIRED', 'REVOKED'] as Status[]).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {showForm && (
        <section className="rounded-2xl border border-saffron-400/30 bg-saffron-400/5 p-5 space-y-4">
          <h2 className="text-saffron-300 text-xs uppercase tracking-widest font-black">{editing ? 'Edit' : 'New'} delegation</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Title *</label>
              <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                placeholder="e.g. Treasurer may pay invoices up to £10,000"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Area</label>
              <select value={draft.area} onChange={e => setDraft(d => ({ ...d, area: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm">
                {AREAS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Delegate name</label>
              <input value={draft.delegate_name} onChange={e => setDraft(d => ({ ...d, delegate_name: e.target.value }))}
                placeholder="Specific person (optional)"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Delegate role</label>
              <input value={draft.delegate_role} onChange={e => setDraft(d => ({ ...d, delegate_role: e.target.value }))}
                placeholder="e.g. TREASURER (goes to whoever holds the role)"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-white/50 text-xs font-bold mb-1">Scope</label>
              <textarea rows={2} value={draft.scope_description}
                onChange={e => setDraft(d => ({ ...d, scope_description: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm resize-none"
                placeholder="What the delegate may do under this authority." />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Limit (£)</label>
              <input type="number" value={draft.limit_amount_gbp}
                onChange={e => setDraft(d => ({ ...d, limit_amount_gbp: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Period</label>
              <select value={draft.limit_period} onChange={e => setDraft(d => ({ ...d, limit_period: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm">
                {PERIODS.map(p => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Start date</label>
              <input type="date" value={draft.start_date} onChange={e => setDraft(d => ({ ...d, start_date: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">End date (optional)</label>
              <input type="date" value={draft.end_date} onChange={e => setDraft(d => ({ ...d, end_date: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Review date</label>
              <input type="date" value={draft.review_date} onChange={e => setDraft(d => ({ ...d, review_date: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-white/50 text-xs font-bold mb-1">Conditions</label>
              <textarea rows={2} value={draft.conditions}
                onChange={e => setDraft(d => ({ ...d, conditions: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm resize-none"
                placeholder="Caveats, pre-approval triggers, reporting cadence." />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={save}
              className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
              {editing ? 'Save changes' : 'Create delegation'}
            </button>
            <button onClick={() => { setShowForm(false); setEditing(null) }}
              className="px-4 py-2 rounded-xl border border-white/15 text-white/70 text-sm font-bold hover:bg-white/5">
              Cancel
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <p className="text-white/50 text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-white/50 text-sm italic">No delegations in this filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-xs uppercase tracking-widest">
              <tr>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Area</th>
                <th className="px-3 py-2 text-left">Delegate</th>
                <th className="px-3 py-2 text-right">Limit</th>
                <th className="px-3 py-2 text-left">Review</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const d = daysTo(r.review_date)
                const colour = d === null ? '' : d < 0 ? 'text-red-300' : d <= 60 ? 'text-amber-300' : 'text-white/70'
                return (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="px-3 py-2">
                      <p className="font-bold text-white">{r.title}</p>
                      {r.scope_description && <p className="text-white/50 text-xs mt-0.5 line-clamp-2">{r.scope_description}</p>}
                    </td>
                    <td className="px-3 py-2 text-white/70 text-xs">{r.area.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2 text-white/70 text-xs">
                      {r.delegate_name || r.delegate_role || '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-white/80">
                      {r.limit_amount_gbp != null ? `£${Number(r.limit_amount_gbp).toLocaleString('en-GB')}` : '—'}
                      {r.limit_amount_gbp != null && <span className="text-white/40"> / {r.limit_period.replace(/_/g, ' ').toLowerCase()}</span>}
                    </td>
                    <td className={'px-3 py-2 text-xs ' + colour}>
                      {r.review_date ? new Date(r.review_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={
                        'px-2 py-0.5 rounded-full text-[10px] font-black border ' +
                        (r.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30'
                          : r.status === 'DRAFT' ? 'bg-sky-500/20 text-sky-200 border-sky-400/30'
                          : r.status === 'EXPIRED' ? 'bg-amber-500/20 text-amber-200 border-amber-400/30'
                          : 'bg-red-500/20 text-red-200 border-red-400/30')
                      }>{r.status}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => openEdit(r)} className="text-white/60 hover:text-white text-xs px-1">✎</button>
                      {r.status === 'ACTIVE' && (
                        <button onClick={() => revoke(r)} className="text-red-400/70 hover:text-red-300 text-xs px-1">Revoke</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
