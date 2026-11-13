// Internal sub-component for Level 1. Exported for the same reason as
// CategoryGrid — the public surface is <DonationPicker>, but hosts can
// mount TierGrid directly if they want.

import { motion } from 'framer-motion'
import type { TierCard } from './types'

export interface TierGridProps {
  tiers: TierCard[]
  /** Accent used for the price, featured outline, and Any-Amount dashed
   *  border. Usually comes from the parent CategoryTile.accent. */
  accent: string
  onPick: (price: number, tier: TierCard) => void
  /** Optional Any-Amount tile fires this. Omit to hide. */
  onAnyAmount?: () => void
  cols?: 2 | 3 | 4
}

export function TierGrid({
  tiers,
  accent,
  onPick,
  onAnyAmount,
  cols = 3,
}: TierGridProps) {
  const colClass =
    cols === 2 ? 'grid-cols-2' : cols === 4 ? 'grid-cols-4' : 'grid-cols-3'
  return (
    <div className={`grid gap-3 flex-1 min-h-0 ${colClass}`}>
      {tiers.map(tier => (
        <motion.button
          key={tier.label}
          whileTap={{ scale: 0.96 }}
          onClick={() => onPick(tier.price, tier)}
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
              <div
                className="font-black text-base leading-tight truncate text-white"
                style={{ fontFamily: 'serif' }}
              >
                {tier.label}
              </div>
              <div
                className="font-black text-xl shrink-0"
                style={{ color: accent, fontFamily: 'serif' }}
              >
                £{tier.price.toLocaleString()}
              </div>
            </div>
            {tier.sub && (
              <div className="text-[10px] opacity-60 leading-snug mt-0.5 text-white">
                {tier.sub}
              </div>
            )}
          </div>
          <div
            className="flex-1 min-h-0 p-3 flex items-center justify-center"
            style={{ filter: 'drop-shadow(0 8px 18px rgba(0,0,0,0.7))' }}
          >
            {tier.render?.()}
          </div>
          {tier.featured && (
            <div
              className="absolute top-2 right-2 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full z-10"
              style={{ background: accent, color: '#180324' }}
            >
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
              <div
                className="font-black text-base leading-tight text-white"
                style={{ fontFamily: 'serif' }}
              >
                Any Amount
              </div>
              <div
                className="font-black text-xl shrink-0"
                style={{ color: accent, fontFamily: 'serif' }}
              >
                £ …
              </div>
            </div>
            <div className="text-[10px] opacity-60 leading-snug mt-0.5 text-white">
              Enter what you&apos;d like to give
            </div>
          </div>
          <div
            className="flex-1 min-h-0 p-3 flex items-center justify-center text-7xl"
            style={{ filter: 'drop-shadow(0 8px 18px rgba(0,0,0,0.7))' }}
          >
            ✏️
          </div>
        </motion.button>
      )}
    </div>
  )
}
