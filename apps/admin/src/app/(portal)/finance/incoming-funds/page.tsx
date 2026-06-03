'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  Legend, Cell, PieChart, Pie,
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

interface SourceBranchRow {
  branch_id: string
  branch_name: string
  source: string
  payment_provider: string
  amount: number
  gift_aid: number
  with_gift_aid: number
  count: number
}

interface GiftaidRow {
  branch_id: string
  branch_name: string
  giftaid_eligible: boolean
  amount: number
  gift_aid: number
  count: number
}

interface DeviceBranchRow {
  branch_id: string
  branch_name: string
  kiosk_device_id: string | null      // null = unattributed (legacy / non-kiosk source)
  device_name: string
  device_type: string
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
  by_source_branch: SourceBranchRow[]
  by_giftaid: GiftaidRow[]
  by_device_branch: DeviceBranchRow[]
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

// Source pie palette + friendly labels. Sources that aren't in the map fall
// through to the raw string so a new source type still renders, just without
// a curated label.
const SOURCE_COLOURS = [
  '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#ef4444',
  '#14b8a6', '#f97316', '#6366f1', '#ec4899', '#84cc16',
]
const SOURCE_LABEL: Record<string, string> = {
  'kiosk':            'Kiosk (full)',
  'quick-donation':   'Quick Donation kiosk',
  'service-portal':   'Service portal (PayPal)',
  'monthly-giving':   'Monthly Giving (recurring)',
  'manual':           'Manual entry',
  'paypal':           'PayPal',
  'cash':             'Cash',
  'card':             'Card',
}
function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] || s
}

// Sum rows from `by_source_branch` filtered to one branch (or all). Returns
// a small array sorted by amount desc — drives both the table and the pie.
interface SourceTotal { source: string; amount: number; gift_aid: number; count: number }
function aggregateSources(rows: SourceBranchRow[], branchId: string | null): SourceTotal[] {
  const acc = new Map<string, SourceTotal>()
  for (const r of rows) {
    if (branchId && r.branch_id !== branchId) continue
    const cur = acc.get(r.source) ?? { source: r.source, amount: 0, gift_aid: 0, count: 0 }
    cur.amount   += r.amount
    cur.gift_aid += r.gift_aid
    cur.count    += r.count
    acc.set(r.source, cur)
  }
  return Array.from(acc.values()).sort((a, b) => b.amount - a.amount)
}

// Sum Gift-Aid eligibility split (yes/no) per branch or org-wide. Empty
// arrays default to zero amounts — the pie still renders with placeholder
// slices so the layout doesn't jump.
function aggregateGiftaid(rows: GiftaidRow[], branchId: string | null): { eligible: number; not_eligible: number } {
  let eligible = 0, not_eligible = 0
  for (const r of rows) {
    if (branchId && r.branch_id !== branchId) continue
    if (r.giftaid_eligible) eligible += r.amount
    else not_eligible += r.amount
  }
  return { eligible, not_eligible }
}

// Per-device rows filtered to one branch (or all). Unattributed rows
// (kiosk_device_id null) are folded into a synthetic "Unattributed" entry
// so the user sees what hasn't been wired up.
function deviceRowsForBranch(rows: DeviceBranchRow[], branchId: string | null): DeviceBranchRow[] {
  const filtered = rows.filter(r => !branchId || r.branch_id === branchId)
  // Re-label nulls so the table reads naturally.
  return filtered.map(r => ({
    ...r,
    device_name: r.kiosk_device_id
      ? (r.device_name || r.kiosk_device_id.slice(0, 8))
      : 'Unattributed (legacy / non-kiosk)',
  }))
}

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

      {/* ── Branch breakdown — org-wide card + one card per branch ────────── */}
      {/* Each card carries the period total, two pies (Gift Aid split, Source split),
          and a table listing every source contributing to the branch. Hidden when
          the user has filtered to a single branch — the per-branch card below
          covers that case on its own. */}
      {!loading && data && !branchId && (
        <BranchBreakdownCard
          branchName="All branches"
          accent="#f59e0b"
          totals={data.totals}
          sources={aggregateSources(data.by_source_branch, null)}
          giftaidSplit={aggregateGiftaid(data.by_giftaid, null)}
          devices={deviceRowsForBranch(data.by_device_branch, null)}
        />
      )}

      {!loading && data && data.by_branch.map((b, i) => (
        <BranchBreakdownCard
          key={b.branch_id}
          branchName={b.branch_name}
          accent={BRANCH_COLOURS[i % BRANCH_COLOURS.length]}
          totals={b}
          sources={aggregateSources(data.by_source_branch, b.branch_id)}
          giftaidSplit={aggregateGiftaid(data.by_giftaid, b.branch_id)}
          devices={deviceRowsForBranch(data.by_device_branch, b.branch_id)}
        />
      ))}
    </div>
  )
}

// ─── Branch breakdown card ────────────────────────────────────────────────────
// Reused for the org-wide row ("All branches") and one per branch. Shows the
// branch's total for the selected period, two pies (Gift Aid split + source
// split), and a table listing every source contributing to the branch.

// Recharts label renderer that prints the slice value (currency-formatted)
// inside the slice when there's room, otherwise outside with a leader line.
// Returning `false` from the renderer suppresses 0-value slices' labels.
function renderPieValueLabel({ cx, cy, midAngle, innerRadius, outerRadius, value }: {
  cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; value: number;
}) {
  if (!value) return null
  const RAD = Math.PI / 180
  const r = innerRadius + (outerRadius - innerRadius) * 0.65
  const x = cx + r * Math.cos(-midAngle * RAD)
  const y = cy + r * Math.sin(-midAngle * RAD)
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
      {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(value)}
    </text>
  )
}

function BranchBreakdownCard({
  branchName, accent, totals, sources, giftaidSplit, devices,
}: {
  branchName:   string
  accent:       string
  totals:       { amount: number; gift_aid: number; with_gift_aid: number; count: number }
  sources:      SourceTotal[]
  giftaidSplit: { eligible: number; not_eligible: number }
  devices:      DeviceBranchRow[]
}) {
  const giftaidData = [
    { name: 'Gift Aid eligible',     value: giftaidSplit.eligible,     fill: '#10b981' },
    { name: 'Not Gift Aid eligible', value: giftaidSplit.not_eligible, fill: '#64748b' },
  ].filter(d => d.value > 0)

  const sourceData = sources.map((s, i) => ({
    name:  sourceLabel(s.source),
    value: s.amount,
    fill:  SOURCE_COLOURS[i % SOURCE_COLOURS.length],
  })).filter(d => d.value > 0)

  const empty = totals.amount === 0 && totals.count === 0

  return (
    <div className="glass rounded-2xl p-5 space-y-4" style={{ borderLeft: `4px solid ${accent}` }}>
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-white font-bold text-lg">{branchName}</h2>
        <div className="flex items-baseline gap-3 text-sm">
          <span className="text-white/40">Period total</span>
          <span className="text-2xl font-black text-saffron-300">{fmtCurrency(totals.with_gift_aid)}</span>
          <span className="text-white/40 text-xs">
            ({fmtCurrency(totals.amount)} donations + {fmtCurrency(totals.gift_aid)} GA · {totals.count} txns)
          </span>
        </div>
      </div>

      {empty ? (
        <p className="text-white/30 text-sm">No donations in this window.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Gift-Aid pie */}
            <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-white/60 text-xs font-bold uppercase tracking-wider mb-2">Gift Aid split</p>
              <div style={{ width: '100%', height: 200 }}>
                {giftaidData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-white/30 text-sm">No data</div>
                ) : (
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={giftaidData} dataKey="value" nameKey="name" outerRadius={75} innerRadius={45} paddingAngle={2} label={renderPieValueLabel} labelLine={false}>
                        {giftaidData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#0f0008', border: '1px solid rgba(212,175,55,0.3)', borderRadius: 12, color: '#fff' }}
                        formatter={(v: number) => fmtCurrency(v)}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Source pie */}
            <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-white/60 text-xs font-bold uppercase tracking-wider mb-2">Source split</p>
              <div style={{ width: '100%', height: 200 }}>
                {sourceData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-white/30 text-sm">No data</div>
                ) : (
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={sourceData} dataKey="value" nameKey="name" outerRadius={75} innerRadius={45} paddingAngle={2} label={renderPieValueLabel} labelLine={false}>
                        {sourceData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#0f0008', border: '1px solid rgba(212,175,55,0.3)', borderRadius: 12, color: '#fff' }}
                        formatter={(v: number) => fmtCurrency(v)}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Source detail table */}
          <div className="overflow-x-auto">
            <p className="text-white/60 text-xs font-bold uppercase tracking-wider mb-2">By source</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-xs font-bold uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Source</th>
                  <th className="px-3 py-2 text-right">Donations</th>
                  <th className="px-3 py-2 text-right">Gift Aid</th>
                  <th className="px-3 py-2 text-right">Temple receives</th>
                  <th className="px-3 py-2 text-right"># Txns</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s, i) => (
                  <tr key={s.source} className="border-t border-white/5 hover:bg-white/3">
                    <td className="px-3 py-2 text-white font-semibold flex items-center gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SOURCE_COLOURS[i % SOURCE_COLOURS.length] }} />
                      {sourceLabel(s.source)}
                    </td>
                    <td className="px-3 py-2 text-right text-white/80">{fmtCurrency(s.amount)}</td>
                    <td className="px-3 py-2 text-right text-green-400">{fmtCurrency(s.gift_aid)}</td>
                    <td className="px-3 py-2 text-right text-saffron-300 font-bold">{fmtCurrency(s.amount + s.gift_aid)}</td>
                    <td className="px-3 py-2 text-right text-white/40">{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Per-device breakdown — rendered only when this branch has any
              attributed device activity, to keep the card lean on org-wide
              "All branches" when most rows are unattributed. */}
          {devices.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-white/60 text-xs font-bold uppercase tracking-wider mb-2">By device</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/40 text-xs font-bold uppercase tracking-wider">
                    <th className="px-3 py-2 text-left">Device</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-right">Donations</th>
                    <th className="px-3 py-2 text-right">Gift Aid</th>
                    <th className="px-3 py-2 text-right">Temple receives</th>
                    <th className="px-3 py-2 text-right"># Txns</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d, i) => (
                    <tr key={d.kiosk_device_id ?? `unattr-${i}`} className="border-t border-white/5 hover:bg-white/3">
                      <td className="px-3 py-2 text-white font-semibold">
                        {d.device_name}
                        {!d.kiosk_device_id && (
                          <span className="ml-2 text-[10px] uppercase text-white/30">no device id</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-white/50 text-xs">{d.device_type || '—'}</td>
                      <td className="px-3 py-2 text-right text-white/80">{fmtCurrency(d.amount)}</td>
                      <td className="px-3 py-2 text-right text-green-400">{fmtCurrency(d.gift_aid)}</td>
                      <td className="px-3 py-2 text-right text-saffron-300 font-bold">{fmtCurrency(d.with_gift_aid)}</td>
                      <td className="px-3 py-2 text-right text-white/40">{d.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
