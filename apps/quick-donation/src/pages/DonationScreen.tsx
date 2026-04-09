/**
 * DonationScreen — tap-and-go tile grid for dedicated Quick Donation devices.
 *
 * Loads amounts from /api/v1/items?category=QUICK_DONATION&branch_id=...
 * Falls back to hardcoded amounts if API unreachable.
 * Auto-selects the amount closest to £5 on load.
 * "Other" is double-width and opens an on-screen numeric keypad.
 */
import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'
const FALLBACK_AMOUNTS = [3, 5, 8, 11, 15, 21, 25]

interface AmountTile {
  id: string
  price: number
}

// ── Numeric keypad (inline) ────────────────────────────────────────────────────
const NUM_ROWS = [['7','8','9'],['4','5','6'],['1','2','3'],['.','0','⌫']]

function NumKey({ k, onPress }: { k: string; onPress: (k: string) => void }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.88 }}
      onPointerDown={() => onPress(k)}
      className="rounded-2xl font-black flex items-center justify-center select-none"
      style={{ background: k === '⌫' ? '#FEE2E2' : '#fff', color: k === '⌫' ? '#DC2626' : '#111', border: '2px solid #F3F4F6', height: 70, fontSize: 26, flex: 1 }}
    >
      {k}
    </motion.button>
  )
}

export function DonationScreen() {
  const { setScreen, setAmount, branchId } = useDonationStore()

  const [tiles, setTiles]           = useState<AmountTile[]>([])
  const [loading, setLoading]       = useState(true)
  const [selected, setSelected]     = useState<string | null>(null)
  const [otherOpen, setOtherOpen]   = useState(false)
  const [otherVal, setOtherVal]     = useState('')

  // ── Load amounts from API ──────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const branch = branchId || 'main'
        const res  = await fetch(`${API_BASE}/items/?category=QUICK_DONATION&branch_id=${branch}`)
        const data = await res.json()
        const items: AmountTile[] = (data.items || [])
          .filter((i: { is_active?: boolean }) => i.is_active !== false)
          .map((i: { id: string; price: number }) => ({ id: i.id, price: i.price }))

        const list = items.length ? items : FALLBACK_AMOUNTS.map(p => ({ id: `f${p}`, price: p }))
        setTiles(list)

        // Auto-select amount closest to £5
        const target = list.find(t => t.price === 5) || list[Math.floor(list.length / 2)]
        if (target) setSelected(target.id)
      } catch {
        const list = FALLBACK_AMOUNTS.map(p => ({ id: `f${p}`, price: p }))
        setTiles(list)
        setSelected('f5')
      }
      setLoading(false)
    }
    load()
  }, [branchId])

  const handleKey = (k: string) => {
    if (k === '⌫') { setOtherVal(v => v.slice(0, -1)); return }
    if (k === '.' && otherVal.includes('.')) return
    if (k === '.' && !otherVal) { setOtherVal('0.'); return }
    const next = otherVal + k
    if (parseFloat(next) > 9999) return
    const parts = next.split('.')
    if (parts[1] && parts[1].length > 2) return
    setOtherVal(next)
  }

  const effectiveAmount = otherOpen
    ? parseFloat(otherVal) || 0
    : tiles.find(t => t.id === selected)?.price ?? 0

  const handleDonate = () => {
    if (effectiveAmount <= 0) return
    setAmount(effectiveAmount)
    setScreen('processing')
  }

  return (
    <div className="w-full h-full flex flex-col bg-temple-gradient">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-3 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-black text-gold-gradient">Donate Today</h1>
          <p className="text-saffron-400/60 text-base mt-0.5">Tap an amount to donate</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl glass-card">
          <span className="text-green-400 font-black text-sm">✓</span>
          <span className="text-white/70 font-bold text-xs">Gift Aid</span>
        </div>
      </div>

      {/* ── Amount grid ─────────────────────────────────────────────────────── */}
      <div className="flex-1 px-5 pb-3 overflow-hidden">
        {loading ? (
          <div className="grid grid-cols-3 gap-3 h-full">
            {[1,2,3,4,5,6].map(i => (
              <div key={i} className="rounded-3xl animate-pulse" style={{ background: 'rgba(255,255,255,0.07)' }} />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 h-full" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: '1fr' }}>
            {tiles.map(tile => {
              const isSelected = !otherOpen && selected === tile.id
              return (
                <motion.button
                  key={tile.id}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => { setSelected(tile.id); setOtherOpen(false); setOtherVal('') }}
                  className="rounded-3xl flex flex-col items-center justify-center font-black transition-all"
                  style={{
                    background: isSelected
                      ? 'linear-gradient(135deg,#FF9933,#FF6B00)'
                      : 'rgba(255,255,255,0.08)',
                    border: isSelected ? '2.5px solid rgba(255,153,51,0.8)' : '1.5px solid rgba(255,255,255,0.10)',
                    boxShadow: isSelected ? '0 8px 28px rgba(255,153,51,0.4)' : 'none',
                    color: '#fff',
                  }}
                >
                  <span className="text-white/50 text-xs font-semibold mb-1">£</span>
                  <span style={{ fontSize: tile.price >= 100 ? 32 : 40 }}>{tile.price % 1 === 0 ? tile.price : tile.price.toFixed(2)}</span>
                  {isSelected && <span className="text-white/60 text-xs mt-1">Selected</span>}
                </motion.button>
              )
            })}

            {/* "Other" — double-width */}
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={() => { setOtherOpen(true); setSelected(null) }}
              className="rounded-3xl flex flex-col items-center justify-center font-black col-span-2 transition-all"
              style={{
                background: otherOpen ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)',
                border: otherOpen ? '2.5px solid rgba(255,255,255,0.35)' : '1.5px solid rgba(255,255,255,0.10)',
                color: '#fff',
              }}
            >
              {otherOpen && otherVal ? (
                <>
                  <span className="text-white/50 text-xs mb-1">Custom</span>
                  <span className="text-4xl">£{otherVal}</span>
                </>
              ) : (
                <>
                  <span className="text-3xl mb-1">✏️</span>
                  <span className="text-xl">Other</span>
                </>
              )}
            </motion.button>
          </div>
        )}
      </div>

      {/* ── On-screen numeric keypad (shown when Other is selected) ─────────── */}
      <AnimatePresence>
        {otherOpen && (
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 350 }}
            className="flex-shrink-0 px-5 pb-3"
            style={{ background: '#1a0800', borderTop: '2px solid rgba(255,153,51,0.3)' }}
          >
            <div className="flex items-center justify-between py-3 mb-2">
              <span className="text-white/50 text-sm font-semibold">Enter custom amount</span>
              <div className="text-3xl font-black text-gold-gradient">£{otherVal || '0'}</div>
            </div>
            <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
              {NUM_ROWS.map((row, ri) => (
                <React.Fragment key={ri}>
                  {row.map(k => <NumKey key={k} k={k} onPress={handleKey} />)}
                </React.Fragment>
              ))}
            </div>
            <button
              onClick={() => setOtherOpen(false)}
              className="w-full mt-3 py-3 rounded-2xl text-white/50 font-bold text-sm"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              Cancel
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Donate CTA ──────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-5 pb-6 pt-2">
        {effectiveAmount > 0 && (
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="text-center text-green-400/80 text-sm font-semibold mb-3"
          >
            🇬🇧 Gift Aid value: <span className="font-black text-green-400">£{(effectiveAmount * 1.25).toFixed(2)}</span>
          </motion.p>
        )}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleDonate}
          disabled={effectiveAmount <= 0}
          className="w-full py-6 rounded-4xl font-black text-2xl transition-all ripple"
          style={{
            background: effectiveAmount > 0 ? 'linear-gradient(135deg,#FF9933,#FF6B00)' : 'rgba(255,255,255,0.08)',
            color: effectiveAmount > 0 ? '#fff' : 'rgba(255,255,255,0.25)',
            boxShadow: effectiveAmount > 0 ? '0 8px 32px rgba(255,153,51,0.5)' : 'none',
          }}
        >
          {effectiveAmount > 0 ? `Tap to Donate £${effectiveAmount % 1 === 0 ? effectiveAmount : effectiveAmount.toFixed(2)}` : 'Select an amount'}
        </motion.button>
      </div>
    </div>
  )
}
