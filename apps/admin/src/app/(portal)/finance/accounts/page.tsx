'use client'
import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface FinanceAccount {
  id: string
  name: string
  account_type: string
  branch_id: string
  currency: string
  external_ref: string
  opening_balance: number
  notes: string
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

interface Form {
  name: string
  account_type: string
  branch_id: string
  currency: string
  external_ref: string
  opening_balance: number
  notes: string
  is_active: boolean
  sort_order: number
}

const EMPTY: Form = {
  name: '', account_type: 'BANK', branch_id: '', currency: 'GBP',
  external_ref: '', opening_balance: 0, notes: '',
  is_active: true, sort_order: 100,
}

const TYPE_BADGE: Record<string, string> = {
  BANK:   'bg-blue-500/20 text-blue-300 border-blue-500/30',
  STRIPE: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  SUMUP:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  PAYPAL: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  SAFE:   'bg-amber-500/20 text-amber-300 border-amber-500/30',
  HUNDI:  'bg-rose-500/20 text-rose-300 border-rose-500/30',
  CASH:   'bg-lime-500/20 text-lime-300 border-lime-500/30',
  OTHER:  'bg-white/10 text-white/60 border-white/20',
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1'

export default function AccountsPage() {
  const [items, setItems] = useState<FinanceAccount[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)

  const [editing, setEditing] = useState<FinanceAccount | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [customType, setCustomType] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams()
      if (typeFilter) qs.set('account_type', typeFilter)
      if (search.trim()) qs.set('search', search.trim())
      if (includeInactive) qs.set('include_inactive', 'true')
      const [a, t] = await Promise.all([
        apiFetch<{ items: FinanceAccount[] }>(`/admin/finance/accounts?${qs}`),
        apiFetch<{ items: string[] }>(`/admin/finance/accounts/types`),
      ])
      setItems(a.items || [])
      setTypes(t.items || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }, [typeFilter, search, includeInactive])

  useEffect(() => { load() }, [load])

  function openNew() {
    setEditing(null); setForm(EMPTY); setCustomType(''); setShowForm(true); setError('')
  }
  function openEdit(a: FinanceAccount) {
    setEditing(a)
    setForm({
      name: a.name, account_type: a.account_type, branch_id: a.branch_id,
      currency: a.currency, external_ref: a.external_ref,
      opening_balance: a.opening_balance, notes: a.notes,
      is_active: a.is_active, sort_order: a.sort_order,
    })
    setCustomType('')
    setShowForm(true); setError('')
  }

  async function save() {
    if (!form.name.trim()) { setError('Name is required'); return }
    const body: Form = { ...form, account_type: (customType.trim() || form.account_type).toUpperCase() }
    setSaving(true); setError('')
    try {
      if (editing) {
        await apiFetch(`/admin/finance/accounts/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
      } else {
        await apiFetch(`/admin/finance/accounts`, { method: 'POST', body: JSON.stringify(body) })
      }
      setShowForm(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  async function remove(a: FinanceAccount) {
    if (!confirm(`Delete account "${a.name}"? Transactions stay but their account column goes to "—". Reversible by restoring from DB.`)) return
    try {
      await apiFetch(`/admin/finance/accounts/${a.id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Finance Accounts</h1>
          <p className="text-white/40 mt-1">
            Every money container the charity tracks — bank accounts, Stripe, SumUp, PayPal, Temple Safe, Hundi boxes, cash tills, anything else. Types are editable — add new ones below.
          </p>
        </div>
        <button onClick={openNew}
          className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90">
          + New Account
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
          <button onClick={() => setTypeFilter('')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
              typeFilter === '' ? 'bg-saffron-gradient text-white' : 'text-white/40 hover:text-white/70'
            }`}>All types</button>
          {types.map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
                typeFilter === t ? 'bg-saffron-gradient text-white' : 'text-white/40 hover:text-white/70'
              }`}>{t}</button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name / external ref"
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-saffron-400/50 min-w-[260px]" />
        <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
          <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)}
            className="w-4 h-4 rounded accent-saffron-400" />
          Show inactive
        </label>
      </div>

      {/* Table */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 border-b border-white/10">
              <tr className="text-white/60 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-semibold">Name</th>
                <th className="px-4 py-3 text-left font-semibold">Type</th>
                <th className="px-4 py-3 text-left font-semibold">Branch</th>
                <th className="px-4 py-3 text-left font-semibold">External ref</th>
                <th className="px-4 py-3 text-right font-semibold">Opening</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Order</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-4 py-12 text-center text-white/40">Loading…</td></tr>}
              {!loading && items.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-white/40">
                  No accounts yet. Click + New Account to add your first bank / Hundi / Safe.
                </td></tr>
              )}
              {items.map(a => (
                <tr key={a.id} onClick={() => openEdit(a)}
                  className={`border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors ${!a.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 text-white font-semibold">
                    {a.name}
                    {a.notes && <div className="text-xs text-white/40 font-normal mt-0.5 truncate max-w-[280px]" title={a.notes}>{a.notes}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${TYPE_BADGE[a.account_type] || TYPE_BADGE.OTHER}`}>
                      {a.account_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/60 text-xs">{a.branch_id || <em className="text-white/30">all</em>}</td>
                  <td className="px-4 py-3 text-white/60 text-xs font-mono">{a.external_ref || '—'}</td>
                  <td className="px-4 py-3 text-white/80 text-right font-mono text-xs">
                    {new Intl.NumberFormat('en-GB', { style: 'currency', currency: a.currency || 'GBP' }).format(a.opening_balance)}
                  </td>
                  <td className="px-4 py-3">
                    {a.is_active
                      ? <span className="text-green-400 text-xs font-bold">● Active</span>
                      : <span className="text-white/40 text-xs">● Inactive</span>}
                  </td>
                  <td className="px-4 py-3 text-white/50 text-right text-xs">{a.sort_order}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={e => { e.stopPropagation(); remove(a) }}
                      className="text-red-400/60 hover:text-red-400 text-xs px-2 py-1">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Form slide-over */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-xl bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editing ? 'Edit account' : 'New account'}</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl p-1">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div>
                  <label className={lbl}>Name *</label>
                  <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inp}
                    placeholder="e.g. NatWest Current · Hundi — Wembley · Temple Safe — Harrow" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Type</label>
                    <select value={form.account_type} onChange={e => setForm(p => ({ ...p, account_type: e.target.value }))} className={inp}>
                      {types.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>…or add new type</label>
                    <input value={customType} onChange={e => setCustomType(e.target.value)} className={inp}
                      placeholder="e.g. CRYPTO, ISA" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Branch (code or empty)</label>
                    <input value={form.branch_id} onChange={e => setForm(p => ({ ...p, branch_id: e.target.value }))} className={inp}
                      placeholder="wembley · harrow · main · empty = all" />
                  </div>
                  <div>
                    <label className={lbl}>Currency</label>
                    <input value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value.toUpperCase().slice(0, 3) }))} className={inp}
                      placeholder="GBP" maxLength={3} />
                  </div>
                </div>
                <div>
                  <label className={lbl}>External ref</label>
                  <input value={form.external_ref} onChange={e => setForm(p => ({ ...p, external_ref: e.target.value }))} className={inp}
                    placeholder="IBAN / sort code / Stripe acct id / reader serial" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Opening balance</label>
                    <input type="number" step="0.01" value={form.opening_balance}
                      onChange={e => setForm(p => ({ ...p, opening_balance: Number(e.target.value) || 0 }))} className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Sort order</label>
                    <input type="number" value={form.sort_order}
                      onChange={e => setForm(p => ({ ...p, sort_order: Number(e.target.value) || 0 }))} className={inp} />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Notes</label>
                  <textarea rows={3} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                    className={inp + ' resize-none'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                    className="w-4 h-4 rounded accent-saffron-400" />
                  Active
                </label>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={save} disabled={saving}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Account'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
