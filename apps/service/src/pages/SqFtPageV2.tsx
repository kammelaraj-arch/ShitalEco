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

import { useState, type ReactElement } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CategoryGrid,
  TierGrid,
  type CategoryTile,
  type TierCard,
} from '@shital/donation-blocks'
import { useStore, t, type Language } from '../store'

// ---- Tier illustrations ---------------------------------------------------
// Ported from the kiosk's ProjectTiersScreen so service-portal tier cards
// have the same photoreal brick / sqft / preset body art — otherwise the
// cards have empty bodies and the "MOST CHOSEN" chip overlaps the price on
// the featured tile.
let __gid = 0
function BrickSVG({ color, mortar, highlight, shimmer }: {
  color: string; mortar: string; highlight: string; shimmer?: string
}) {
  const uid = (__gid++).toString(36)
  const body = `bk-${uid}`
  const sheen = `sh-${uid}`
  const bevel = `bv-${uid}`
  return (
    <svg viewBox="0 0 170 120" style={{ display: 'block', width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0"    stopColor={highlight} />
          <stop offset="0.15" stopColor={color} />
          <stop offset="0.85" stopColor={color} />
          <stop offset="1"    stopColor={mortar} />
        </linearGradient>
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0"   stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.4" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={bevel} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0"   stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1"   stopColor="#000000" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="158" height="48" rx="5" fill={`url(#${body})`} stroke={mortar} strokeWidth="1" />
      <rect x="6" y="6" width="158" height="48" rx="5" fill={`url(#${bevel})`} />
      <rect x="6" y="6" width="158" height="48" rx="5" fill={`url(#${sheen})`} />
      <rect x="10" y="8" width="150" height="2.5" rx="1" fill={highlight} opacity="0.75" />
      {shimmer && <rect x="6" y="24" width="158" height="6" fill={shimmer} opacity="0.22" />}
      <rect x="6"  y="62" width="74" height="52" rx="5" fill={`url(#${body})`} stroke={mortar} strokeWidth="1" />
      <rect x="6"  y="62" width="74" height="52" rx="5" fill={`url(#${bevel})`} />
      <rect x="6"  y="62" width="74" height="52" rx="5" fill={`url(#${sheen})`} />
      <rect x="10" y="64" width="66" height="2.5" rx="1" fill={highlight} opacity="0.75" />
      <rect x="90" y="62" width="74" height="52" rx="5" fill={`url(#${body})`} stroke={mortar} strokeWidth="1" />
      <rect x="90" y="62" width="74" height="52" rx="5" fill={`url(#${bevel})`} />
      <rect x="90" y="62" width="74" height="52" rx="5" fill={`url(#${sheen})`} />
      <rect x="94" y="64" width="66" height="2.5" rx="1" fill={highlight} opacity="0.75" />
    </svg>
  )
}
function SqFtSVG({ color, highlight, label }: { color: string; highlight: string; label: string }) {
  const uid = (__gid++).toString(36)
  return (
    <svg viewBox="0 0 170 120" style={{ display: 'block', width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id={`sq-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={highlight} />
          <stop offset="1" stopColor={color} />
        </linearGradient>
      </defs>
      <rect x="18" y="12" width="134" height="96" rx="6" fill={`url(#sq-${uid})`} stroke={highlight} strokeWidth="2.5" />
      <text x="85" y="78" textAnchor="middle" fontSize="40" fill="#180324" fontFamily="serif" fontWeight="900">{label}</text>
    </svg>
  )
}
function PresetSVG({ color, accent, label }: { color: string; accent: string; label: string }) {
  const uid = (__gid++).toString(36)
  return (
    <svg viewBox="0 0 170 120" style={{ display: 'block', width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id={`p-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={accent} />
          <stop offset="1" stopColor={color} />
        </linearGradient>
      </defs>
      <circle cx="85" cy="60" r="50" fill={`url(#p-${uid})`} stroke={accent} strokeWidth="2.5" />
      <text x="85" y="72" textAnchor="middle" fontSize="36" fontFamily="serif" fontWeight="900" fill="#180324">{label}</text>
    </svg>
  )
}
function EmojiArt({ emoji, bg }: { emoji: string; bg: string }): ReactElement {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `radial-gradient(circle at 50% 45%, ${bg}55, transparent 65%)`,
      fontSize: '4rem',
      filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.5))',
    }}>
      {emoji}
    </div>
  )
}

// Category skeleton — ids and colours only. Name/caption are resolved
// per-render through the store's t() so the page follows the donor's
// selected language.
interface CatSkel {
  id: string
  nameKey: string
  capKey: string
  emoji: string
  bg: string
  accent: string
}
const CATEGORY_SKELS: CatSkel[] = [
  { id: 'brick',    nameKey: 'cat_brick',    capKey: 'cap_brick',    emoji: '🧱', bg: '#D45030', accent: '#FFB899' },
  { id: 'sqft',     nameKey: 'cat_sqft',     capKey: 'cap_sqft',     emoji: '📏', bg: '#2E86AB', accent: '#A0D8F1' },
  { id: 'material', nameKey: 'cat_material', capKey: 'cap_material', emoji: '🗿', bg: '#C06C00', accent: '#FFD28B' },
  { id: 'volunt',   nameKey: 'cat_volunt',   capKey: 'cap_volunt',   emoji: '🤝', bg: '#14B8A6', accent: '#A7F3D0' },
  { id: 'services', nameKey: 'cat_services', capKey: 'cap_services', emoji: '🛠️', bg: '#7B2CBF', accent: '#D8B4FE' },
  { id: 'business', nameKey: 'cat_business', capKey: 'cap_business', emoji: '💼', bg: '#2E7D32', accent: '#A6E0A9' },
  { id: 'general',  nameKey: 'cat_general',  capKey: 'cap_general',  emoji: '🪔', bg: '#E63E7F', accent: '#FFC3DA' },
  { id: 'any',      nameKey: 'cat_any',      capKey: 'cap_any',      emoji: '£',  bg: '#FF9933', accent: '#FFE0B2' },
]
const buildCategories = (lang: Language): CategoryTile[] =>
  CATEGORY_SKELS.map(s => ({
    id: s.id,
    name: t(s.nameKey, lang),
    caption: t(s.capKey, lang),
    emoji: s.emoji,
    bg: s.bg,
    accent: s.accent,
  }))

// Priced tiers, matching kiosk ProjectTiersScreen.CATEGORY_TIERS, now with
// photoreal body art so the TierGrid cards fill properly and the featured
// "Most chosen" chip doesn't overlap the price.
const TIERS: Record<string, TierCard[]> = {
  brick: [
    { label: 'Red Brick',     price: 51,   sub: 'Name on the donor wall',
      render: () => <BrickSVG color="#D83921" mortar="#5B1507" highlight="#FFA384" /> },
    { label: 'Bronze Brick',  price: 151,  sub: 'Family name · annual mention',
      render: () => <BrickSVG color="#B96A1F" mortar="#4A2308" highlight="#F3B274" /> },
    { label: 'Silver Brick',  price: 508,  sub: 'Patron plaque · lifetime pass',
      render: () => <BrickSVG color="#B9C1C7" mortar="#4B5257" highlight="#F3F7FA" shimmer="#FFFFFF" /> },
    { label: 'Gold Brick',    price: 1008, sub: 'Centrepiece plaque · trustee letter', featured: true,
      render: () => <BrickSVG color="#E5B320" mortar="#5A4106" highlight="#FFF1A8" shimmer="#FFFFFF" /> },
    { label: 'Founder Brick', price: 5008, sub: 'Named in opening ceremony',
      render: () => <BrickSVG color="#9E1244" mortar="#3E041A" highlight="#F0C072" shimmer="#F0C072" /> },
  ],
  sqft: [
    { label: '1 sq ft',     price: 351,  sub: 'One foot of hall floor · name engraved', featured: true,
      render: () => <SqFtSVG color="#2C7FB8" highlight="#A9DBF5" label="ft²" /> },
    { label: 'Family plot', price: 2501, sub: '≈7 ft² · family entrance tile',
      render: () => <SqFtSVG color="#1B5F85" highlight="#A9DBF5" label="7 ft²" /> },
  ],
  general: [
    { label: '£5',   price: 5,
      render: () => <PresetSVG color="#E63E7F" accent="#FFC3DA" label="£5" /> },
    { label: '£10',  price: 10,
      render: () => <PresetSVG color="#E63E7F" accent="#FFC3DA" label="£10" /> },
    { label: '£25',  price: 25, featured: true,
      render: () => <PresetSVG color="#E63E7F" accent="#FFC3DA" label="£25" /> },
    { label: '£50',  price: 50,
      render: () => <PresetSVG color="#E63E7F" accent="#FFC3DA" label="£50" /> },
    { label: '£100', price: 100,
      render: () => <PresetSVG color="#E63E7F" accent="#FFC3DA" label="£100" /> },
  ],
  business: [
    { label: 'Business Sponsorship', price: 2501, sub: 'Dedicated panel · invoice provided',
      render: () => <EmojiArt emoji="💼" bg="#2E7D32" /> },
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
  items, bg, accent, cta, onPick,
}: { items: PledgeItem[]; bg: string; accent: string; cta: string; onPick: (item: PledgeItem) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3 flex-1 min-h-0">
      {items.map(it => (
        <motion.button
          key={it.id}
          whileTap={{ scale: 0.96 }}
          onClick={() => onPick(it)}
          className="rounded-2xl text-left relative flex flex-col overflow-hidden p-3 text-white"
          style={{
            // Same gradient language as the Level 0 CategoryGrid tiles:
            // radial accent glow in the top-left + linear bg from the
            // category colour. Keeps Level 1 visually in the same world
            // as the kiosk / CategoryGrid instead of neutral grey cards
            // on the maroon page bg.
            background: `
              radial-gradient(ellipse 60% 55% at 15% 0%, ${accent}70 0%, transparent 65%),
              linear-gradient(170deg, ${bg} 0%, ${bg}B0 100%)
            `,
            border: `2px solid ${accent}80`,
            boxShadow: `0 6px 18px rgba(0,0,0,0.35), 0 0 0 1px ${accent}40 inset`,
            textShadow: '0 1px 4px rgba(0,0,0,0.25)',
          }}
        >
          <div className="text-3xl mb-2" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))' }}>
            {it.icon}
          </div>
          <div
            className="font-black text-sm leading-tight"
            style={{ fontFamily: 'serif' }}
          >
            {it.label}
          </div>
          <div
            className="mt-auto pt-2 text-[10px] uppercase tracking-widest font-black"
            style={{ color: accent, textShadow: 'none' }}
          >
            {cta}
          </div>
        </motion.button>
      ))}
    </div>
  )
}

export function SqFtPageV2() {
  const addItem = useStore(s => s.addItem)
  const setScreen = useStore(s => s.setScreen)
  const language = useStore(s => s.language)
  const categories = buildCategories(language)
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
          {t('sqft_eyebrow', language)}
        </p>
        <h1 className="font-display text-2xl sm:text-3xl font-black mt-1"
          style={{ color: 'var(--text)' }}>
          {t('sqft_title', language)}
        </h1>
        <p className="text-sm mt-2 max-w-xl mx-auto" style={{ color: 'var(--text-muted)' }}>
          {t('sqft_subtitle', language)}
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
              ← {t('back', language)}
            </button>
            <div className="ml-3 flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-widest"
                style={{ color: picked.accent }}>
                {t(isPledgeCat ? 'sqft_select_offer' : 'sqft_choose_tier', language)}
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
              ← {t('back', language)}
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
              <CategoryGrid tiles={categories} cols={3} onPick={pickCategory} />
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
                  bg={picked.bg}
                  accent={picked.accent}
                  cta={t('sqft_tap_pledge', language)}
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
                    {t('sqft_enter_amount', language)} →
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
                {anySheet.category.emoji} {t('sqft_enter_amount', language)}
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
                  {t('cancel', language)}
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
                  {amountValid
                    ? `${t('add', language)} £${(Math.round(amountNum * 100) / 100).toLocaleString('en-GB')} →`
                    : t('sqft_enter_amount', language)}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
