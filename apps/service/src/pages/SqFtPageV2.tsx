// Future Legacy Appeal on the service portal — rendered with the SAME
// global LEGO the kiosk uses: @shital/donation-blocks → CategoryGrid
// (Level 0) + TierGrid / custom PledgeGrid (Level 1).
//
// Level 0 tiles mirror the kiosk's TILE_CATALOG one-for-one. Level 1
// mirrors the kiosk's specific tier / pledge catalogs so a donor on
// service.shital.org.uk and a donor at the kiosk see the same control
// at every step.
//
// Level 1 per category:
//   brick    → kiosk tier catalog (Red/Bronze/Silver/Gold/Founder) + Any
//   sqft     → kiosk tier catalog (1 sq ft / Family plot) + Any
//   general  → kiosk preset catalog (£5 £10 £25 £50 £100) + Any
//   business → one Business Sponsorship tier + Any
//   services → kiosk pledge catalog (12 items) → pick one → Any-Amount
//   volunt   → kiosk pledge catalog (12 items) → pick one → Any-Amount
//   material → kiosk pledge catalog (12 items) → pick one → Any-Amount
//   any      → straight to Any-Amount sheet (no Level 1)
//
// 'Any Amount' always adds the chosen amount to the basket and jumps
// to the 'basket' screen; the downstream contact → gift-aid → PayPal
// checkout is untouched.

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CategoryGrid,
  TierGrid,
  type CategoryTile,
  type TierCard,
} from '@shital/donation-blocks'
import { useStore } from '../store'

// Exactly the kiosk's TILE_CATALOG — same ids, colours, emojis and
// captions. A future tweak lands on both surfaces with one edit.
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

// Priced tiers, matching kiosk ProjectTiersScreen.CATEGORY_TIERS.
const TIERS: Record<string, TierCard[]> = {
  brick: [
    { label: 'Red Brick',     price: 51,   sub: 'Name on the donor wall' },
    { label: 'Bronze Brick',  price: 151,  sub: 'Family name · annual mention' },
    { label: 'Silver Brick',  price: 508,  sub: 'Patron plaque · lifetime pass' },
    { label: 'Gold Brick',    price: 1008, sub: 'Centrepiece plaque · trustee letter', featured: true },
    { label: 'Founder Brick', price: 5008, sub: 'Named in opening ceremony' },
  ],
  sqft: [
    { label: '1 sq ft',     price: 351,  sub: 'One foot of hall floor · name engraved', featured: true },
    { label: 'Family plot', price: 2501, sub: '≈7 ft² · family entrance tile' },
  ],
  general: [
    { label: '£5',   price: 5 },
    { label: '£10',  price: 10 },
    { label: '£25',  price: 25, featured: true },
    { label: '£50',  price: 50 },
    { label: '£100', price: 100 },
  ],
  business: [
    { label: 'Business Sponsorship', price: 2501, sub: 'Dedicated panel · invoice provided' },
  ],
}

// Pledge categories — 12 tiles each, matching kiosk
// ProjectPledgeScreen.PLEDGE_CATALOG one-for-one. Picking a tile on the
// service portal (which is payment-based, unlike the kiosk's no-charge
// pledge flow) opens the Any-Amount sheet pre-seeded with the item's
// label so the basket line reads "Materials — Bricks" etc.
interface PledgeItem { id: string; label: string; icon: string }
const PLEDGES: Record<string, { title: string; items: PledgeItem[] }> = {
  services: {
    title: 'Professional Services',
    items: [
      { id: 'architecture',   label: 'Architecture & Design',        icon: '📐' },
      { id: 'structural',     label: 'Structural Engineering',       icon: '🏗️' },
      { id: 'surveying',      label: 'Quantity Surveying',           icon: '📊' },
      { id: 'legal',          label: 'Legal / Conveyancing',         icon: '⚖️' },
      { id: 'accounting',     label: 'Accounting / Audit',           icon: '🧾' },
      { id: 'planning',       label: 'Planning Consultancy',         icon: '🗺️' },
      { id: 'project_mgmt',   label: 'Project Management',           icon: '📋' },
      { id: 'health_safety',  label: 'Health & Safety',              icon: '🦺' },
      { id: 'it',             label: 'IT / Web / A-V',               icon: '💻' },
      { id: 'marketing',      label: 'Marketing / Comms',            icon: '📢' },
      { id: 'photography',    label: 'Photography / Videography',    icon: '📷' },
      { id: 'translation',    label: 'Translation (Hindi/Gujarati)', icon: '🌐' },
    ],
  },
  volunt: {
    title: 'Volunteering',
    items: [
      { id: 'carpentry',      label: 'Carpentry / Joinery',          icon: '🔨' },
      { id: 'electrical',     label: 'Electrical',                   icon: '💡' },
      { id: 'plumbing',       label: 'Plumbing',                     icon: '🚰' },
      { id: 'painting',       label: 'Painting & Finishes',          icon: '🎨' },
      { id: 'gardening',      label: 'Landscaping / Gardening',      icon: '🌳' },
      { id: 'cleaning',       label: 'Cleaning / Housekeeping',      icon: '🧹' },
      { id: 'catering',       label: 'Catering (Prasad / Events)',   icon: '🍛' },
      { id: 'security',       label: 'Security / Stewarding',        icon: '🛡️' },
      { id: 'driving',        label: 'Driving / Collection',         icon: '🚐' },
      { id: 'teaching',       label: 'Teaching (classes / youth)',   icon: '📚' },
      { id: 'music',          label: 'Bhajan / Music',               icon: '🎵' },
      { id: 'reception',      label: 'Reception / Front-of-house',   icon: '🙏' },
    ],
  },
  material: {
    title: 'Materials',
    items: [
      { id: 'bricks',         label: 'Bricks',                       icon: '🧱' },
      { id: 'cement',         label: 'Cement / Mortar',              icon: '🪣' },
      { id: 'sand',           label: 'Sand / Aggregate',             icon: '⛏️' },
      { id: 'timber',         label: 'Timber',                       icon: '🪵' },
      { id: 'steel',          label: 'Steel / Rebar',                icon: '🏗️' },
      { id: 'tiles',          label: 'Tiles / Marble',               icon: '🔲' },
      { id: 'glass',          label: 'Glass / Doors',                icon: '🚪' },
      { id: 'roofing',        label: 'Roofing',                      icon: '🏠' },
      { id: 'lighting',       label: 'Lighting / Fixtures',          icon: '💡' },
      { id: 'av',             label: 'AV / Speakers',                icon: '🔊' },
      { id: 'furniture',      label: 'Furniture',                    icon: '🪑' },
      { id: 'kitchen',        label: 'Kitchen equipment',            icon: '🍳' },
    ],
  },
}

type AnySheet = { category: CategoryTile; subLabel?: string } | null

// ---------- Custom Level 1 for pledge categories ----------------------------
// 3-col grid of icon tiles — same look as kiosk ProjectPledgeScreen, but
// here each tile acts as a single-select launch pad: tap → open the
// Any-Amount sheet pre-seeded with that pledge item as the basket label.
function PledgeGrid({
  items, accent, onPick,
}: { items: PledgeItem[]; accent: string; onPick: (item: PledgeItem) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3 flex-1 min-h-0">
      {items.map(it => (
        <motion.button
          key={it.id}
          whileTap={{ scale: 0.96 }}
          onClick={() => onPick(it)}
          className="rounded-2xl text-left relative flex flex-col overflow-hidden p-3"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1.5px solid rgba(255,255,255,0.12)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          <div className="text-3xl mb-2">{it.icon}</div>
          <div
            className="font-black text-sm leading-tight text-white"
            style={{ fontFamily: 'serif' }}
          >
            {it.label}
          </div>
          <div
            className="mt-auto pt-2 text-[10px] uppercase tracking-widest"
            style={{ color: accent }}
          >
            Tap to pledge £…
          </div>
        </motion.button>
      ))}
    </div>
  )
}

export function SqFtPageV2() {
  const addItem = useStore(s => s.addItem)
  const setScreen = useStore(s => s.setScreen)
  const [picked, setPicked] = useState<CategoryTile | null>(null)
  const [anySheet, setAnySheet] = useState<AnySheet>(null)
  const [raw, setRaw] = useState('')

  function pushBasketAndGo(opts: { name: string; price: number; refKey: string }) {
    addItem({
      type: 'DONATION',
      name: opts.name,
      quantity: 1,
      unitPrice: opts.price,
      totalPrice: opts.price,
      referenceId: `${opts.refKey}-${Date.now()}`,
      giftAidEligible: true,
      category: 'SPONSORSHIP',
    })
    setScreen('basket')
  }

  function openAmountSheet(category: CategoryTile, subLabel?: string) {
    setRaw('')
    setAnySheet({ category, subLabel })
  }

  function submitAmountSheet() {
    if (!anySheet) return
    const amount = Number(raw)
    if (!Number.isFinite(amount) || amount < 1) return
    const price = Math.round(amount * 100) / 100
    const base = `Future Legacy Appeal — ${anySheet.category.name}`
    pushBasketAndGo({
      name: anySheet.subLabel ? `${base} — ${anySheet.subLabel}` : base,
      price,
      refKey: `${anySheet.category.id}${anySheet.subLabel ? ':' + anySheet.subLabel : ''}`,
    })
    setAnySheet(null)
  }

  function pickCategory(category: CategoryTile) {
    // 'Any Amount' tile skips Level 1 entirely — same shortcut the
    // kiosk uses (its project-tiers screen for 'any' pops the keypad
    // on arrival). Here we just open the amount sheet directly.
    if (category.id === 'any') {
      openAmountSheet(category)
      return
    }
    setPicked(category)
  }

  function pickTierCard(category: CategoryTile, price: number, tier: TierCard) {
    pushBasketAndGo({
      name: tier.label,
      price,
      refKey: `${category.id}:${tier.label}`,
    })
  }

  const amountNum = Number(raw)
  const amountValid = Number.isFinite(amountNum) && amountNum >= 1

  // ---------- Render ---------------------------------------------------------
  const isPledgeCat = picked && PLEDGES[picked.id]
  const isTierCat   = picked && TIERS[picked.id]

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
        {/* Level 1 header: Back + category name. Only when picked. */}
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
              <div className="text-[10px] uppercase tracking-widest"
                style={{ color: picked.accent }}>
                {isPledgeCat ? 'Select what you can offer' : 'Choose a tier'}
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

        {/* Level 0 Exit */}
        {!picked && (
          <div className="shrink-0 mb-3">
            <button
              onClick={() => setScreen('browse')}
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
              <CategoryGrid tiles={CATEGORIES} cols={3} onPick={pickCategory} />
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
              {isPledgeCat ? (
                <PledgeGrid
                  items={PLEDGES[picked.id].items}
                  accent={picked.accent}
                  onPick={item => openAmountSheet(picked, item.label)}
                />
              ) : isTierCat ? (
                <TierGrid
                  tiers={TIERS[picked.id]}
                  accent={picked.accent}
                  cols={3}
                  onPick={(price, tier) => pickTierCard(picked, price, tier)}
                  onAnyAmount={() => openAmountSheet(picked)}
                />
              ) : (
                // Defensive: category not configured — fall back to Any Amount.
                <div className="flex-1 flex items-center justify-center">
                  <button
                    onClick={() => openAmountSheet(picked)}
                    className="px-6 py-3 rounded-2xl font-black text-base"
                    style={{
                      background: picked.accent,
                      color: '#180324',
                    }}
                  >
                    Enter an amount →
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Any-Amount overlay — shared between 'Any Amount' tile taps and
          pledge-item taps. Pre-seeded label (sub) shown as context. */}
      <AnimatePresence>
        {anySheet && (
          <motion.div
            key="any-amount-sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 flex items-center justify-center z-50 px-4"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setAnySheet(null)}
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
                border: `2px solid ${anySheet.category.accent}`,
                boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 32px ${anySheet.category.accent}30`,
              }}
            >
              <div className="text-[10px] uppercase tracking-widest mb-1"
                style={{ color: anySheet.category.accent }}>
                {anySheet.category.name}
                {anySheet.subLabel ? ` · ${anySheet.subLabel}` : ''}
              </div>
              <div className="font-black text-xl mb-4" style={{ color: 'var(--text)', fontFamily: 'serif' }}>
                {anySheet.category.emoji} Enter an amount
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xl font-black" style={{ color: anySheet.category.accent }}>£</span>
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
                  onKeyDown={e => { if (e.key === 'Enter' && amountValid) submitAmountSheet() }}
                  className="flex-1 text-center py-2.5 rounded-lg text-xl font-black outline-none"
                  style={{
                    background: 'rgba(0,0,0,0.35)',
                    border: `1.5px solid ${anySheet.category.accent}60`,
                    color: 'var(--text)',
                  }}
                />
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setAnySheet(null)}
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
                  onClick={submitAmountSheet}
                  disabled={!amountValid}
                  className="flex-1 py-2.5 rounded-xl font-black text-sm active:scale-[0.98] disabled:opacity-40"
                  style={{
                    background: amountValid
                      ? `linear-gradient(135deg, ${anySheet.category.accent}, ${anySheet.category.bg})`
                      : 'rgba(0,0,0,0.3)',
                    color: amountValid ? '#180324' : 'var(--text-muted)',
                    boxShadow: amountValid ? `0 6px 20px ${anySheet.category.accent}40` : 'none',
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
