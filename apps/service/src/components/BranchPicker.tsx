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
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: '#060100' }}>

      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 70% 50% at 50% 30%, rgba(212,175,55,0.07) 0%, transparent 65%)',
        }} />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm relative z-10"
      >
        {/* Hero */}
        <div className="text-center mb-10">
          <motion.div
            animate={{ boxShadow: ['0 0 20px rgba(212,175,55,0.2)', '0 0 50px rgba(212,175,55,0.5)', '0 0 20px rgba(212,175,55,0.2)'] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl mx-auto mb-6"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)', color: '#1A0606' }}
          >
            🛕
          </motion.div>
          <h1 className="font-display font-bold text-2xl text-gold-400 mb-1 tracking-wide">
            Shri Shirdi Saibaba Temple
          </h1>
          <p className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: '#FF9933' }}>
            SHITAL · Charity No. 1138530
          </p>
          <p style={{ color: 'rgba(255,248,220,0.5)' }} className="text-sm">
            Which temple would you like to visit?
          </p>
        </div>

        {/* Divider */}
        <div className="divider-gold mb-6" />

        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="text-4xl"
            >🕉</motion.div>
            <p className="text-xs tracking-widest uppercase" style={{ color: 'rgba(212,175,55,0.5)' }}>
              Loading…
            </p>
          </div>
        ) : branches.length === 0 ? (
          <button
            onClick={() => setBranch('main', 'Shital Temple', false)}
            className="btn-gold"
          >
            Enter the Temple →
          </button>
        ) : (
          <div className="space-y-3">
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

        <p className="text-center text-xs mt-8" style={{ color: 'rgba(255,248,220,0.2)' }}>
          🙏 Jai Sai Baba
        </p>
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
      whileHover={{ y: -2, borderColor: 'rgba(212,175,55,0.5)' }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="w-full temple-card p-4 flex items-center gap-4 text-left"
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
        style={{ background: 'rgba(212,175,55,0.12)' }}
      >
        {emoji}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-ivory-200 truncate text-sm">{name}</p>
        {city && <p className="text-xs truncate mt-0.5" style={{ color: 'rgba(255,248,220,0.45)' }}>{city}</p>}
      </div>
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"
        style={{ color: '#D4AF37' }}>
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
