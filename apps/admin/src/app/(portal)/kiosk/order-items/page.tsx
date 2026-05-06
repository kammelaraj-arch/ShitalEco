'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'bg-green-500/20 text-green-300 border-green-500/30',
  PENDING:   'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  FAILED:    'bg-red-500/20 text-red-300 border-red-500/30',
  CANCELLED: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
}

const TYPE_COLORS: Record<string, string> = {
  DONATION: 'bg-saffron-500/20 text-saffron-300 border-saffron-500/30',
  SERVICE:  'bg-blue-500/20 text-blue-300 border-blue-500/30',
}

interface OrderItem {
  id: string
  order_ref: string
  order_status: string
  order_date: string
  branch_id: string
  customer_name: string | null
  customer_email: string | null
  payment_provider: string | null
  item_type: string
  name: string
  description: string | null
  quantity: number
  unit_price: number
  total_price: number
}

export default function OrderItemsPage() {
  const [items, setItems] = useState<OrderItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [orderRef, setOrderRef] = useState('')
  const [branchId, setBranchId] = useState('')
  const [page, setPage] = useState(1)
  const PER_PAGE = 100

  const load = useCallback(async (ref = orderRef, bid = branchId, pg = page) => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ page: String(pg), per_page: String(PER_PAGE) })
      if (ref) params.set('order_ref', ref)
      if (bid) params.set('branch_id', bid)
      const res = await fetch(`${API}/admin/order-items?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('shital_access_token') || ''}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch (e: unknown) {
      setError(`Failed to load: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally { setLoading(false) }
  }, [orderRef, branchId, page])

  useEffect(() => { load() }, [load])

  function search() { setPage(1); load(orderRef, branchId, 1) }
  const fmt = (dt: string) => new Date(dt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  const totalPages = Math.ceil(total / PER_PAGE)

  const totalRevenue = items.reduce((s, i) => s + Number(i.total_price), 0)

  // Per-status breakdown (count + sum) for the cards + pie chart.
  const byStatus = items.reduce<Record<string, { count: number; sum: number }>>((acc, it) => {
    const k = it.order_status || 'UNKNOWN'
    if (!acc[k]) acc[k] = { count: 0, sum: 0 }
    acc[k].count += 1
    acc[k].sum   += Number(it.total_price)
    return acc
  }, {})
  // Slice colours for the pie — match the badge colours in the table.
  const STATUS_PIE: Record<string, string> = {
    COMPLETED: '#22C55E', // green-500
    PENDING:   '#EAB308', // yellow-500
    FAILED:    '#EF4444', // red-500
    CANCELLED: '#9CA3AF', // gray-400
    UNKNOWN:   '#6366F1', // indigo-500
  }
  const slices = Object.entries(byStatus)
    .map(([status, v]) => ({ status, ...v, color: STATUS_PIE[status] || '#6366F1' }))
    .filter(s => s.sum > 0)
    .sort((a, b) => b.sum - a.sum)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Order Items</h1>
          <p className="text-white/40 mt-1">{total.toLocaleString()} line items across all kiosk orders</p>
        </div>
        <button onClick={() => load()} className="px-4 py-2 rounded-xl border border-white/10 text-white/60 text-sm font-medium hover:bg-white/5 transition-all">
          ↻ Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="glass rounded-2xl p-4 border border-temple-border flex flex-wrap gap-3">
        <input
          value={orderRef} onChange={e => setOrderRef(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Filter by order ref (e.g. ORD-…)"
          className="flex-1 min-w-48 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-saffron-500/50"
        />
        <select value={branchId} onChange={e => { setBranchId(e.target.value); setPage(1); load(orderRef, e.target.value, 1) }}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-saffron-500/50">
          <option value="">All branches</option>
          <option value="main">Wembley (main)</option>
          <option value="leicester">Leicester</option>
          <option value="reading">Reading</option>
          <option value="mk">Milton Keynes</option>
        </select>
        <button onClick={search} className="px-5 py-2 rounded-xl bg-saffron-500/20 text-saffron-300 border border-saffron-500/30 text-sm font-semibold hover:bg-saffron-500/30 transition-all">
          Search
        </button>
      </div>

      {/* Summary — per-status totals + pie chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Status breakdown cards (left two columns) */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(['COMPLETED', 'PENDING', 'FAILED', 'CANCELLED'] as const).map(s => (
            <div key={s} className="glass rounded-2xl p-4 border border-temple-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_PIE[s] }} />
                <p className="text-white/40 text-xs uppercase tracking-wider font-semibold">{s}</p>
              </div>
              <p className="text-2xl font-black text-white">£{(byStatus[s]?.sum ?? 0).toFixed(2)}</p>
              <p className="text-white/30 text-xs mt-0.5">
                {byStatus[s]?.count ?? 0} item{(byStatus[s]?.count ?? 0) === 1 ? '' : 's'}
              </p>
            </div>
          ))}
          <div className="glass rounded-2xl p-4 border border-temple-border bg-saffron-500/5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">💷</span>
              <p className="text-saffron-300 text-xs uppercase tracking-wider font-semibold">Total (shown)</p>
            </div>
            <p className="text-2xl font-black text-white">£{totalRevenue.toFixed(2)}</p>
            <p className="text-white/30 text-xs mt-0.5">{items.length} of {total} items</p>
          </div>
          <div className="glass rounded-2xl p-4 border border-temple-border">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">🛒</span>
              <p className="text-white/40 text-xs uppercase tracking-wider font-semibold">All Items</p>
            </div>
            <p className="text-2xl font-black text-white">{total.toLocaleString()}</p>
            <p className="text-white/30 text-xs mt-0.5">across all kiosk orders</p>
          </div>
        </div>

        {/* Pie chart (right column) */}
        <div className="glass rounded-2xl p-4 border border-temple-border flex flex-col items-center justify-center">
          <p className="text-white/40 text-xs uppercase tracking-wider font-semibold mb-3 self-start">By status (£)</p>
          {slices.length === 0 ? (
            <p className="text-white/30 text-sm py-8">No data</p>
          ) : (
            <>
              <StatusPie slices={slices} totalRevenue={totalRevenue} />
              <div className="mt-3 w-full space-y-1">
                {slices.map(s => (
                  <div key={s.status} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                      <span className="text-white/70 font-medium">{s.status}</span>
                    </div>
                    <span className="text-white/50 font-mono">
                      £{s.sum.toFixed(2)} · {((s.sum / totalRevenue) * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {loading ? (
        <div className="text-center py-20 text-white/30">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 text-white/30">
          <p className="text-4xl mb-3">🛒</p>
          <p>No order items found.</p>
        </div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden border border-temple-border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Order', 'Customer', 'Item', 'Type', 'Qty', 'Unit £', 'Total £', 'Status', 'Branch', 'Date'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <motion.tr key={item.id}
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.015 }}
                    className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-saffron-400 font-bold text-sm font-mono">{item.order_ref}</p>
                      <p className="text-white/20 text-xs">{item.payment_provider || ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-white text-sm">{item.customer_name || '—'}</p>
                      <p className="text-white/30 text-xs truncate max-w-32">{item.customer_email || ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-white text-sm font-medium">{item.name}</p>
                      {item.description && <p className="text-white/30 text-xs truncate max-w-40">{item.description}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${TYPE_COLORS[item.item_type] || 'bg-white/5 text-white/40 border-white/10'}`}>
                        {item.item_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white font-bold">{item.quantity}</td>
                    <td className="px-4 py-3 text-white/60 text-sm">£{Number(item.unit_price).toFixed(2)}</td>
                    <td className="px-4 py-3 text-white font-bold text-sm">£{Number(item.total_price).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${STATUS_COLORS[item.order_status] || STATUS_COLORS.PENDING}`}>
                        {item.order_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/50 text-sm capitalize">{item.branch_id}</td>
                    <td className="px-4 py-3 text-white/50 text-sm">{fmt(item.order_date)}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-white/5">
              <p className="text-white/40 text-sm">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <button disabled={page === 1} onClick={() => { setPage(p => p - 1); load(orderRef, branchId, page - 1) }}
                  className="px-3 py-1.5 rounded-lg border border-white/10 text-white/60 text-sm disabled:opacity-30 hover:bg-white/5">← Prev</button>
                <button disabled={page >= totalPages} onClick={() => { setPage(p => p + 1); load(orderRef, branchId, page + 1) }}
                  className="px-3 py-1.5 rounded-lg border border-white/10 text-white/60 text-sm disabled:opacity-30 hover:bg-white/5">Next →</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Inline SVG pie (no chart library — keeps the bundle slim) ──────────────
// Renders one path per slice. For a single 100%-slice we draw a full circle
// since SVG arc paths can't represent a 360° arc cleanly.
function StatusPie({
  slices,
  totalRevenue,
}: {
  slices: { status: string; sum: number; color: string }[]
  totalRevenue: number
}) {
  const size = 160
  const r = 70
  const cx = size / 2
  const cy = size / 2

  if (slices.length === 1) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill={slices[0].color} />
        <circle cx={cx} cy={cy} r={r * 0.5} fill="rgba(20,20,20,0.92)" />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
          fill="white" fontSize="14" fontWeight="900">
          £{Math.round(totalRevenue)}
        </text>
      </svg>
    )
  }

  let cum = 0
  const paths = slices.map(s => {
    const start = cum
    const slice = s.sum / totalRevenue
    cum += slice
    const a0 = start * Math.PI * 2 - Math.PI / 2
    const a1 = cum   * Math.PI * 2 - Math.PI / 2
    const x0 = cx + r * Math.cos(a0)
    const y0 = cy + r * Math.sin(a0)
    const x1 = cx + r * Math.cos(a1)
    const y1 = cy + r * Math.sin(a1)
    const largeArc = slice > 0.5 ? 1 : 0
    return {
      d: `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z`,
      color: s.color,
    }
  })

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.color} stroke="rgba(20,20,20,0.92)" strokeWidth="1" />
      ))}
      {/* Donut hole + total in centre */}
      <circle cx={cx} cy={cy} r={r * 0.5} fill="rgba(20,20,20,0.92)" />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
        fill="white" fontSize="14" fontWeight="900">
        £{Math.round(totalRevenue)}
      </text>
    </svg>
  )
}
