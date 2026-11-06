import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore, SHITAL_LOGO_URL } from '../store'
import { api } from '../api'

// "Enter the Temple" landing — a card gallery of every live centre so the
// donor picks visually before anything else loads. Each card carries the
// centre's hero photo, name, city, established year, and a chevron.
// Falls back to a procedurally-lit tile when no image_url is set yet.

interface Branch {
  branch_id: string
  name: string
  city: string
  is_active: boolean
  image_url?: string
  tagline?: string
  established?: string
  address?: string
}

export function BranchPicker() {
  const { setBranch } = useStore()
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [entering, setEntering] = useState<Branch | null>(null)

  useEffect(() => {
    api.getBranches()
      .then(list => { setBranches(list); setLoading(false) })
      .catch(e => { setError(e?.message || 'Could not load centres'); setLoading(false) })
  }, [])

  // Donor taps a centre → play a ~3.2s ceremony (gates open, lamps light,
  // name revealed, "Om Sai Ram" invocation) before mounting the portal.
  // Kept as local state so the picker remains in control of the transition
  // and never leaves the overlay open if the user navigates away.
  function beginEnter(branch: Branch, forcedName?: string) {
    const target: Branch = forcedName
      ? { ...branch, name: forcedName }
      : branch
    setEntering(target)
    window.setTimeout(() => {
      setBranch(branch.branch_id, forcedName || branch.name, false)
    }, 3200)
  }

  return (
    <div className="min-h-screen px-4 sm:px-6 py-8 sm:py-12 relative"
      style={{ background: 'transparent' }}>

      {/* Ambient glow — pins the gaze on the grid */}
      <div className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 15%, rgba(212,175,55,0.08) 0%, transparent 60%),' +
            'radial-gradient(ellipse 50% 30% at 50% 85%, rgba(160,20,60,0.06) 0%, transparent 60%)',
        }} />

      <motion.div
        initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="relative z-10 max-w-6xl mx-auto"
      >

        {/* Masthead */}
        <header className="text-center mb-10 sm:mb-14">
          <motion.div
            animate={{ boxShadow: ['0 0 24px rgba(212,175,55,0.2)', '0 0 56px rgba(212,175,55,0.5)', '0 0 24px rgba(212,175,55,0.2)'] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden flex items-center justify-center mx-auto mb-5"
            style={{ background: '#fff' }}
          >
            <img src={SHITAL_LOGO_URL} alt="SHITAL"
              className="w-full h-full object-contain p-1"
              onError={e => {
                const el = e.currentTarget
                el.style.display = 'none'
                const p = el.parentElement
                if (p && !p.querySelector('.fallback-emoji')) {
                  const span = document.createElement('span')
                  span.className = 'fallback-emoji text-4xl'
                  span.style.color = '#6B0000'
                  span.textContent = '🛕'
                  p.appendChild(span)
                }
              }} />
          </motion.div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-gold-400 tracking-wide">
            Shri Shirdi Saibaba Temple
          </h1>
          <p className="text-[11px] sm:text-xs font-bold tracking-[0.25em] uppercase mt-2 mb-4"
            style={{ color: '#FF9933' }}>
            SHITAL · Charity No. 1138530
          </p>
          <p className="text-sm sm:text-base" style={{ color: 'rgba(255,248,220,0.55)' }}>
            Choose a centre to visit.
          </p>
        </header>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <motion.div animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="text-4xl">🕉</motion.div>
            <p className="text-xs tracking-widest uppercase" style={{ color: 'rgba(212,175,55,0.5)' }}>
              Loading our centres…
            </p>
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={() => setBranch('main', 'All Temples', false)}
              className="mt-4 btn-gold">Continue to the service portal →</button>
          </div>
        ) : (
          <>
            {/* General-donation chip at the top */}
            <button onClick={() => beginEnter({ branch_id: 'main', name: 'All Temples', city: '', is_active: true })}
              className="group w-full max-w-md mx-auto flex items-center gap-3 px-4 py-3 mb-6 sm:mb-8 rounded-2xl text-left transition-all hover:brightness-110"
              style={{
                background: 'linear-gradient(135deg, rgba(212,175,55,0.14), rgba(140,0,0,0.08))',
                border: '1px solid rgba(212,175,55,0.3)',
              }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: 'rgba(212,175,55,0.2)' }}>🕉</div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm" style={{ color: 'var(--text)' }}>
                  All Temples · General Donation
                </p>
                <p className="text-[11px]" style={{ color: 'rgba(255,248,220,0.5)' }}>
                  Not sure which centre? Start here.
                </p>
              </div>
              <span className="text-xs font-black tracking-widest group-hover:translate-x-1 transition-transform"
                style={{ color: '#D4AF37' }}>→</span>
            </button>

            {/* Centre gallery */}
            {branches.length === 0 ? (
              <div className="text-center py-10">
                <button onClick={() => beginEnter({ branch_id: 'main', name: 'Shital Temple', city: '', is_active: true })}
                  className="btn-gold">
                  Enter the Temple →
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                {branches.map((b, i) => (
                  <TempleCard key={b.branch_id} branch={b} index={i}
                    onClick={() => beginEnter(b)} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Entrance ceremony — plays over the picker when a centre is tapped */}
        <AnimatePresence>
          {entering && <EntranceCeremony branch={entering} />}
        </AnimatePresence>

        <p className="text-center text-[11px] mt-10 sm:mt-12 tracking-widest"
          style={{ color: 'rgba(255,248,220,0.25)' }}>
          🙏 Jai Sai Baba · Om Sai Ram
        </p>
      </motion.div>
    </div>
  )
}

// ── Temple card ──────────────────────────────────────────────────────────────

function TempleCard({ branch, index, onClick }: { branch: Branch; index: number; onClick: () => void }) {
  const accent = tintFor(branch.city || branch.name)
  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 * index, duration: 0.4, ease: 'easeOut' }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className="group relative rounded-2xl overflow-hidden text-left focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-transparent"
      style={{
        background: 'rgba(14,10,14,0.6)',
        border: '1px solid rgba(212,175,55,0.22)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
        backdropFilter: 'blur(14px) saturate(140%)',
        WebkitBackdropFilter: 'blur(14px) saturate(140%)',
      }}
    >
      {/* Hero area */}
      <div className="relative aspect-[16/10] overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${accent.from} 0%, ${accent.to} 100%)` }}>
        {branch.image_url ? (
          <img src={branch.image_url} alt={branch.name}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
            loading="lazy"
            onError={e => { e.currentTarget.style.display = 'none' }} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-6xl opacity-60"
            aria-hidden>{accent.glyph}</div>
        )}
        {/* Lower gradient for text contrast */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.75) 100%)' }} />
        {/* Established chip */}
        {branch.established && (
          <span className="absolute top-3 right-3 text-[10px] tracking-widest uppercase font-black px-2 py-1 rounded-full"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', color: '#F6C454', border: '1px solid rgba(246,196,84,0.35)' }}>
            Est. {branch.established}
          </span>
        )}
        {/* Name overlay */}
        <div className="absolute left-4 right-4 bottom-3">
          <p className="text-[10px] tracking-[0.22em] uppercase font-black mb-0.5"
            style={{ color: 'rgba(246,196,84,0.9)' }}>
            {branch.city || 'United Kingdom'}
          </p>
          <h3 className="text-lg sm:text-xl font-black leading-tight" style={{ color: '#fff' }}>
            {branch.name}
          </h3>
        </div>
      </div>

      {/* Lower band */}
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {branch.tagline ? (
            <p className="text-xs leading-snug line-clamp-2" style={{ color: 'rgba(255,248,220,0.7)' }}>
              {branch.tagline}
            </p>
          ) : branch.address ? (
            <p className="text-xs truncate" style={{ color: 'rgba(255,248,220,0.55)' }}>
              {branch.address}
            </p>
          ) : (
            <p className="text-xs" style={{ color: 'rgba(255,248,220,0.5)' }}>Open daily · Aarti morning &amp; evening</p>
          )}
        </div>
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all group-hover:gap-2"
          style={{
            background: 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)',
            color: '#4a0e18',
            boxShadow: '0 3px 10px rgba(212,175,55,0.3)',
          }}>
          Visit →
        </span>
      </div>
    </motion.button>
  )
}

// Tints the gradient placeholder when a branch has no photo yet. Each city
// gets its own warm Indian-palette combination so the gallery still reads as
// a set of distinct places even on first load.
function tintFor(hint: string): { from: string; to: string; glyph: string } {
  const h = hint.toLowerCase()
  if (h.includes('wembley') || h.includes('london')) return { from: '#5f1830', to: '#9a4a1e', glyph: '🏛' }
  if (h.includes('leicester'))                       return { from: '#4c1d2a', to: '#8e2c3a', glyph: '🛕' }
  if (h.includes('milton') || h.includes('mk'))      return { from: '#1f3a4a', to: '#4a6b7c', glyph: '🕌' }
  if (h.includes('reading'))                         return { from: '#2d3c1b', to: '#5c7030', glyph: '🏯' }
  if (h.includes('slough'))                          return { from: '#2b4238', to: '#527a66', glyph: '🛕' }
  if (h.includes('dartford'))                        return { from: '#2c2740', to: '#55456f', glyph: '🛕' }
  if (h.includes('hounslow'))                        return { from: '#52221b', to: '#8a4432', glyph: '🛕' }
  if (h.includes('birmingham'))                      return { from: '#40181f', to: '#722a35', glyph: '🛕' }
  // sensible saffron default
  return { from: '#5c1824', to: '#b26922', glyph: '🛕' }
}

// ── Entrance ceremony ────────────────────────────────────────────────────────
// Cinematic overlay played between tapping a centre and the portal mounting.
// The sequence runs ~3.2s total and is all CSS/SVG so nothing has to load.

function EntranceCeremony({ branch }: { branch: Branch }) {
  const accent = tintFor(branch.city || branch.name)
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{ background: '#05020a' }}
      aria-live="polite"
    >
      {/* Hero backdrop — the branch photo (or gradient) slowly zooming in */}
      <motion.div
        initial={{ scale: 1.25, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 3.0, ease: 'easeOut' }}
        className="absolute inset-0"
        style={{
          background: branch.image_url
            ? `url(${branch.image_url}) center/cover no-repeat`
            : `linear-gradient(135deg, ${accent.from} 0%, ${accent.to} 100%)`,
          filter: 'brightness(0.6)',
        }}
      />

      {/* Cinematic dark gradient so the type always reads */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 50%, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.85) 90%)',
        }} />

      {/* Torana (temple arch) opening — two gold curtains sliding apart */}
      <motion.div
        initial={{ x: 0 }} animate={{ x: '-100%' }}
        transition={{ duration: 1.1, delay: 0.25, ease: [0.55, 0, 0.3, 1] }}
        className="absolute inset-y-0 left-0 w-1/2"
        style={{
          background:
            'linear-gradient(90deg, #4a0e18 0%, #6B0000 45%, #8c1a1a 100%)',
          borderRight: '3px solid rgba(212,175,55,0.5)',
          boxShadow: 'inset -40px 0 80px rgba(0,0,0,0.6), 4px 0 20px rgba(0,0,0,0.5)',
        }}
      >
        <div className="absolute inset-y-0 right-0 w-10"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.6))' }} />
        {/* Gold Toran motif on the curtain's trailing edge */}
        <div className="absolute inset-y-0 right-2 flex items-center">
          <div className="w-1.5 h-40 rounded-full"
            style={{ background: 'linear-gradient(180deg, #d4af37, #fff4c4, #d4af37)' }} />
        </div>
      </motion.div>
      <motion.div
        initial={{ x: 0 }} animate={{ x: '100%' }}
        transition={{ duration: 1.1, delay: 0.25, ease: [0.55, 0, 0.3, 1] }}
        className="absolute inset-y-0 right-0 w-1/2"
        style={{
          background:
            'linear-gradient(-90deg, #4a0e18 0%, #6B0000 45%, #8c1a1a 100%)',
          borderLeft: '3px solid rgba(212,175,55,0.5)',
          boxShadow: 'inset 40px 0 80px rgba(0,0,0,0.6), -4px 0 20px rgba(0,0,0,0.5)',
        }}
      >
        <div className="absolute inset-y-0 left-0 w-10"
          style={{ background: 'linear-gradient(-90deg, transparent, rgba(0,0,0,0.6))' }} />
        <div className="absolute inset-y-0 left-2 flex items-center">
          <div className="w-1.5 h-40 rounded-full"
            style={{ background: 'linear-gradient(180deg, #d4af37, #fff4c4, #d4af37)' }} />
        </div>
      </motion.div>

      {/* Two diyas (oil lamps) that flicker to life */}
      <Diya position="left" />
      <Diya position="right" />

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 1.1 }}
        className="relative z-10 text-center px-6 max-w-xl"
      >
        <p className="text-[10px] sm:text-xs tracking-[0.42em] uppercase font-black mb-5"
          style={{ color: '#f6c454' }}>
          Welcome to
        </p>
        <h1 className="font-display font-bold text-3xl sm:text-5xl leading-tight mb-5"
          style={{
            color: '#fff5d1',
            textShadow: '0 0 28px rgba(246,196,84,0.4), 0 4px 32px rgba(0,0,0,0.9)',
            letterSpacing: '-0.01em',
          }}>
          {branch.name}
        </h1>
        {branch.city && (
          <p className="text-sm sm:text-base tracking-wider mb-4" style={{ color: 'rgba(255,248,220,0.75)' }}>
            {branch.city}
          </p>
        )}
        <motion.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 2.0 }}
          className="text-[10px] sm:text-xs tracking-[0.5em] uppercase font-black mt-2"
          style={{ color: '#D4AF37' }}
        >
          Om Sai Ram
        </motion.p>

        {/* Progress bead — fills over the final beat */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 2.1 }}
          className="relative mx-auto mt-6 h-[2px] w-56 overflow-hidden rounded-full"
          style={{ background: 'rgba(212,175,55,0.15)' }}
        >
          <motion.div
            initial={{ width: 0 }} animate={{ width: '100%' }}
            transition={{ duration: 1.1, delay: 2.1, ease: 'easeInOut' }}
            className="h-full"
            style={{ background: 'linear-gradient(90deg, transparent, #d4af37, #fff4c4, #d4af37, transparent)' }}
          />
        </motion.div>
      </motion.div>

      {/* Final flash to carry us into the portal */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 3.0 }}
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(circle at 50% 50%, rgba(255,245,209,0.9) 0%, transparent 70%)' }}
      />
    </motion.div>
  )
}

function Diya({ position }: { position: 'left' | 'right' }) {
  const side = position === 'left' ? { left: '14%' } : { right: '14%' }
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 1.3 }}
      className="absolute bottom-[14%] hidden sm:block"
      style={side}
    >
      {/* Flame */}
      <motion.div
        animate={{ scale: [1, 1.12, 0.94, 1.08, 1], opacity: [0.9, 1, 0.85, 1, 0.9] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        className="w-5 h-7 rounded-full mx-auto"
        style={{
          background:
            'radial-gradient(ellipse at 50% 60%, #fff4c4 0%, #ffbf3b 45%, #e97a1f 75%, transparent 100%)',
          filter: 'blur(1px)',
          boxShadow: '0 0 36px rgba(255,180,60,0.8), 0 0 80px rgba(255,120,30,0.5)',
        }}
      />
      {/* Diya bowl */}
      <div
        className="w-14 h-4 mx-auto rounded-b-full"
        style={{
          background: 'linear-gradient(180deg, #a3471e 0%, #4a2412 100%)',
          border: '1px solid rgba(212,175,55,0.5)',
          marginTop: '-2px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
        }}
      />
    </motion.div>
  )
}
