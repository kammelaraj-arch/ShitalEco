import React from 'react'
import { motion } from 'framer-motion'
import { useKioskStore } from '../store/kiosk.store'

export function IdleScreen() {
  const { setScreen } = useKioskStore()

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center bg-temple-gradient cursor-pointer"
      onClick={() => setScreen('home')}
      onTouchStart={() => setScreen('home')}
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
        🕉️
      </motion.div>

      {/* Temple name */}
      <motion.h1
        className="text-5xl font-black text-gold-gradient mb-2 tracking-tight"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        Shital
      </motion.h1>

      <motion.p
        className="text-saffron-300 text-xl mb-2 font-light tracking-widest uppercase"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        Self Service
      </motion.p>

      {/* Gujarati subtitle */}
      <motion.p
        className="text-saffron-400/70 text-lg font-gujarati mb-16"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      >
        સ્વ-સેવા | स्व-सेवा
      </motion.p>

      {/* Touch to start button */}
      <motion.div
        className="relative"
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* Glow ring */}
        <motion.div
          className="absolute inset-0 rounded-full bg-saffron-400/30 blur-xl"
          animate={{ scale: [0.8, 1.3, 0.8], opacity: [0.5, 0.2, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <button className="relative z-10 bg-saffron-gradient text-white font-black text-2xl px-16 py-6 rounded-full shadow-2xl tracking-wide ripple">
          Touch to Begin
        </button>
      </motion.div>

      {/* Sub-languages */}
      <motion.p
        className="mt-6 text-saffron-400/50 text-base"
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 3, repeat: Infinity }}
      >
        English · ગુજરાતી · हिंदी
      </motion.p>

      {/* Footer */}
      <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-1">
        <p className="text-saffron-400/30 text-sm">UK Registered Charity</p>
        <p className="text-saffron-400/20 text-xs">Jay Shri Krishna 🙏</p>
      </div>
    </div>
  )
}
