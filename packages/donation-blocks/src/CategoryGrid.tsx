// Internal sub-component for Level 0. Exported for consumers who want
// to use the grid outside the DonationPicker wizard (e.g. the service
// portal's landing page grid), but the public surface of the package
// is <DonationPicker>.

import { motion } from 'framer-motion'
import type { CategoryTile } from './types'

export interface CategoryGridProps {
  tiles: CategoryTile[]
  onPick: (tile: CategoryTile) => void
  /** Default 3 — today's kiosk layout. */
  cols?: 2 | 3 | 4
}

export function CategoryGrid({ tiles, onPick, cols = 3 }: CategoryGridProps) {
  const colClass =
    cols === 2 ? 'grid-cols-2' : cols === 4 ? 'grid-cols-4' : 'grid-cols-3'
  return (
    <div className={`grid gap-3 flex-1 ${colClass}`} style={{ gridAutoRows: '1fr' }}>
      {tiles.map(t => (
        <motion.button
          key={t.id}
          whileTap={{ scale: 0.95 }}
          onClick={() => onPick(t)}
          className="rounded-3xl flex flex-col items-center justify-center text-center text-white font-bold p-4"
          style={{
            background: `
              radial-gradient(ellipse 60% 55% at 15% 0%, ${t.accent}70 0%, transparent 65%),
              linear-gradient(170deg, ${t.bg} 0%, ${t.bg}B0 100%)
            `,
            border: `2px solid ${t.accent}80`,
            boxShadow: `0 8px 24px rgba(0,0,0,0.45), 0 0 0 1px ${t.accent}40 inset`,
            textShadow: '0 2px 6px rgba(0,0,0,0.3)',
          }}
        >
          <div
            className="text-5xl mb-3 leading-none"
            style={{ filter: 'drop-shadow(0 3px 10px rgba(0,0,0,0.5))' }}
          >
            {t.emoji}
          </div>
          <div
            className="text-2xl font-black leading-tight mb-2"
            style={{ fontFamily: 'serif', letterSpacing: '-0.01em' }}
          >
            {t.name}
          </div>
          <div className="text-xs font-medium" style={{ color: t.accent }}>
            {t.caption}
          </div>
        </motion.button>
      ))}
    </div>
  )
}
