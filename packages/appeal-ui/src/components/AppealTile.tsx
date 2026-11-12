// LEGO: one Appeal product rendered as a tile. Mounts in three places:
//   - Service portal Future Legacy page grid
//   - Wembley kiosk donation grid
//   - Social-media deep-link landing page (single tile, hero size)
//
// All variants use the same palette from products.ts so colour / price /
// blurb changes are a one-liner. Interaction is passed in via `qty` +
// `onQtyChange` — the consumer owns basket state (store, URL params,
// backend, whatever). Tile stays stateless.

import { CSSProperties, ReactNode } from 'react'
import { AppealProduct, gbp } from '../data/products'
import { QtyStepper } from './QtyStepper'

export interface AppealTileProps {
  product: AppealProduct
  qty: number
  onQtyChange: (next: number) => void
  /** 'grid' (default) — square, fills parent. 'hero' — wide, for deep-link pages. 'compact' — single-row horizontal. */
  variant?: 'grid' | 'hero' | 'compact'
  /** Optional slot below the blurb — donor-wall name input, "most chosen" ribbon, etc. */
  extra?: ReactNode
}

export function AppealTile({
  product,
  qty,
  onQtyChange,
  variant = 'grid',
  extra,
}: AppealTileProps) {
  const p = product
  const isHero = variant === 'hero'
  const isCompact = variant === 'compact'

  // Tile background: one-colour wash so the price is the loudest thing
  // on screen (the service portal prototype proved donors scan prices
  // first). Soft inner glow gives the tier its identity.
  const style: CSSProperties = {
    background: `
      radial-gradient(ellipse 70% 55% at 15% 0%, ${p.color}55 0%, transparent 65%),
      linear-gradient(170deg, #2a0f14 0%, #140606 100%)
    `,
    border: `2px solid ${p.color}66`,
    boxShadow: `0 10px 28px rgba(0,0,0,0.45), inset 0 0 0 1px ${p.color}33`,
    color: '#fff',
  }

  return (
    <div
      className={
        isCompact
          ? 'rounded-2xl p-3 flex items-center gap-3'
          : isHero
            ? 'rounded-3xl p-6 flex flex-col gap-4'
            : 'rounded-3xl p-4 flex flex-col text-left'
      }
      style={style}
      data-product={p.key}
    >
      <div className={isCompact ? 'flex items-center gap-3 flex-1 min-w-0' : 'flex items-center gap-3'}>
        <div
          className="rounded-2xl flex items-center justify-center font-black shrink-0"
          style={{
            background: `${p.color}33`,
            border: `1.5px solid ${p.color}88`,
            width: isHero ? 72 : isCompact ? 48 : 56,
            height: isHero ? 72 : isCompact ? 48 : 56,
            fontSize: isHero ? 38 : isCompact ? 24 : 30,
            color: p.color,
          }}
          aria-hidden
        >
          {p.emoji || p.tier.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-black leading-tight truncate"
               style={{ fontSize: isHero ? 24 : 18, color: '#FFF8EC' }}>
            {p.tier}
          </div>
          <div className="font-black leading-tight tabular-nums"
               style={{ fontSize: isHero ? 32 : isCompact ? 18 : 24, color: p.color }}>
            {gbp(p.price)}
            <span className="font-medium opacity-70 ml-1" style={{ fontSize: '0.55em' }}>
              each
            </span>
          </div>
        </div>
        {p.featured && !isCompact && (
          <div className="rounded-full font-black text-[10px] uppercase tracking-wider shrink-0"
               style={{ background: p.color, color: '#180324', padding: '4px 10px' }}>
            Most chosen
          </div>
        )}
      </div>

      {!isCompact && (
        <p className="text-sm leading-snug mt-2" style={{ color: '#E7C796' }}>
          {p.blurb}
        </p>
      )}
      {!isCompact && (
        <div className="text-xs font-semibold mt-1" style={{ color: p.color }}>
          🪪 {p.wall}
        </div>
      )}

      {extra}

      <div className={isCompact ? 'ml-auto' : 'mt-3 flex items-center justify-between gap-3'}>
        {!isCompact && (
          <div className="text-xs opacity-70" style={{ color: '#E7C796' }}>
            Total:&nbsp;
            <span className="font-black tabular-nums" style={{ color: '#FFF8EC' }}>
              {gbp(p.price * qty)}
            </span>
          </div>
        )}
        <QtyStepper
          value={qty}
          onChange={onQtyChange}
          color={p.color}
          size={isHero ? 44 : isCompact ? 32 : 36}
          label={p.tier}
        />
      </div>
    </div>
  )
}
