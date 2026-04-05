'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'

const CATEGORIES = [
  { id: 'policies', label: 'Policies', icon: '📋', count: 0 },
  { id: 'finance', label: 'Finance', icon: '💰', count: 0 },
  { id: 'hr', label: 'HR', icon: '👥', count: 0 },
  { id: 'compliance', label: 'Compliance', icon: '⚖️', count: 0 },
  { id: 'templates', label: 'Templates', icon: '📝', count: 0 },
  { id: 'reports', label: 'Reports', icon: '📊', count: 0 },
]

export default function DocumentsPage() {
  const [activeCategory, setActiveCategory] = useState('policies')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Documents</h1>
          <p className="text-white/40 mt-1">Temple documents and compliance files</p>
        </div>
        <button className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90">
          + Upload Document
        </button>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 text-blue-300 text-sm">
        ℹ️ Document storage will integrate with Azure Blob Storage. This module is in development.
      </div>

      <div className="flex gap-4">
        {/* Category sidebar */}
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="w-48 flex-shrink-0 space-y-1">
          {CATEGORIES.map(cat => (
            <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${activeCategory === cat.id ? 'bg-saffron-400/15 text-saffron-400 border border-saffron-400/30' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}>
              <span>{cat.icon}</span>
              <span className="flex-1">{cat.label}</span>
              <span className="text-xs text-white/20">{cat.count}</span>
            </button>
          ))}
        </motion.div>

        {/* Document grid */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex-1">
          <div className="glass rounded-2xl p-6 min-h-[400px] flex flex-col items-center justify-center">
            <p className="text-6xl mb-4">📁</p>
            <p className="text-white/40 text-lg font-semibold">No documents in this category</p>
            <p className="text-white/20 text-sm mt-1">Upload documents to organise and share with your team</p>
            <button className="mt-6 px-6 py-3 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/5 transition-all">
              Upload First Document
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
