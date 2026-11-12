// LEGO: responsive grid of Appeal tiles. Consumers pass a basket
// (ProductKey → qty) and a handler. No store knowledge — persist
// however you like.

import { APPEAL_PRODUCTS, ProductKey } from '../data/products'
import { AppealTile } from './AppealTile'

export interface AppealGridProps {
  basket: Partial<Record<ProductKey, number>>
  onQtyChange: (key: ProductKey, next: number) => void
  /** Hide the Business Sponsorship tile on consumer-facing grids where
   *  "corporate" would feel out of place. Default shows everything. */
  hideBusiness?: boolean
  /** Override columns per breakpoint. Default: 1 mobile, 2 tablet, 3 desktop. */
  cols?: { base: number; sm?: number; md?: number; lg?: number }
}

export function AppealGrid({
  basket,
  onQtyChange,
  hideBusiness = false,
  cols = { base: 1, sm: 2, md: 3 },
}: AppealGridProps) {
  const items = hideBusiness
    ? APPEAL_PRODUCTS.filter(p => p.key !== 'business')
    : APPEAL_PRODUCTS

  // Tailwind can't dynamically pick grid-cols-N, so emit explicit classes.
  const gridClass = [
    'grid gap-4',
    `grid-cols-${cols.base}`,
    cols.sm ? `sm:grid-cols-${cols.sm}` : '',
    cols.md ? `md:grid-cols-${cols.md}` : '',
    cols.lg ? `lg:grid-cols-${cols.lg}` : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={gridClass}>
      {items.map(p => (
        <AppealTile
          key={p.key}
          product={p}
          qty={basket[p.key] ?? 0}
          onQtyChange={next => onQtyChange(p.key, next)}
        />
      ))}
    </div>
  )
}
