import { useState, type ReactElement } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'
import { TILE_CATALOG } from './ProjectStartScreen'

// Inline SVG brick illustration — each tier gets its own body colour +
// a darker mortar line + a hairline highlight so the brick looks 3D
// rather than a flat rectangle. License-clean (we authored it), scales,
// works offline, and the admin can later override by dropping a real
// PNG at apps/quick-donation/public/bricks/<id>.png (the <img> here
// would be swapped in via a tiny tweak — kept inline for now).
function BrickSVG({ color, mortar, highlight }: { color: string; mortar: string; highlight: string }) {
  return (
    <svg viewBox="0 0 120 70" style={{ display: 'block', width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id={`bg-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={highlight} />
          <stop offset="0.35" stopColor={color} />
          <stop offset="1" stopColor={mortar} />
        </linearGradient>
      </defs>
      {/* body */}
      <rect x="4" y="6" width="112" height="58" rx="4" fill={`url(#bg-${color})`} stroke="rgba(0,0,0,0.35)" strokeWidth="1.5" />
      {/* horizontal mortar */}
      <line x1="4" y1="35" x2="116" y2="35" stroke={mortar} strokeWidth="2" opacity="0.55" />
      {/* vertical mortar (staggered) */}
      <line x1="60" y1="6"  x2="60" y2="35" stroke={mortar} strokeWidth="2" opacity="0.55" />
      <line x1="30" y1="35" x2="30" y2="64" stroke={mortar} strokeWidth="2" opacity="0.55" />
      <line x1="90" y1="35" x2="90" y2="64" stroke={mortar} strokeWidth="2" opacity="0.55" />
      {/* top highlight for a hint of dimension */}
      <rect x="6" y="8" width="108" height="3" fill={highlight} opacity="0.4" rx="1" />
    </svg>
  )
}

// Square-foot icon — ruler + square outline, same scaling treatment.
function SqFtSVG({ color, highlight }: { color: string; highlight: string }) {
  return (
    <svg viewBox="0 0 120 70" style={{ display: 'block', width: '100%', height: '100%' }}>
      <rect x="24" y="10" width="72" height="50" rx="2" fill={color} stroke={highlight} strokeWidth="2" opacity="0.9" />
      <text x="60" y="44" textAnchor="middle" fontSize="18" fill={highlight} fontFamily="serif" fontWeight="800">ft²</text>
    </svg>
  )
}

interface Tier {
  label: string
  price: number
  sub?: string
  render: () => ReactElement
  featured?: boolean
}

// Each brick tier gets its own body colour + mortar + highlight tuned
// to that tier's identity (red terracotta, bronze, silver, gold, deep
// Founder gold-on-crimson).
const CATEGORY_TIERS: Record<string, Tier[]> = {
  brick: [
    { label: 'Red Brick',     price: 51,
      sub: 'Named engraving on donor wall',
      render: () => <BrickSVG color="#CB4A2B" mortar="#762416" highlight="#F08263" /> },
    { label: 'Bronze Brick',  price: 151,
      sub: 'Family name + annual mention',
      render: () => <BrickSVG color="#9A6132" mortar="#4F2E13" highlight="#D59968" /> },
    { label: 'Silver Brick',  price: 508,
      sub: 'Patron plaque · lifetime pass',
      render: () => <BrickSVG color="#B7BEC4" mortar="#5C6267" highlight="#EDF1F3" /> },
    { label: 'Gold Brick',    price: 1008,
      sub: 'Centrepiece plaque · trustee letter',
      render: () => <BrickSVG color="#D4A62A" mortar="#6A5008" highlight="#FBE681" />,
      featured: true },
    { label: 'Founder Brick', price: 5008,
      sub: 'Named in temple opening ceremony',
      render: () => <BrickSVG color="#8A1A3C" mortar="#450818" highlight="#D7B96E" /> },
  ],
  sqft: [
    { label: '1 square foot', price: 351,
      sub: 'One foot of hall floor · name engraved',
      render: () => <SqFtSVG color="#2E86AB" highlight="#A0D8F1" />,
      featured: true },
    { label: 'Family plot',   price: 2501,
      sub: '≈7 ft² · family named entrance tile',
      render: () => <SqFtSVG color="#1E5C7A" highlight="#A0D8F1" /> },
  ],
}

// £ per sq ft used for the live size readout on Any Amount for sqft
const SQFT_RATE = 351

// Big on-screen keypad overlay that appears when the donor taps the
// "Any Amount" tile. Kiosk-friendly (no OS keyboard, no cursor caret).
function AnyAmountKeypad({ initial, accent, onCancel, onConfirm, hint }: {
  initial: string
  accent: string
  hint?: string
  onCancel: () => void
  onConfirm: (amount: number) => void
}) {
  const [value, setValue] = useState(initial || '')

  function press(k: string) {
    setValue(v => {
      if (k === '←') return v.slice(0, -1)
      if (k === '.' && v.includes('.')) return v
      if (v.length >= 10) return v
      return (v + k).replace(/^0+(?=\d)/, '')
    })
  }

  const amt = parseFloat(value)
  const canConfirm = isFinite(amt) && amt > 0
  const KEYS = ['1','2','3','4','5','6','7','8','9','.','0','←']

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.85)' }}
    >
      <motion.div
        initial={{ scale: 0.92, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }}
        className="w-full max-w-md rounded-3xl p-6 text-white"
        style={{ background: '#140606', border: `2px solid ${accent}` }}
      >
        <div className="text-center mb-4">
          <div className="text-xs uppercase tracking-widest" style={{ color: accent }}>Enter any amount</div>
          <div className="font-black text-6xl mt-2" style={{ fontFamily: 'serif', color: accent }}>
            £{value || '0'}
          </div>
          {hint && <div className="text-xs mt-2 opacity-70">{hint}</div>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {KEYS.map(k => (
            <motion.button key={k} whileTap={{ scale: 0.9 }}
                           onClick={() => press(k)}
                           className="aspect-square rounded-2xl text-3xl font-black bg-white/10 hover:bg-white/15">
              {k}
            </motion.button>
          ))}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onCancel}
                  className="flex-1 py-4 rounded-2xl font-black text-lg bg-white/10 hover:bg-white/15">
            Cancel
          </button>
          <button onClick={() => canConfirm && onConfirm(amt)}
                  disabled={!canConfirm}
                  className="flex-1 py-4 rounded-2xl font-black text-lg disabled:opacity-40"
                  style={{ background: accent, color: '#180324' }}>
            Continue →
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

export function ProjectTiersScreen() {
  const { pickedCategory, setAmount, setScreen } = useDonationStore()
  const [keypadOpen, setKeypadOpen] = useState(false)
  const tile = TILE_CATALOG.find(t => t.id === pickedCategory)
  const tiers = CATEGORY_TIERS[pickedCategory] || []
  const bg = tile?.bg || '#2E86AB'
  const accent = tile?.accent || '#A0D8F1'

  function pickTier(amount: number) {
    setAmount(amount)
    setScreen('project-contact')
  }

  const sqftHint = pickedCategory === 'sqft'
    ? `Rate: £${SQFT_RATE} per ft² — we calculate the size`
    : ''

  // Build grid: tier tiles + Any Amount as the last tile (same size).
  // Always 2 columns on kiosk screens.
  return (
    <div className="min-h-screen flex flex-col px-4 py-5 text-white"
         style={{ background: `linear-gradient(170deg, ${bg} 0%, #140606 100%)` }}>

      {/* Top header */}
      <header className="flex items-center mb-5">
        <button onClick={() => setScreen('donate')}
                className="px-3 py-2 rounded-xl text-white/80 hover:bg-white/10 text-sm">
          ← Back
        </button>
        <div className="ml-3 flex-1">
          <div className="text-xs uppercase tracking-widest" style={{ color: accent }}>Choose a tier</div>
          <div className="font-black text-2xl" style={{ fontFamily: 'serif' }}>{tile?.emoji} {tile?.name}</div>
        </div>
      </header>

      {/* Tier grid — tiers + Any Amount as the last tile */}
      <div className="grid grid-cols-2 gap-3 mb-5 flex-1 content-start">
        {tiers.map(tier => (
          <motion.button key={tier.label} whileTap={{ scale: 0.95 }}
                         onClick={() => pickTier(tier.price)}
                         className="rounded-2xl p-5 text-left relative flex flex-col"
                         style={{
                           background: tier.featured ? `${accent}20` : 'rgba(255,255,255,0.05)',
                           border: tier.featured ? `2px solid ${accent}` : '2px solid rgba(255,255,255,0.1)',
                           minHeight: 160,
                         }}>
            {tier.featured && (
              <div className="absolute top-3 right-3 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                   style={{ background: accent, color: '#180324' }}>Most chosen</div>
            )}
            <div className="mb-3 h-16 w-28" style={{ filter: 'drop-shadow(0 3px 10px rgba(0,0,0,0.5))' }}>
              {tier.render()}
            </div>
            <div className="font-black text-lg mb-1" style={{ fontFamily: 'serif' }}>{tier.label}</div>
            {tier.sub && <div className="text-xs opacity-70 mb-3 leading-snug">{tier.sub}</div>}
            <div className="font-black text-3xl mt-auto" style={{ color: accent, fontFamily: 'serif' }}>
              £{tier.price.toLocaleString()}
            </div>
          </motion.button>
        ))}

        {/* Any Amount tile — same size + shape as the tier tiles, dashed
            border so it reads as the "other" choice without the inline
            input bar that confused the donor previously. */}
        <motion.button whileTap={{ scale: 0.95 }}
                       onClick={() => setKeypadOpen(true)}
                       className="rounded-2xl p-5 text-left relative flex flex-col border-dashed"
                       style={{
                         background: 'rgba(255,255,255,0.04)',
                         border: `2px dashed ${accent}80`,
                         minHeight: 160,
                       }}>
          <div className="text-4xl mb-2" style={{ filter: 'drop-shadow(0 3px 10px rgba(0,0,0,0.5))' }}>✏️</div>
          <div className="font-black text-lg mb-1" style={{ fontFamily: 'serif' }}>Any Amount</div>
          <div className="text-xs opacity-70 mb-3 leading-snug">Enter what you&apos;d like to give</div>
          <div className="font-black text-3xl mt-auto" style={{ color: accent, fontFamily: 'serif' }}>£ …</div>
        </motion.button>
      </div>

      {/* Highlighted Back button at the bottom for easy escape. Clearer
          than the small text-link up top when the hall lights are low. */}
      <button onClick={() => setScreen('donate')}
              className="w-full py-5 rounded-2xl font-black text-lg"
              style={{ background: 'rgba(255,255,255,0.12)', border: '2px solid rgba(255,255,255,0.25)' }}>
        ← Back to categories
      </button>

      <AnimatePresence>
        {keypadOpen && (
          <AnyAmountKeypad
            initial=""
            accent={accent}
            hint={sqftHint}
            onCancel={() => setKeypadOpen(false)}
            onConfirm={(amount) => { setKeypadOpen(false); pickTier(amount) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
