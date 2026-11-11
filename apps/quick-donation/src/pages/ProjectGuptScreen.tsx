import { useState } from 'react'
import { motion } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'
import { GUPT_DAAN_TILE } from './ProjectStartScreen'

// Gupt Daan — anonymous amount keypad. The donor enters the amount and
// goes straight to the card tap. No contact form, no Gift Aid prompt;
// the donation row saves with contact_id = NULL and is_anonymous = true
// per the existing backend behaviour.
export function ProjectGuptScreen() {
  const { setAmount, setPendingGiftAid, setScreen } = useDonationStore()
  const [value, setValue] = useState('')

  function press(k: string) {
    setValue(v => {
      if (k === '←') return v.slice(0, -1)
      if (k === '.' && v.includes('.')) return v
      if (v.length >= 10) return v
      return (v + k).replace(/^0+(?=\d)/, '')
    })
  }

  const amt = parseFloat(value)
  const canConfirm = isFinite(amt) && amt > 0
  const KEYS = ['1','2','3','4','5','6','7','8','9','.','0','←']
  const accent = GUPT_DAAN_TILE.accent
  const bg     = GUPT_DAAN_TILE.bg

  const PRESETS = [11, 51, 108, 251, 501, 1008]

  function go(amount: number) {
    setPendingGiftAid(null)  // never Gift Aid on anonymous donations
    setAmount(amount)
    setScreen('tap')
  }

  return (
    <div className="min-h-screen px-4 py-5 text-white flex flex-col"
         style={{ background: `linear-gradient(170deg, ${bg} 0%, #140606 100%)` }}>

      <header className="flex items-center mb-5 shrink-0">
        <button onClick={() => setScreen('donate')}
                className="px-3 py-2 rounded-xl text-white/85 hover:bg-white/10 text-sm">
          ← Back
        </button>
        <div className="ml-3 flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest" style={{ color: accent }}>Anonymous — no name, no record</div>
          <div className="font-black text-2xl" style={{ fontFamily: 'serif' }}>ॐ Gupt Daan</div>
        </div>
      </header>

      {/* Big readout */}
      <div className="text-center mb-5">
        <div className="text-xs uppercase tracking-widest" style={{ color: accent }}>Enter amount</div>
        <div className="font-black text-7xl mt-2" style={{ fontFamily: 'serif', color: accent }}>
          £{value || '0'}
        </div>
      </div>

      {/* Preset chips */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        {PRESETS.map(p => (
          <motion.button
            key={p}
            whileTap={{ scale: 0.95 }}
            onClick={() => go(p)}
            className="py-3 rounded-2xl font-black text-xl"
            style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${accent}50`, color: accent }}>
            £{p}
          </motion.button>
        ))}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-3 flex-1 min-h-0 content-start">
        {KEYS.map(k => (
          <motion.button
            key={k}
            whileTap={{ scale: 0.9 }}
            onClick={() => press(k)}
            className="aspect-square rounded-2xl text-4xl font-black bg-white/10 hover:bg-white/15">
            {k}
          </motion.button>
        ))}
      </div>

      <button
        disabled={!canConfirm}
        onClick={() => go(amt)}
        className="w-full mt-4 py-5 rounded-2xl font-black text-xl disabled:opacity-40 shrink-0"
        style={{ background: accent, color: '#180324' }}>
        Tap to pay →
      </button>
    </div>
  )
}
