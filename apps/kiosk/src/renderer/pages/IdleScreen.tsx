import React from 'react'
import { motion } from 'framer-motion'
import { useKioskStore, THEMES, IDLE_BACKGROUNDS, IDLE_RING_COLORS } from '../store/kiosk.store'

export function IdleScreen() {
  const { setScreen, theme, orgName, orgLogoUrl, loggedInUser, cardProvider, stripeReaderLabel, sumupReaderLabel, cloverDeviceName, squareDeviceName } = useKioskStore()
  const th = THEMES[theme]
  const idleBg = IDLE_BACKGROUNDS[theme]
  const ringColor = IDLE_RING_COLORS[theme]

  // Show staff at a glance which user is logged in + which reader is bound to
  // this device. Top-right corner, small, doesn't distract donors. Tapping
  // anywhere on the screen still triggers the start-donation flow.
  const readerLabel =
    cardProvider === 'stripe_terminal' ? stripeReaderLabel :
    cardProvider === 'sumup'           ? sumupReaderLabel :
    cardProvider === 'clover'          ? cloverDeviceName :
    cardProvider === 'square'          ? squareDeviceName :
    cardProvider === 'cash'            ? 'Cash only' :
    ''

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center cursor-pointer relative overflow-hidden"
      style={{ background: idleBg, fontFamily: 'Inter, system-ui, sans-serif' }}
      onClick={() => setScreen('home')}
      onTouchStart={() => setScreen('home')}
    >
      {/* Staff-facing badge: logged-in user + active reader. Sits in top-right
          on idle, low-key so it doesn't compete with the call-to-action. */}
      {(loggedInUser || readerLabel) && (
        <div
          className="absolute top-3 right-3 z-20 text-right pointer-events-none"
          style={{ color: ringColor, opacity: 0.75 }}
        >
          {loggedInUser && (
            <div className="text-xs font-mono">
              👤 {loggedInUser.name || loggedInUser.email}
            </div>
          )}
          {readerLabel && (
            <div className="text-xs font-mono mt-0.5">
              💳 {readerLabel} <span className="opacity-60">({cardProvider.replace('_', ' ')})</span>
            </div>
          )}
        </div>
      )}

      {/* Subtle dot-grid background pattern */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(${ringColor}20 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }}
      />

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
        {/* Slow counter-spinning outer accent ring */}
        <motion.div
          className="absolute rounded-full"
          style={{ width: 920, height: 920, border: `1px dashed ${ringColor}18` }}
          animate={{ rotate: [0, -360] }}
          transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
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

      {/* Primary call-to-action — replaced the temple name here so donors
          immediately understand the kiosk's purpose. Temple name moved to
          a smaller line below so the branding is still visible. */}
      <motion.h1
        className="text-6xl font-black mb-2 tracking-tight text-gold-gradient select-none relative z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        Donate Here
      </motion.h1>

      {/* Temple name — small, still visible so devotees know which temple */}
      <motion.p
        className="text-lg mb-1 font-semibold tracking-wide select-none relative z-10"
        style={{ color: th.headerSub }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        {orgName}
      </motion.p>

      <motion.p
        className="text-base mb-2 font-light tracking-widest uppercase select-none relative z-10"
        style={{ color: `${th.headerSub}99` }}
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

      {/* Walk-by hint — visitors who don't tap can donate from their phone */}
      <motion.p
        className="mt-3 text-sm select-none relative z-10"
        style={{ color: `${th.headerSub}70`, letterSpacing: '0.5px' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.8 }}
      >
        Or visit <span style={{ color: th.langActive, fontWeight: 700 }}>kiosk.shop</span>
      </motion.p>

      {/* Scrolling ticker — available services */}
      <div className="absolute bottom-0 left-0 right-0 z-10 overflow-hidden" style={{ borderTop: `1px solid ${ringColor}20`, background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(8px)' }}>
        <motion.div
          className="flex items-center gap-8 py-2.5 px-4 whitespace-nowrap"
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
          style={{ width: 'max-content' }}
        >
          {['🪔 Puja Booking', '🎁 Soft Donations', '📖 Sponsorship', '✨ Temple Services', '🏗️ Project Donation', '🛍️ Shop', '🙏 Quick Donate', '🎉 Festivals', '📚 Yoga & Classes',
            '🪔 Puja Booking', '🎁 Soft Donations', '📖 Sponsorship', '✨ Temple Services', '🏗️ Project Donation', '🛍️ Shop', '🙏 Quick Donate', '🎉 Festivals', '📚 Yoga & Classes'].map((item, i) => (
            <span key={i} className="text-xs font-semibold select-none" style={{ color: `${ringColor}90` }}>
              {item}
              {i < 17 && <span className="ml-8 opacity-30">·</span>}
            </span>
          ))}
        </motion.div>
      </div>

      {/* Footer */}
      <div className="absolute bottom-12 left-0 right-0 flex flex-col items-center gap-1 z-10">
        <p className="text-sm select-none font-semibold" style={{ color: `${th.headerSub}60` }}>UK Registered Charity</p>
        <p className="text-xs select-none" style={{ color: `${th.headerSub}40` }}>Jay Shri Krishna 🙏</p>
      </div>
    </div>
  )
}
