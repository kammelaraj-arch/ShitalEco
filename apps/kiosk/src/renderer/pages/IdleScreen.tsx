import React from 'react'
import { motion } from 'framer-motion'
import { useKioskStore, THEMES, IDLE_BACKGROUNDS, IDLE_RING_COLORS } from '../store/kiosk.store'

export function IdleScreen() {
  const { setScreen, theme, orgName, orgLogoUrl } = useKioskStore()
  const th = THEMES[theme]
  const idleBg = IDLE_BACKGROUNDS[theme]
  const ringColor = IDLE_RING_COLORS[theme]

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center cursor-pointer relative overflow-hidden"
      style={{ background: idleBg, fontFamily: 'Inter, system-ui, sans-serif' }}
      onClick={() => setScreen('home')}
      onTouchStart={() => setScreen('home')}
    >
      {/* Animated background rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {[1, 2, 3, 4, 5].map((i) => (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              width: i * 190,
              height: i * 190,
              border: `${i <= 2 ? 2 : 1}px solid ${ringColor}`,
            }}
            animate={{
              scale:   [1, 1.12 - i * 0.01, 1],
              opacity: [0.3 + i * 0.08, 0.85, 0.3 + i * 0.08],
              rotate:  [0, i % 2 === 0 ? 8 : -8, 0],
            }}
            transition={{
              duration: 3 + i * 0.6,
              delay: i * 0.4,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        ))}
        {/* Fast spinning inner accent ring */}
        <motion.div
          className="absolute rounded-full"
          style={{ width: 160, height: 160, border: `2px solid ${ringColor}`, borderStyle: 'dashed' }}
          animate={{ rotate: [0, 360] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      {/* Logo / Om symbol */}
      <motion.div
        className="mb-6 select-none relative z-10"
        animate={{ y: [0, -12, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        {orgLogoUrl ? (
          <img
            src={orgLogoUrl}
            alt={orgName}
            className="w-24 h-24 rounded-2xl object-contain shadow-2xl"
            style={{ border: `2px solid ${ringColor}` }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div
            className="w-24 h-24 rounded-2xl flex items-center justify-center text-5xl shadow-2xl"
            style={{
              background: th.logoBg,
              border: `2px solid ${ringColor}`,
            }}
          >
            🕉️
          </div>
        )}
      </motion.div>

      {/* Org name */}
      <motion.h1
        className="text-5xl font-black mb-2 tracking-tight text-gold-gradient select-none relative z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        {orgName}
      </motion.h1>

      <motion.p
        className="text-xl mb-2 font-light tracking-widest uppercase select-none relative z-10"
        style={{ color: th.headerSub }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        Self Service
      </motion.p>

      {/* Gujarati subtitle */}
      <motion.p
        className="text-lg font-gujarati mb-16 select-none relative z-10"
        style={{ color: `${th.headerSub}99` }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      >
        સ્વ-સેવા | स्व-सेवा
      </motion.p>

      {/* Touch to start button */}
      <motion.div
        className="relative z-10"
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* Glow ring */}
        <motion.div
          className="absolute inset-0 rounded-full blur-xl"
          style={{ background: `${th.langActive}50` }}
          animate={{ scale: [0.8, 1.3, 0.8], opacity: [0.6, 0.25, 0.6] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <button
          className="relative z-10 text-white font-black text-2xl px-16 py-6 rounded-full shadow-2xl tracking-wide ripple"
          style={{ background: `linear-gradient(135deg, ${th.langActive} 0%, ${th.basketBtn} 100%)` }}
        >
          Touch to Begin
        </button>
      </motion.div>

      {/* Sub-languages */}
      <motion.p
        className="mt-6 text-base select-none relative z-10"
        style={{ color: `${th.headerSub}80` }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 3, repeat: Infinity }}
      >
        English · ગુજરાતી · हिंदी
      </motion.p>

      {/* Footer */}
      <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-1 z-10">
        <p className="text-sm select-none" style={{ color: `${th.headerSub}50` }}>UK Registered Charity</p>
        <p className="text-xs select-none" style={{ color: `${th.headerSub}35` }}>Jay Shri Krishna 🙏</p>
      </div>
    </div>
  )
}
