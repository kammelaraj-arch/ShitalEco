'use client'
import { motion } from 'framer-motion'

const CATEGORIES = ['Furniture', 'IT Equipment', 'Vehicles', 'Property', 'AV Equipment', 'Kitchen']

export default function AssetsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Assets</h1>
          <p className="text-white/40 mt-1">Fixed assets register and depreciation tracking</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <span className="text-amber-400 text-sm">🚧 Module coming in next release</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Assets Value', value: '—', icon: '🏗️', color: 'from-blue-600 to-indigo-500' },
          { label: 'YTD Depreciation', value: '—', icon: '📉', color: 'from-red-600 to-rose-500' },
          { label: 'Net Book Value', value: '—', icon: '💼', color: 'from-green-600 to-emerald-500' },
          { label: 'Total Assets', value: '—', icon: '📋', color: 'from-purple-600 to-violet-500' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="glass rounded-2xl p-5 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-lg mb-3`}>{s.icon}</div>
            <p className="text-white/50 text-xs font-medium">{s.label}</p>
            <p className="text-3xl font-black text-white mt-1">{s.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="flex gap-3">
        {CATEGORIES.map(c => (
          <button key={c} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-white/10 text-white/40 hover:text-white/70 transition-all">{c}</button>
        ))}
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl overflow-hidden border border-temple-border">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/5">
              {['Asset Name', 'Category', 'Purchase Date', 'Cost', 'Net Book Value', 'Depreciation Rate', 'Status'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={7} className="text-center py-16 text-white/30">
                <p className="text-4xl mb-3">🏗️</p>
                <p>No assets registered yet.</p>
                <p className="text-xs mt-1 text-white/20">Asset management will link to finance accounts for automatic depreciation journals.</p>
              </td>
            </tr>
          </tbody>
        </table>
      </motion.div>
    </div>
  )
}
