import { useState, type ReactElement } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'
import { TILE_CATALOG } from './ProjectStartScreen'
import { AmountKeypad } from '../components/AmountKeypad'

// ---------- Photoreal "digital-twin" brick -----------------------------------
// Layered gradients + chamfer + inner mortar shadow + top light sheen so the
// brick reads as a real physical object rather than a flat rectangle. Each
// brick has its own id-suffix to avoid <defs> collision when several render
// together in the same grid.
let __gid = 0
function BrickSVG({ color, mortar, highlight, shimmer }: {
  color: string; mortar: string; highlight: string; shimmer?: string
}) {
  const uid = (__gid++).toString(36)
  const body = `bk-${uid}`
  const sheen = `sh-${uid}`
  const bevel = `bv-${uid}`
  return (
    <svg viewBox="0 0 170 120" style={{ display: 'block', width: '100%', height: '100%' }}>
      <defs>
        {/* Main body gradient — mid-light → mid → mid-dark */}
        <linearGradient id={body} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0"    stopColor={highlight} />
          <stop offset="0.15" stopColor={color} />
          <stop offset="0.85" stopColor={color} />
          <stop offset="1"    stopColor={mortar} />
        </linearGradient>
        {/* Diagonal glossy sheen sweep */}
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0"    stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.4"  stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.6"  stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        {/* Edge chamfer — light on top-left, dark on bottom-right */}
        <linearGradient id={bevel} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0"   stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1"   stopColor="#000000" stopOpacity="0.45" />
        </linearGradient>
        <filter id={`sh-${uid}-sh`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2.5" />
          <feOffset dx="0" dy="3" result="offsetblur" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Top row — one wide brick */}
      <g filter={`url(#sh-${uid}-sh)`}>
        <rect x="6" y="6" width="158" height="48" rx="5"
              fill={`url(#${body})`} stroke={mortar} strokeWidth="1" />
        {/* Chamfer overlay */}
        <rect x="6" y="6" width="158" height="48" rx="5" fill={`url(#${bevel})`} />
        {/* Glossy sheen */}
        <rect x="6" y="6" width="158" height="48" rx="5" fill={`url(#${sheen})`} />
        {/* Top specular highlight line */}
        <rect x="10" y="8" width="150" height="2.5" rx="1" fill={highlight} opacity="0.75" />
        {shimmer && <rect x="6" y="24" width="158" height="6" fill={shimmer} opacity="0.22" />}
      </g>

      {/* Bottom row — two staggered bricks (masonry pattern) */}
      <g filter={`url(#sh-${uid}-sh)`}>
        <rect x="6"  y="62" width="74" height="52" rx="5"
              fill={`url(#${body})`} stroke={mortar} strokeWidth="1" />
        <rect x="6"  y="62" width="74" height="52" rx="5" fill={`url(#${bevel})`} />
        <rect x="6"  y="62" width="74" height="52" rx="5" fill={`url(#${sheen})`} />
        <rect x="10" y="64" width="66" height="2.5" rx="1" fill={highlight} opacity="0.75" />

        <rect x="90"  y="62" width="74" height="52" rx="5"
              fill={`url(#${body})`} stroke={mortar} strokeWidth="1" />
        <rect x="90"  y="62" width="74" height="52" rx="5" fill={`url(#${bevel})`} />
        <rect x="90"  y="62" width="74" height="52" rx="5" fill={`url(#${sheen})`} />
        <rect x="94" y="64" width="66" height="2.5" rx="1" fill={highlight} opacity="0.75" />
      </g>
    </svg>
  )
}

function SqFtSVG({ color, highlight }: { color: string; highlight: string }) {
  const uid = (__gid++).toString(36)
  return (
    <svg viewBox="0 0 170 120" style={{ display: 'block', width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id={`sq-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={highlight} />
          <stop offset="1" stopColor={color} />
        </linearGradient>
        <linearGradient id={`sqb-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0"   stopColor="#ffffff" stopOpacity="0.4" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1"   stopColor="#000000" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <rect x="18" y="12" width="134" height="96" rx="6"
            fill={`url(#sq-${uid})`} stroke={highlight} strokeWidth="2.5" />
      <rect x="18" y="12" width="134" height="96" rx="6" fill={`url(#sqb-${uid})`} />
      <text x="85" y="78" textAnchor="middle" fontSize="40"
            fill="#180324" fontFamily="serif" fontWeight="900">ft²</text>
    </svg>
  )
}

// ---------- Tier catalog -----------------------------------------------------
interface Tier {
  label: string
  price: number
  sub?: string
  render: () => ReactElement
  featured?: boolean
}

const CATEGORY_TIERS: Record<string, Tier[]> = {
  brick: [
    { label: 'Red Brick',     price: 51,
      sub: 'Name on the donor wall',
      render: () => <BrickSVG color="#D83921" mortar="#5B1507" highlight="#FFA384" /> },
    { label: 'Bronze Brick',  price: 151,
      sub: 'Family name · annual mention',
      render: () => <BrickSVG color="#B96A1F" mortar="#4A2308" highlight="#F3B274" /> },
    { label: 'Silver Brick',  price: 508,
      sub: 'Patron plaque · lifetime pass',
      render: () => <BrickSVG color="#B9C1C7" mortar="#4B5257" highlight="#F3F7FA" shimmer="#FFFFFF" /> },
    { label: 'Gold Brick',    price: 1008,
      sub: 'Centrepiece plaque · trustee letter',
      render: () => <BrickSVG color="#E5B320" mortar="#5A4106" highlight="#FFF1A8" shimmer="#FFFFFF" />,
      featured: true },
    { label: 'Founder Brick', price: 5008,
      sub: 'Named in opening ceremony',
      render: () => <BrickSVG color="#9E1244" mortar="#3E041A" highlight="#F0C072" shimmer="#F0C072" /> },
  ],
  sqft: [
    { label: '1 sq ft',       price: 351,
      sub: 'One foot of hall floor · name engraved',
      render: () => <SqFtSVG color="#2C7FB8" highlight="#A9DBF5" />,
      featured: true },
    { label: 'Family plot',   price: 2501,
      sub: '≈7 ft² · family entrance tile',
      render: () => <SqFtSVG color="#1B5F85" highlight="#A9DBF5" /> },
  ],
  general: [
    { label: '£5',   price: 5,   render: () => <PresetSVG color="#E63E7F" accent="#FFC3DA" label="£5" /> },
    { label: '£10',  price: 10,  render: () => <PresetSVG color="#E63E7F" accent="#FFC3DA" label="£10" /> },
    { label: '£25',  price: 25,  render: () => <PresetSVG color="#E63E7F" accent="#FFC3DA" label="£25" />,
      featured: true },
    { label: '£50',  price: 50,  render: () => <PresetSVG color="#E63E7F" accent="#FFC3DA" label="£50" /> },
    { label: '£100', price: 100, render: () => <PresetSVG color="#E63E7F" accent="#FFC3DA" label="£100" /> },
  ],
}

// Preset-amount card for General Donation — large stylised £ amount.
function PresetSVG({ color, accent, label }: { color: string; accent: string; label: string }) {
  return (
    <svg viewBox="0 0 170 120" style={{ display: 'block', width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id={`p-${label}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={accent} />
          <stop offset="1" stopColor={color} />
        </linearGradient>
      </defs>
      <circle cx="85" cy="60" r="50" fill={`url(#p-${label})`} stroke={accent} strokeWidth="2.5" />
      <text x="85" y="72" textAnchor="middle" fontSize="36" fontFamily="serif"
            fontWeight="900" fill="#180324">{label}</text>
    </svg>
  )
}

const SQFT_RATE = 351

// Any-Amount keypad is now the shared AmountKeypad component (imported
// above) rendered in modal mode. Kept out of this file to stop the Gupt
// Daan + Any-Amount flows diverging — operator feedback: "stop building
// every time, use one across the eco system".

// ---------- Main screen ------------------------------------------------------
// Compact 3-column grid, label on TOP of each tile (per operator feedback),
// photoreal brick fills the body of the tile, price badge in the corner.
// No scroll — grid flexes to viewport.
//
// Tier source order (first non-empty wins):
//   1. tierProfile.config[category] — admin-edited list from Settings →
//      Tier Profiles, loaded at login and shared across devices.
//   2. CATEGORY_TIERS[category] — hardcoded defaults, so a kiosk still
//      works out of the box with no profile attached.
export function ProjectTiersScreen() {
  const { pickedCategory, setAmount, setScreen, tierProfile } = useDonationStore()
  const [keypadOpen, setKeypadOpen] = useState(false)
  const tile = TILE_CATALOG.find(t => t.id === pickedCategory)
  const overrides = tierProfile?.config?.[pickedCategory]
  const tiers: Tier[] = (overrides && overrides.length > 0)
    ? overrides
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(t => ({
          label: t.label,
          price: Number(t.price) || 0,
          sub:   t.sub,
          featured: t.featured,
          // Admin image URL takes precedence over the SVG renderer; when
          // absent we fall back to the hardcoded SVG for the SAME label
          // (so changing just the price keeps the illustration), else
          // generic brick art for the first tier in that category.
          render: () => (t.image_url
            ? <img src={t.image_url} alt={t.label}
                   style={{ display: 'block', width: '100%', height: '100%',
                            objectFit: 'contain' }} />
            : (CATEGORY_TIERS[pickedCategory]?.find(d => d.label === t.label)?.render?.()
               ?? <BrickSVG color="#B96A1F" mortar="#4A2308" highlight="#F3B274" />)),
        }))
    : (CATEGORY_TIERS[pickedCategory] || [])
  const accent = tile?.accent || '#FFD089'

  function pickTier(amount: number) {
    setAmount(amount)
    setScreen('project-contact')
  }

  const sqftHint = pickedCategory === 'sqft'
    ? `Rate: £${SQFT_RATE} per ft² — we calculate the size`
    : ''

  return (
    <div className="h-screen flex flex-col px-5 py-4 text-white overflow-hidden"
         style={{
           // Dark near-black with a warm tint so vivid bricks pop.
           background: 'radial-gradient(ellipse at top, #2a0e08 0%, #0b0303 65%)',
         }}>

      {/* Compact header */}
      <header className="flex items-center mb-3 shrink-0">
        <button onClick={() => setScreen('donate')}
                className="px-3 py-2 rounded-xl text-white/85 hover:bg-white/10 text-sm">
          ← Back
        </button>
        <div className="ml-3 flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest" style={{ color: accent }}>Choose a tier</div>
          <div className="font-black text-xl truncate" style={{ fontFamily: 'serif' }}>
            {tile?.emoji} {tile?.name}
          </div>
        </div>
      </header>

      {/* Tier grid: 3 cols × 2 rows → 6 tiles visible without scroll */}
      <div className="grid grid-cols-3 gap-3 flex-1 min-h-0">
        {tiers.map(tier => (
          <motion.button key={tier.label} whileTap={{ scale: 0.96 }}
                         onClick={() => pickTier(tier.price)}
                         className="rounded-2xl text-left relative flex flex-col overflow-hidden"
                         style={{
                           background: tier.featured
                             ? `linear-gradient(160deg, ${accent}30 0%, rgba(255,255,255,0.03) 100%)`
                             : 'rgba(255,255,255,0.04)',
                           border: tier.featured
                             ? `2px solid ${accent}`
                             : '1.5px solid rgba(255,255,255,0.12)',
                           boxShadow: tier.featured
                             ? `0 0 28px ${accent}40, inset 0 1px 0 rgba(255,255,255,0.05)`
                             : 'inset 0 1px 0 rgba(255,255,255,0.05)',
                         }}>
            {/* Top header: label + price on one line + sub */}
            <div className="px-3 pt-3 pb-2 border-b border-white/10 shrink-0">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-black text-base leading-tight truncate" style={{ fontFamily: 'serif' }}>
                  {tier.label}
                </div>
                <div className="font-black text-xl shrink-0" style={{ color: accent, fontFamily: 'serif' }}>
                  £{tier.price.toLocaleString()}
                </div>
              </div>
              {tier.sub && <div className="text-[10px] opacity-60 leading-snug mt-0.5">{tier.sub}</div>}
            </div>
            {/* Digital-twin brick fills the rest of the tile */}
            <div className="flex-1 min-h-0 p-3 flex items-center justify-center"
                 style={{ filter: 'drop-shadow(0 8px 18px rgba(0,0,0,0.7))' }}>
              {tier.render()}
            </div>
            {tier.featured && (
              <div className="absolute top-2 right-2 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full z-10"
                   style={{ background: accent, color: '#180324' }}>Most chosen</div>
            )}
          </motion.button>
        ))}

        {/* Any Amount tile — same shape, pencil glyph, label on top */}
        <motion.button whileTap={{ scale: 0.96 }}
                       onClick={() => setKeypadOpen(true)}
                       className="rounded-2xl text-left relative flex flex-col overflow-hidden"
                       style={{
                         background: 'rgba(255,255,255,0.03)',
                         border: `2px dashed ${accent}80`,
                       }}>
          <div className="px-3 pt-3 pb-2 border-b border-white/10 shrink-0">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-black text-base leading-tight" style={{ fontFamily: 'serif' }}>
                Any Amount
              </div>
              <div className="font-black text-xl shrink-0" style={{ color: accent, fontFamily: 'serif' }}>
                £ …
              </div>
            </div>
            <div className="text-[10px] opacity-60 leading-snug mt-0.5">
              Enter what you&apos;d like to give
            </div>
          </div>
          <div className="flex-1 min-h-0 p-3 flex items-center justify-center text-7xl"
               style={{ filter: 'drop-shadow(0 8px 18px rgba(0,0,0,0.7))' }}>
            ✏️
          </div>
        </motion.button>
      </div>

      {/* Highlighted back pill */}
      <button onClick={() => setScreen('donate')}
              className="w-full py-3 mt-3 rounded-2xl font-black text-base shrink-0"
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1.5px solid rgba(255,255,255,0.22)',
              }}>
        ← Back to categories
      </button>

      <AnimatePresence>
        {keypadOpen && (
          <AmountKeypad
            mode="modal"
            accent={accent}
            title="Enter any amount"
            hint={sqftHint}
            onCancel={() => setKeypadOpen(false)}
            onConfirm={(amount) => { setKeypadOpen(false); pickTier(amount) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
