import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'
import { SOFT_DONATION_ITEMS, CatalogItem, filterActiveItems } from '../data/catalog'

type FilterKey = 'ALL' | 'GRAINS' | 'PULSES' | 'OIL_ESSENTIALS'

const FILTERS: { key: FilterKey; label: string; labelGu: string; labelHi: string; emoji: string }[] = [
  { key: 'ALL',           label: 'All',            labelGu: 'બધા',       labelHi: 'सब',       emoji: '🌟' },
  { key: 'GRAINS',        label: 'Grains',         labelGu: 'અનાજ',      labelHi: 'अनाज',     emoji: '🌾' },
  { key: 'PULSES',        label: 'Pulses',         labelGu: 'દાળ',       labelHi: 'दालें',    emoji: '🫘' },
  { key: 'OIL_ESSENTIALS',label: 'Oil & Essentials',labelGu: 'તેલ',      labelHi: 'तेल',      emoji: '🌻' },
]

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
    if (bid) {
      updateQuantity(bid, getQty(item.id) + 1)
    } else {
      handleAdd(item)
    }
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

      {/* Header */}
      <header
        className="flex items-center h-16 px-4 gap-3 flex-shrink-0 relative z-20"
        style={{
          background: th.headerBg,
          borderBottom: `2px solid rgba(255,153,51,0.25)`,
          boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
        }}
      >
        <button
          onClick={() => setScreen('home')}
          className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg transition-all active:scale-95"
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

        {/* NOT Gift Aid badge */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: '#FEE2E2', border: '1.5px solid #FCA5A5' }}>
          <span className="text-red-600 font-black text-sm">✗</span>
          <span className="text-red-700 font-bold text-xs">Gift Aid</span>
        </div>

        {/* Basket count */}
        {basketCount > 0 && (
          <button
            onClick={() => setScreen('basket')}
            className="relative flex items-center gap-2 text-white font-bold px-3 py-2 rounded-xl transition-all shadow-md active:scale-95 text-sm"
            style={{ background: th.basketBtn }}
          >
            🛒
            <span className="absolute -top-2 -right-2 bg-yellow-400 text-gray-900 text-xs font-black w-5 h-5 rounded-full flex items-center justify-center shadow-md">
              {basketCount}
            </span>
          </button>
        )}
      </header>

      {/* Description Banner */}
      <div
        className="px-5 py-3 flex-shrink-0"
        style={{ background: '#FFF7ED', borderBottom: '1px solid #FED7AA' }}
      >
        <p className="text-sm text-orange-800 font-medium">
          🎁 Donate food items to those in need. These donations are <strong>NOT eligible for Gift Aid</strong> as they are physical goods.
        </p>
      </div>

      {/* Filter pills */}
      <div
        className="flex gap-2 px-4 py-3 flex-shrink-0 overflow-x-auto"
        style={{ background: th.sectionHeaderBg, borderBottom: '1px solid rgba(0,0,0,0.06)', scrollbarWidth: 'none' }}
      >
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all active:scale-95"
            style={{
              background: filter === f.key ? th.langActive : `${th.langActive}15`,
              color: filter === f.key ? '#fff' : th.sectionTitleColor,
              boxShadow: filter === f.key ? `0 2px 8px ${th.langActive}40` : 'none',
            }}
          >
            <span>{f.emoji}</span>
            <span>{getFilterLabel(f)}</span>
          </button>
        ))}
      </div>

      {/* Item Grid */}
      <div className="flex-1 overflow-y-auto p-4" style={{ background: th.mainBg, scrollbarWidth: 'none' }}>
        <AnimatePresence mode="popLayout">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filtered.map((item, i) => {
              const qty = getQty(item.id)
              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="rounded-2xl overflow-hidden shadow-md"
                  style={{ background: item.imageColor, border: qty > 0 ? `2px solid ${th.langActive}` : '2px solid transparent' }}
                >
                  <div className="p-3.5">
                    {/* Emoji & not-gift-aid */}
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-3xl">{item.emoji}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">✗ GA</span>
                    </div>

                    <p className="font-bold text-sm text-gray-800 leading-snug line-clamp-2 mb-0.5">
                      {getItemName(item, language)}
                    </p>
                    {item.unit && (
                      <p className="text-xs text-gray-500 mb-2">{item.unit}</p>
                    )}
                    <p className="font-black text-lg text-gray-900">£{item.price}</p>

                    {/* Add / Stepper */}
                    <div className="mt-2.5">
                      {qty === 0 ? (
                        <button
                          onClick={() => handleAdd(item)}
                          className="w-full py-2 rounded-xl text-white font-bold text-sm transition-all active:scale-95"
                          style={{ background: th.basketBtn, minHeight: 44 }}
                        >
                          {language === 'gu' ? 'ઉમેરો' : language === 'hi' ? 'जोड़ें' : 'Add'}
                        </button>
                      ) : (
                        <div className="flex items-center justify-between rounded-xl overflow-hidden" style={{ background: 'rgba(0,0,0,0.08)', minHeight: 44 }}>
                          <button
                            onClick={() => handleDec(item)}
                            className="flex-1 font-black text-lg flex items-center justify-center h-11 transition-all active:scale-95 hover:bg-black/10"
                          >
                            −
                          </button>
                          <span className="font-black text-base w-8 text-center">{qty}</span>
                          <button
                            onClick={() => handleInc(item)}
                            className="flex-1 font-black text-lg flex items-center justify-center h-11 transition-all active:scale-95 hover:bg-black/10"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </AnimatePresence>
      </div>

      {/* Running total bar */}
      <AnimatePresence>
        {basketCount > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="flex-shrink-0 flex items-center justify-between px-5 py-3"
            style={{
              background: th.basketBarBg,
              borderTop: `2px solid rgba(255,153,51,0.30)`,
              boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
            }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎁</span>
              <div>
                <p className="text-xs font-medium opacity-70" style={{ color: th.basketBarText }}>
                  {basketCount} item{basketCount !== 1 ? 's' : ''}
                </p>
                <p className="font-black text-lg" style={{ color: th.basketBarSubText }}>
                  £{basketTotal.toFixed(2)}
                </p>
              </div>
            </div>
            <button
              onClick={() => setScreen('basket')}
              className="text-white font-black px-6 py-2.5 rounded-xl text-sm transition-all shadow-lg active:scale-95"
              style={{ background: th.basketBtn }}
            >
              View Basket →
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
