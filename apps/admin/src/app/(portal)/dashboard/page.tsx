'use client'
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { apiFetch } from '@/lib/api'

interface Stats {
  total_items: number
  live_items: number
  total_orders: number
  today_orders: number
  total_revenue: number
  total_employees: number
  monthly_revenue: { month: string; amount: number }[]
  recent_orders: {
    reference: string
    customer_name: string | null
    total_amount: number
    status: string
    created_at: string
  }[]
}

function fmt(n: number) {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`
  return `${Math.floor(diff / 86400)} day ago`
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch<Stats>('/admin/stats')
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const statCards = stats
    ? [
        {
          label: 'Total Revenue',
          value: fmt(stats.total_revenue),
          sub: `${stats.total_orders} orders total`,
          icon: '💰',
          color: 'from-amber-600 to-orange-500',
        },
        {
          label: "Today's Orders",
          value: String(stats.today_orders),
          sub: `${stats.total_orders} all time`,
          icon: '🧾',
          color: 'from-blue-600 to-indigo-500',
        },
        {
          label: 'Live Catalog Items',
          value: String(stats.live_items),
          sub: `${stats.total_items} total items`,
          icon: '📦',
          color: 'from-green-600 to-emerald-500',
        },
        {
          label: 'Employees',
          value: String(stats.total_employees || '—'),
          sub: 'Active staff',
          icon: '👥',
          color: 'from-purple-600 to-violet-500',
        },
      ]
    : []

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-white">{greeting} 🙏</h1>
        <p className="text-white/40 mt-1">Here&apos;s what&apos;s happening at Shital Temple today</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass rounded-2xl p-6 animate-pulse h-36" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          {statCards.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="glass rounded-2xl p-6 stat-card relative overflow-hidden"
            >
              <div className={`absolute top-0 right-0 w-24 h-24 rounded-full bg-gradient-to-br ${stat.color} opacity-10 blur-2xl`} />
              <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${stat.color} flex items-center justify-center text-xl mb-4 shadow-lg`}>
                {stat.icon}
              </div>
              <p className="text-white/50 text-sm font-medium mb-1">{stat.label}</p>
              <p className="text-3xl font-black text-white mb-2">{stat.value}</p>
              <p className="text-white/30 text-xs">{stat.sub}</p>
            </motion.div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {/* Revenue chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="col-span-2 glass rounded-2xl p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-white font-bold text-lg">Donation Revenue</h2>
              <p className="text-white/40 text-sm">Last 12 months — live from database</p>
            </div>
          </div>
          {stats?.monthly_revenue && stats.monthly_revenue.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={stats.monthly_revenue}>
                <defs>
                  <linearGradient id="donGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FF9933" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#FF9933" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: '#1a0a00', border: '1px solid rgba(255,153,51,0.2)', borderRadius: '12px', color: '#fff' }}
                  formatter={(v: number) => [`£${v.toLocaleString()}`, 'Revenue']}
                />
                <Area type="monotone" dataKey="amount" stroke="#FF9933" strokeWidth={2} fill="url(#donGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-white/30">
              <div className="text-center">
                <p className="text-4xl mb-2">📊</p>
                <p className="text-sm">No revenue data yet — process orders to see the chart</p>
              </div>
            </div>
          )}
        </motion.div>

        {/* Quick links */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="glass rounded-2xl p-6"
        >
          <h2 className="text-white font-bold text-lg mb-4">Quick Actions</h2>
          <div className="space-y-2">
            {[
              { href: '/kiosk/items', icon: '📦', label: 'Manage Catalog Items' },
              { href: '/kiosk/orders', icon: '🧾', label: 'View Kiosk Orders' },
              { href: '/kiosk/services', icon: '🛕', label: 'Manage Services' },
              { href: '/settings/users', icon: '🔐', label: 'Users & Roles' },
              { href: '/finance', icon: '💰', label: 'Finance Accounts' },
              { href: '/hr', icon: '👥', label: 'HR Employees' },
            ].map((link) => (
              <a key={link.href} href={link.href}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-all group">
                <span className="text-xl">{link.icon}</span>
                <span className="text-white/70 text-sm font-medium group-hover:text-white transition-colors">{link.label}</span>
                <span className="ml-auto text-white/20 group-hover:text-saffron-400 transition-colors">→</span>
              </a>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Recent orders */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="glass rounded-2xl p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-lg">Recent Orders</h2>
          <a href="/kiosk/orders" className="text-saffron-400 text-sm hover:text-saffron-300 transition-colors">View all →</a>
        </div>
        {stats?.recent_orders && stats.recent_orders.length > 0 ? (
          <div className="space-y-2">
            {stats.recent_orders.map((order) => (
              <div key={order.reference} className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-all">
                <div className="w-10 h-10 rounded-full bg-saffron-gradient flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {(order.customer_name || '?').slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm">{order.customer_name || 'Anonymous'}</p>
                  <p className="text-white/40 text-xs font-mono">{order.reference}</p>
                </div>
                <div className="text-right">
                  <p className="text-saffron-400 font-bold text-sm">{fmt(order.total_amount)}</p>
                  <p className="text-white/30 text-xs">{timeAgo(order.created_at)}</p>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  order.status === 'PAID' ? 'bg-green-500/20 text-green-400' :
                  order.status === 'PENDING' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-white/10 text-white/40'}`}>
                  {order.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-white/30">
            <p className="text-3xl mb-2">🧾</p>
            <p className="text-sm">No orders yet — kiosk transactions will appear here</p>
          </div>
        )}
      </motion.div>
    </div>
  )
}
