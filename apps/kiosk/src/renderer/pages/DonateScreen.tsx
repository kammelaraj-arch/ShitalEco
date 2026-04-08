/**
 * DonateScreen — Quick Donation tap-and-go tile grid.
 *
 * Design for 7"+ screens. No back button — this IS the donation device entry point.
 * Amounts load from /api/v1/items?category=QUICK_DONATION&branch_id={branchId}.
 * Falls back to hardcoded defaults if API unreachable.
 * Default amount auto-selected on load (first item or £5).
 * "Other" tile is double-width; when selected shows an inline numeric input.
 */
import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'
const FALLBACK_AMOUNTS = [3, 5, 8, 11, 15, 21, 25]

interface AmountTile {
  id: string
  price: number
  name_gu: string
  name_hi: string
  isDefault?: boolean
}

export function DonateScreen() {
  const { language, setScreen, addItem, items, branchId, theme } = useKioskStore()
  const th = THEMES[theme]

  const [tiles, setTiles] = useState<AmountTile[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)   // price in pence-free float
  const [showOther, setShowOther] = useState(false)
  const [otherValue, setOtherValue] = useState('')
  const otherRef = useRef<HTMLInputElement>(null)

  const basketCount = items.reduce((s, i) => s + i.quantity, 0)

  // ── Load tiles from API ─────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(
          `${API_BASE}/items/?category=QUICK_DONATION&branch_id=${branchId || 'main'}&active_only=true`,
          { signal: AbortSignal.timeout(6000) }
        )
        const data = await res.json()
        const apiTiles: AmountTile[] = (data.items || [])
          .map((i: { id: string; price: string | number; name_gu?: string; name_hi?: string }) => ({
            id: i.id,
            price: Number(i.price),
            name_gu: i.name_gu || '',
            name_hi: i.name_hi || '',
          }))
          .filter((t: AmountTile) => t.price > 0)
          .sort((a: AmountTile, b: AmountTile) => a.price - b.price)

        if (apiTiles.length > 0) {
          setTiles(apiTiles)
          // Auto-select the tile closest to £5 as the default (middle-ish)
          const def = apiTiles.find(t => t.price === 5) || apiTiles[Math.floor(apiTiles.length / 2)]
          setSelected(def.price)
        } else {
          loadFallback()
        }
      } catch {
        loadFallback()
      }
      setLoading(false)
    }

    function loadFallback() {
      const fallback = FALLBACK_AMOUNTS.map((p, i) => ({
        id: `fallback_${p}`,
        price: p,
        name_gu: `£${p}`,
        name_hi: `£${p}`,
        isDefault: i === 1, // £5
      }))
      setTiles(fallback)
      setSelected(5)
    }

    load()
  }, [branchId])

  // Focus other input when shown
  useEffect(() => {
    if (showOther) {
      setTimeout(() => otherRef.current?.focus(), 80)
    }
  }, [showOther])

  // ── Effective amount ────────────────────────────────────────────────────────
  const effectiveAmount = showOther
    ? (parseFloat(otherValue) || 0)
    : (selected ?? 0)

  const giftAidBonus = (effectiveAmount * 0.25).toFixed(2)
  const giftAidTotal = (effectiveAmount * 1.25).toFixed(2)

  // ── Add to basket + proceed ─────────────────────────────────────────────────
  const handleDonate = () => {
    if (effectiveAmount <= 0) return
    addItem({
      type: 'DONATION',
      name: `Quick Donation £${effectiveAmount.toFixed(2)}`,
      nameGu: `ઝડપ દાન £${effectiveAmount.toFixed(2)}`,
      nameHi: `त्वरित दान £${effectiveAmount.toFixed(2)}`,
      quantity: 1,
      unitPrice: effectiveAmount,
      totalPrice: effectiveAmount,
      referenceId: `quick-donate-${effectiveAmount}`,
      giftAidEligible: true,
    })
    setScreen('gift-aid')
  }

  // ── Label helpers ───────────────────────────────────────────────────────────
  const title =
    language === 'gu' ? 'દાન · ટૅપ & ગો' :
    language === 'hi' ? 'दान · टैप & गो' :
    'Donate · Tap & Go'

  const subTitle =
    language === 'gu' ? 'રકમ પસંદ કરો · ટૅપ કરો' :
    language === 'hi' ? 'राशि चुनें · टैप करें' :
    'Select · Tap · Go'

  // ── Keypad digit input for Other ───────────────────────────────────────────
  const handleKeypad = (key: string) => {
    if (key === '⌫') {
      setOtherValue(v => v.slice(0, -1))
    } else if (key === '.' && otherValue.includes('.')) {
      return
    } else {
      // Max 7 chars including decimal
      if (otherValue.replace('.', '').length >= 6) return
      setOtherValue(v => v + key)
    }
  }

  return (
    <div
      className="w-full h-full flex flex-col"
      style={{ fontFamily: 'Inter, system-ui, sans-serif', background: th.mainBg }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        className="flex-shrink-0 flex items-center justify-between px-4 py-2.5"
        style={{ background: th.headerBg, borderBottom: `1.5px solid rgba(255,153,51,0.18)`, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}
      >
        <div>
          <h1 className="font-black text-base leading-tight" style={{ color: th.headerText }}>
            {title}
          </h1>
          <p className="text-xs font-medium opacity-60" style={{ color: th.headerText }}>{subTitle}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Gift Aid badge */}
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg" style={{ background: '#DCFCE7', border: '1px solid #86EFAC' }}>
            <span className="text-green-600 font-black text-xs">✓</span>
            <span className="text-green-700 font-bold text-xs">Gift Aid</span>
          </div>
          {basketCount > 0 && (
            <button
              onClick={() => setScreen('basket')}
              className="relative text-white font-bold px-2.5 py-1.5 rounded-xl active:scale-95 text-sm"
              style={{ background: th.basketBtn }}
            >
              🛒
              <span className="absolute -top-1.5 -right-1.5 bg-yellow-400 text-gray-900 text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center">
                {basketCount}
              </span>
            </button>
          )}
        </div>
      </header>

      {/* ── Gift Aid notice strip ────────────────────────────────────────────── */}
      {effectiveAmount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-1.5 text-xs"
          style={{ background: '#F0FDF4', borderBottom: '1px solid #BBF7D0' }}
        >
          <span className="text-green-700 font-bold">🇬🇧 HMRC adds £{giftAidBonus} → total worth £{giftAidTotal}</span>
        </motion.div>
      )}

      {/* ── Amount tile grid ─────────────────────────────────────────────────── */}
      <div className="flex-1 p-3 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {loading ? (
          <div className="grid grid-cols-2 gap-3 h-full">
            {[1,2,3,4,5,6,7,8].map(i => (
              <div key={i} className="rounded-2xl animate-pulse" style={{ background: 'rgba(0,0,0,0.07)', minHeight: 80 }} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((tile, idx) => {
              const isSelected = !showOther && selected === tile.price
              const label =
                language === 'gu' ? (tile.name_gu || `£${tile.price}`) :
                language === 'hi' ? (tile.name_hi || `£${tile.price}`) :
                `£${tile.price}`

              return (
                <motion.button
                  key={tile.id}
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: idx * 0.04 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => { setSelected(tile.price); setShowOther(false); setOtherValue('') }}
                  className="relative rounded-2xl flex flex-col items-center justify-center py-5 transition-all"
                  style={{
                    background: isSelected
                      ? `linear-gradient(135deg, ${th.langActive}, ${th.basketBtn})`
                      : 'rgba(0,0,0,0.05)',
                    border: isSelected ? `2px solid ${th.langActive}` : '2px solid rgba(0,0,0,0.08)',
                    boxShadow: isSelected ? `0 6px 20px ${th.langActive}40` : '0 1px 4px rgba(0,0,0,0.06)',
                    minHeight: 88,
                  }}
                >
                  {/* Selected check */}
                  {isSelected && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white/30 flex items-center justify-center"
                    >
                      <span className="text-white text-xs font-black">✓</span>
                    </motion.div>
                  )}

                  <span
                    className="font-black text-2xl leading-none"
                    style={{ color: isSelected ? '#FFFFFF' : th.sectionTitleColor }}
                  >
                    £{tile.price}
                  </span>
                  {tile.price > 0 && (
                    <span
                      className="text-[10px] mt-1 font-medium opacity-70"
                      style={{ color: isSelected ? '#FFFFFF' : th.sectionTitleColor }}
                    >
                      +£{(tile.price * 0.25).toFixed(2)} Gift Aid
                    </span>
                  )}
                </motion.button>
              )
            })}

            {/* Other — full 2-col width */}
            <motion.button
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: tiles.length * 0.04 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => { setShowOther(true); setSelected(null) }}
              className="col-span-2 rounded-2xl flex items-center justify-center gap-3 py-4 transition-all"
              style={{
                background: showOther
                  ? `linear-gradient(135deg, ${th.langActive}22, ${th.basketBtn}22)`
                  : 'rgba(0,0,0,0.05)',
                border: showOther ? `2px solid ${th.langActive}` : '2px solid rgba(0,0,0,0.08)',
                boxShadow: showOther ? `0 4px 16px ${th.langActive}30` : 'none',
                minHeight: 64,
              }}
            >
              <span className="text-xl">✏️</span>
              <span
                className="font-black text-lg"
                style={{ color: showOther ? th.langActive : th.sectionTitleColor }}
              >
                {showOther && otherValue
                  ? `£${otherValue}`
                  : language === 'gu' ? 'અન્ય રકમ'
                  : language === 'hi' ? 'अन्य राशि'
                  : 'Other Amount'}
              </span>
            </motion.button>
          </div>
        )}
      </div>

      {/* ── Other amount keypad ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {showOther && (
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="flex-shrink-0 px-3 pb-2 pt-2"
            style={{ background: th.headerBg, borderTop: `1.5px solid rgba(255,153,51,0.18)` }}
          >
            {/* Display */}
            <div className="text-center mb-2">
              <span className="font-black text-3xl" style={{ color: th.headerText }}>
                £{otherValue || '0'}
              </span>
            </div>
            {/* Keypad */}
            <div className="grid grid-cols-3 gap-1.5 mb-1.5">
              {['1','2','3','4','5','6','7','8','9','.','0','⌫'].map(k => (
                <button
                  key={k}
                  onClick={() => handleKeypad(k)}
                  className="rounded-xl font-bold text-lg py-3 transition-all active:scale-95"
                  style={{
                    background: k === '⌫' ? `${th.langActive}20` : 'rgba(0,0,0,0.06)',
                    color: th.sectionTitleColor,
                  }}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => { setShowOther(false); setOtherValue(''); setSelected(tiles[1]?.price ?? 5) }}
                className="rounded-xl py-3 font-bold text-sm"
                style={{ background: 'rgba(0,0,0,0.06)', color: th.sectionTitleColor }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (parseFloat(otherValue) > 0) handleDonate()
                }}
                disabled={!(parseFloat(otherValue) > 0)}
                className="rounded-xl py-3 font-black text-sm text-white transition-all active:scale-95 disabled:opacity-40"
                style={{ background: `linear-gradient(135deg, ${th.langActive}, ${th.basketBtn})` }}
              >
                Donate £{otherValue || '0'} →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Donate CTA ───────────────────────────────────────────────────────── */}
      {!showOther && (
        <motion.div
          className="flex-shrink-0 px-3 pb-3 pt-2"
          style={{ background: th.headerBg, borderTop: `1.5px solid rgba(255,153,51,0.18)` }}
        >
          <button
            onClick={handleDonate}
            disabled={effectiveAmount <= 0}
            className="w-full py-4 rounded-2xl text-white font-black text-xl transition-all active:scale-[0.98] disabled:opacity-40 shadow-lg"
            style={{
              background: effectiveAmount > 0
                ? `linear-gradient(135deg, ${th.langActive}, ${th.basketBtn})`
                : 'rgba(0,0,0,0.15)',
              boxShadow: effectiveAmount > 0 ? `0 6px 20px ${th.langActive}50` : 'none',
            }}
          >
            {effectiveAmount > 0
              ? `🙏 Donate £${effectiveAmount.toFixed(2)} →`
              : language === 'gu' ? 'રકમ પસંદ કરો'
              : language === 'hi' ? 'राशि चुनें'
              : 'Select an amount'}
          </button>
          <p className="text-center text-[10px] mt-1.5 font-medium opacity-40" style={{ color: th.sectionTitleColor }}>
            UK Registered Charity · Gift Aid eligible · Jay Shri Krishna 🙏
          </p>
        </motion.div>
      )}
    </div>
  )
}
