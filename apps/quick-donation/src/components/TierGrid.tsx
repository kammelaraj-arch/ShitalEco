// LEGO level 1: the tier card grid donors see after picking a category
// ("Red Brick £51", "Gold Brick £1,008", "Any Amount"…). Each card
// shows label + price + optional sub-caption + a visual (the brick /
// sqft SVG the consumer passes in via `render`). The "Any Amount" tile
// is first-class so the layout stays balanced across 3×2 and 3×3 grids.
//
// Stateless — consumer owns tiers, accent, and taps. Lifted out of
// ProjectTiersScreen so the service portal and any future variants can
// drop in the same grid with their own tier list.

import { motion } from 'framer-motion'
import { ReactNode } from 'react'

export interface TierCard {
  /** Stable identifier — label is used today; keep it unique. */
  label: string
  price: number
  /** Short line under the label — e.g. "Family name · annual mention". */
  sub?: string
  /** Visual rendered in the card's main body (digital-twin brick, sqft
   *  tile, etc). Keeps the grid component framework-agnostic — you can
   *  hand it any ReactNode / render-prop. */
  render?: () => ReactNode
  /** When set, this card gets the gold outline + "Most chosen" chip. */
  featured?: boolean
}

export interface TierGridProps {
  tiers: TierCard[]
  /** Accent colour used for the price, featured outline, and Any-Amount
   *  dashed border. Usually comes from the parent category tile. */
  accent: string
  onPick: (price: number) => void
  /** Optional "Any Amount" tile that calls onAnyAmount when tapped.
   *  Omit to hide. */
  onAnyAmount?: () => void
  /** Grid columns. Default 3. */
  cols?: 2 | 3 | 4
}

export function TierGrid({
  tiers,
  accent,
  onPick,
  onAnyAmount,
  cols = 3,
}: TierGridProps) {
  const colClass = cols === 2 ? 'grid-cols-2' : cols === 4 ? 'grid-cols-4' : 'grid-cols-3'
  return (
    <div className={`grid gap-3 flex-1 min-h-0 ${colClass}`}>
      {tiers.map(tier => (
        <motion.button
          key={tier.label}
          whileTap={{ scale: 0.96 }}
          onClick={() => onPick(tier.price)}
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
          }}
        >
          <div className="px-3 pt-3 pb-2 border-b border-white/10 shrink-0">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-black text-base leading-tight truncate text-white"
                   style={{ fontFamily: 'serif' }}>
                {tier.label}
              </div>
              <div className="font-black text-xl shrink-0"
                   style={{ color: accent, fontFamily: 'serif' }}>
                £{tier.price.toLocaleString()}
              </div>
            </div>
            {tier.sub && (
              <div className="text-[10px] opacity-60 leading-snug mt-0.5 text-white">
                {tier.sub}
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 p-3 flex items-center justify-center"
               style={{ filter: 'drop-shadow(0 8px 18px rgba(0,0,0,0.7))' }}>
            {tier.render?.()}
          </div>
          {tier.featured && (
            <div className="absolute top-2 right-2 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full z-10"
                 style={{ background: accent, color: '#180324' }}>
              Most chosen
            </div>
          )}
        </motion.button>
      ))}

      {onAnyAmount && (
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onAnyAmount}
          className="rounded-2xl text-left relative flex flex-col overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: `2px dashed ${accent}80`,
          }}
        >
          <div className="px-3 pt-3 pb-2 border-b border-white/10 shrink-0">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-black text-base leading-tight text-white"
                   style={{ fontFamily: 'serif' }}>
                Any Amount
              </div>
              <div className="font-black text-xl shrink-0"
                   style={{ color: accent, fontFamily: 'serif' }}>
                £ …
              </div>
            </div>
            <div className="text-[10px] opacity-60 leading-snug mt-0.5 text-white">
              Enter what you&apos;d like to give
            </div>
          </div>
          <div className="flex-1 min-h-0 p-3 flex items-center justify-center text-7xl"
               style={{ filter: 'drop-shadow(0 8px 18px rgba(0,0,0,0.7))' }}>
            ✏️
          </div>
        </motion.button>
      )}
    </div>
  )
}
