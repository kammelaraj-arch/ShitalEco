'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const BRANCHES = [
  { id: 'main', name: 'Wembley Main', city: 'London', postcode: 'HA9 0AA', address: '1 Temple Road, Wembley', phone: '+44 20 0000 0000', email: 'wembley@shital.org', established: '1987', active: true },
  { id: 'leicester', name: 'Leicester Branch', city: 'Leicester', postcode: 'LE1 1AA', address: '15 Temple Street, Leicester', phone: '+44 116 000 0000', email: 'leicester@shital.org', established: '2005', active: true },
  { id: 'reading', name: 'Reading Branch', city: 'Reading', postcode: 'RG1 1AA', address: '8 Temple Lane, Reading', phone: '+44 118 000 0000', email: 'reading@shital.org', established: '2012', active: true },
  { id: 'mk', name: 'Milton Keynes Branch', city: 'Milton Keynes', postcode: 'MK1 1AA', address: '3 Temple Way, Milton Keynes', phone: '+44 1908 000 000', email: 'mk@shital.org', established: '2018', active: true },
]

type Branch = typeof BRANCHES[0]

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

export default function BranchesPage() {
  const [selected, setSelected] = useState<Branch | null>(null)
  const [form, setForm] = useState<Branch | null>(null)

  const openEdit = (b: Branch) => { setSelected(b); setForm({ ...b }) }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-white">Branches</h1>
        <p className="text-white/40 mt-1">Temple branch locations and configuration</p>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-amber-400 text-sm">
        ℹ️ Branch configuration is managed by the system administrator. Contact your admin to add new branches.
      </div>

      <div className="grid grid-cols-2 gap-5">
        {BRANCHES.map((branch, i) => (
          <motion.div key={branch.id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
            className="glass rounded-2xl p-6 border border-temple-border hover:border-saffron-400/20 transition-all">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-saffron-gradient flex items-center justify-center text-white text-xl flex-shrink-0">
                  🛕
                </div>
                <div>
                  <h3 className="text-white font-black text-lg">{branch.name}</h3>
                  <p className="text-white/40 text-sm">{branch.city} · Est. {branch.established}</p>
                </div>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
                Active
              </span>
            </div>

            <div className="space-y-2 text-sm mb-4">
              <div className="flex items-center gap-2 text-white/50">
                <span>📍</span><span>{branch.address}, {branch.postcode}</span>
              </div>
              <div className="flex items-center gap-2 text-white/50">
                <span>📞</span><span>{branch.phone}</span>
              </div>
              <div className="flex items-center gap-2 text-white/50">
                <span>✉️</span><span>{branch.email}</span>
              </div>
            </div>

            <button onClick={() => openEdit(branch)}
              className="w-full py-2 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/5 transition-all">
              Edit Details
            </button>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {selected && form && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelected(null)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-[480px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">Edit Branch</h2>
                <button onClick={() => setSelected(null)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div>
                  <label className={lbl}>Branch Name</label>
                  <input value={form.name} onChange={e => setForm(p => p ? { ...p, name: e.target.value } : p)} className={inp} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>City</label>
                    <input value={form.city} onChange={e => setForm(p => p ? { ...p, city: e.target.value } : p)} className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Postcode</label>
                    <input value={form.postcode} onChange={e => setForm(p => p ? { ...p, postcode: e.target.value } : p)} className={inp} />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Address</label>
                  <input value={form.address} onChange={e => setForm(p => p ? { ...p, address: e.target.value } : p)} className={inp} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Phone</label>
                    <input value={form.phone} onChange={e => setForm(p => p ? { ...p, phone: e.target.value } : p)} className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Email</label>
                    <input type="email" value={form.email} onChange={e => setForm(p => p ? { ...p, email: e.target.value } : p)} className={inp} />
                  </div>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-amber-400 text-xs">
                  ℹ️ Branch ID cannot be changed. Contact system admin for structural changes.
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setSelected(null)} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={() => setSelected(null)} className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm">
                  Save Changes
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
