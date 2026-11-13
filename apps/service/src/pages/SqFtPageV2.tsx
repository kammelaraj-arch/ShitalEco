// Future Legacy Appeal, V2 — rebuilt on the global @shital/appeal-ui
// LEGO. The classic SqFtPage stays in place as the operator's backup;
// this page shows the SAME 6 products using the shared AppealGrid +
// BasketBadge so a tweak to tile markup lives in one file across the
// kiosk, the service portal and any future campaign page.
//
// Flow mirrors the classic:
//   1. Donor picks qty on each tile (qty 0 = not in basket)
//   2. Floating "£N · M items · Checkout →" bar at the bottom
//   3. Checkout fires addItem for each tier and jumps to the basket
//      screen — reusing every downstream page (contact, gift-aid,
//      PayPal) unchanged.

import {
  AppealGrid,
  BasketBadge,
  APPEAL_PRODUCTS,
  type ProductKey,
} from '@shital/appeal-ui'
import { useState } from 'react'
import { useStore } from '../store'

const SAI_IMG =
  'https://admin.shital.org.uk/api/v1/media/library/00a4a66d-d25b-4195-8d33-57b1f2853f63'

export function SqFtPageV2() {
  const addItem = useStore(s => s.addItem)
  const setScreen = useStore(s => s.setScreen)
  // Basket state lives here (not Zustand) because it's a local qty draft
  // until the donor hits Checkout — same pattern as the classic page.
  const [basket, setBasket] = useState<Partial<Record<ProductKey, number>>>({})

  function checkout() {
    const lines = APPEAL_PRODUCTS
      .map(p => ({ product: p, qty: basket[p.key] ?? 0 }))
      .filter(l => l.qty > 0)
    if (lines.length === 0) return
    for (const l of lines) {
      addItem({
        type: 'DONATION',
        name: `${l.product.tier}${l.qty > 1 ? ` ×${l.qty}` : ''}`,
        quantity: l.qty,
        unitPrice: l.product.price,
        totalPrice: l.product.price * l.qty,
        referenceId: `${l.product.key}-${Date.now()}`,
        giftAidEligible: true,
        category: 'SPONSORSHIP',
      })
    }
    setScreen('basket')
  }

  return (
    <div
      className="min-h-screen px-4 py-6 pb-32"
      style={{
        background:
          'radial-gradient(1200px 600px at 50% -10%, #550000 0%, #2a0000 60%), #140606',
        color: 'var(--text, #FFF8EC)',
      }}
    >
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-6">
          <img
            src={SAI_IMG}
            alt=""
            className="w-28 h-28 mx-auto rounded-full object-cover mb-3"
            style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
            onError={e => {
              (e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
          <div
            className="text-xs font-black uppercase tracking-widest mb-2"
            style={{ color: 'rgba(212,175,55,0.9)' }}
          >
            Future Legacy Appeal
          </div>
          <h1
            className="text-3xl md:text-4xl font-black mb-3"
            style={{ fontFamily: 'serif', letterSpacing: '-0.02em' }}
          >
            Secure our ground · Build our future
          </h1>
          <p className="text-sm md:text-base max-w-2xl mx-auto opacity-90">
            Sponsor a <b>square foot</b> to help <b>clear the mortgage</b>,
            or a <b>brick</b> to build our future. The higher the tier, the
            larger your name on the temple's <b>digital donor wall</b>.
            Every gift is <b>Gift-Aided (+25%)</b>.
          </p>
        </div>

        <AppealGrid
          basket={basket}
          onQtyChange={(key, qty) =>
            setBasket(prev => {
              const next = { ...prev }
              if (qty <= 0) delete next[key]
              else next[key] = qty
              return next
            })
          }
          cols={{ base: 1, sm: 2, md: 3 }}
        />
      </div>

      <BasketBadge
        basket={basket}
        onCheckout={checkout}
        label="Checkout →"
      />
    </div>
  )
}
