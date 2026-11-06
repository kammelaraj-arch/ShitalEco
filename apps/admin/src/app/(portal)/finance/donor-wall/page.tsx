'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

// Donor Wall admin — Future Legacy Appeal dedications.
// Auto-approve < £101; £101+ lands here for a human to tick Approve or Hide.

type Status = 'PENDING' | 'APPROVED' | 'HIDDEN'
interface Entry {
  id: string
  order_id: string
  tier_key: string
  tier_label: string
  amount: number
  prefix: string
  dedication: string
  status: Status
  display_order: number
  approved_by: string
  approved_at: string
  created_at: string
  updated_at: string
}

const TIERS = [
  { key: 'founder',  label: 'Founder Panel' },
  { key: 'business', label: 'Business Sponsorship' },
  { key: 'gold',     label: 'Gold Brick' },
  { key: 'sqft',     label: 'Square Foot' },
  { key: 'bronze',   label: 'Bronze Brick' },
  { key: 'red',      label: 'Red Brick' },
  { key: 'anyamt',   label: 'Any amount' },
] as const

const PREFIXES = ['', 'In memory of', 'In honour of', 'Dedicated by', 'With gratitude from']

const gbp = (n: number) => '£' + Math.round(n).toLocaleString('en-GB')
const fmtDate = (iso: string) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return iso }
}

const tab = 'px-4 py-2 rounded-xl text-sm font-bold transition-all'
const inp = 'bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-saffron-400/50'

export default function DonorWallAdminPage() {
  const [tab1, setTab1] = useState<Status>('PENDING')
  const [tier, setTier] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [items, setItems] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<{ PENDING: number; APPROVED: number; HIDDEN: number; TOTAL: number }>({
    PENDING: 0, APPROVED: 0, HIDDEN: 0, TOTAL: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Entry | null>(null)
  const [editDedication, setEditDedication] = useState('')
  const [editPrefix, setEditPrefix] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({
        status_filter: tab1,
        limit:         String(pageSize),
        offset:        String(page * pageSize),
      })
      if (tier) qs.set('tier', tier)
      if (search.trim()) qs.set('search', search.trim())
      const [list, cnt] = await Promise.all([
        apiFetch<{ items: Entry[]; total: number }>(`/admin/donor-wall?${qs}`),
        apiFetch<{ PENDING: number; APPROVED: number; HIDDEN: number; TOTAL: number }>('/admin/donor-wall/counts'),
      ])
      setItems(list.items || [])
      setTotal(list.total || 0)
      setCounts(cnt)
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [tab1, tier, search, page, pageSize])

  useEffect(() => { load() }, [load])

  async function act(id: string, action: 'approve' | 'hide' | 'unhide') {
    try {
      await apiFetch(`/admin/donor-wall/${id}/${action}`, { method: 'POST' })
      await load()
    } catch (e: any) {
      setError(e?.message || 'Action failed')
    }
  }

  function openEdit(e: Entry) {
    setEditing(e)
    setEditDedication(e.dedication)
    setEditPrefix(e.prefix)
  }

  async function saveEdit() {
    if (!editing) return
    try {
      await apiFetch(`/admin/donor-wall/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({ dedication: editDedication, prefix: editPrefix }),
      })
      setEditing(null)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white tracking-tight">Donor Wall</h1>
        <p className="text-white/50 text-sm mt-1">
          Future Legacy Appeal dedications. Gifts under £101 auto-approve; larger gifts land here for a glance before going public.
        </p>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 flex-wrap">
        {(['PENDING', 'APPROVED', 'HIDDEN'] as Status[]).map(s => (
          <button key={s} onClick={() => { setTab1(s); setPage(0) }}
            className={`${tab} ${tab1 === s
              ? 'bg-saffron-gradient text-white shadow-saffron'
              : 'bg-white/5 text-white/70 border border-white/10 hover:bg-white/10'}`}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
            <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-black"
              style={{ background: 'rgba(0,0,0,0.3)' }}>
              {counts[s] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Filter row */}
      <div className="glass rounded-2xl p-3 flex flex-wrap gap-3 items-center">
        <select value={tier} onChange={e => { setTier(e.target.value); setPage(0) }} className={inp + ' min-w-[160px]'}>
          <option value="">All tiers</option>
          {TIERS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
          placeholder="🔍 Search dedication or prefix…"
          className={inp + ' flex-1 min-w-[220px]'} />
        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }} className={inp}>
          {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>

      {error && <div className="glass rounded-xl p-3 text-red-300 text-sm border border-red-500/30">{error}</div>}

      <div className="glass rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-white/50 text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-white/50 text-sm">
            No dedications in this bucket.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-white/5 border-b border-white/10 text-white/50 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Tier</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-left">Dedication</th>
                <th className="px-4 py-3 text-left">Received</th>
                <th className="px-4 py-3 text-left">Approved</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(e => (
                <tr key={e.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="font-bold text-white">{e.tier_label}</div>
                    <div className="text-[10px] text-white/40 uppercase tracking-wider">{e.tier_key}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-saffron-300 tabular-nums">{gbp(e.amount)}</td>
                  <td className="px-4 py-3">
                    {e.prefix && <div className="text-xs italic text-white/50">{e.prefix}</div>}
                    <div className="font-semibold text-white">{e.dedication}</div>
                  </td>
                  <td className="px-4 py-3 text-white/60 text-xs">{fmtDate(e.created_at)}</td>
                  <td className="px-4 py-3 text-white/60 text-xs">
                    {e.approved_at ? (
                      <>
                        {fmtDate(e.approved_at)}
                        {e.approved_by && <div className="text-[10px] text-white/40">by {e.approved_by}</div>}
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex gap-1">
                      <button onClick={() => openEdit(e)}
                        className="px-2 py-1 rounded-lg border border-white/10 text-white/70 text-xs font-bold hover:bg-white/10">
                        Edit
                      </button>
                      {e.status === 'PENDING' && (
                        <button onClick={() => act(e.id, 'approve')}
                          className="px-2 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 text-xs font-bold hover:bg-emerald-600/30">
                          ✓ Approve
                        </button>
                      )}
                      {e.status !== 'HIDDEN' && (
                        <button onClick={() => act(e.id, 'hide')}
                          className="px-2 py-1 rounded-lg bg-red-600/20 border border-red-500/40 text-red-200 text-xs font-bold hover:bg-red-600/30">
                          Hide
                        </button>
                      )}
                      {e.status === 'HIDDEN' && (
                        <button onClick={() => act(e.id, 'unhide')}
                          className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/70 text-xs font-bold hover:bg-white/10">
                          Unhide
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {total > 0 && (
        <div className="glass rounded-2xl p-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-white/60">
            {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} of {total.toLocaleString()}
          </span>
          <div className="ml-auto flex gap-1.5">
            <button onClick={() => setPage(0)} disabled={page === 0}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 text-xs font-semibold hover:bg-white/5 disabled:opacity-30">« First</button>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 text-xs font-semibold hover:bg-white/5 disabled:opacity-30">‹ Prev</button>
            <span className="px-3 py-1.5 text-white/60 text-xs">
              Page <b className="text-white">{page + 1}</b> of {Math.max(1, Math.ceil(total / pageSize))}
            </span>
            <button onClick={() => setPage(p => (p + 1) * pageSize < total ? p + 1 : p)} disabled={(page + 1) * pageSize >= total}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 text-xs font-semibold hover:bg-white/5 disabled:opacity-30">Next ›</button>
            <button onClick={() => setPage(Math.max(0, Math.ceil(total / pageSize) - 1))} disabled={(page + 1) * pageSize >= total}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 text-xs font-semibold hover:bg-white/5 disabled:opacity-30">Last »</button>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setEditing(null)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92%] max-w-md bg-temple-deep border border-white/10 rounded-2xl z-50 p-5 space-y-4">
            <h3 className="text-white font-black text-lg">Edit dedication</h3>
            <div>
              <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Prefix</label>
              <select value={editPrefix} onChange={e => setEditPrefix(e.target.value)} className={inp + ' w-full'}>
                {PREFIXES.map(p => <option key={p} value={p}>{p || '— none —'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Dedication</label>
              <input value={editDedication} onChange={e => setEditDedication(e.target.value.slice(0, 200))}
                className={inp + ' w-full'} maxLength={200} />
              <p className="text-[10px] text-white/40 mt-1">
                {editing.tier_label} · {gbp(editing.amount)} · received {fmtDate(editing.created_at)}
              </p>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setEditing(null)}
                className="px-4 py-2 rounded-xl border border-white/10 text-white/70 text-sm font-bold hover:bg-white/5">
                Cancel
              </button>
              <button onClick={saveEdit}
                className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
                Save
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
