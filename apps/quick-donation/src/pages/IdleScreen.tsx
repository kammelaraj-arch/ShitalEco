import React from 'react'
import { motion } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'

export function IdleScreen() {
  const { setScreen } = useDonationStore()

  const handleTouch = () => setScreen('donate')

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center bg-temple-gradient cursor-pointer"
      onClick={handleTouch}
      onTouchStart={handleTouch}
    >
      {/* Animated background rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {[1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            className="absolute rounded-full border border-saffron-400/10"
            style={{ width: i * 220, height: i * 220 }}
            animate={{ scale: [1, 1.05, 1], opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 4, delay: i * 0.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
      </div>

      {/* Om symbol */}
      <motion.div
        className="text-8xl mb-6 select-none"
        animate={{ y: [0, -12, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        🙏
      </motion.div>

      {/* Temple name */}
      <motion.h1
        className="text-5xl font-black text-gold-gradient mb-2 tracking-tight"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        Quick Donation
      </motion.h1>

      <motion.p
        className="text-saffron-300 text-xl mb-2 font-light tracking-widest uppercase"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        Shital Temple
      </motion.p>

      <motion.p
        className="text-saffron-400/70 text-lg font-gujarati mb-16"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      >
        દાન કરો | दान करें
      </motion.p>

      {/* Touch to donate button */}
      <motion.div
        className="relative"
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <motion.div
          className="absolute inset-0 rounded-full bg-saffron-400/30 blur-xl"
          animate={{ scale: [0.8, 1.3, 0.8], opacity: [0.5, 0.2, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <button className="relative z-10 bg-saffron-gradient text-white font-black text-2xl px-16 py-6 rounded-full shadow-2xl tracking-wide ripple">
          Tap to Donate
        </button>
      </motion.div>

      {/* Contactless icon hint */}
      <motion.div
        className="mt-8 flex items-center gap-2 text-saffron-400/40"
        animate={{ opacity: [0.4, 0.8, 0.4] }}
        transition={{ duration: 3, repeat: Infinity }}
      >
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8.5 14.5A7 7 0 0 0 13 17m-5.5-5A5 5 0 0 0 11 14m-3.5-5A3 3 0 0 0 9 11" strokeLinecap="round" />
        </svg>
        <span className="text-sm">Contactless Tap & Go</span>
      </motion.div>

      {/* Footer */}
      <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-1">
        <p className="text-saffron-400/30 text-sm">UK Registered Charity</p>
        <p className="text-saffron-400/20 text-xs">Jay Shri Krishna</p>
      </div>

      {/* Hidden admin button — 5 taps on corner */}
      <div
        className="absolute top-0 right-0 w-20 h-20"
        onDoubleClick={() => setScreen('admin')}
      />
    </div>
  )
}
