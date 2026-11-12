// Wembley kiosk → Future Legacy Appeal basket flow. Mounts the shared
// @shital/appeal-ui tiles + basket badge, aggregates the total, hands off
// to the existing TapScreen for card-reader payment.
//
// Scope: Wembley branch only. Other branches keep the classic 9-tile
// ProjectStartScreen flow. Branch gate lives in QuickDonationApp.

import { AppealGrid, BasketBadge, APPEAL_PRODUCTS } from '@shital/appeal-ui'
import { useDonationStore } from '../store/donation.store'

export function AppealScreen() {
  const {
    appealBasket, appealSetQty,
    setAmount, setScreen, setPickedCategory,
    branchId,
  } = useDonationStore()

  function checkout() {
    // Aggregate the basket into the single amount the existing card-tap
    // flow expects. Line-item breakdown stays in store (appealBasket)
    // so the eventual /record call can include it as metadata when we
    // wire that up in a follow-up.
    const total = APPEAL_PRODUCTS.reduce(
      (s, p) => s + p.price * (appealBasket[p.key] ?? 0),
      0,
    )
    if (total <= 0) return
    setAmount(total)
    // Tag the donation with 'appeal' so the Incoming Funds dashboard can
    // bucket it alongside the service portal's Future Legacy Appeal rows.
    setPickedCategory('appeal')
    setScreen('tap')
  }

  return (
    <div
      className="min-h-screen px-4 py-5 text-white"
      style={{ background: 'var(--qd-bg, #140606)' }}
    >
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div
            className="text-[11px] uppercase tracking-widest font-black"
            style={{ color: '#F6C454' }}
          >
            Future Legacy Appeal
          </div>
          <h1
            className="font-black text-3xl leading-tight"
            style={{ fontFamily: 'serif', letterSpacing: '-0.02em' }}
          >
            Secure our ground · Build our future
          </h1>
          <p className="text-xs mt-1" style={{ color: '#E7C796' }}>
            Shital {branchId || 'Wembley'} · Sponsor a square foot or a brick
            — add any combination, tap once to pay.
          </p>
        </div>
        <button
          onClick={() => setScreen('admin')}
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
          aria-label="Settings"
        >
          ⚙
        </button>
      </header>

      {/* Leave room for the sticky basket bar at the bottom. */}
      <div className="pb-32">
        <AppealGrid
          basket={appealBasket}
          onQtyChange={(key, next) => appealSetQty(key, next)}
          cols={{ base: 1, sm: 2, md: 3 }}
        />
      </div>

      <BasketBadge
        basket={appealBasket}
        onCheckout={checkout}
        label="Tap card to pay →"
      />
    </div>
  )
}
