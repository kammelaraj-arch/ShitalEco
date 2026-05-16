'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'
import { Pagination } from '@/components/ui/Pagination'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NominalCode {
  id: string
  code: string
  name: string
  description: string
  type: 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY' | 'EQUITY' | string
  category: string
  subcategory: string
  scope: 'BRANCH' | 'HEAD_OFFICE' | 'BOTH' | string
  branch_id: string | null
  fund_type: 'UNRESTRICTED' | 'RESTRICTED' | 'ENDOWMENT' | string
  activity_type: 'CHARITABLE' | 'TRADING' | 'INVESTMENT' | 'GOVERNANCE' | 'SUPPORT' | string
  gift_aid_eligible: boolean
  hmrc_category: string
  vat_code: 'STANDARD' | 'REDUCED' | 'ZERO' | 'EXEMPT' | 'OUT_OF_SCOPE' | 'REVERSE_CHARGE' | string
  vat_rate: number
  xero_account_code: string
  sage_nominal_code: string
  quickbooks_account: string
  parent_code_id: string | null
  sort_order: number
  is_active: boolean
  notes: string
  created_at: string
  updated_at: string
}

interface Branch { branch_id: string; name: string; is_active?: boolean }

const TYPE_BADGE: Record<string, string> = {
  INCOME:    'bg-green-500/15 text-green-300 border-green-500/30',
  EXPENSE:   'bg-amber-500/15 text-amber-300 border-amber-500/30',
  ASSET:     'bg-blue-500/15 text-blue-300 border-blue-500/30',
  LIABILITY: 'bg-red-500/15 text-red-300 border-red-500/30',
  EQUITY:    'bg-purple-500/15 text-purple-300 border-purple-500/30',
}

const FUND_BADGE: Record<string, string> = {
  UNRESTRICTED: 'bg-white/5 text-white/60 border-white/10',
  RESTRICTED:   'bg-amber-500/10 text-amber-300 border-amber-500/25',
  ENDOWMENT:    'bg-purple-500/10 text-purple-300 border-purple-500/25',
}

const VAT_RATES = [
  { code: 'STANDARD',       rate: 20, label: 'Standard 20%' },
  { code: 'REDUCED',        rate: 5,  label: 'Reduced 5%' },
  { code: 'ZERO',           rate: 0,  label: 'Zero rated' },
  { code: 'EXEMPT',         rate: 0,  label: 'Exempt' },
  { code: 'OUT_OF_SCOPE',   rate: 0,  label: 'Out of scope' },
  { code: 'REVERSE_CHARGE', rate: 0,  label: 'Reverse charge' },
]

const EMPTY: Partial<NominalCode> = {
  code: '', name: '', description: '',
  type: 'INCOME', category: '', subcategory: '',
  scope: 'BOTH', branch_id: null,
  fund_type: 'UNRESTRICTED', activity_type: 'CHARITABLE',
  gift_aid_eligible: false, hmrc_category: '',
  vat_code: 'OUT_OF_SCOPE', vat_rate: 0,
  xero_account_code: '', sage_nominal_code: '', quickbooks_account: '',
  sort_order: 100, is_active: true, notes: '',
}

export default function NominalCodesPage() {
  const [items, setItems] = useState<NominalCode[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(50)

  // Filters
  const [typeFilter, setTypeFilter]       = useState('')
  const [scopeFilter, setScopeFilter]     = useState('')
  const [branchFilter, setBranchFilter]   = useState('')
  const [search, setSearch]               = useState('')
  const [showInactive, setShowInactive]   = useState(false)

  const [editing, setEditing] = useState<NominalCode | 'new' | null>(null)

  useEffect(() => {
    apiFetch<{ branches: Branch[] }>('/branches')
      .then(d => setBranches((d.branches || []).filter(b => b.is_active !== false)))
      .catch(() => setBranches([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) })
      if (typeFilter)   qs.set('type',   typeFilter)
      if (scopeFilter)  qs.set('scope',  scopeFilter)
      if (branchFilter) qs.set('branch_id', branchFilter)
      if (search.trim()) qs.set('search', search.trim())
      qs.set('active', showInactive ? 'false' : 'true')
      const d = await apiFetch<{ items: NominalCode[]; total: number }>(`/admin/nominal-codes?${qs}`)
      setItems(d.items || [])
      setTotal(d.total || 0)
    } catch (e: any) {
      setError(e?.message || 'Failed to load nominal codes')
    } finally {
      setLoading(false)
    }
  }, [page, perPage, typeFilter, scopeFilter, branchFilter, search, showInactive])

  useEffect(() => { load() }, [load])

  // Branch-name lookup for the table render.
  const branchName = (code: string | null) => {
    if (!code) return <span className="text-white/40 italic">Head office</span>
    return branches.find(b => b.branch_id === code)?.name || code
  }

  // Stats: count by type, total active
  const stats = useMemo(() => {
    const byType: Record<string, number> = {}
    for (const i of items) byType[i.type] = (byType[i.type] || 0) + 1
    return byType
  }, [items])

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">📚 Nominal Codes (Chart of Accounts)</h1>
          <p className="text-white/40 mt-1">
            UK Charity SORP-aligned chart of accounts. Granular per branch + head office, with
            Gift Aid eligibility, HMRC category, VAT code, and Xero / Sage / QuickBooks mappings.
          </p>
        </div>
        <button onClick={() => setEditing('new')} className="btn-primary">+ New Code</button>
      </div>

      {/* Stats chips */}
      <div className="flex flex-wrap gap-2">
        {(['INCOME', 'EXPENSE', 'ASSET', 'LIABILITY', 'EQUITY'] as const).map(t => (
          <div key={t} className={`px-3 py-1.5 rounded-full text-xs font-bold border ${TYPE_BADGE[t]}`}>
            {t}: {stats[t] || 0}
          </div>
        ))}
        <div className="px-3 py-1.5 rounded-full text-xs font-bold border bg-white/5 text-white/60 border-white/10">
          Total: {total}
        </div>
      </div>

      {/* Filters */}
      <div className="glass rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1) }}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-white text-sm outline-none">
          <option value="">All types</option>
          <option value="INCOME">Income</option>
          <option value="EXPENSE">Expense</option>
          <option value="ASSET">Asset</option>
          <option value="LIABILITY">Liability</option>
          <option value="EQUITY">Equity</option>
        </select>
        <select value={scopeFilter} onChange={e => { setScopeFilter(e.target.value); setPage(1) }}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-white text-sm outline-none">
          <option value="">All scopes</option>
          <option value="BRANCH">Branch</option>
          <option value="HEAD_OFFICE">Head office</option>
          <option value="BOTH">Both</option>
        </select>
        <select value={branchFilter} onChange={e => { setBranchFilter(e.target.value); setPage(1) }}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-white text-sm outline-none">
          <option value="">All branches</option>
          {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && setPage(1)}
          placeholder="Search code, name, description…"
          className="flex-1 min-w-48 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-white text-sm outline-none" />
        <label className="flex items-center gap-2 cursor-pointer text-xs text-white/60">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
            className="w-4 h-4 rounded accent-saffron-400" />
          Show disabled
        </label>
        <button onClick={load} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 text-xs hover:bg-white/10">↻ Refresh</button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Table */}
      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        {loading ? (
          <div className="text-center py-16 text-white/30">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-white/30">No nominal codes match.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr className="text-white/40 text-xs font-bold uppercase tracking-wider">
                  <th className="px-3 py-3 text-left">Code</th>
                  <th className="px-3 py-3 text-left">Name</th>
                  <th className="px-3 py-3 text-left">Type</th>
                  <th className="px-3 py-3 text-left">Category</th>
                  <th className="px-3 py-3 text-left">Branch</th>
                  <th className="px-3 py-3 text-left">Fund</th>
                  <th className="px-3 py-3 text-left">Activity</th>
                  <th className="px-3 py-3 text-left">VAT</th>
                  <th className="px-3 py-3 text-center">GA</th>
                  <th className="px-3 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(c => (
                  <tr key={c.id} className={`border-t border-white/5 hover:bg-white/3 cursor-pointer ${!c.is_active ? 'opacity-40' : ''}`}
                      onClick={() => setEditing(c)}>
                    <td className="px-3 py-2 font-mono text-white font-bold">{c.code}</td>
                    <td className="px-3 py-2 text-white">
                      {c.name}
                      {c.subcategory && <p className="text-white/30 text-xs">{c.subcategory.replace(/_/g, ' ').toLowerCase()}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${TYPE_BADGE[c.type] || 'bg-white/5 text-white/40 border-white/10'}`}>
                        {c.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-white/60 text-xs">{c.category.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2 text-white/70 text-xs">{branchName(c.branch_id)}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${FUND_BADGE[c.fund_type] || 'bg-white/5 text-white/40 border-white/10'}`}>
                        {c.fund_type.charAt(0)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-white/60 text-xs">{c.activity_type.toLowerCase()}</td>
                    <td className="px-3 py-2 text-white/60 text-xs">
                      {c.vat_code === 'OUT_OF_SCOPE' ? '—' : `${c.vat_code} ${c.vat_rate}%`}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {c.gift_aid_eligible && <span className="text-green-400 font-bold text-xs">✓</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button className="text-saffron-300 text-xs font-bold hover:underline">Edit →</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          pageSize={perPage}
          total={total}
          disabled={loading}
          onPageChange={p => setPage(p)}
          onPageSizeChange={pp => { setPerPage(pp); setPage(1) }}
        />
      </div>

      <AnimatePresence>
        {editing && (
          <CodeModal
            code={editing === 'new' ? null : editing}
            branches={branches}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); load() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Edit Modal ──────────────────────────────────────────────────────────────

function CodeModal({ code, branches, onClose, onSaved }: {
  code: NominalCode | null
  branches: Branch[]
  onClose: () => void
  onSaved: () => void
}) {
  const init = code || EMPTY
  const [form, setForm] = useState<Partial<NominalCode>>(init)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  function f<K extends keyof NominalCode>(k: K, v: NominalCode[K]) {
    setForm(p => ({ ...p, [k]: v }))
  }

  // When VAT code changes, autofill the default rate (20/5/0).
  useEffect(() => {
    const rate = VAT_RATES.find(v => v.code === form.vat_code)?.rate
    if (rate !== undefined && rate !== form.vat_rate) {
      setForm(p => ({ ...p, vat_rate: rate }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vat_code])

  async function save() {
    if (!form.name?.trim()) { setError('Name is required'); return }
    if (!code && !form.code?.trim()) { setError('Code is required'); return }
    if (form.scope === 'BRANCH' && !form.branch_id) { setError('Branch is required when scope is Branch'); return }
    setSaving(true); setError('')
    try {
      const payload = { ...form }
      if (code) {
        await apiFetch(`/admin/nominal-codes/${code.id}`, {
          method: 'PUT', body: JSON.stringify(payload),
        })
      } else {
        await apiFetch('/admin/nominal-codes', {
          method: 'POST', body: JSON.stringify(payload),
        })
      }
      onSaved()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-saffron-400/50'
  const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1'

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="fixed inset-0 bg-black/60 z-40" />
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed right-0 top-0 h-full w-full sm:max-w-[560px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-white font-black text-lg">{code ? `Edit ${code.code}` : 'New Nominal Code'}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={lbl}>Code *</label>
              <input value={form.code || ''} onChange={e => f('code', e.target.value.toUpperCase().replace(/\s/g, ''))}
                disabled={!!code} className={`${inp} font-mono ${code ? 'opacity-50' : ''}`} placeholder="4001" />
            </div>
            <div>
              <label className={lbl}>Sort order</label>
              <input type="number" value={form.sort_order ?? 100} onChange={e => f('sort_order', parseInt(e.target.value) || 0)} className={inp} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-white">
                <input type="checkbox" checked={!!form.is_active} onChange={e => f('is_active', e.target.checked)}
                  className="w-4 h-4 rounded accent-saffron-400" />
                Active
              </label>
            </div>
          </div>

          <div>
            <label className={lbl}>Name *</label>
            <input value={form.name || ''} onChange={e => f('name', e.target.value)} className={inp}
              placeholder="Donations — General (Unrestricted)" />
          </div>

          <div>
            <label className={lbl}>Description</label>
            <textarea value={form.description || ''} onChange={e => f('description', e.target.value)}
              rows={2} className={`${inp} resize-none`} placeholder="What this code is for…" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Type *</label>
              <select value={form.type || 'INCOME'} onChange={e => f('type', e.target.value)} className={inp}>
                <option value="INCOME">Income</option>
                <option value="EXPENSE">Expense</option>
                <option value="ASSET">Asset</option>
                <option value="LIABILITY">Liability</option>
                <option value="EQUITY">Equity / Fund</option>
              </select>
            </div>
            <div>
              <label className={lbl}>Scope *</label>
              <select value={form.scope || 'BOTH'} onChange={e => f('scope', e.target.value)} className={inp}>
                <option value="BOTH">Both (branch + HQ)</option>
                <option value="BRANCH">Branch only</option>
                <option value="HEAD_OFFICE">Head office only</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Branch {form.scope === 'BRANCH' ? '*' : '(optional override)'}</label>
              <select value={form.branch_id || ''} onChange={e => f('branch_id', (e.target.value || null) as any)} className={inp}>
                <option value="">Head office (no specific branch)</option>
                {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Parent code (optional)</label>
              <input value={form.parent_code_id || ''} onChange={e => f('parent_code_id', (e.target.value || null) as any)} className={inp}
                placeholder="UUID of parent code" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Category</label>
              <input value={form.category || ''} onChange={e => f('category', e.target.value.toUpperCase().replace(/\s+/g, '_'))} className={inp}
                placeholder="DONATIONS" />
            </div>
            <div>
              <label className={lbl}>Subcategory</label>
              <input value={form.subcategory || ''} onChange={e => f('subcategory', e.target.value.toUpperCase().replace(/\s+/g, '_'))} className={inp}
                placeholder="GENERAL" />
            </div>
          </div>

          {/* SORP fields */}
          <div className="rounded-xl p-3 space-y-3" style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.18)' }}>
            <p className="text-saffron-300 text-xs uppercase font-bold tracking-widest">SORP Classification</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Fund type *</label>
                <select value={form.fund_type || 'UNRESTRICTED'} onChange={e => f('fund_type', e.target.value)} className={inp}>
                  <option value="UNRESTRICTED">Unrestricted</option>
                  <option value="RESTRICTED">Restricted</option>
                  <option value="ENDOWMENT">Endowment</option>
                </select>
              </div>
              <div>
                <label className={lbl}>Activity type *</label>
                <select value={form.activity_type || 'CHARITABLE'} onChange={e => f('activity_type', e.target.value)} className={inp}>
                  <option value="CHARITABLE">Charitable</option>
                  <option value="TRADING">Trading</option>
                  <option value="INVESTMENT">Investment</option>
                  <option value="GOVERNANCE">Governance</option>
                  <option value="SUPPORT">Support</option>
                </select>
              </div>
            </div>
          </div>

          {/* HMRC / Gift Aid */}
          <div className="rounded-xl p-3 space-y-3" style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.18)' }}>
            <p className="text-green-300 text-xs uppercase font-bold tracking-widest">HMRC / Gift Aid</p>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-white">
              <input type="checkbox" checked={!!form.gift_aid_eligible} onChange={e => f('gift_aid_eligible', e.target.checked)}
                className="w-4 h-4 rounded accent-green-400" />
              Gift Aid eligible
            </label>
            <div>
              <label className={lbl}>HMRC category</label>
              <select value={form.hmrc_category || ''} onChange={e => f('hmrc_category', e.target.value)} className={inp}>
                <option value="">— none —</option>
                <option value="CASH_DONATION">Cash donation</option>
                <option value="AGGREGATED_DONATION">Aggregated donation</option>
                <option value="GIFT_AID_RECLAIM">Gift Aid reclaim</option>
                <option value="SHARES_PROPERTY">Shares / property</option>
                <option value="GASDS">GASDS (small donations)</option>
              </select>
            </div>
          </div>

          {/* VAT */}
          <div className="rounded-xl p-3 space-y-3" style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.18)' }}>
            <p className="text-blue-300 text-xs uppercase font-bold tracking-widest">VAT</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>VAT code</label>
                <select value={form.vat_code || 'OUT_OF_SCOPE'} onChange={e => f('vat_code', e.target.value)} className={inp}>
                  {VAT_RATES.map(v => <option key={v.code} value={v.code}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>VAT rate %</label>
                <input type="number" step="0.01" value={form.vat_rate ?? 0} onChange={e => f('vat_rate', parseFloat(e.target.value) || 0)} className={inp} />
              </div>
            </div>
          </div>

          {/* External accounting */}
          <div className="rounded-xl p-3 space-y-3" style={{ background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.18)' }}>
            <p className="text-purple-300 text-xs uppercase font-bold tracking-widest">External Accounting Mapping</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={lbl}>Xero code</label>
                <input value={form.xero_account_code || ''} onChange={e => f('xero_account_code', e.target.value)} className={inp} placeholder="200" />
              </div>
              <div>
                <label className={lbl}>Sage code</label>
                <input value={form.sage_nominal_code || ''} onChange={e => f('sage_nominal_code', e.target.value)} className={inp} placeholder="4000" />
              </div>
              <div>
                <label className={lbl}>QuickBooks</label>
                <input value={form.quickbooks_account || ''} onChange={e => f('quickbooks_account', e.target.value)} className={inp} placeholder="Income" />
              </div>
            </div>
          </div>

          <div>
            <label className={lbl}>Notes</label>
            <textarea value={form.notes || ''} onChange={e => f('notes', e.target.value)}
              rows={2} className={`${inp} resize-none`} placeholder="Internal notes / accounting policy…" />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/5 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
            {saving ? 'Saving…' : 'Save Code'}
          </button>
        </div>
      </motion.div>
    </>
  )
}
