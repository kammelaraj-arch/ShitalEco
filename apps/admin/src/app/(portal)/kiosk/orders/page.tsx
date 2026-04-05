'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  PAID:      'bg-green-500/20 text-green-300 border-green-500/30',
  FAILED:    'bg-red-500/20 text-red-300 border-red-500/30',
  CANCELLED: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  REFUNDED:  'bg-blue-500/20 text-blue-300 border-blue-500/30',
}

interface Order {
  id: string
  reference: string
  branch_id: string
  status: string
  total_amount: number
  currency: string
  payment_provider: string
  customer_name: string | null
  customer_email: string | null
  created_at: string
}

export default function KioskOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/admin/orders?limit=50`)
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setOrders(data.orders || [])
    } catch (e: unknown) {
      setError(`Failed to load orders: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const fmt = (dt: string) => new Date(dt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Kiosk Orders</h1>
          <p className="text-white/40 mt-1">All transactions processed through the kiosk terminal</p>
        </div>
        <button onClick={load} className="px-4 py-2 rounded-xl border border-white/10 text-white/60 text-sm font-medium hover:bg-white/5 transition-all">
          ↻ Refresh
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {loading ? (
        <div className="text-center py-20 text-white/30">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20 text-white/30">
          <p className="text-4xl mb-3">🧾</p>
          <p>No orders yet. Kiosk transactions will appear here.</p>
        </div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden border border-temple-border">
          <div className="overflow-x-auto"><table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-5 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Reference</th>
                <th className="text-left px-5 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Customer</th>
                <th className="text-left px-5 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Amount</th>
                <th className="text-left px-5 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Branch</th>
                <th className="text-left px-5 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => (
                <motion.tr key={o.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-5 py-4">
                    <p className="text-saffron-400 font-bold text-sm font-mono">{o.reference}</p>
                    <p className="text-white/20 text-xs mt-0.5">{o.payment_provider || 'STRIPE_TERMINAL'}</p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-white text-sm">{o.customer_name || '—'}</p>
                    <p className="text-white/30 text-xs">{o.customer_email || ''}</p>
                  </td>
                  <td className="px-5 py-4 text-white font-bold">
                    £{Number(o.total_amount).toFixed(2)}
                  </td>
                  <td className="px-5 py-4">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${STATUS_COLORS[o.status] || STATUS_COLORS.PENDING}`}>
                      {o.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-white/50 text-sm capitalize">{o.branch_id}</td>
                  <td className="px-5 py-4 text-white/50 text-sm">{fmt(o.created_at)}</td>
                </motion.tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  )
}