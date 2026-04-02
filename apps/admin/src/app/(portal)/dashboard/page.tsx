'use client'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'

const DONATION_DATA = [
  { month: 'Jan', amount: 4200 }, { month: 'Feb', amount: 3800 }, { month: 'Mar', amount: 5100 },
  { month: 'Apr', amount: 6200 }, { month: 'May', amount: 5800 }, { month: 'Jun', amount: 7400 },
  { month: 'Jul', amount: 8100 }, { month: 'Aug', amount: 7200 }, { month: 'Sep', amount: 9500 },
  { month: 'Oct', amount: 8800 }, { month: 'Nov', amount: 10200 }, { month: 'Dec', amount: 12500 },
]

const STATS = [
  { label: 'Total Donations (YTD)', value: '£88,800', change: '+12.4%', up: true, icon: '💰', color: 'from-amber-600 to-orange-500' },
  { label: 'Gift Aid Claimed', value: '£22,200', change: '+12.4%', up: true, icon: '🇬🇧', color: 'from-blue-600 to-indigo-500' },
  { label: 'Active Employees', value: '24', change: '+2', up: true, icon: '👥', color: 'from-green-600 to-emerald-500' },
  { label: 'Assets Value', value: '£1.2M', change: '-£8.4K', up: false, icon: '🏗️', color: 'from-purple-600 to-violet-500' },
]

const RECENT_DONATIONS = [
  { name: 'Priya Patel', amount: '£250', purpose: 'Temple Maintenance', time: '2 min ago', initials: 'PP' },
  { name: 'Raj Sharma', amount: '£100', purpose: 'General Fund', time: '15 min ago', initials: 'RS' },
  { name: 'Meera Nair', amount: '£50', purpose: 'Youth Education', time: '1 hr ago', initials: 'MN' },
  { name: 'Anil Kumar', amount: '£500', purpose: 'Festival Fund', time: '3 hr ago', initials: 'AK' },
  { name: 'Sita Devi', amount: '£25', purpose: 'Food Bank Seva', time: '5 hr ago', initials: 'SD' },
]

const PENDING_ACTIONS = [
  { text: '3 leave requests awaiting approval', icon: '🌴', urgency: 'yellow' },
  { text: 'Payroll run due for January 2025', icon: '💷', urgency: 'orange' },
  { text: '2 governance documents overdue for review', icon: '⚖️', urgency: 'red' },
  { text: 'Asset maintenance scheduled for next week', icon: '🔧', urgency: 'blue' },
]

export default function DashboardPage() {
  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-black text-white">Good morning 🙏</h1>
        <p className="text-white/40 mt-1">Here's what's happening at Shital Temple today</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-5">
        {STATS.map((stat, i) => (
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
            <span className={`text-sm font-semibold ${stat.up ? 'text-green-400' : 'text-red-400'}`}>
              {stat.up ? '↑' : '↓'} {stat.change}
            </span>
          </motion.div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-5">
        {/* Donations chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="col-span-2 glass rounded-2xl p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-white font-bold text-lg">Donation Revenue</h2>
              <p className="text-white/40 text-sm">2024 — Monthly breakdown</p>
            </div>
            <div className="flex gap-2">
              {['6M', '1Y', 'All'].map((t) => (
                <button key={t} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${t === '1Y' ? 'bg-saffron-400/20 text-saffron-400' : 'text-white/30 hover:text-white/60'}`}>{t}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={DONATION_DATA}>
              <defs>
                <linearGradient id="donGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FF9933" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#FF9933" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `£${v / 1000}k`} />
              <Tooltip
                contentStyle={{ background: '#1a0a00', border: '1px solid rgba(255,153,51,0.2)', borderRadius: '12px', color: '#fff' }}
                formatter={(v: number) => [`£${v.toLocaleString()}`, 'Donations']}
              />
              <Area type="monotone" dataKey="amount" stroke="#FF9933" strokeWidth={2} fill="url(#donGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Pending actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="glass rounded-2xl p-6"
        >
          <h2 className="text-white font-bold text-lg mb-4">Pending Actions</h2>
          <div className="space-y-3">
            {PENDING_ACTIONS.map((action) => (
              <div key={action.text} className={`flex items-start gap-3 p-3 rounded-xl bg-${action.urgency}-500/10 border border-${action.urgency}-500/20`}>
                <span className="text-xl flex-shrink-0">{action.icon}</span>
                <p className="text-white/70 text-sm leading-snug">{action.text}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Recent donations + AI assistant */}
      <div className="grid grid-cols-3 gap-5">
        {/* Recent donations */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="col-span-2 glass rounded-2xl p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-bold text-lg">Recent Donations</h2>
            <a href="/donations" className="text-saffron-400 text-sm hover:text-saffron-300">View all →</a>
          </div>
          <div className="space-y-3">
            {RECENT_DONATIONS.map((don) => (
              <div key={don.name} className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-all cursor-pointer">
                <div className="w-10 h-10 rounded-full bg-saffron-gradient flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {don.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm">{don.name}</p>
                  <p className="text-white/40 text-xs truncate">{don.purpose}</p>
                </div>
                <div className="text-right">
                  <p className="text-saffron-400 font-bold">{don.amount}</p>
                  <p className="text-white/30 text-xs">{don.time}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Quick AI chat */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="glass rounded-2xl p-6 flex flex-col"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-saffron-gradient flex items-center justify-center text-xl">🧠</div>
            <div>
              <h2 className="text-white font-bold">Digital Brain</h2>
              <p className="text-white/40 text-xs">AI Assistant · Online</p>
            </div>
          </div>
          <div className="flex-1 bg-black/20 rounded-xl p-4 mb-4 space-y-3 text-sm">
            <div className="flex gap-2">
              <span className="text-xl">🧠</span>
              <div className="glass rounded-2xl rounded-tl-none px-4 py-2.5">
                <p className="text-white/80">Good morning! Donations are up 12.4% this month. Shall I run the Gift Aid claim for Q4?</p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Ask Digital Brain..."
              className="input-field text-sm"
            />
            <button className="btn-primary px-4 text-xl">→</button>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
