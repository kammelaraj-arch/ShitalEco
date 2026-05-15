'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  Legend, Cell,
} from 'recharts'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeriesPoint {
  bucket: string
  amount: number
  gift_aid: number
  with_gift_aid: number
  count: number
}

interface BranchTotals {
  branch_id: string
  branch_name: string
  amount: number
  gift_aid: number
  with_gift_aid: number
  count: number
}

interface FundsResponse {
  period: 'day' | 'week' | 'month' | 'quarter' | 'year'
  start_date: string
  end_date:   string
  branch_id:  string | null
  series:     SeriesPoint[]
  by_branch:  BranchTotals[]
  totals:     { amount: number; gift_aid: number; with_gift_aid: number; count: number }
}

interface Branch { branch_id: string; name: string; is_active?: boolean }

// ─── Period presets ───────────────────────────────────────────────────────────
// Each preset sets both the granularity (date-bucket) and the date window.
// "Last 7 days, daily buckets" is what most temple admins reach for first;
// the month + quarter views are for trustee reports.
const PERIOD_PRESETS = [
  { id: 'day_7',     label: 'Last 7 days',      period: 'day'     as const, days: 7    },
  { id: 'day_30',    label: 'Last 30 days',     period: 'day'     as const, days: 30   },
  { id: 'week_12',   label: 'Last 12 weeks',    period: 'week'    as const, days: 84   },
  { id: 'month_6',   label: 'Last 6 months',    period: 'month'   as const, days: 180  },
  { id: 'month_12',  label: 'Last 12 months',   period: 'month'   as const, days: 365  },
  { id: 'quarter_4', label: 'Last 4 quarters',  period: 'quarter' as const, days: 365  },
  { id: 'year_3',    label: 'Last 3 years',     period: 'year'    as const, days: 1095 },
]

const BRANCH_COLOURS = ['#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#ef4444', '#14b8a6', '#f97316', '#6366f1']

function isoDaysAgo(n: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
function isoToday(): string { return new Date().toISOString().slice(0, 10) }

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n)
}

// Friendly bucket label per period — week starts get an extra "Wk of" prefix.
function bucketLabel(bucket: string, period: FundsResponse['period']): string {
  if (!bucket) return ''
  const d = new Date(bucket + 'T00:00:00Z')
  if (period === 'day') return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  if (period === 'week') return 'Wk ' + d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  if (period === 'month') return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
  if (period === 'quarter') {
    const q = Math.floor(d.getUTCMonth() / 3) + 1
    return `Q${q} ${d.getUTCFullYear()}`
  }
  return String(d.getUTCFullYear())
}

export default function IncomingFundsPage() {
  const [preset, setPreset]           = useState(PERIOD_PRESETS[1])
  const [branchId, setBranchId]       = useState<string>('')           // '' = all branches
  const [groupByBranch, setGroupBy]   = useState<boolean>(false)
  const [branches, setBranches]       = useState<Branch[]>([])
  const [data, setData]               = useState<FundsResponse | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')

  // Branches list for the picker + name resolution. Hits the public
  // /branches endpoint added in PR #92 (board roles registry's sibling).
  useEffect(() => {
    apiFetch<{ branches: Branch[] }>('/branches')
      .then(d => setBranches((d.branches || []).filter(b => b.is_active !== false)))
      .catch(() => setBranches([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const start = isoDaysAgo(preset.days)
      const end   = isoToday()
      const qs = new URLSearchParams({
        period:     preset.period,
        start_date: start,
        end_date:   end,
        group_by_branch: 'true',  // always fetch breakdown — cheap, drives the per-branch chart
      })
      if (branchId) qs.set('branch_id', branchId)
      const d = await apiFetch<FundsResponse>(`/finance/dashboards/incoming-funds?${qs}`)
      setData(d)
    } catch (e: any) {
      setError(e?.message || 'Failed to load funds dashboard')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [preset, branchId])

  useEffect(() => { load() }, [load])

  const chartData = useMemo(() => {
    if (!data) return []
    return data.series.map(s => ({
      label:        bucketLabel(s.bucket, data.period),
      bucket:       s.bucket,
      Donations:    s.amount,
      'Gift Aid':   s.gift_aid,
      count:        s.count,
    }))
  }, [data])

  // For the per-branch bar chart, only show top 10 + an "Other" bucket if
  // there are more — keeps the chart readable even for a 50-branch trust.
  const branchChartData = useMemo(() => {
    if (!data) return []
    const sorted = [...data.by_branch].sort((a, b) => b.amount - a.amount)
    if (sorted.length <= 10) return sorted
    const top = sorted.slice(0, 10)
    const rest = sorted.slice(10)
    const other = rest.reduce(
      (acc, b) => ({
        amount: acc.amount + b.amount,
        gift_aid: acc.gift_aid + b.gift_aid,
        with_gift_aid: acc.with_gift_aid + b.with_gift_aid,
        count: acc.count + b.count,
      }),
      { amount: 0, gift_aid: 0, with_gift_aid: 0, count: 0 },
    )
    return [...top, { branch_id: '__other__', branch_name: `Other (${rest.length})`, ...other }]
  }, [data])

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">💸 Incoming Funds</h1>
          <p className="text-white/40 mt-1">
            Donations + Gift Aid by day / week / month / quarter / year. All branches or filter to one.
            Pull-down to compare branch-by-branch.
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="glass rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
          {PERIOD_PRESETS.map(p => (
            <button key={p.id} onClick={() => setPreset(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                preset.id === p.id ? 'bg-saffron-gradient text-white shadow' : 'text-white/40 hover:text-white/70'
              }`}>{p.label}</button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-white/40">Branch</label>
          <select value={branchId} onChange={e => setBranchId(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-white text-sm outline-none">
            <option value="">All branches</option>
            {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
          </select>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={groupByBranch} onChange={e => setGroupBy(e.target.checked)}
            className="w-4 h-4 rounded accent-saffron-400" disabled={!!branchId} />
          <span className="text-xs font-semibold text-white/60">
            Branch-by-branch breakdown
            {branchId && <span className="text-white/30 ml-1">(disabled — single branch)</span>}
          </span>
        </label>

        <button onClick={load} className="ml-auto px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 text-xs hover:bg-white/10">
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}

      {/* Total cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Donations',         value: data?.totals.amount        ?? 0, suffix: '',           color: 'from-saffron-500 to-orange-500' },
          { label: 'Gift Aid',          value: data?.totals.gift_aid      ?? 0, suffix: '',           color: 'from-green-600 to-emerald-500' },
          { label: 'Temple receives',   value: data?.totals.with_gift_aid ?? 0, suffix: '',           color: 'from-blue-600 to-indigo-500' },
          { label: 'Transactions',      value: data?.totals.count         ?? 0, suffix: '',           color: 'from-purple-600 to-fuchsia-500', isCount: true },
        ].map(c => (
          <div key={c.label} className="glass rounded-2xl p-5 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-24 h-24 rounded-full bg-gradient-to-br ${c.color} opacity-10 blur-xl`} />
            <p className="text-white/50 text-xs font-medium mb-1">{c.label}</p>
            <p className="text-2xl font-black text-white">
              {loading ? '…' : c.isCount ? c.value : fmtCurrency(c.value)}
            </p>
          </div>
        ))}
      </div>

      {/* Time-series bar (donations + gift aid stacked) */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-white font-bold">Trend</h2>
            <p className="text-white/40 text-xs">
              {data ? `${data.start_date} → ${data.end_date} · ${preset.label.toLowerCase()}` : ''}
            </p>
          </div>
        </div>
        <div style={{ width: '100%', height: 320 }}>
          {loading ? (
            <div className="h-full flex items-center justify-center text-white/30 text-sm">Loading…</div>
          ) : !data || data.series.length === 0 ? (
            <div className="h-full flex items-center justify-center text-white/30 text-sm">No donations in this window.</div>
          ) : (
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="label" stroke="rgba(255,255,255,0.5)" fontSize={11} />
                <YAxis stroke="rgba(255,255,255,0.5)" fontSize={11} tickFormatter={(v) => `£${v}`} />
                <Tooltip
                  contentStyle={{ background: '#0f0008', border: '1px solid rgba(212,175,55,0.3)', borderRadius: 12, color: '#fff' }}
                  formatter={(v: number) => fmtCurrency(v)}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }} />
                <Bar dataKey="Donations"  stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Gift Aid"   stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Per-branch bar (only when not already filtered to one branch) */}
      {!branchId && (
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-white font-bold">By Branch</h2>
              <p className="text-white/40 text-xs">Donations + Gift Aid across the window above</p>
            </div>
          </div>
          <div style={{ width: '100%', height: Math.max(220, branchChartData.length * 38) }}>
            {loading ? (
              <div className="h-full flex items-center justify-center text-white/30 text-sm">Loading…</div>
            ) : branchChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-white/30 text-sm">No branch totals yet.</div>
            ) : (
              <ResponsiveContainer>
                <BarChart data={branchChartData} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                  <XAxis type="number" stroke="rgba(255,255,255,0.5)" fontSize={11} tickFormatter={(v) => `£${v}`} />
                  <YAxis type="category" dataKey="branch_name" stroke="rgba(255,255,255,0.5)" fontSize={11} width={80} />
                  <Tooltip
                    contentStyle={{ background: '#0f0008', border: '1px solid rgba(212,175,55,0.3)', borderRadius: 12, color: '#fff' }}
                    formatter={(v: number) => fmtCurrency(v)}
                  />
                  <Bar dataKey="amount" name="Donations" radius={[0, 6, 6, 0]}>
                    {branchChartData.map((_, i) => (
                      <Cell key={i} fill={BRANCH_COLOURS[i % BRANCH_COLOURS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Detail table beneath the chart */}
          {branchChartData.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/40 text-xs font-bold uppercase tracking-wider">
                    <th className="px-3 py-2 text-left">Branch</th>
                    <th className="px-3 py-2 text-right">Donations</th>
                    <th className="px-3 py-2 text-right">Gift Aid</th>
                    <th className="px-3 py-2 text-right">Temple receives</th>
                    <th className="px-3 py-2 text-right"># Txns</th>
                  </tr>
                </thead>
                <tbody>
                  {branchChartData.map((b) => (
                    <tr key={b.branch_id} className="border-t border-white/5 hover:bg-white/3">
                      <td className="px-3 py-2 text-white font-semibold">{b.branch_name}</td>
                      <td className="px-3 py-2 text-right text-white/80">{fmtCurrency(b.amount)}</td>
                      <td className="px-3 py-2 text-right text-green-400">{fmtCurrency(b.gift_aid)}</td>
                      <td className="px-3 py-2 text-right text-saffron-300 font-bold">{fmtCurrency(b.with_gift_aid)}</td>
                      <td className="px-3 py-2 text-right text-white/40">{b.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
