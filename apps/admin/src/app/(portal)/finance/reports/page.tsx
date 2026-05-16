'use client'
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

interface Branch { branch_id: string; name: string; is_active?: boolean }

interface IELine { code: string; name: string; category: string; amount: number }
interface IEResp {
  filters: { branch_id: string; fund_type: string; project_id: string; from_date: string; to_date: string }
  income: IELine[]; expense: IELine[]
  total_income: number; total_expense: number; surplus_deficit: number
}

interface BSLine { code: string; name: string; category: string; balance: number }
interface BSResp {
  as_at: string; branch_id: string
  assets: BSLine[]; liabilities: BSLine[]; equity: BSLine[]
  total_assets: number; total_liabilities: number; total_equity: number; is_balanced: boolean
}

interface SoFARow {
  type: string; code: string; name: string; activity_type: string
  UNRESTRICTED: number; RESTRICTED: number; ENDOWMENT: number; TOTAL: number
}
interface SoFAResp {
  filters: { branch_id: string; from_date: string; to_date: string }
  incoming: SoFARow[]; spent: SoFARow[]
  totals_in:    { UNRESTRICTED: number; RESTRICTED: number; ENDOWMENT: number; TOTAL: number }
  totals_ex:    { UNRESTRICTED: number; RESTRICTED: number; ENDOWMENT: number; TOTAL: number }
  net_movement: { UNRESTRICTED: number; RESTRICTED: number; ENDOWMENT: number; TOTAL: number }
}

interface BranchPLRow { branch_id: string; income: number; expense: number; net: number }
interface BranchPLResp {
  filters: { from_date: string; to_date: string; fund_type: string }
  items: BranchPLRow[]
  total_income: number; total_expense: number; total_net: number
}

const FUND_TYPES = ['UNRESTRICTED', 'RESTRICTED', 'ENDOWMENT']

function fmt(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n || 0)
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-[11px] font-semibold uppercase tracking-wide mb-1'

function downloadCsv(url: string, qs: URLSearchParams) {
  const token = (typeof window !== 'undefined' && localStorage.getItem('shital_access_token')) || ''
  const full = `/api/v1${url}${qs.toString() ? '?' + qs : ''}`
  fetch(full, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(r => r.blob())
    .then(blob => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = url.split('/').pop() || 'report.csv'
      a.click()
      URL.revokeObjectURL(a.href)
    })
    .catch(() => alert('Failed to download CSV'))
}

export default function ReportsPage() {
  const [tab, setTab] = useState<'ie' | 'bs' | 'sofa' | 'bpl'>('ie')
  const [branches, setBranches] = useState<Branch[]>([])

  useEffect(() => {
    apiFetch<{ branches: Branch[] }>('/branches')
      .then(d => setBranches((d.branches || []).filter(b => b.is_active !== false)))
      .catch(() => setBranches([]))
  }, [])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-white">Financial Reports</h1>
        <p className="text-white/40 mt-1">SORP-aligned reports straight from the GL. Filter by branch / fund / period and export to CSV.</p>
      </div>

      <div className="flex gap-2 border-b border-white/5 overflow-x-auto">
        <TabBtn active={tab === 'ie'}   onClick={() => setTab('ie')}>📈 Income &amp; Expenditure</TabBtn>
        <TabBtn active={tab === 'bs'}   onClick={() => setTab('bs')}>📊 Balance Sheet</TabBtn>
        <TabBtn active={tab === 'sofa'} onClick={() => setTab('sofa')}>🇬🇧 SoFA</TabBtn>
        <TabBtn active={tab === 'bpl'}  onClick={() => setTab('bpl')}>🏢 Branch P&amp;L</TabBtn>
      </div>

      {tab === 'ie'   && <IETab   branches={branches} />}
      {tab === 'bs'   && <BSTab   branches={branches} />}
      {tab === 'sofa' && <SoFATab branches={branches} />}
      {tab === 'bpl'  && <BranchPLTab />}
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${active
        ? 'border-saffron-400 text-white'
        : 'border-transparent text-white/50 hover:text-white/80'}`}>
      {children}
    </button>
  )
}

function PeriodFilter({ values, onChange, branches, showProject, showFund = true }: {
  values: { branch_id: string; fund_type: string; project_id: string; from_date: string; to_date: string }
  onChange: (v: typeof values) => void; branches: Branch[]
  showProject?: boolean; showFund?: boolean
}) {
  return (
    <div className={`glass rounded-2xl p-4 grid grid-cols-2 md:grid-cols-${showProject ? 5 : 4} gap-3`}>
      <div>
        <label className={lbl}>Branch</label>
        <select value={values.branch_id} onChange={e => onChange({ ...values, branch_id: e.target.value })} className={inp}>
          <option value="">All branches</option>
          {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
        </select>
      </div>
      {showFund && (
        <div>
          <label className={lbl}>Fund</label>
          <select value={values.fund_type} onChange={e => onChange({ ...values, fund_type: e.target.value })} className={inp}>
            <option value="">All funds</option>
            {FUND_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className={lbl}>From</label>
        <input type="date" value={values.from_date} onChange={e => onChange({ ...values, from_date: e.target.value })} className={inp} />
      </div>
      <div>
        <label className={lbl}>To</label>
        <input type="date" value={values.to_date} onChange={e => onChange({ ...values, to_date: e.target.value })} className={inp} />
      </div>
      {showProject && (
        <div>
          <label className={lbl}>Project (UUID)</label>
          <input value={values.project_id} onChange={e => onChange({ ...values, project_id: e.target.value })} placeholder="optional" className={inp} />
        </div>
      )}
    </div>
  )
}

// ─── Income & Expenditure ────────────────────────────────────────────────────

function IETab({ branches }: { branches: Branch[] }) {
  const thisYear = new Date().getFullYear()
  const [filters, setFilters] = useState({ branch_id: '', fund_type: '', project_id: '', from_date: `${thisYear}-01-01`, to_date: new Date().toISOString().split('T')[0] })
  const [data, setData] = useState<IEResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams()
      Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const d = await apiFetch<IEResp>(`/admin/reports/income-expense?${qs}`)
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load() }, [load])

  const qs = () => {
    const q = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => { if (v) q.set(k, v) })
    return q
  }

  return (
    <div className="space-y-4">
      <PeriodFilter values={filters} onChange={setFilters} branches={branches} showProject />

      <div className="flex justify-between items-center">
        {data && (
          <div className="text-sm text-white/60">
            <span className="text-green-300 font-bold">{fmt(data.total_income)}</span>
            {' income · '}
            <span className="text-red-300 font-bold">{fmt(data.total_expense)}</span>
            {' expense · '}
            <span className={`font-black ${data.surplus_deficit >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmt(data.surplus_deficit)}</span>
            {' net'}
          </div>
        )}
        <button onClick={() => downloadCsv('/admin/reports/income-expense.csv', qs())}
          className="px-4 py-2 rounded-xl border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/5">
          ⬇ Export CSV
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Income" rows={data?.income || []} totalLabel="Total Income" total={data?.total_income || 0} color="green" loading={loading} />
        <Section title="Expense" rows={data?.expense || []} totalLabel="Total Expense" total={data?.total_expense || 0} color="red" loading={loading} />
      </div>

      {data && (
        <div className="glass rounded-2xl p-5 border border-saffron-400/30 text-center">
          <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Surplus / (Deficit)</p>
          <p className={`text-4xl font-black font-mono ${data.surplus_deficit >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmt(data.surplus_deficit)}</p>
        </div>
      )}
    </div>
  )
}

function Section({ title, rows, totalLabel, total, color, loading }: {
  title: string; rows: IELine[]; totalLabel: string; total: number
  color: 'green' | 'red'; loading: boolean
}) {
  const txt = color === 'green' ? 'text-green-300' : 'text-red-300'
  return (
    <div className="glass rounded-2xl overflow-hidden border border-temple-border">
      <div className="px-4 py-3 border-b border-white/5">
        <h3 className={`font-bold ${txt}`}>{title}</h3>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-white/3 text-white/40 text-[10px] uppercase tracking-wider">
          <tr>
            <th className="text-left px-3 py-2">Code</th>
            <th className="text-left px-3 py-2">Name</th>
            <th className="text-right px-3 py-2">Amount</th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={3} className="px-3 py-8 text-center text-white/30">Loading…</td></tr>}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={3} className="px-3 py-8 text-center text-white/30">No movement.</td></tr>
          )}
          {rows.map(r => (
            <tr key={r.code} className="border-t border-white/5 text-white/70">
              <td className="px-3 py-2 font-mono text-xs font-bold">{r.code}</td>
              <td className="px-3 py-2 text-xs">{r.name}</td>
              <td className={`px-3 py-2 text-right font-mono ${txt}`}>{fmt(r.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-white/3 text-white font-bold">
          <tr>
            <td colSpan={2} className="px-3 py-2 text-right">{totalLabel}</td>
            <td className={`px-3 py-2 text-right font-mono ${txt}`}>{fmt(total)}</td>
          </tr>
        </tfoot>
      </table></div>
    </div>
  )
}

// ─── Balance Sheet ───────────────────────────────────────────────────────────

function BSTab({ branches }: { branches: Branch[] }) {
  const [asAt, setAsAt] = useState(new Date().toISOString().split('T')[0])
  const [branchId, setBranchId] = useState('')
  const [data, setData] = useState<BSResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ as_at: asAt })
      if (branchId) qs.set('branch_id', branchId)
      const d = await apiFetch<BSResp>(`/admin/reports/balance-sheet?${qs}`)
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [asAt, branchId])

  useEffect(() => { load() }, [load])

  const qs = () => {
    const q = new URLSearchParams({ as_at: asAt })
    if (branchId) q.set('branch_id', branchId)
    return q
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className={lbl}>As at</label>
          <input type="date" value={asAt} onChange={e => setAsAt(e.target.value)} className={inp} />
        </div>
        <div>
          <label className={lbl}>Branch</label>
          <select value={branchId} onChange={e => setBranchId(e.target.value)} className={inp}>
            <option value="">All branches</option>
            {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button onClick={() => downloadCsv('/admin/reports/balance-sheet.csv', qs())}
            className="px-4 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/5">
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="grid md:grid-cols-2 gap-4">
        <BSSection title="Assets" rows={data?.assets || []} total={data?.total_assets || 0} color="green" loading={loading} />
        <div className="space-y-4">
          <BSSection title="Liabilities" rows={data?.liabilities || []} total={data?.total_liabilities || 0} color="red" loading={loading} />
          <BSSection title="Equity / Funds" rows={data?.equity || []} total={data?.total_equity || 0} color="blue" loading={loading} />
        </div>
      </div>

      {data && (
        <div className={`glass rounded-2xl p-5 border text-center ${data.is_balanced ? 'border-green-400/30' : 'border-red-400/30'}`}>
          <p className={`text-2xl font-black ${data.is_balanced ? 'text-green-300' : 'text-red-300'}`}>
            {data.is_balanced ? '✓ Balanced' : '✗ Out of balance'}
          </p>
          <p className="text-white/60 text-sm mt-1">
            Assets {fmt(data.total_assets)} = Liabilities {fmt(data.total_liabilities)} + Equity {fmt(data.total_equity)}
          </p>
        </div>
      )}
    </div>
  )
}

function BSSection({ title, rows, total, color, loading }: {
  title: string; rows: BSLine[]; total: number
  color: 'green' | 'red' | 'blue'; loading: boolean
}) {
  const txt = color === 'green' ? 'text-green-300' : color === 'red' ? 'text-red-300' : 'text-blue-300'
  return (
    <div className="glass rounded-2xl overflow-hidden border border-temple-border">
      <div className="px-4 py-3 border-b border-white/5">
        <h3 className={`font-bold ${txt}`}>{title}</h3>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-white/3 text-white/40 text-[10px] uppercase tracking-wider">
          <tr>
            <th className="text-left px-3 py-2">Code</th>
            <th className="text-left px-3 py-2">Name</th>
            <th className="text-right px-3 py-2">Balance</th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={3} className="px-3 py-8 text-center text-white/30">Loading…</td></tr>}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={3} className="px-3 py-8 text-center text-white/30">No balance.</td></tr>
          )}
          {rows.map(r => (
            <tr key={r.code} className="border-t border-white/5 text-white/70">
              <td className="px-3 py-2 font-mono text-xs font-bold">{r.code}</td>
              <td className="px-3 py-2 text-xs">{r.name}</td>
              <td className={`px-3 py-2 text-right font-mono ${txt}`}>{fmt(r.balance)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-white/3 text-white font-bold">
          <tr>
            <td colSpan={2} className="px-3 py-2 text-right">Total {title}</td>
            <td className={`px-3 py-2 text-right font-mono ${txt}`}>{fmt(total)}</td>
          </tr>
        </tfoot>
      </table></div>
    </div>
  )
}

// ─── SoFA ───────────────────────────────────────────────────────────────────

function SoFATab({ branches }: { branches: Branch[] }) {
  const thisYear = new Date().getFullYear()
  const [filters, setFilters] = useState({ branch_id: '', from_date: `${thisYear}-01-01`, to_date: new Date().toISOString().split('T')[0] })
  const [data, setData] = useState<SoFAResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams()
      Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const d = await apiFetch<SoFAResp>(`/admin/reports/sofa?${qs}`)
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load() }, [load])

  const qs = () => {
    const q = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => { if (v) q.set(k, v) })
    return q
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={lbl}>Branch</label>
          <select value={filters.branch_id} onChange={e => setFilters(f => ({ ...f, branch_id: e.target.value }))} className={inp}>
            <option value="">All branches</option>
            {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
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
        <div className="flex items-end">
          <button onClick={() => downloadCsv('/admin/reports/sofa.csv', qs())}
            className="px-4 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/5">
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="px-4 py-3 border-b border-white/5">
          <h3 className="font-bold text-white">Incoming Resources</h3>
        </div>
        <SoFATable rows={data?.incoming || []} totalLabel="Total incoming" totals={data?.totals_in} loading={loading} />
      </div>

      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="px-4 py-3 border-b border-white/5">
          <h3 className="font-bold text-white">Resources Expended</h3>
        </div>
        <SoFATable rows={data?.spent || []} totalLabel="Total expended" totals={data?.totals_ex} loading={loading} />
      </div>

      {data && (
        <div className="glass rounded-2xl p-5 border border-saffron-400/30">
          <h3 className="font-bold text-white mb-3">Net Movement in Funds</h3>
          <div className="grid grid-cols-4 gap-3 text-center">
            {['UNRESTRICTED', 'RESTRICTED', 'ENDOWMENT', 'TOTAL'].map(k => (
              <div key={k}>
                <p className="text-white/40 text-[10px] uppercase tracking-wider">{k}</p>
                <p className={`text-2xl font-black font-mono ${(data.net_movement[k as keyof typeof data.net_movement]) >= 0 ? 'text-green-300' : 'text-red-300'}`}>
                  {fmt(data.net_movement[k as keyof typeof data.net_movement])}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SoFATable({ rows, totalLabel, totals, loading }: {
  rows: SoFARow[]; totalLabel: string
  totals?: { UNRESTRICTED: number; RESTRICTED: number; ENDOWMENT: number; TOTAL: number }
  loading: boolean
}) {
  return (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="bg-white/3 text-white/40 text-[10px] uppercase tracking-wider">
        <tr>
          <th className="text-left px-3 py-2">Code</th>
          <th className="text-left px-3 py-2">Name</th>
          <th className="text-right px-3 py-2">Unrestricted</th>
          <th className="text-right px-3 py-2">Restricted</th>
          <th className="text-right px-3 py-2">Endowment</th>
          <th className="text-right px-3 py-2">Total</th>
        </tr>
      </thead>
      <tbody>
        {loading && <tr><td colSpan={6} className="px-3 py-8 text-center text-white/30">Loading…</td></tr>}
        {!loading && rows.length === 0 && (
          <tr><td colSpan={6} className="px-3 py-8 text-center text-white/30">No movement.</td></tr>
        )}
        {rows.map(r => (
          <tr key={r.code} className="border-t border-white/5 text-white/70">
            <td className="px-3 py-2 font-mono text-xs font-bold">{r.code}</td>
            <td className="px-3 py-2 text-xs">{r.name}</td>
            <td className="px-3 py-2 text-right font-mono">{r.UNRESTRICTED ? fmt(r.UNRESTRICTED) : '—'}</td>
            <td className="px-3 py-2 text-right font-mono">{r.RESTRICTED ? fmt(r.RESTRICTED) : '—'}</td>
            <td className="px-3 py-2 text-right font-mono">{r.ENDOWMENT ? fmt(r.ENDOWMENT) : '—'}</td>
            <td className="px-3 py-2 text-right font-mono font-bold text-white">{fmt(r.TOTAL)}</td>
          </tr>
        ))}
      </tbody>
      {totals && (
        <tfoot className="bg-white/3 text-white font-bold">
          <tr>
            <td colSpan={2} className="px-3 py-2 text-right">{totalLabel}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(totals.UNRESTRICTED)}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(totals.RESTRICTED)}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(totals.ENDOWMENT)}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(totals.TOTAL)}</td>
          </tr>
        </tfoot>
      )}
    </table></div>
  )
}

// ─── Branch P&L ─────────────────────────────────────────────────────────────

function BranchPLTab() {
  const thisYear = new Date().getFullYear()
  const [fromDate, setFromDate] = useState(`${thisYear}-01-01`)
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0])
  const [fundType, setFundType] = useState('')
  const [data, setData] = useState<BranchPLResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ from_date: fromDate, to_date: toDate })
      if (fundType) qs.set('fund_type', fundType)
      const d = await apiFetch<BranchPLResp>(`/admin/reports/branch-pl?${qs}`)
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate, fundType])

  useEffect(() => { load() }, [load])

  const qs = () => {
    const q = new URLSearchParams({ from_date: fromDate, to_date: toDate })
    if (fundType) q.set('fund_type', fundType)
    return q
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={lbl}>From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={inp} />
        </div>
        <div>
          <label className={lbl}>To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={inp} />
        </div>
        <div>
          <label className={lbl}>Fund</label>
          <select value={fundType} onChange={e => setFundType(e.target.value)} className={inp}>
            <option value="">All funds</option>
            {FUND_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button onClick={() => downloadCsv('/admin/reports/branch-pl.csv', qs())}
            className="px-4 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/5">
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-white/3 text-white/40 text-[10px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Branch</th>
              <th className="text-right px-4 py-3">Income</th>
              <th className="text-right px-4 py-3">Expense</th>
              <th className="text-right px-4 py-3">Net</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="px-4 py-10 text-center text-white/30">Loading…</td></tr>}
            {!loading && (!data || data.items.length === 0) && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-white/30">No postings in this period.</td></tr>
            )}
            {data?.items.map(r => (
              <tr key={r.branch_id} className="border-t border-white/5 text-white/80">
                <td className="px-4 py-3 font-bold">{r.branch_id}</td>
                <td className="px-4 py-3 text-right font-mono text-green-300">{fmt(r.income)}</td>
                <td className="px-4 py-3 text-right font-mono text-red-300">{fmt(r.expense)}</td>
                <td className={`px-4 py-3 text-right font-mono font-bold ${r.net >= 0 ? 'text-white' : 'text-red-300'}`}>{fmt(r.net)}</td>
              </tr>
            ))}
          </tbody>
          {data && (
            <tfoot className="bg-white/3 text-white font-black">
              <tr>
                <td className="px-4 py-3">TOTAL</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(data.total_income)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(data.total_expense)}</td>
                <td className={`px-4 py-3 text-right font-mono ${data.total_net >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmt(data.total_net)}</td>
              </tr>
            </tfoot>
          )}
        </table></div>
      </div>
    </div>
  )
}
