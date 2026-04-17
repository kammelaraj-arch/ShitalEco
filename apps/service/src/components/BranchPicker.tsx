import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'
import { api } from '../api'

interface Branch {
  branch_id: string
  name: string
  city: string
  is_active: boolean
}

export function BranchPicker() {
  const { setBranch } = useStore()
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getBranches().then((list) => {
      setBranches(list)
      setLoading(false)
    })
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        {/* Hero */}
        <div className="text-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 shadow-lg"
            style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)' }}
          >🕉</div>
          <h1 className="text-2xl font-black text-gray-900 mb-1">Shri Shirdi Saibaba Temple</h1>
          <p className="text-orange-600 text-xs font-semibold tracking-wide mb-0.5">SHITAL · Charity No. 1138530</p>
          <p className="text-gray-400 text-sm">Which temple would you like to donate to?</p>
        </div>

        {/* Branch list */}
        {loading ? (
          <div className="flex justify-center py-8">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              className="text-4xl"
            >🕉</motion.div>
          </div>
        ) : branches.length === 0 ? (
          /* No branches in DB — go straight to main */
          <div className="text-center">
            <button
              onClick={() => setBranch('main', 'Shital Temple', false)}
              className="w-full py-4 rounded-2xl text-white font-black text-base shadow-lg"
              style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)' }}
            >
              Enter →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Always include "All / Main" option */}
            <BranchCard
              name="All Temples"
              city="General donation"
              emoji="🕉"
              onClick={() => setBranch('main', 'All Temples', false)}
            />
            {branches.map((b) => (
              <BranchCard
                key={b.branch_id}
                name={b.name}
                city={b.city}
                emoji={cityEmoji(b.city)}
                onClick={() => setBranch(b.branch_id, b.name, false)}
              />
            ))}
          </div>
        )}
      </motion.div>
    </div>
  )
}

function BranchCard({
  name, city, emoji, onClick,
}: {
  name: string; city: string; emoji: string; onClick: () => void
}) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-4 text-left hover:border-orange-200 transition-colors"
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
        style={{ background: 'linear-gradient(135deg,#FFF3E0,#FFE0B2)' }}
      >
        {emoji}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-gray-900 truncate">{name}</p>
        {city && <p className="text-sm text-gray-400 truncate">{city}</p>}
      </div>
      <svg className="w-5 h-5 text-orange-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
      </svg>
    </motion.button>
  )
}

function cityEmoji(city: string): string {
  const c = city.toLowerCase()
  if (c.includes('london') || c.includes('wembley') || c.includes('hounslow')) return '🏙️'
  if (c.includes('milton') || c.includes('mk')) return '🏘️'
  if (c.includes('leicester')) return '🦊'
  if (c.includes('reading')) return '📚'
  if (c.includes('slough')) return '🌿'
  if (c.includes('dartford')) return '🌉'
  if (c.includes('birmingham')) return '🌆'
  if (c.includes('manchester')) return '🏭'
  if (c.includes('leeds')) return '🌃'
  return '🛕'
}
