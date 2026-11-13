// Global donation LEGO — ONE control that handles Level 0 → Level 1 as
// a single flow. Mount it, hand it your categories + tiers, listen for
// onChoose / onAnyAmount.
//
// Why one control instead of two separate grids:
// --------------------------------------------
// The kiosk, service portal, and campaign pages all go category →
// tier → amount in the same order with the same back / switch
// semantics. Keeping that transition logic (which Level is showing,
// how Back works, which accent to pass down) inside ONE component
// means every consumer stays identical to every other consumer, and a
// bugfix lives in one place.
//
// Consumers that only want one of the two levels can still import
// CategoryGrid or TierGrid directly — they're re-exported for that
// case.

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CategoryGrid } from './CategoryGrid'
import { TierGrid } from './TierGrid'
import type { CategoryTile, TierCard } from './types'

export interface DonationPickerProps {
  /** Level 0 tiles — the categories the donor picks from first. */
  categories: CategoryTile[]
  /** Level 1 tiers per category id. Missing key → treated as empty
   *  and the donor goes straight to "Any Amount" if provided, else a
   *  "No tiers configured" line (so misconfiguration is obvious). */
  tiersByCategory: Record<string, TierCard[]>
  /** Donor picked a specific priced tier. */
  onChoose: (category: CategoryTile, price: number, tier: TierCard) => void
  /** Donor tapped the dashed Any-Amount tile. Omit to hide that tile. */
  onAnyAmount?: (category: CategoryTile) => void
  /** Donor backed out of Level 0. The picker handles Level-1 →
   *  Level-0 itself; this only fires on the top level. */
  onExit?: () => void
  /** Column count — default 3. */
  cols?: 2 | 3 | 4
  /** Optional heading row shown above both levels. Rendered as-is so
   *  the host can mount their own branch / project label. */
  header?: React.ReactNode
}

export function DonationPicker({
  categories,
  tiersByCategory,
  onChoose,
  onAnyAmount,
  onExit,
  cols = 3,
  header,
}: DonationPickerProps) {
  const [picked, setPicked] = useState<CategoryTile | null>(null)

  return (
    <div className="h-full flex flex-col">
      {header}

      {/* Level 1 header: small Back-to-categories + "Choose a tier" +
          category name. Only visible when a category is picked. */}
      {picked && (
        <header className="flex items-center mb-3 shrink-0">
          <button
            onClick={() => setPicked(null)}
            className="px-4 py-2 rounded-xl text-white font-bold text-sm hover:bg-white/15 border border-white/25"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >
            ← Back
          </button>
          <div className="ml-3 flex-1 min-w-0">
            <div
              className="text-[10px] uppercase tracking-widest"
              style={{ color: picked.accent }}
            >
              Choose a tier
            </div>
            <div
              className="font-black text-xl truncate text-white"
              style={{ fontFamily: 'serif' }}
            >
              {picked.emoji} {picked.name}
            </div>
          </div>
        </header>
      )}

      {/* Level 0 Exit button (host-provided). Only rendered when NO
          category is picked AND the host wants an explicit exit path. */}
      {!picked && onExit && (
        <div className="shrink-0 mb-3">
          <button
            onClick={onExit}
            className="px-4 py-2 rounded-xl text-white font-bold text-sm hover:bg-white/15 border border-white/25"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >
            ← Back
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {!picked ? (
          <motion.div
            key="level0"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.18 }}
            className="flex-1 flex flex-col min-h-0"
          >
            <CategoryGrid
              tiles={categories}
              cols={cols}
              onPick={tile => setPicked(tile)}
            />
          </motion.div>
        ) : (
          <motion.div
            key={`level1:${picked.id}`}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18 }}
            className="flex-1 flex flex-col min-h-0"
          >
            <TierGrid
              tiers={tiersByCategory[picked.id] ?? []}
              accent={picked.accent}
              cols={cols}
              onPick={(price, tier) => onChoose(picked, price, tier)}
              onAnyAmount={
                onAnyAmount ? () => onAnyAmount(picked) : undefined
              }
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
