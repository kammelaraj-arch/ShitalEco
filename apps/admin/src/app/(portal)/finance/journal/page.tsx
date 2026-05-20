'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'
import { Pagination } from '@/components/ui/Pagination'

interface NominalCode { id: string; code: string; name: string; type: string }
interface Branch { branch_id: string; name: string; is_active?: boolean }

interface Entry {
  id: string
  branch_id: string
  reference: string
  description: string
  date: string
  total_amount: number
  status: string
  source_type: string
  source_id: string | null
  reversal_of: string | null
  fund_type: string
  project_id: string | null
  posted_by: string
  posted_at: string | null
  created_at: string
  lines?: Line[]
}

interface Line {
  id: string
  transaction_id: string
  nominal_code_id: string | null
  nominal_code: string
  code: string | null
  code_name: string | null
  fund_type: string
  project_id: string | null
  branch_id: string
  description: string
  debit_amount: number
  credit_amount: number
}

interface TBRow {
  id: string
  code: string
  name: string
  type: string
  category: string
  code_fund: string
  total_debit: number
  total_credit: number
  balance: number
}

interface TBResponse {
  items: TBRow[]
  total_debit: number
  total_credit: number
  is_balanced: boolean
}

const FUND_TYPES = ['UNRESTRICTED', 'RESTRICTED', 'ENDOWMENT']
const SOURCE_TYPES = [
  '', 'manual', 'po_receive', 'po_pay', 'invoice_send', 'invoice_pay',
  'donation', 'reimbursement_approve', 'reimbursement_pay', 'payroll',
  'reversal', 'bank_import',
]

const TYPE_COLOR: Record<string, string> = {
  ASSET:     'text-green-300',
  LIABILITY: 'text-red-300',
  EQUITY:    'text-blue-300',
  INCOME:    'text-orange-300',
  EXPENSE:   'text-yellow-300',
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n || 0)
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso }
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-[11px] font-semibold uppercase tracking-wide mb-1'

export default function JournalPage() {
  const [tab, setTab] = useState<'entries' | 'trial-balance'>('entries')
  const [branches, setBranches] = useState<Branch[]>([])
  const [codes, setCodes] = useState<NominalCode[]>([])

  useEffect(() => {
    apiFetch<{ branches: Branch[] }>('/branches')
      .then(d => setBranches((d.branches || []).filter(b => b.is_active !== false)))
      .catch(() => setBranches([]))
    apiFetch<{ items: NominalCode[] }>('/admin/nominal-codes?active=true&per_page=500')
      .then(d => setCodes(d.items || []))
      .catch(() => setCodes([]))
  }, [])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-white">General Ledger</h1>
        <p className="text-white/40 mt-1">Every income/expense event in one auditable double-entry ledger.</p>
      </div>

      <div className="flex gap-2 border-b border-white/5">
        <TabBtn active={tab === 'entries'}       onClick={() => setTab('entries')}>📒 Journal entries</TabBtn>
        <TabBtn active={tab === 'trial-balance'} onClick={() => setTab('trial-balance')}>⚖ Trial balance</TabBtn>
      </div>

      {tab === 'entries' && <EntriesTab branches={branches} codes={codes} />}
      {tab === 'trial-balance' && <TrialBalanceTab branches={branches} />}
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${active
        ? 'border-saffron-400 text-white'
        : 'border-transparent text-white/50 hover:text-white/80'}`}>
      {children}
    </button>
  )
}

function EntriesTab({ branches, codes }: { branches: Branch[]; codes: NominalCode[] }) {
  const [items, setItems] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [filters, setFilters] = useState({ branch_id: '', source_type: '', fund_type: '', from_date: '', to_date: '', search: '' })
  const [showForm, setShowForm] = useState(false)
  const [detail, setDetail] = useState<Entry | null>(null)
  const [actioning, setActioning] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) })
      Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const d = await apiFetch<{ items: Entry[]; total: number }>(`/admin/gl/journal?${qs}`)
      setItems(d.items || [])
      setTotal(d.total || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load journal')
    } finally {
      setLoading(false)
    }
  }, [page, perPage, filters])

  useEffect(() => { load() }, [load])

  async function openDetail(id: string) {
    try {
      const d = await apiFetch<Entry>(`/admin/gl/journal/${id}`)
      setDetail(d)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load entry')
    }
  }

  async function reverse(id: string) {
    if (!window.confirm('Post a reversing entry? The original entry is kept; this creates a balancing inverse.')) return
    setActioning(id)
    try {
      const d = await apiFetch<Entry>(`/admin/gl/journal/${id}/reverse`, { method: 'POST' })
      setDetail(d)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to reverse')
    } finally {
      setActioning('')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="text-white/40 text-sm">{total.toLocaleString()} entries</div>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ Manual Posting</button>
      </div>

      <div className="glass rounded-2xl p-4 grid grid-cols-2 md:grid-cols-6 gap-3">
        <input value={filters.search} onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1) }}
          placeholder="Search ref / desc" className={`${inp} md:col-span-2`} />
        <select value={filters.branch_id} onChange={e => { setFilters(f => ({ ...f, branch_id: e.target.value })); setPage(1) }} className={inp}>
          <option value="">All branches</option>
          {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
        </select>
        <select value={filters.source_type} onChange={e => { setFilters(f => ({ ...f, source_type: e.target.value })); setPage(1) }} className={inp}>
          {SOURCE_TYPES.map(s => <option key={s} value={s}>{s || 'All sources'}</option>)}
        </select>
        <input type="date" value={filters.from_date} onChange={e => { setFilters(f => ({ ...f, from_date: e.target.value })); setPage(1) }} className={inp} />
        <input type="date" value={filters.to_date}   onChange={e => { setFilters(f => ({ ...f, to_date: e.target.value })); setPage(1) }} className={inp} />
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="overflow-x-auto"><table className="w-full">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs font-semibold uppercase tracking-wider">
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Reference</th>
              <th className="text-left px-4 py-3">Description</th>
              <th className="text-left px-4 py-3">Branch</th>
              <th className="text-left px-4 py-3">Source</th>
              <th className="text-left px-4 py-3">Fund</th>
              <th className="text-right px-4 py-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-4 py-10 text-center text-white/30 text-sm">Loading…</td></tr>}
            {!loading && items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-white/30 text-sm">No journal entries match these filters.</td></tr>
            )}
            {items.map((e, i) => (
              <motion.tr key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                onClick={() => openDetail(e.id)}
                className="border-b border-white/5 hover:bg-white/3 cursor-pointer transition-colors">
                <td className="px-4 py-3 text-white/70 text-sm font-mono">{fmtDate(e.date)}</td>
                <td className="px-4 py-3 text-white font-mono text-xs font-bold">{e.reference}</td>
                <td className="px-4 py-3 text-white/80 text-sm">
                  {e.description}
                  {e.reversal_of && <span className="ml-2 text-[10px] text-red-300/80 bg-red-500/10 px-1.5 py-0.5 rounded">REV</span>}
                </td>
                <td className="px-4 py-3 text-white/50 text-xs">{e.branch_id}</td>
                <td className="px-4 py-3 text-white/50 text-xs font-mono">{e.source_type}</td>
                <td className="px-4 py-3 text-white/50 text-xs">{e.fund_type}</td>
                <td className="px-4 py-3 text-right text-white font-mono text-sm font-bold">{fmt(e.total_amount)}</td>
              </motion.tr>
            ))}
          </tbody>
        </table></div>
        <Pagination page={page} pageSize={perPage} total={total} onPageChange={setPage} onPageSizeChange={setPerPage} />
      </div>

      <ManualPostingForm
        open={showForm} onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); load() }}
        branches={branches} codes={codes}
      />

      <EntryDrawer entry={detail} onClose={() => setDetail(null)} onReverse={reverse} actioning={actioning} />
    </div>
  )
}

function ManualPostingForm({ open, onClose, onSaved, branches, codes }: {
  open: boolean; onClose: () => void; onSaved: () => void
  branches: Branch[]; codes: NominalCode[]
}) {
  const [branchId, setBranchId] = useState('main')
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0])
  const [reference, setReference] = useState('')
  const [description, setDescription] = useState('')
  const [fundType, setFundType] = useState('UNRESTRICTED')
  const [lines, setLines] = useState([
    { nominal_code: '', debit: 0, credit: 0, description: '' },
    { nominal_code: '', debit: 0, credit: 0, description: '' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function setLine(i: number, patch: Partial<typeof lines[number]>) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }
  function addLine() {
    setLines(prev => [...prev, { nominal_code: '', debit: 0, credit: 0, description: '' }])
  }
  function removeLine(i: number) {
    setLines(prev => prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev)
  }

  const totalDr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
  const totalCr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  const diff = Math.abs(totalDr - totalCr)
  const balanced = diff < 0.005 && totalDr > 0

  async function submit() {
    if (!description.trim()) { setError('Description is required'); return }
    if (!balanced) { setError(`Entry is unbalanced: DR ${fmt(totalDr)} vs CR ${fmt(totalCr)}`); return }
    if (lines.some(l => !l.nominal_code.trim())) { setError('Every line needs a nominal code'); return }
    setSaving(true); setError('')
    try {
      await apiFetch('/admin/gl/journal', {
        method: 'POST',
        body: JSON.stringify({
          branch_id: branchId, entry_date: entryDate, description, reference,
          fund_type: fundType, lines,
        }),
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} className="fixed inset-0 bg-black/60 z-40" />
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="fixed right-0 top-0 h-full w-full sm:max-w-[760px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-white font-black text-lg">Manual Journal Posting</h2>
              <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Branch</label>
                  <select value={branchId} onChange={e => setBranchId(e.target.value)} className={inp}>
                    {branches.length === 0 && <option value="main">main</option>}
                    {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Date</label>
                  <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} className={inp} />
                </div>
                <div>
                  <label className={lbl}>Reference</label>
                  <input value={reference} onChange={e => setReference(e.target.value)} placeholder="auto if blank" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Fund type</label>
                  <select value={fundType} onChange={e => setFundType(e.target.value)} className={inp}>
                    {FUND_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={lbl}>Description *</label>
                <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this entry for?" className={inp} />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={lbl}>Lines (debits must equal credits)</label>
                  <button onClick={addLine} className="text-xs text-saffron-300 hover:text-saffron-200">+ Add line</button>
                </div>
                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={i} className="bg-white/3 border border-white/5 rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <select value={l.nominal_code} onChange={e => setLine(i, { nominal_code: e.target.value })}
                          className={`${inp} flex-1 text-xs`}>
                          <option value="">Pick nominal code…</option>
                          {codes.map(c => <option key={c.id} value={c.code}>{c.code} — {c.name} [{c.type}]</option>)}
                        </select>
                        <button onClick={() => removeLine(i)} disabled={lines.length <= 2}
                          className="text-white/40 hover:text-red-400 disabled:opacity-30 text-lg w-9 h-9 flex items-center justify-center">✕</button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input value={l.description} onChange={e => setLine(i, { description: e.target.value })}
                          placeholder="Line description" className={inp} />
                        <input type="number" step="0.01" min="0" value={l.debit || ''} onChange={e => setLine(i, { debit: Number(e.target.value) })}
                          placeholder="DR £" className={inp} />
                        <input type="number" step="0.01" min="0" value={l.credit || ''} onChange={e => setLine(i, { credit: Number(e.target.value) })}
                          placeholder="CR £" className={inp} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-white/5 pt-3">
                <div className="flex justify-between text-sm text-white/60"><span>Total DR</span><span className="font-mono">{fmt(totalDr)}</span></div>
                <div className="flex justify-between text-sm text-white/60"><span>Total CR</span><span className="font-mono">{fmt(totalCr)}</span></div>
                <div className={`flex justify-between font-bold text-base pt-2 ${balanced ? 'text-green-300' : 'text-red-300'}`}>
                  <span>{balanced ? '✓ Balanced' : `✗ Unbalanced by ${fmt(diff)}`}</span>
                  <span></span>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-white/5 flex gap-3">
              <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
              <button onClick={submit} disabled={saving || !balanced}
                className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                {saving ? 'Posting…' : 'Post Entry'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function EntryDrawer({ entry, onClose, onReverse, actioning }: {
  entry: Entry | null; onClose: () => void; onReverse: (id: string) => void; actioning: string
}) {
  if (!entry) return null
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="fixed inset-0 bg-black/60 z-40" />
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed right-0 top-0 h-full w-full sm:max-w-[680px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div>
            <h2 className="text-white font-black text-lg font-mono">{entry.reference}</h2>
            <p className="text-white/40 text-xs mt-0.5">{entry.description}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><p className="text-white/40 text-xs">Date</p><p className="text-white font-mono">{fmtDate(entry.date)}</p></div>
            <div><p className="text-white/40 text-xs">Branch</p><p className="text-white">{entry.branch_id}</p></div>
            <div><p className="text-white/40 text-xs">Fund</p><p className="text-white">{entry.fund_type}</p></div>
            <div><p className="text-white/40 text-xs">Source</p><p className="text-white font-mono text-xs">{entry.source_type}</p></div>
            <div><p className="text-white/40 text-xs">Posted by</p><p className="text-white/80 text-xs truncate">{entry.posted_by || '—'}</p></div>
            <div><p className="text-white/40 text-xs">Posted at</p><p className="text-white/80 text-xs">{entry.posted_at ? new Date(entry.posted_at).toLocaleString('en-GB') : '—'}</p></div>
          </div>

          {(entry.source_id || entry.reversal_of) && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-200 space-y-1 font-mono">
              {entry.source_id && <div>source_id: {entry.source_id}</div>}
              {entry.reversal_of && <div>reversal_of: {entry.reversal_of}</div>}
            </div>
          )}

          <div>
            <p className="text-white/40 text-xs uppercase tracking-wide mb-2">Lines</p>
            <div className="border border-white/5 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-white/3 text-white/40 text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">Code</th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-left px-3 py-2">Fund</th>
                    <th className="text-right px-3 py-2">Debit</th>
                    <th className="text-right px-3 py-2">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {(entry.lines || []).map(l => (
                    <tr key={l.id} className="border-t border-white/5 text-white/70">
                      <td className="px-3 py-2 font-mono text-xs">
                        <div className="font-bold">{l.code || l.nominal_code}</div>
                        <div className="text-white/40 text-[10px]">{l.code_name}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{l.description}</td>
                      <td className="px-3 py-2 text-xs">{l.fund_type}</td>
                      <td className="px-3 py-2 text-right font-mono text-green-200">{l.debit_amount > 0 ? fmt(l.debit_amount) : ''}</td>
                      <td className="px-3 py-2 text-right font-mono text-red-200">{l.credit_amount > 0 ? fmt(l.credit_amount) : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-white/3 text-white font-bold">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right">Totals</td>
                    <td className="px-3 py-2 text-right font-mono text-green-200">{fmt((entry.lines || []).reduce((s, l) => s + (Number(l.debit_amount) || 0), 0))}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-200">{fmt((entry.lines || []).reduce((s, l) => s + (Number(l.credit_amount) || 0), 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-white/5 flex gap-3">
          {entry.source_type !== 'reversal' && !entry.reversal_of && (
            <button onClick={() => onReverse(entry.id)} disabled={!!actioning}
              className="px-4 py-2.5 rounded-xl border border-red-500/30 text-red-300 text-sm font-semibold disabled:opacity-40">
              {actioning === entry.id ? 'Reversing…' : 'Reverse Entry'}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-white/5 text-white/70 text-sm">Close</button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

function TrialBalanceTab({ branches }: { branches: Branch[] }) {
  const [data, setData] = useState<TBResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ branch_id: '', fund_type: '', from_date: '', to_date: '' })
  const [hideZero, setHideZero] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams()
      Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const d = await apiFetch<TBResponse>(`/admin/gl/trial-balance${qs.toString() ? '?' + qs : ''}`)
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trial balance')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load() }, [load])

  const rows = (data?.items || []).filter(r => !hideZero || r.total_debit > 0 || r.total_credit > 0)

  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
        <div>
          <label className={lbl}>Branch</label>
          <select value={filters.branch_id} onChange={e => setFilters(f => ({ ...f, branch_id: e.target.value }))} className={inp}>
            <option value="">All branches</option>
            {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Fund type</label>
          <select value={filters.fund_type} onChange={e => setFilters(f => ({ ...f, fund_type: e.target.value }))} className={inp}>
            <option value="">All funds</option>
            {FUND_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>From</label>
          <input type="date" value={filters.from_date} onChange={e => setFilters(f => ({ ...f, from_date: e.target.value }))} className={inp} />
        </div>
        <div>
          <label className={lbl}>To</label>
          <input type="date" value={filters.to_date} onChange={e => setFilters(f => ({ ...f, to_date: e.target.value }))} className={inp} />
        </div>
        <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
          <input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)}
            className="w-4 h-4 accent-saffron-500" />
          Hide zero-balance codes
        </label>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="overflow-x-auto"><table className="w-full">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs font-semibold uppercase tracking-wider">
              <th className="text-left px-4 py-3">Code</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-right px-4 py-3">Debits</th>
              <th className="text-right px-4 py-3">Credits</th>
              <th className="text-right px-4 py-3">Balance</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-white/30 text-sm">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-white/30 text-sm">No movement in this period.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-b border-white/5">
                <td className="px-4 py-2.5 text-white font-mono text-sm font-bold">{r.code}</td>
                <td className="px-4 py-2.5 text-white/80 text-sm">{r.name}</td>
                <td className={`px-4 py-2.5 text-xs font-bold ${TYPE_COLOR[r.type] || 'text-white/50'}`}>{r.type}</td>
                <td className="px-4 py-2.5 text-right text-white/70 font-mono text-sm">{r.total_debit > 0 ? fmt(r.total_debit) : '—'}</td>
                <td className="px-4 py-2.5 text-right text-white/70 font-mono text-sm">{r.total_credit > 0 ? fmt(r.total_credit) : '—'}</td>
                <td className={`px-4 py-2.5 text-right font-mono text-sm font-bold ${r.balance > 0 ? 'text-green-300' : r.balance < 0 ? 'text-red-300' : 'text-white/40'}`}>
                  {r.balance !== 0 ? fmt(r.balance) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          {data && (
            <tfoot className="bg-white/3 text-white font-black">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-right">TOTALS</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(data.total_debit)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(data.total_credit)}</td>
                <td className={`px-4 py-3 text-right text-xs ${data.is_balanced ? 'text-green-300' : 'text-red-300'}`}>
                  {data.is_balanced ? '✓ BALANCED' : '✗ MISMATCH'}
                </td>
              </tr>
            </tfoot>
          )}
        </table></div>
      </div>
    </div>
  )
}
