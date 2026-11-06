import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
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

  useEffect(() => {
    api.getBranches()
      .then(list => { setBranches(list); setLoading(false) })
      .catch(e => { setError(e?.message || 'Could not load centres'); setLoading(false) })
  }, [])

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
            <button onClick={() => setBranch('main', 'All Temples', false)}
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
                <button onClick={() => setBranch('main', 'Shital Temple', false)} className="btn-gold">
                  Enter the Temple →
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                {branches.map((b, i) => (
                  <TempleCard key={b.branch_id} branch={b} index={i}
                    onClick={() => setBranch(b.branch_id, b.name, false)} />
                ))}
              </div>
            )}
          </>
        )}

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
