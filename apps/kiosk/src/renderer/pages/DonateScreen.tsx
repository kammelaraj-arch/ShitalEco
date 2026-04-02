import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, t } from '../store/kiosk.store'

const PRESET_AMOUNTS = [5, 10, 25, 50, 100, 250]

const PURPOSES = [
  { id: 'general', en: 'General Fund', gu: 'સામાન્ય ભંડોળ', hi: 'सामान्य कोष', icon: '🕉️' },
  { id: 'temple_maintenance', en: 'Temple Maintenance', gu: 'મંદિર જાળવણી', hi: 'मंदिर रखरखाव', icon: '🏛️' },
  { id: 'youth_education', en: 'Youth & Education', gu: 'યુવા અને શિક્ષણ', hi: 'युवा और शिक्षा', icon: '📚' },
  { id: 'food_bank', en: 'Food Bank Seva', gu: 'ખોરાક સેવા', hi: 'भोजन सेवा', icon: '🍱' },
  { id: 'festival', en: 'Festival Fund', gu: 'ઉત્સવ ભંડોળ', hi: 'उत्सव कोष', icon: '🎉' },
]

export function DonateScreen() {
  const { language, setScreen, addItem } = useKioskStore()
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [selectedPurpose, setSelectedPurpose] = useState(PURPOSES[0])
  const [showKeypad, setShowKeypad] = useState(false)
  const [keypadValue, setKeypadValue] = useState('')

  const effectiveAmount = selectedAmount ?? parseFloat(customAmount) || 0
  const giftAidExtra = effectiveAmount * 0.25

  const handleKeypad = (key: string) => {
    if (key === '⌫') {
      setKeypadValue((v) => v.slice(0, -1))
    } else if (key === '.' && keypadValue.includes('.')) {
      return
    } else {
      setKeypadValue((v) => v + key)
    }
  }

  const handleCustomDone = () => {
    const val = parseFloat(keypadValue)
    if (val > 0) {
      setSelectedAmount(null)
      setCustomAmount(keypadValue)
    }
    setShowKeypad(false)
  }

  const handleAddToBag = () => {
    if (effectiveAmount <= 0) return
    const purposeLabel = selectedPurpose[language] || selectedPurpose.en
    addItem({
      type: 'DONATION',
      name: `Donation — ${purposeLabel}`,
      quantity: 1,
      unitPrice: effectiveAmount,
      totalPrice: effectiveAmount,
      referenceId: `donation-${selectedPurpose.id}`,
    })
    setScreen('basket')
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="px-10 pt-8 pb-4"
      >
        <div className="flex items-center gap-4 mb-2">
          <button onClick={() => setScreen('home')} className="text-saffron-400/60 text-lg">← Back</button>
        </div>
        <h1 className="text-4xl font-black text-gold-gradient">{t('donate', language)}</h1>
        <p className="text-saffron-400/60 text-lg mt-1">Your donation supports our community 🙏</p>
      </motion.div>

      <div className="flex-1 px-10 kiosk-scroll">
        {/* Purpose selector */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
          <h2 className="text-white/70 text-xl font-semibold mb-4">Choose Purpose</h2>
          <div className="flex gap-3 flex-wrap mb-8">
            {PURPOSES.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPurpose(p)}
                className={`
                  flex items-center gap-2 px-5 py-3 rounded-2xl font-semibold text-lg transition-all ripple
                  ${selectedPurpose.id === p.id
                    ? 'bg-saffron-gradient text-white shadow-lg scale-105'
                    : 'glass-card text-saffron-300 border-saffron-400/20'}
                `}
              >
                <span>{p.icon}</span>
                <span>{p[language] || p.en}</span>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Amount presets */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
          <h2 className="text-white/70 text-xl font-semibold mb-4">Select Amount</h2>
          <div className="grid grid-cols-3 gap-4 mb-4">
            {PRESET_AMOUNTS.map((amt) => (
              <button
                key={amt}
                onClick={() => { setSelectedAmount(amt); setCustomAmount('') }}
                className={`
                  amount-btn ripple service-card
                  ${selectedAmount === amt
                    ? 'bg-saffron-gradient text-white shadow-xl shadow-saffron-400/30'
                    : 'glass-card text-white border-saffron-400/20'}
                `}
              >
                £{amt}
              </button>
            ))}
          </div>
          {/* Custom amount */}
          <button
            onClick={() => setShowKeypad(true)}
            className={`
              w-full py-5 rounded-3xl font-bold text-xl transition-all ripple
              ${customAmount
                ? 'bg-saffron-gradient text-white'
                : 'glass-card text-saffron-300 border-saffron-400/20 border'}
            `}
          >
            {customAmount ? `Custom: £${customAmount}` : 'Other Amount...'}
          </button>
        </motion.div>

        {/* Gift Aid notice */}
        {effectiveAmount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 glass-card rounded-3xl p-5 border-green-500/20"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🇬🇧</span>
              <p className="text-green-400 font-bold text-lg">Gift Aid available</p>
            </div>
            <p className="text-white/70 text-base">
              Your donation of <span className="text-white font-bold">£{effectiveAmount.toFixed(2)}</span>
              {' '}is worth <span className="text-green-400 font-bold">£{(effectiveAmount + giftAidExtra).toFixed(2)}</span>{' '}
              with Gift Aid — at no extra cost to you.
            </p>
          </motion.div>
        )}
      </div>

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="px-10 pb-8 pt-4"
      >
        <button
          onClick={handleAddToBag}
          disabled={effectiveAmount <= 0}
          className={`
            w-full py-6 rounded-4xl font-black text-2xl ripple transition-all
            ${effectiveAmount > 0
              ? 'bg-saffron-gradient text-white shadow-2xl shadow-saffron-400/30 pay-btn-pulse'
              : 'bg-white/10 text-white/30 cursor-not-allowed'}
          `}
        >
          {effectiveAmount > 0 ? `Donate £${effectiveAmount.toFixed(2)} 🙏` : 'Select an amount'}
        </button>
      </motion.div>

      {/* Keypad Modal */}
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
              className="bg-temple-dark w-full rounded-t-5xl p-8"
            >
              <div className="text-center mb-6">
                <p className="text-white/50 text-lg mb-2">Enter Amount (£)</p>
                <p className="text-6xl font-black text-gold-gradient">
                  £{keypadValue || '0'}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {['1','2','3','4','5','6','7','8','9','.','0','⌫'].map((k) => (
                  <button key={k} onClick={() => handleKeypad(k)} className="keypad-btn py-6">
                    {k}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { setKeypadValue(''); setShowKeypad(false) }}
                  className="glass-card rounded-3xl py-5 text-white/70 font-bold text-xl ripple">
                  Cancel
                </button>
                <button onClick={handleCustomDone}
                  className="bg-saffron-gradient rounded-3xl py-5 text-white font-black text-xl ripple">
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
