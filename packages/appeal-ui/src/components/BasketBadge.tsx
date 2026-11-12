// LEGO: floating "£N · M items · Checkout →" bar. Stays sticky to the
// bottom of the viewport. Hides itself while the basket is empty so
// kiosk donors don't see an empty bar.

import { APPEAL_PRODUCTS, ProductKey, gbp } from '../data/products'

export interface BasketBadgeProps {
  basket: Partial<Record<ProductKey, number>>
  onCheckout: () => void
  disabled?: boolean
  label?: string      // e.g. "Tap card to pay" on kiosk, "Checkout →" on web
  /** Force-show even when empty (useful on the service portal where the
   *  badge doubles as a hint "nothing added yet"). */
  showWhenEmpty?: boolean
}

export function BasketBadge({
  basket,
  onCheckout,
  disabled,
  label = 'Checkout →',
  showWhenEmpty = false,
}: BasketBadgeProps) {
  const lines = APPEAL_PRODUCTS
    .map(p => ({ product: p, qty: basket[p.key] ?? 0 }))
    .filter(l => l.qty > 0)
  const total = lines.reduce((s, l) => s + l.product.price * l.qty, 0)
  const items = lines.reduce((s, l) => s + l.qty, 0)

  if (items === 0 && !showWhenEmpty) return null

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 p-3"
      style={{
        background: 'linear-gradient(0deg, rgba(20,6,6,0.98), rgba(20,6,6,0.9) 60%, transparent)',
      }}
    >
      <button
        type="button"
        onClick={onCheckout}
        disabled={disabled || items === 0}
        className="w-full rounded-2xl py-4 px-5 flex items-center justify-between text-left font-black border-2 border-white/40 disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
        style={{
          background: '#F6C454',
          color: '#180324',
          boxShadow: '0 12px 36px rgba(246,196,84,0.45)',
        }}
      >
        <span className="text-base leading-tight">
          <span className="tabular-nums text-xl block">{gbp(total)}</span>
          <span className="text-xs uppercase tracking-wider opacity-80">
            {items} item{items === 1 ? '' : 's'}
            {lines.length > 0 && (
              <>
                {' · '}
                {lines
                  .map(l => `${l.product.tier} ×${l.qty}`)
                  .join(' · ')}
              </>
            )}
          </span>
        </span>
        <span className="text-lg">{label}</span>
      </button>
    </div>
  )
}
