import React from 'react'
import { motion } from 'framer-motion'
import { useKioskStore, t } from '../store/kiosk.store'

const CATEGORIES = [
  {
    id: 'PUJA',
    icon: '🪔',
    color: 'from-orange-600 to-amber-500',
    glow: 'shadow-orange-500/40',
    border: 'border-orange-500/30',
    size: 'large',
  },
  {
    id: 'HAVAN',
    icon: '🔥',
    color: 'from-red-600 to-orange-500',
    glow: 'shadow-red-500/40',
    border: 'border-red-500/30',
    size: 'large',
  },
  {
    id: 'donate',
    icon: '🙏',
    color: 'from-yellow-500 to-amber-400',
    glow: 'shadow-yellow-500/40',
    border: 'border-yellow-500/30',
    size: 'large',
    action: 'donate',
  },
  {
    id: 'CLASS',
    icon: '📚',
    color: 'from-green-600 to-emerald-500',
    glow: 'shadow-green-500/40',
    border: 'border-green-500/30',
    size: 'medium',
  },
  {
    id: 'HALL_HIRE',
    icon: '🏛️',
    color: 'from-purple-600 to-violet-500',
    glow: 'shadow-purple-500/40',
    border: 'border-purple-500/30',
    size: 'medium',
  },
  {
    id: 'FESTIVAL',
    icon: '🎉',
    color: 'from-pink-600 to-rose-500',
    glow: 'shadow-pink-500/40',
    border: 'border-pink-500/30',
    size: 'medium',
  },
]

export function HomeScreen() {
  const { language, setScreen, items } = useKioskStore()
  const itemCount = items.reduce((s, i) => s + i.quantity, 0)
  const total = items.reduce((s, i) => s + i.totalPrice, 0)

  const handleCategoryTap = (cat: typeof CATEGORIES[0]) => {
    if (cat.action === 'donate') {
      setScreen('donate')
    } else {
      // Navigate to services filtered by category
      setScreen('services')
    }
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between px-10 pt-8 pb-4"
      >
        <div>
          <h1 className="text-4xl font-black text-gold-gradient">
            {t('welcome', language)}
          </h1>
          <p className="text-saffron-400/60 text-lg">How can we help you today?</p>
        </div>

        {/* Basket badge */}
        {itemCount > 0 && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            onClick={() => setScreen('basket')}
            className="relative glass-card rounded-3xl px-6 py-4 flex items-center gap-3 border-saffron-400/30 ripple"
          >
            <span className="text-3xl">🛒</span>
            <div className="text-left">
              <p className="text-white font-bold text-lg">{itemCount} item{itemCount !== 1 ? 's' : ''}</p>
              <p className="text-saffron-400 font-black text-xl">£{total.toFixed(2)}</p>
            </div>
            <div className="absolute -top-2 -right-2 bg-saffron-400 text-white text-sm font-black w-7 h-7 rounded-full flex items-center justify-center">
              {itemCount}
            </div>
          </motion.button>
        )}
      </motion.div>

      {/* Category Grid */}
      <div className="flex-1 px-10 py-4 kiosk-scroll">
        <div className="grid grid-cols-3 gap-5 pb-4">
          {CATEGORIES.map((cat, i) => (
            <motion.button
              key={cat.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 + 0.1 }}
              onClick={() => handleCategoryTap(cat)}
              className={`
                relative overflow-hidden rounded-4xl service-card ripple
                bg-gradient-to-br ${cat.color}
                shadow-2xl ${cat.glow}
                border ${cat.border}
                ${cat.size === 'large' ? 'py-10' : 'py-8'}
                flex flex-col items-center justify-center gap-3
              `}
            >
              {/* Shine effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />

              <span className={`${cat.size === 'large' ? 'text-7xl' : 'text-6xl'} animate-float`}
                    style={{ animationDelay: `${i * 0.4}s` }}>
                {cat.icon}
              </span>
              <div className="text-center z-10">
                <p className={`text-white font-black ${cat.size === 'large' ? 'text-2xl' : 'text-xl'}`}>
                  {t(cat.id.toLowerCase().replace('_', '_'), language)}
                </p>
              </div>

              {/* Corner accent */}
              <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-white/40" />
            </motion.button>
          ))}
        </div>
      </div>

      {/* Bottom nav */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="px-10 pb-8 flex gap-4"
      >
        <button
          onClick={() => setScreen('idle')}
          className="flex-1 glass-card rounded-3xl py-4 text-saffron-400/70 font-bold text-lg ripple"
        >
          ← Back
        </button>
        {itemCount > 0 && (
          <button
            onClick={() => setScreen('basket')}
            className="flex-2 bg-saffron-gradient rounded-3xl py-4 px-8 text-white font-black text-xl ripple shadow-lg pay-btn-pulse"
          >
            View Basket ({itemCount}) · £{total.toFixed(2)}
          </button>
        )}
      </motion.div>
    </div>
  )
}
