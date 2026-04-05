'use client'
import { motion } from 'framer-motion'

const PLACEHOLDER_CARDS = [
  { label: 'Total Budget', value: '—', icon: '📋', color: 'from-blue-600 to-indigo-500' },
  { label: 'Spent', value: '—', icon: '💸', color: 'from-red-600 to-rose-500' },
  { label: 'Remaining', value: '—', icon: '💼', color: 'from-green-600 to-emerald-500' },
  { label: 'Variance', value: '—', icon: '⚖️', color: 'from-purple-600 to-violet-500' },
]

const DEPARTMENTS = ['Religious Services', 'Finance & Admin', 'HR & Payroll', 'Events & Community', 'Facilities', 'IT & Systems']

export default function BudgetsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Budgets</h1>
          <p className="text-white/40 mt-1">Annual budget planning and tracking</p>
        </div>
      </div>

      {/* Coming soon banner */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="glass rounded-2xl p-4 border border-saffron-400/30 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-saffron-gradient flex items-center justify-center text-xl shrink-0">🚧</div>
        <div>
          <p className="text-saffron-400 font-bold text-sm">Coming Soon</p>
          <p className="text-white/50 text-sm">Budget module will be linked to finance accounts in the next release.</p>
        </div>
      </motion.div>

      {/* Placeholder summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {PLACEHOLDER_CARDS.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="glass rounded-2xl p-5 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-24 h-24 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-lg mb-3`}>{s.icon}</div>
            <p className="text-white/50 text-xs font-medium mb-1">{s.label}</p>
            <p className="text-3xl font-black text-white/30">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Placeholder table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="p-5 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-white font-bold">Department Budgets</h2>
          <span className="text-xs text-white/30 bg-white/5 px-3 py-1 rounded-full">No data — pending setup</span>
        </div>
        <div className="overflow-x-auto"><table className="w-full">
          <thead>
            <tr className="border-b border-white/5">
              {['Department', 'Budget', 'Spent', 'Remaining', '% Used'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DEPARTMENTS.map((dept, i) => (
              <motion.tr key={dept} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 + i * 0.03 }}
                className="border-b border-white/5">
                <td className="px-4 py-4 text-white/50">{dept}</td>
                <td className="px-4 py-4 text-white/20 font-mono text-sm">—</td>
                <td className="px-4 py-4 text-white/20 font-mono text-sm">—</td>
                <td className="px-4 py-4 text-white/20 font-mono text-sm">—</td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-white/5" />
                    <span className="text-white/20 text-xs">—</span>
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table></div>
        <div className="p-5 border-t border-white/5 text-center text-white/30 text-xs">
          Budget module will be linked to finance accounts in the next release.
        </div>
      </motion.div>
    </div>
  )
}
