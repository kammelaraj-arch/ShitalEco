import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'
import { SOFT_DONATION_ITEMS, CatalogItem, filterActiveItems } from '../data/catalog'

type FilterKey = 'ALL' | 'GRAINS' | 'PULSES' | 'OIL_ESSENTIALS'

const FILTERS: { key: FilterKey; label: string; labelGu: string; labelHi: string; emoji: string }[] = [
  { key: 'ALL',            label: 'All Items',        labelGu: 'બધા',  labelHi: 'सब',    emoji: '✨' },
  { key: 'GRAINS',         label: 'Grains',           labelGu: 'અનાજ', labelHi: 'अनाज',  emoji: '🌾' },
  { key: 'PULSES',         label: 'Pulses',           labelGu: 'દાળ',  labelHi: 'दालें', emoji: '🫘' },
  { key: 'OIL_ESSENTIALS', label: 'Oil & Essentials', labelGu: 'તેલ',  labelHi: 'तेल',   emoji: '🌻' },
]

// Per-category vivid color scheme
const CAT_COLORS: Record<string, {
  gradient: string; glow: string; overlay: string
  pill: string; pillText: string; btnGrad: string; btnGlow: string
}> = {
  GRAINS: {
    gradient: 'linear-gradient(135deg,#F59E0B 0%,#D97706 100%)',
    glow: 'rgba(245,158,11,0.45)',
    overlay: 'rgba(180,83,9,0.35)',
    pill: '#FEF3C7', pillText: '#78350F',
    btnGrad: 'linear-gradient(135deg,#D97706,#92400E)',
    btnGlow: 'rgba(217,119,6,0.50)',
  },
  PULSES: {
    gradient: 'linear-gradient(135deg,#22C55E 0%,#16A34A 100%)',
    glow: 'rgba(34,197,94,0.40)',
    overlay: 'rgba(20,83,45,0.35)',
    pill: '#DCFCE7', pillText: '#14532D',
    btnGrad: 'linear-gradient(135deg,#16A34A,#14532D)',
    btnGlow: 'rgba(22,163,74,0.50)',
  },
  OIL_ESSENTIALS: {
    gradient: 'linear-gradient(135deg,#F97316 0%,#EA580C 100%)',
    glow: 'rgba(249,115,22,0.45)',
    overlay: 'rgba(154,52,18,0.35)',
    pill: '#FFEDD5', pillText: '#7C2D12',
    btnGrad: 'linear-gradient(135deg,#EA580C,#9A3412)',
    btnGlow: 'rgba(234,88,12,0.50)',
  },
  DEFAULT: {
    gradient: 'linear-gradient(135deg,#8B5CF6 0%,#7C3AED 100%)',
    glow: 'rgba(139,92,246,0.40)',
    overlay: 'rgba(76,29,149,0.35)',
    pill: '#EDE9FE', pillText: '#4C1D95',
    btnGrad: 'linear-gradient(135deg,#7C3AED,#4C1D95)',
    btnGlow: 'rgba(124,58,237,0.50)',
  },
}

const FILTER_COLORS: Record<FilterKey, { active: string; glow: string }> = {
  ALL:            { active: 'linear-gradient(135deg,#FF9933,#FF6600)', glow: 'rgba(255,153,51,0.45)' },
  GRAINS:         { active: 'linear-gradient(135deg,#F59E0B,#D97706)', glow: 'rgba(245,158,11,0.45)' },
  PULSES:         { active: 'linear-gradient(135deg,#22C55E,#16A34A)', glow: 'rgba(34,197,94,0.45)'  },
  OIL_ESSENTIALS: { active: 'linear-gradient(135deg,#F97316,#EA580C)', glow: 'rgba(249,115,22,0.45)' },
}

function getCat(cat: string) {
  return CAT_COLORS[cat] ?? CAT_COLORS.DEFAULT
}

function getCatLabel(cat: string) {
  if (cat === 'GRAINS') return '🌾 Grains'
  if (cat === 'PULSES') return '🫘 Pulses'
  if (cat === 'OIL_ESSENTIALS') return '🌻 Essentials'
  return '📦 ' + cat
}

function getItemName(item: CatalogItem, lang: string) {
  if (lang === 'gu') return item.nameGu
  if (lang === 'hi') return item.nameHi
  return item.name
}

export function SoftDonationScreen() {
  const { language, setScreen, addItem, items, updateQuantity, removeItem, theme } = useKioskStore()
  const th = THEMES[theme]
  const [filter, setFilter] = useState<FilterKey>('ALL')

  const basketTotal = items.reduce((s, i) => s + i.totalPrice, 0)
  const basketCount = items.reduce((s, i) => s + i.quantity, 0)
  const activeItems = filterActiveItems(SOFT_DONATION_ITEMS)
  const filtered = filter === 'ALL' ? activeItems : activeItems.filter(i => i.category === filter)

  const getQty = (id: string) => items.find(i => i.referenceId === id)?.quantity ?? 0
  const getBid = (id: string) => items.find(i => i.referenceId === id)?.id ?? null

  const handleAdd = (item: CatalogItem) =>
    addItem({ type: 'DONATION', name: item.name, nameGu: item.nameGu, nameHi: item.nameHi,
      quantity: 1, unitPrice: item.price, totalPrice: item.price,
      referenceId: item.id, giftAidEligible: false })

  const handleInc = (item: CatalogItem) => {
    const bid = getBid(item.id)
    bid ? updateQuantity(bid, getQty(item.id) + 1) : handleAdd(item)
  }
  const handleDec = (item: CatalogItem) => {
    const bid = getBid(item.id)
    if (!bid) return
    const q = getQty(item.id)
    if (q <= 1) removeItem(bid); else updateQuantity(bid, q - 1)
  }

  const getFilterLabel = (f: typeof FILTERS[0]) => {
    if (language === 'gu') return f.labelGu
    if (language === 'hi') return f.labelHi
    return f.label
  }

  return (
    <div className="w-full h-full flex flex-col" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header
        className="flex items-center h-16 px-4 gap-3 flex-shrink-0 z-20"
        style={{ background: th.headerBg, borderBottom: '2px solid rgba(255,153,51,0.2)', boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}
      >
        <button
          onClick={() => setScreen('home')}
          className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg active:scale-95"
          style={{ background: `${th.langActive}25`, color: th.headerText }}
        >←</button>
        <div className="flex-1">
          <h1 className="font-black text-lg leading-tight" style={{ color: th.headerText }}>
            {language === 'gu' ? 'વસ્તુ દાન' : language === 'hi' ? 'वस्तु दान' : 'Soft Item Donation'}
          </h1>
          <p className="text-xs" style={{ color: th.headerSub }}>🎁 Food &amp; Essentials for Those in Need</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: '#FEE2E2', border: '1.5px solid #FCA5A5' }}>
          <span className="text-red-600 font-black text-sm">✗</span>
          <span className="text-red-700 font-bold text-xs">Gift Aid</span>
        </div>
        {basketCount > 0 && (
          <button
            onClick={() => setScreen('basket')}
            className="relative flex items-center gap-2 text-white font-bold px-3 py-2 rounded-xl shadow-md active:scale-95 text-sm"
            style={{ background: th.basketBtn }}
          >
            🛒
            <span className="absolute -top-2 -right-2 bg-yellow-400 text-gray-900 text-xs font-black w-5 h-5 rounded-full flex items-center justify-center shadow">
              {basketCount}
            </span>
          </button>
        )}
      </header>

      {/* ── Filter chips ──────────────────────────────────────────────────── */}
      <div
        className="flex gap-2.5 px-4 py-3 flex-shrink-0 overflow-x-auto"
        style={{ background: '#1C1008', scrollbarWidth: 'none' }}
      >
        {FILTERS.map(f => {
          const active = filter === f.key
          const fc = FILTER_COLORS[f.key]
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="flex-shrink-0 flex items-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-black transition-all active:scale-95"
              style={{
                background: active ? fc.active : 'rgba(255,255,255,0.10)',
                color: active ? '#fff' : 'rgba(255,255,255,0.65)',
                boxShadow: active ? `0 4px 14px ${fc.glow}` : 'none',
                border: active ? 'none' : '1.5px solid rgba(255,255,255,0.12)',
              }}
            >
              <span>{f.emoji}</span>
              <span>{getFilterLabel(f)}</span>
            </button>
          )
        })}
      </div>

      {/* ── Card grid ─────────────────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto px-4 py-5"
        style={{ background: '#1C1008', scrollbarWidth: 'none' }}
      >
        <AnimatePresence mode="popLayout">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {filtered.map((item, i) => {
              const qty = getQty(item.id)
              const cc = getCat(item.category)
              const inBasket = qty > 0
              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: i * 0.04, type: 'spring', stiffness: 260, damping: 22 }}
                  className="rounded-3xl overflow-hidden flex flex-col"
                  style={{
                    background: '#FFFFFF',
                    boxShadow: inBasket
                      ? `0 8px 28px ${cc.glow}, 0 2px 8px rgba(0,0,0,0.15)`
                      : `0 4px 18px rgba(0,0,0,0.25)`,
                    border: inBasket ? `3px solid ${cc.btnGrad.includes('22C55') ? '#22C55E' : cc.btnGrad.includes('F59E') ? '#F59E0B' : '#F97316'}` : '2px solid transparent',
                    transform: inBasket ? 'translateY(-2px)' : 'none',
                  }}
                >
                  {/* ── Vivid photo area ── */}
                  <div className="relative overflow-hidden flex-shrink-0" style={{ height: 155 }}>
                    {/* Category gradient backdrop */}
                    <div className="absolute inset-0" style={{ background: cc.gradient }} />

                    {/* Food photo */}
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="absolute inset-0 w-full h-full object-cover mix-blend-overlay"
                        style={{ opacity: 0.85 }}
                        loading="lazy"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span style={{ fontSize: 72, lineHeight: 1, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))' }}>
                          {item.emoji}
                        </span>
                      </div>
                    )}

                    {/* Bottom gradient scrim */}
                    <div
                      className="absolute bottom-0 inset-x-0 h-20 pointer-events-none"
                      style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.60) 0%, transparent 100%)' }}
                    />

                    {/* Price — bottom left */}
                    <div
                      className="absolute bottom-2.5 left-3 font-black text-white"
                      style={{ fontSize: '1.375rem', textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}
                    >
                      £{item.price}
                    </div>

                    {/* Unit — bottom right */}
                    {item.unit && (
                      <div
                        className="absolute bottom-3 right-3 text-[11px] font-black text-white px-2 py-0.5 rounded-lg"
                        style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
                      >
                        {item.unit}
                      </div>
                    )}

                    {/* In-basket badge */}
                    {inBasket && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-xl text-xs font-black text-white shadow-lg"
                        style={{ background: cc.btnGrad }}
                      >
                        ×{qty} ✓
                      </motion.div>
                    )}

                    {/* Category pill — top left */}
                    <div
                      className="absolute top-2.5 left-2.5 text-[10px] font-black px-2 py-0.5 rounded-lg"
                      style={{ background: 'rgba(0,0,0,0.45)', color: '#fff', backdropFilter: 'blur(4px)' }}
                    >
                      {getCatLabel(item.category)}
                    </div>
                  </div>

                  {/* ── Card body ── */}
                  <div className="flex flex-col flex-1 px-3.5 pt-3 pb-3.5 gap-2">
                    <p className="font-black text-sm leading-snug line-clamp-2" style={{ color: '#111827' }}>
                      {getItemName(item, language)}
                    </p>

                    <div className="flex-1" />

                    {/* Add / Stepper */}
                    {qty === 0 ? (
                      <button
                        onClick={() => handleAdd(item)}
                        className="w-full py-2.5 rounded-2xl text-white font-black text-sm active:scale-95 transition-all"
                        style={{
                          background: cc.btnGrad,
                          boxShadow: `0 4px 14px ${cc.btnGlow}`,
                        }}
                      >
                        {language === 'gu' ? '+ ઉમેરો' : language === 'hi' ? '+ जोड़ें' : '+ Add to Basket'}
                      </button>
                    ) : (
                      <div
                        className="flex items-center justify-between rounded-2xl overflow-hidden"
                        style={{ background: cc.pill, border: `2px solid ${cc.pillText}30` }}
                      >
                        <button
                          onClick={() => handleDec(item)}
                          className="flex-1 font-black text-xl flex items-center justify-center py-2.5 active:scale-90 transition-all"
                          style={{ color: cc.pillText }}
                        >−</button>
                        <span className="font-black text-base w-8 text-center" style={{ color: cc.pillText }}>{qty}</span>
                        <button
                          onClick={() => handleInc(item)}
                          className="flex-1 font-black text-xl flex items-center justify-center py-2.5 active:scale-90 transition-all"
                          style={{ color: cc.pillText }}
                        >+</button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        </AnimatePresence>
      </div>

      {/* ── Basket bar ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {basketCount > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="flex-shrink-0 flex items-center justify-between px-5 py-3"
            style={{ background: '#2A1408', borderTop: '2px solid rgba(255,153,51,0.25)', boxShadow: '0 -6px 24px rgba(0,0,0,0.35)' }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shadow"
                style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)' }}
              >🎁</div>
              <div>
                <p className="text-xs font-semibold text-orange-300">{basketCount} item{basketCount !== 1 ? 's' : ''} selected</p>
                <p className="font-black text-xl text-white">£{basketTotal.toFixed(2)}</p>
              </div>
            </div>
            <button
              onClick={() => setScreen('basket')}
              className="text-white font-black px-7 py-3 rounded-2xl text-sm active:scale-95 transition-all"
              style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)', boxShadow: '0 4px 18px rgba(255,153,51,0.55)' }}
            >
              View Basket →
            </button>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  )
}
