import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'
import { SOFT_DONATION_ITEMS, CatalogItem, filterActiveItems } from '../data/catalog'

type FilterKey = 'ALL' | 'GRAINS' | 'PULSES' | 'OIL_ESSENTIALS'

const FILTERS: { key: FilterKey; label: string; labelGu: string; labelHi: string; emoji: string }[] = [
  { key: 'ALL',           label: 'All Items',        labelGu: 'બધા',     labelHi: 'सब',     emoji: '🌟' },
  { key: 'GRAINS',        label: 'Grains',           labelGu: 'અનાજ',    labelHi: 'अनाज',   emoji: '🌾' },
  { key: 'PULSES',        label: 'Pulses',           labelGu: 'દાળ',     labelHi: 'दालें',  emoji: '🫘' },
  { key: 'OIL_ESSENTIALS',label: 'Oil & Essentials', labelGu: 'તેલ',     labelHi: 'तेल',    emoji: '🌻' },
]

// Warm cream palette matching ecavo-style
const CREAM_BG = '#F4ECD8'
const CARD_BG  = '#FFFDF8'

function getItemName(item: CatalogItem, lang: string) {
  if (lang === 'gu') return item.nameGu
  if (lang === 'hi') return item.nameHi
  return item.name
}

function getCategoryLabel(cat: string) {
  if (cat === 'GRAINS') return { label: 'Grains', emoji: '🌾', color: '#84CC16', bg: '#F7FEE7' }
  if (cat === 'PULSES') return { label: 'Pulses', emoji: '🫘', color: '#16A34A', bg: '#F0FDF4' }
  if (cat === 'OIL_ESSENTIALS') return { label: 'Essentials', emoji: '🌻', color: '#CA8A04', bg: '#FEFCE8' }
  return { label: cat, emoji: '📦', color: '#6B7280', bg: '#F9FAFB' }
}

export function SoftDonationScreen() {
  const { language, setScreen, addItem, items, updateQuantity, removeItem, theme } = useKioskStore()
  const th = THEMES[theme]
  const [filter, setFilter] = useState<FilterKey>('ALL')

  const basketTotal = items.reduce((s, i) => s + i.totalPrice, 0)
  const basketCount = items.reduce((s, i) => s + i.quantity, 0)

  const activeItems = filterActiveItems(SOFT_DONATION_ITEMS)
  const filtered = filter === 'ALL'
    ? activeItems
    : activeItems.filter(i => i.category === filter)

  const getQty = (catalogId: string) => {
    const bi = items.find(i => i.referenceId === catalogId)
    return bi ? bi.quantity : 0
  }
  const getBasketId = (catalogId: string) => {
    const bi = items.find(i => i.referenceId === catalogId)
    return bi?.id ?? null
  }

  const handleAdd = (item: CatalogItem) => {
    addItem({
      type: 'DONATION',
      name: item.name,
      nameGu: item.nameGu,
      nameHi: item.nameHi,
      quantity: 1,
      unitPrice: item.price,
      totalPrice: item.price,
      referenceId: item.id,
      giftAidEligible: false,
    })
  }
  const handleInc = (item: CatalogItem) => {
    const bid = getBasketId(item.id)
    if (bid) updateQuantity(bid, getQty(item.id) + 1)
    else handleAdd(item)
  }
  const handleDec = (item: CatalogItem) => {
    const bid = getBasketId(item.id)
    if (!bid) return
    const q = getQty(item.id)
    if (q <= 1) removeItem(bid)
    else updateQuantity(bid, q - 1)
  }

  const getFilterLabel = (f: typeof FILTERS[0]) => {
    if (language === 'gu') return f.labelGu
    if (language === 'hi') return f.labelHi
    return f.label
  }

  return (
    <div className="w-full h-full flex flex-col" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        className="flex items-center h-16 px-4 gap-3 flex-shrink-0 z-20"
        style={{ background: th.headerBg, borderBottom: '2px solid rgba(255,153,51,0.2)', boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}
      >
        <button
          onClick={() => setScreen('home')}
          className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg active:scale-95"
          style={{ background: `${th.langActive}20`, color: th.headerText }}
        >
          ←
        </button>
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
            <span className="absolute -top-2 -right-2 bg-yellow-400 text-gray-900 text-xs font-black w-5 h-5 rounded-full flex items-center justify-center shadow-md">
              {basketCount}
            </span>
          </button>
        )}
      </header>

      {/* ── Filter pills ──────────────────────────────────────────────────── */}
      <div
        className="flex gap-2 px-4 py-3 flex-shrink-0 overflow-x-auto"
        style={{ background: CREAM_BG, borderBottom: '1px solid #E8DDC8', scrollbarWidth: 'none' }}
      >
        {FILTERS.map(f => {
          const active = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all active:scale-95"
              style={{
                background: active ? '#2D6A4F' : '#FFFFFF',
                color: active ? '#fff' : '#5C4A2A',
                border: active ? '2px solid #2D6A4F' : '2px solid #D4C5A9',
                boxShadow: active ? '0 2px 10px rgba(45,106,79,0.3)' : '0 1px 3px rgba(0,0,0,0.06)',
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
        style={{ background: CREAM_BG, scrollbarWidth: 'none' }}
      >
        <AnimatePresence mode="popLayout">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {filtered.map((item, i) => {
              const qty = getQty(item.id)
              const cat = getCategoryLabel(item.category)
              const inBasket = qty > 0
              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04, type: 'spring', stiffness: 280, damping: 24 }}
                  className="rounded-3xl overflow-hidden flex flex-col"
                  style={{
                    background: CARD_BG,
                    boxShadow: inBasket
                      ? `0 4px 20px ${th.langActive}45, 0 1px 4px rgba(0,0,0,0.08)`
                      : '0 2px 12px rgba(139,90,43,0.12), 0 1px 3px rgba(0,0,0,0.06)',
                    border: inBasket ? `2.5px solid ${th.langActive}` : '2px solid rgba(212,197,169,0.5)',
                  }}
                >
                  {/* ── Photo area ── */}
                  <div
                    className="relative overflow-hidden flex-shrink-0"
                    style={{ height: 150, background: item.imageColor || '#FEF3C7' }}
                  >
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span style={{ fontSize: 64, lineHeight: 1 }}>{item.emoji}</span>
                      </div>
                    )}
                    {/* Gradient scrim at bottom */}
                    <div
                      className="absolute bottom-0 inset-x-0 h-16 pointer-events-none"
                      style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.32) 0%, transparent 100%)' }}
                    />
                    {/* Price pill overlaid on photo */}
                    <div
                      className="absolute bottom-2.5 left-3 px-2.5 py-1 rounded-xl font-black text-white text-base"
                      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
                    >
                      £{item.price}
                    </div>
                    {/* In-basket badge */}
                    {inBasket && (
                      <div
                        className="absolute top-2.5 right-2.5 px-2 py-1 rounded-xl text-xs font-black text-white"
                        style={{ background: th.langActive }}
                      >
                        ×{qty} in basket
                      </div>
                    )}
                  </div>

                  {/* ── Card body ── */}
                  <div className="flex flex-col flex-1 p-3.5 gap-2">
                    {/* Category badge */}
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-[11px] font-black px-2.5 py-0.5 rounded-full flex items-center gap-1"
                        style={{ background: cat.bg, color: cat.color, border: `1px solid ${cat.color}30` }}
                      >
                        {cat.emoji} {cat.label}
                      </span>
                    </div>

                    {/* Name */}
                    <div>
                      <p className="font-black text-sm leading-snug line-clamp-2" style={{ color: '#2C1A0E' }}>
                        {getItemName(item, language)}
                      </p>
                      {item.unit && (
                        <p className="text-xs mt-0.5 font-medium" style={{ color: '#9C7A4B' }}>
                          📦 {item.unit}
                        </p>
                      )}
                    </div>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Add / Stepper */}
                    {qty === 0 ? (
                      <button
                        onClick={() => handleAdd(item)}
                        className="w-full py-2.5 rounded-2xl text-white font-black text-sm transition-all active:scale-95 shadow-md"
                        style={{ background: 'linear-gradient(135deg,#2D6A4F,#1B4332)' }}
                      >
                        {language === 'gu' ? '+ ઉમેરો' : language === 'hi' ? '+ जोड़ें' : '+ Add to Basket'}
                      </button>
                    ) : (
                      <div
                        className="flex items-center justify-between rounded-2xl overflow-hidden"
                        style={{ background: '#F0FDF4', border: '2px solid #22C55E' }}
                      >
                        <button
                          onClick={() => handleDec(item)}
                          className="flex-1 font-black text-xl flex items-center justify-center py-2.5 transition-all active:scale-90"
                          style={{ color: '#15803D' }}
                        >
                          −
                        </button>
                        <span className="font-black text-base w-8 text-center" style={{ color: '#15803D' }}>{qty}</span>
                        <button
                          onClick={() => handleInc(item)}
                          className="flex-1 font-black text-xl flex items-center justify-center py-2.5 transition-all active:scale-90"
                          style={{ color: '#15803D' }}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        </AnimatePresence>
      </div>

      {/* ── Basket bar ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {basketCount > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="flex-shrink-0 flex items-center justify-between px-5 py-3"
            style={{
              background: '#FFFDF8',
              borderTop: '2px solid #E8DDC8',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.10)',
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl"
                style={{ background: '#F0FDF4', border: '2px solid #22C55E' }}
              >
                🎁
              </div>
              <div>
                <p className="text-xs font-semibold" style={{ color: '#9C7A4B' }}>
                  {basketCount} item{basketCount !== 1 ? 's' : ''} selected
                </p>
                <p className="font-black text-lg" style={{ color: '#2C1A0E' }}>£{basketTotal.toFixed(2)}</p>
              </div>
            </div>
            <button
              onClick={() => setScreen('basket')}
              className="text-white font-black px-6 py-3 rounded-2xl text-sm shadow-lg active:scale-95 transition-all"
              style={{ background: 'linear-gradient(135deg,#2D6A4F,#1B4332)' }}
            >
              View Basket →
            </button>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  )
}
