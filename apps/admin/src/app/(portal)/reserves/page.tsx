'use client'
// Reserves policy + monthly snapshots. CC19.
// Shows a big "months of cover" tile (coloured by policy triggers),
// the policy settings, and a history list. Admin can record a new
// snapshot or edit the policy.

import { useCallback, useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'

interface ReservesPolicy {
  id: string
  target_months: number
  target_amount_gbp: number | null
  free_reserves_definition: string
  trigger_action_below_months: number
  review_period_months: number
  notes: string
  last_reviewed_at: string | null
  next_review_date: string | null
}
interface Snapshot {
  id: string
  as_of_date: string
  unrestricted_balance: number
  restricted_balance: number
  endowment_balance: number
  free_reserves: number
  monthly_run_cost: number
  months_of_cover: number
  triggers_fired: string[]
  note: string
  created_at: string
}

function fmtGbp(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)
}

export default function ReservesPage() {
  const [policy, setPolicy] = useState<ReservesPolicy | null>(null)
  const [snaps, setSnaps] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [policyForm, setPolicyForm] = useState<ReservesPolicy | null>(null)
  const [showPolicyEdit, setShowPolicyEdit] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({
    as_of_date: new Date().toISOString().slice(0, 10),
    unrestricted_balance: 0,
    restricted_balance: 0,
    endowment_balance: 0,
    monthly_run_cost: 0,
    free_reserves: '' as string | number,
    note: '',
  })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [p, s] = await Promise.all([
        apiFetch<{ policy: ReservesPolicy | null }>('/admin/reserves/policy'),
        apiFetch<{ snapshots: Snapshot[] }>('/admin/reserves/snapshots'),
      ])
      setPolicy(p.policy)
      setSnaps(s.snapshots || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function savePolicy() {
    if (!policyForm) return
    try {
      await apiFetch('/admin/reserves/policy', {
        method: 'PUT',
        body: JSON.stringify({
          target_months: Number(policyForm.target_months),
          target_amount_gbp: policyForm.target_amount_gbp ? Number(policyForm.target_amount_gbp) : null,
          free_reserves_definition: policyForm.free_reserves_definition,
          trigger_action_below_months: Number(policyForm.trigger_action_below_months),
          review_period_months: Number(policyForm.review_period_months),
          notes: policyForm.notes,
          last_reviewed_at: policyForm.last_reviewed_at || null,
        }),
      })
      setShowPolicyEdit(false)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function addSnapshot() {
    try {
      await apiFetch('/admin/reserves/snapshots', {
        method: 'POST',
        body: JSON.stringify({
          as_of_date: draft.as_of_date,
          unrestricted_balance: Number(draft.unrestricted_balance),
          restricted_balance: Number(draft.restricted_balance),
          endowment_balance: Number(draft.endowment_balance),
          monthly_run_cost: Number(draft.monthly_run_cost),
          free_reserves: draft.free_reserves === '' ? null : Number(draft.free_reserves),
          note: draft.note,
        }),
      })
      setAdding(false)
      setDraft({
        as_of_date: new Date().toISOString().slice(0, 10),
        unrestricted_balance: 0, restricted_balance: 0, endowment_balance: 0,
        monthly_run_cost: 0, free_reserves: '', note: '',
      })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function removeSnap(id: string) {
    if (!confirm('Delete this snapshot?')) return
    try {
      await apiFetch(`/admin/reserves/snapshots/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  const latest = snaps[0]
  const level =
    !latest || !policy ? 'unknown'
    : latest.months_of_cover < policy.trigger_action_below_months ? 'CRITICAL'
    : latest.months_of_cover < policy.target_months ? 'BELOW_TARGET'
    : 'ON_TARGET'

  return (
    <div className="p-6 space-y-6 text-white max-w-[1400px] mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black">Reserves</h1>
          <p className="text-white/50 text-sm mt-0.5">CC19 — trustees set a policy, trustees prove the actual reserves meet it.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setPolicyForm(policy); setShowPolicyEdit(true) }}
            className="px-4 py-2 rounded-xl border border-white/15 text-white/80 text-sm font-bold hover:bg-white/5">
            Edit policy
          </button>
          <button onClick={() => setAdding(s => !s)}
            className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
            {adding ? 'Cancel' : '+ Record snapshot'}
          </button>
        </div>
      </header>

      {error && <div className="bg-red-500/15 border border-red-500/40 text-red-200 px-4 py-3 rounded-xl text-sm">{error}</div>}
      {loading && <p className="text-white/50 text-sm">Loading…</p>}

      {/* Key tile + policy summary */}
      {policy && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={
            'rounded-2xl p-5 border ' +
            (level === 'CRITICAL' ? 'border-red-500/40 bg-red-500/10'
              : level === 'BELOW_TARGET' ? 'border-amber-500/40 bg-amber-500/10'
              : level === 'ON_TARGET' ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-white/10 bg-white/3')
          }>
            <p className="text-white/50 text-xs uppercase tracking-widest font-black">Months of cover</p>
            <p className="text-4xl font-black mt-1">{latest ? Number(latest.months_of_cover).toFixed(1) : '—'}</p>
            <p className="text-white/50 text-xs mt-1">
              Policy target <b>{Number(policy.target_months).toFixed(1)}</b> ·
              trigger below <b>{Number(policy.trigger_action_below_months).toFixed(1)}</b>
            </p>
            {latest && latest.triggers_fired.length > 0 && (
              <p className="text-amber-200 text-xs mt-2 font-bold">
                ⚠ {latest.triggers_fired.join(', ').replace(/_/g, ' ')}
              </p>
            )}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
            <p className="text-white/50 text-xs uppercase tracking-widest font-black">Policy</p>
            <p className="text-white text-sm mt-2 whitespace-pre-wrap">{policy.free_reserves_definition}</p>
            {policy.next_review_date && (
              <p className="text-white/50 text-xs mt-2">Next review: {new Date(policy.next_review_date).toLocaleDateString()}</p>
            )}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
            <p className="text-white/50 text-xs uppercase tracking-widest font-black">Latest balances</p>
            {latest ? (
              <ul className="text-white/80 text-sm mt-2 space-y-1">
                <li>Free: <b>{fmtGbp(Number(latest.free_reserves))}</b></li>
                <li>Unrestricted: {fmtGbp(Number(latest.unrestricted_balance))}</li>
                <li>Restricted: {fmtGbp(Number(latest.restricted_balance))}</li>
                <li>Endowment: {fmtGbp(Number(latest.endowment_balance))}</li>
                <li>Monthly run cost: {fmtGbp(Number(latest.monthly_run_cost))}</li>
                <li className="text-white/50 text-xs">As of {new Date(latest.as_of_date).toLocaleDateString()}</li>
              </ul>
            ) : (
              <p className="text-white/40 text-xs italic mt-2">No snapshots yet — add one to start the trend.</p>
            )}
          </div>
        </section>
      )}

      {/* New snapshot form */}
      {adding && (
        <section className="rounded-2xl border border-saffron-400/30 bg-saffron-400/5 p-5 space-y-3">
          <h2 className="text-saffron-300 text-xs uppercase tracking-widest font-black">New snapshot</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">As of</label>
              <input type="date" value={draft.as_of_date} onChange={e => setDraft(d => ({ ...d, as_of_date: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Monthly run cost (£)</label>
              <input type="number" value={draft.monthly_run_cost}
                onChange={e => setDraft(d => ({ ...d, monthly_run_cost: Number(e.target.value) }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Free reserves (£, optional override)</label>
              <input type="number" value={draft.free_reserves}
                onChange={e => setDraft(d => ({ ...d, free_reserves: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm"
                placeholder="Leave blank → uses unrestricted balance" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Unrestricted balance (£)</label>
              <input type="number" value={draft.unrestricted_balance}
                onChange={e => setDraft(d => ({ ...d, unrestricted_balance: Number(e.target.value) }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Restricted balance (£)</label>
              <input type="number" value={draft.restricted_balance}
                onChange={e => setDraft(d => ({ ...d, restricted_balance: Number(e.target.value) }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Endowment balance (£)</label>
              <input type="number" value={draft.endowment_balance}
                onChange={e => setDraft(d => ({ ...d, endowment_balance: Number(e.target.value) }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-3">
              <label className="block text-white/50 text-xs font-bold mb-1">Note</label>
              <input value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm"
                placeholder="Optional comment (e.g. closing month with large restricted grant)" />
            </div>
          </div>
          <button onClick={addSnapshot}
            className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
            Save snapshot
          </button>
        </section>
      )}

      {/* Policy edit */}
      {showPolicyEdit && policyForm && (
        <section className="rounded-2xl border border-sky-400/30 bg-sky-400/5 p-5 space-y-3">
          <h2 className="text-sky-300 text-xs uppercase tracking-widest font-black">Policy</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Target months of cover</label>
              <input type="number" step="0.1" value={policyForm.target_months}
                onChange={e => setPolicyForm(p => p && ({ ...p, target_months: Number(e.target.value) }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Trigger action below</label>
              <input type="number" step="0.1" value={policyForm.trigger_action_below_months}
                onChange={e => setPolicyForm(p => p && ({ ...p, trigger_action_below_months: Number(e.target.value) }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Target amount £ (optional)</label>
              <input type="number" value={policyForm.target_amount_gbp ?? ''}
                onChange={e => setPolicyForm(p => p && ({ ...p, target_amount_gbp: e.target.value ? Number(e.target.value) : null }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-3">
              <label className="block text-white/50 text-xs font-bold mb-1">Free reserves definition</label>
              <textarea rows={2} value={policyForm.free_reserves_definition}
                onChange={e => setPolicyForm(p => p && ({ ...p, free_reserves_definition: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm resize-none" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Last reviewed on</label>
              <input type="date" value={policyForm.last_reviewed_at?.slice(0, 10) || ''}
                onChange={e => setPolicyForm(p => p && ({ ...p, last_reviewed_at: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Review period (months)</label>
              <input type="number" value={policyForm.review_period_months}
                onChange={e => setPolicyForm(p => p && ({ ...p, review_period_months: Number(e.target.value) }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-3">
              <label className="block text-white/50 text-xs font-bold mb-1">Notes</label>
              <textarea rows={3} value={policyForm.notes}
                onChange={e => setPolicyForm(p => p && ({ ...p, notes: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm resize-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={savePolicy}
              className="px-4 py-2 rounded-xl bg-sky-500 text-white text-sm font-black">Save policy</button>
            <button onClick={() => setShowPolicyEdit(false)}
              className="px-4 py-2 rounded-xl border border-white/15 text-white/70 text-sm font-bold hover:bg-white/5">Cancel</button>
          </div>
        </section>
      )}

      {/* History */}
      <section>
        <h2 className="text-white/60 text-xs uppercase tracking-widest font-black mb-2">History</h2>
        {snaps.length === 0 ? (
          <p className="text-white/40 text-sm italic">No snapshots yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-white/60 text-xs uppercase tracking-widest">
                <tr>
                  <th className="px-3 py-2 text-left">As of</th>
                  <th className="px-3 py-2 text-right">Free reserves</th>
                  <th className="px-3 py-2 text-right">Monthly cost</th>
                  <th className="px-3 py-2 text-right">Months cover</th>
                  <th className="px-3 py-2 text-left">Triggers</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {snaps.map(s => (
                  <tr key={s.id} className="border-t border-white/5">
                    <td className="px-3 py-2">{new Date(s.as_of_date).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-right">{fmtGbp(Number(s.free_reserves))}</td>
                    <td className="px-3 py-2 text-right">{fmtGbp(Number(s.monthly_run_cost))}</td>
                    <td className="px-3 py-2 text-right font-bold">{Number(s.months_of_cover).toFixed(1)}</td>
                    <td className="px-3 py-2 text-amber-300 text-xs">
                      {s.triggers_fired.map(t => t.replace(/_/g, ' ')).join(', ') || '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => removeSnap(s.id)} className="text-red-400/60 hover:text-red-400 text-xs">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
