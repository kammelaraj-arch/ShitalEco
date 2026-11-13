// Future Legacy Appeal on the service portal — rendered with the SAME
// global LEGO the kiosk uses: @shital/donation-blocks → DonationPicker
// (Level 0 CategoryGrid + Level 1 TierGrid).
//
// Operator requirement: 'use this control with level 0, 1' — the
// screenshot the operator sent was the kiosk's CategoryGrid (Brick,
// Square Feet, Materials, Volunteering, Professional Services, Business
// Sponsorship, General Donation, Any Amount). This page must mirror that
// exactly so a donor on service.shital.org.uk and a donor at the kiosk
// see the same control.
//
// Flow
// ----
//   Level 0 (CategoryGrid) → donor picks a category
//   Level 1 (TierGrid)     → donor picks a tier, OR taps "Any Amount"
//                            which opens a small amount overlay.
//   Both paths add a basket line and jump to the 'basket' screen.
//   The downstream contact → gift-aid → PayPal checkout is untouched.
//
// The classic SqFtPage stays reachable at ?screen=sqft-classic as the
// operator-requested backup.

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  DonationPicker,
  type CategoryTile,
  type TierCard,
} from '@shital/donation-blocks'
import { useStore } from '../store'

// Exactly the kiosk's TILE_CATALOG — same ids, colours, emojis and
// captions. Keeping them one-for-one means a future tweak lands on
// every surface with one edit.
const CATEGORIES: CategoryTile[] = [
  { id: 'brick',    name: 'Brick',                 emoji: '🧱', caption: 'Red to Founder · as you wish',    bg: '#D45030', accent: '#FFB899' },
  { id: 'sqft',     name: 'Square Feet',           emoji: '📏', caption: 'Any size · as you can afford',   bg: '#2E86AB', accent: '#A0D8F1' },
  { id: 'material', name: 'Materials',             emoji: '🗿', caption: 'Help supply the build',          bg: '#C06C00', accent: '#FFD28B' },
  { id: 'volunt',   name: 'Volunteering',          emoji: '🤝', caption: 'Help supply the build',          bg: '#14B8A6', accent: '#A7F3D0' },
  { id: 'services', name: 'Professional Services', emoji: '🛠️', caption: 'Share your skill or sponsor it',  bg: '#7B2CBF', accent: '#D8B4FE' },
  { id: 'business', name: 'Business Sponsorship',  emoji: '💼', caption: 'A lasting partnership',          bg: '#2E7D32', accent: '#A6E0A9' },
  { id: 'general',  name: 'General Donation',      emoji: '🪔', caption: "Where it's needed most",         bg: '#E63E7F', accent: '#FFC3DA' },
  { id: 'any',      name: 'Any Amount',            emoji: '£',  caption: 'Give what you wish',             bg: '#FF9933', accent: '#FFE0B2' },
]

// Level 1 tiers per category. Categories without priced tiers (material,
// volunt, services, general, any) render with only the dashed Any-Amount
// tile — the donor still goes through the global control, we just don't
// prescribe prices for them.
const TIERS: Record<string, TierCard[]> = {
  brick: [
    { label: 'Red Brick',     price: 51,   sub: 'Your name on the donor wall' },
    { label: 'Bronze Brick',  price: 151,  sub: 'A bronze plaque on the wall' },
    { label: 'Gold Brick',    price: 1008, sub: 'A prominent gold plaque' },
    { label: 'Founder Brick', price: 5100, sub: 'Premium Founder panel' },
  ],
  sqft: [
    { label: 'Square Foot', price: 351, sub: 'Clears a square foot of the mortgage', featured: true },
  ],
  business: [
    { label: 'Business Sponsorship', price: 2501, sub: 'Dedicated panel · invoice provided' },
  ],
  material: [],
  volunt:   [],
  services: [],
  general:  [],
  any:      [],
}

type PendingAny = { category: CategoryTile } | null

export function SqFtPageV2() {
  const addItem = useStore(s => s.addItem)
  const setScreen = useStore(s => s.setScreen)
  const [pendingAny, setPendingAny] = useState<PendingAny>(null)
  const [raw, setRaw] = useState('')

  function pushBasketAndGo(opts: {
    name: string
    price: number
    categoryKey: string
  }) {
    addItem({
      type: 'DONATION',
      name: opts.name,
      quantity: 1,
      unitPrice: opts.price,
      totalPrice: opts.price,
      referenceId: `${opts.categoryKey}-${Date.now()}`,
      giftAidEligible: true,
      category: 'SPONSORSHIP',
    })
    setScreen('basket')
  }

  function onChoose(category: CategoryTile, price: number, tier: TierCard) {
    pushBasketAndGo({
      name: tier.label,
      price,
      categoryKey: category.id,
    })
  }

  function onAnyAmountTapped(category: CategoryTile) {
    setRaw('')
    setPendingAny({ category })
  }

  function submitAnyAmount() {
    if (!pendingAny) return
    const amount = Number(raw)
    if (!Number.isFinite(amount) || amount < 1) return
    const price = Math.round(amount * 100) / 100
    pushBasketAndGo({
      name: `Future Legacy Appeal — ${pendingAny.category.name}`,
      price,
      categoryKey: pendingAny.category.id,
    })
    setPendingAny(null)
  }

  const amountNum = Number(raw)
  const amountValid = Number.isFinite(amountNum) && amountNum >= 1

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto px-4 py-6"
      style={{ maxWidth: 1200, minHeight: 'calc(100vh - 140px)' }}
    >
      <div className="text-center mb-5">
        <p className="text-xs font-bold tracking-widest uppercase"
          style={{ color: 'rgba(212,175,55,0.85)' }}>
          Future Legacy Appeal
        </p>
        <h1 className="font-display text-2xl sm:text-3xl font-black mt-1"
          style={{ color: 'var(--text)' }}>
          Secure our ground · build our future
        </h1>
        <p className="text-sm mt-2 max-w-xl mx-auto" style={{ color: 'var(--text-muted)' }}>
          Pick a category, then a tier — or enter any amount. Every gift is Gift-Aided (+25%).
        </p>
      </div>

      <div className="flex flex-col" style={{ minHeight: 540 }}>
        <DonationPicker
          categories={CATEGORIES}
          tiersByCategory={TIERS}
          onChoose={onChoose}
          onAnyAmount={onAnyAmountTapped}
          onExit={() => setScreen('browse')}
          cols={3}
        />
      </div>

      <AnimatePresence>
        {pendingAny && (
          <motion.div
            key="any-amount-sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 flex items-center justify-center z-50 px-4"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setPendingAny(null)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 12 }}
              transition={{ duration: 0.18 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl p-5"
              style={{
                background: 'linear-gradient(180deg, #2A0A0A, #180404)',
                border: `2px solid ${pendingAny.category.accent}`,
                boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 32px ${pendingAny.category.accent}30`,
              }}
            >
              <div className="text-[10px] uppercase tracking-widest mb-1"
                style={{ color: pendingAny.category.accent }}>
                {pendingAny.category.name}
              </div>
              <div className="font-black text-xl mb-4" style={{ color: 'var(--text)', fontFamily: 'serif' }}>
                {pendingAny.category.emoji} Enter an amount
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xl font-black" style={{ color: pendingAny.category.accent }}>£</span>
                <input
                  autoFocus
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={raw}
                  onChange={e => {
                    const cleaned = e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
                    setRaw(cleaned)
                  }}
                  onKeyDown={e => { if (e.key === 'Enter' && amountValid) submitAnyAmount() }}
                  className="flex-1 text-center py-2.5 rounded-lg text-xl font-black outline-none"
                  style={{
                    background: 'rgba(0,0,0,0.35)',
                    border: `1.5px solid ${pendingAny.category.accent}60`,
                    color: 'var(--text)',
                  }}
                />
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setPendingAny(null)}
                  className="flex-1 py-2.5 rounded-xl font-black text-sm active:scale-[0.98]"
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    color: 'var(--text)',
                    border: '1.5px solid rgba(255,255,255,0.15)',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={submitAnyAmount}
                  disabled={!amountValid}
                  className="flex-1 py-2.5 rounded-xl font-black text-sm active:scale-[0.98] disabled:opacity-40"
                  style={{
                    background: amountValid
                      ? `linear-gradient(135deg, ${pendingAny.category.accent}, ${pendingAny.category.bg})`
                      : 'rgba(0,0,0,0.3)',
                    color: amountValid ? '#180324' : 'var(--text-muted)',
                    boxShadow: amountValid ? `0 6px 20px ${pendingAny.category.accent}40` : 'none',
                  }}
                >
                  {amountValid ? `Add £${(Math.round(amountNum * 100) / 100).toLocaleString('en-GB')} →` : 'Enter amount'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
