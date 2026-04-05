import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'

const AUTO_RESET_SECONDS = 30

export function ConfirmationScreen() {
  const { amount, orderRef, branchId, reset } = useDonationStore()
  const [countdown, setCountdown] = useState(AUTO_RESET_SECONDS)

  const branchName =
    branchId === 'main' ? 'Wembley' :
    branchId === 'leicester' ? 'Leicester' :
    branchId === 'reading' ? 'Reading' :
    branchId === 'mk' ? 'Milton Keynes' :
    'Shital Temple'

  useEffect(() => {
    const t = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { reset(); return 0 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [reset])

  return (
    <div className="w-full h-full flex flex-col bg-white" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-6">
        {/* Success icon */}
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', damping: 14, stiffness: 180 }}
          className="text-8xl"
        >
          🙏
        </motion.div>

        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="px-6 py-2 rounded-full text-sm font-black text-white shadow"
          style={{ background: 'linear-gradient(135deg,#22C55E,#16A34A)' }}
        >
          ✓ Donation Received
        </motion.div>

        {/* Thank you message */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <h1 className="font-black text-gray-900 text-3xl leading-tight mb-1">
            Thank You!
          </h1>
          <p className="font-black text-xl" style={{ color: '#FF9933' }}>
            Jay Shri Krishna
          </p>
        </motion.div>

        {/* Amount & reference */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
          className="w-full max-w-xs bg-gray-50 rounded-2xl px-6 py-5 border border-gray-100"
        >
          <p className="text-4xl font-black text-gray-900 mb-2">
            £{amount.toFixed(2)}
          </p>
          <p className="text-xs text-gray-400">
            Ref: <span className="font-black text-gray-600">{orderRef}</span>
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Shital Temple {branchName}
          </p>
        </motion.div>

        {/* Gift Aid reminder */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="w-full max-w-xs bg-green-50 border border-green-200 rounded-2xl px-5 py-3"
        >
          <p className="text-green-700 text-sm font-semibold">
            🇬🇧 Eligible for Gift Aid? Ask our staff to add it — worth 25% extra at no cost to you.
          </p>
        </motion.div>

      </div>

      {/* New Donation CTA */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.75 }}
        className="w-full px-6 pb-2"
      >
        <button
          onClick={reset}
          className="w-full py-4 rounded-2xl text-white font-black text-lg shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)', boxShadow: '0 8px 24px #FF993350' }}
        >
          🙏 New Donation
        </button>
      </motion.div>

      {/* Countdown */}
      <div className="flex-shrink-0 px-5 pb-4 pt-2">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: '#FF9933', width: `${(countdown / AUTO_RESET_SECONDS) * 100}%` }}
              transition={{ duration: 1 }}
            />
          </div>
          <p className="text-xs text-gray-400 flex-shrink-0">
            Auto-reset in <span className="font-bold text-gray-600">{countdown}s</span>
          </p>
        </div>
      </div>
    </div>
  )
}
