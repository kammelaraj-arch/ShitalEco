import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'

const PRESET_AMOUNTS = [1, 2.5, 5, 10, 15, 20, 50]

export function DonationScreen() {
  const { setScreen, setAmount, defaultAmount } = useDonationStore()
  const [selectedAmount, setSelectedAmount] = useState<number | null>(defaultAmount)
  const [showKeypad, setShowKeypad] = useState(false)
  const [keypadValue, setKeypadValue] = useState('')

  const customAmount = parseFloat(keypadValue) || 0
  const effectiveAmount = selectedAmount ?? customAmount

  const handlePreset = (amt: number) => {
    setSelectedAmount(amt)
    setKeypadValue('')
  }

  const handleKeypad = (key: string) => {
    if (key === 'backspace') {
      setKeypadValue((v) => v.slice(0, -1))
    } else if (key === '.' && keypadValue.includes('.')) {
      return
    } else if (key === '.' && keypadValue === '') {
      setKeypadValue('0.')
    } else {
      const parts = keypadValue.split('.')
      if (parts[1] && parts[1].length >= 2) return
      const next = keypadValue + key
      if (parseFloat(next) > 9999) return
      setKeypadValue(next)
    }
  }

  const handleCustomDone = () => {
    const val = parseFloat(keypadValue)
    if (val > 0) {
      setSelectedAmount(null)
    }
    setShowKeypad(false)
  }

  const handleDonate = () => {
    if (effectiveAmount <= 0) return
    setAmount(effectiveAmount)
    setScreen('processing')
  }

  return (
    <div className="w-full h-full flex flex-col bg-temple-gradient">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="px-8 pt-8 pb-4 flex-shrink-0"
      >
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-4xl font-black text-gold-gradient">Make a Donation</h1>
          <div className="text-saffron-400/40 text-sm">Shital Temple</div>
        </div>
        <p className="text-saffron-400/60 text-lg">Select an amount or enter your own</p>
      </motion.div>

      {/* Amount grid */}
      <div className="flex-1 px-8 pb-4 kiosk-scroll">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-3 gap-4 mb-4"
        >
          {PRESET_AMOUNTS.map((amt, i) => (
            <motion.button
              key={amt}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i }}
              onClick={() => handlePreset(amt)}
              className={`
                amount-btn ripple
                ${selectedAmount === amt
                  ? 'bg-saffron-gradient text-white shadow-xl shadow-saffron-400/30'
                  : 'glass-card text-white border-saffron-400/20'}
              `}
            >
              <div className="flex flex-col items-center justify-center h-full">
                <span>
                  {amt === 2.5 ? '£2.50' : `£${amt}`}
                </span>
              </div>
            </motion.button>
          ))}

          {/* Custom amount button */}
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            onClick={() => { setShowKeypad(true); setSelectedAmount(null) }}
            className={`
              amount-btn ripple
              ${customAmount > 0 && !selectedAmount
                ? 'bg-saffron-gradient text-white shadow-xl shadow-saffron-400/30'
                : 'glass-card text-saffron-300 border-saffron-400/20 border-dashed border-2'}
            `}
          >
            <div className="flex flex-col items-center justify-center h-full">
              {customAmount > 0 && !selectedAmount ? (
                <>
                  <span className="text-sm text-white/60 font-medium mb-1">Custom</span>
                  <span>£{customAmount.toFixed(2)}</span>
                </>
              ) : (
                <>
                  <span className="text-2xl mb-1">✏️</span>
                  <span className="text-lg">Other</span>
                </>
              )}
            </div>
          </motion.button>
        </motion.div>

        {/* Gift Aid notice */}
        {effectiveAmount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card rounded-3xl p-5 border-green-500/20"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🇬🇧</span>
              <div>
                <p className="text-green-400 font-bold text-base">Gift Aid makes it worth more</p>
                <p className="text-white/60 text-sm">
                  £{effectiveAmount.toFixed(2)} becomes{' '}
                  <span className="text-green-400 font-bold">
                    £{(effectiveAmount * 1.25).toFixed(2)}
                  </span>{' '}
                  at no extra cost
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="px-8 pb-8 pt-4 flex-shrink-0"
      >
        <button
          onClick={handleDonate}
          disabled={effectiveAmount <= 0}
          className={`
            w-full py-7 rounded-4xl font-black text-2xl ripple transition-all
            ${effectiveAmount > 0
              ? 'bg-saffron-gradient text-white shadow-2xl shadow-saffron-400/30 pay-btn-pulse'
              : 'bg-white/10 text-white/30 cursor-not-allowed'}
          `}
        >
          {effectiveAmount > 0 ? (
            <span className="flex items-center justify-center gap-3">
              <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M8.5 14.5A7 7 0 0 0 13 17m-5.5-5A5 5 0 0 0 11 14m-3.5-5A3 3 0 0 0 9 11" strokeLinecap="round" />
              </svg>
              Tap & Donate £{effectiveAmount.toFixed(2)}
            </span>
          ) : (
            'Select an amount'
          )}
        </button>
      </motion.div>

      {/* Hidden admin button — double-tap top-right corner */}
      <div
        className="absolute top-0 right-0 w-20 h-20"
        onDoubleClick={() => setScreen('admin')}
      />

      {/* Custom Amount Keypad Modal */}
      <AnimatePresence>
        {showKeypad && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-end justify-center z-50"
            onClick={(e) => e.target === e.currentTarget && setShowKeypad(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="w-full rounded-t-5xl p-8"
              style={{ background: '#2d1200' }}
            >
              <div className="text-center mb-6">
                <p className="text-white/50 text-lg mb-2">Enter Amount</p>
                <p className="text-6xl font-black text-gold-gradient">
                  £{keypadValue || '0'}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                {['1','2','3','4','5','6','7','8','9','.','0','backspace'].map((k) => (
                  <button
                    key={k}
                    onClick={() => handleKeypad(k)}
                    className="keypad-btn py-5"
                  >
                    {k === 'backspace' ? '⌫' : k}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 mb-4">
                {[25, 75, 100, 200].map((v) => (
                  <button
                    key={v}
                    onClick={() => setKeypadValue(v.toString())}
                    className="flex-1 py-3 rounded-2xl glass-card text-saffron-300 font-bold text-base ripple"
                  >
                    £{v}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => { setKeypadValue(''); setShowKeypad(false) }}
                  className="glass-card rounded-3xl py-5 text-white/70 font-bold text-xl ripple"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCustomDone}
                  className="bg-saffron-gradient rounded-3xl py-5 text-white font-black text-xl ripple"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
