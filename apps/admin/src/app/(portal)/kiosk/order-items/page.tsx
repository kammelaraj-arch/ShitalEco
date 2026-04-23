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

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Items', value: total.toLocaleString(), icon: '🛒' },
          { label: 'Showing', value: items.length.toString(), icon: '📋' },
          { label: 'Revenue (shown)', value: `£${totalRevenue.toFixed(2)}`, icon: '💷' },
        ].map(c => (
          <div key={c.label} className="glass rounded-2xl p-4 border border-temple-border">
            <p className="text-2xl mb-1">{c.icon}</p>
            <p className="text-2xl font-black text-white">{c.value}</p>
            <p className="text-white/40 text-xs mt-0.5">{c.label}</p>
          </div>
        ))}
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
