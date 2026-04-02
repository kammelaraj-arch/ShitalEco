import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useKioskStore, t } from '../store/kiosk.store'
import { QRCodeSVG } from 'qrcode.react'

const AUTO_RESET_SECONDS = 30

export function ConfirmationScreen() {
  const { language, orderRef, items, resetKiosk } = useKioskStore()
  const [countdown, setCountdown] = useState(AUTO_RESET_SECONDS)
  const total = items.reduce((s, i) => s + i.totalPrice, 0)
  const receiptUrl = `https://shital.org/receipt/${orderRef}`

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { resetKiosk(); return 0 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [resetKiosk])

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-12">
      {/* Success animation */}
      <motion.div
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', damping: 15, stiffness: 200 }}
        className="text-9xl mb-6"
      >
        ✅
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="text-5xl font-black text-gold-gradient text-center mb-3"
      >
        {t('order_confirmed', language)}
      </motion.h1>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-saffron-400/70 text-2xl text-center mb-8"
      >
        {t('thank_you', language)} — {t('jay_shri_krishna', language)}
      </motion.p>

      {/* Order summary card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="glass-card rounded-4xl p-8 w-full max-w-lg mb-8"
      >
        <div className="flex justify-between items-center mb-4">
          <p className="text-white/60 text-lg">Order Reference</p>
          <p className="text-white font-black text-2xl tracking-wider">{orderRef}</p>
        </div>
        <div className="space-y-2 mb-4">
          {items.map((item) => (
            <div key={item.id} className="flex justify-between text-white/80 text-base">
              <span>{item.name} × {item.quantity}</span>
              <span className="font-semibold">£{item.totalPrice.toFixed(2)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10 pt-3 flex justify-between items-center">
          <span className="text-white font-bold text-xl">Total Paid</span>
          <span className="text-white font-black text-3xl">£{total.toFixed(2)}</span>
        </div>
      </motion.div>

      {/* QR Code for digital receipt */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="flex flex-col items-center gap-3 mb-8"
      >
        <QRCodeSVG
          value={receiptUrl}
          size={140}
          bgColor="transparent"
          fgColor="#FF9933"
          level="M"
        />
        <p className="text-saffron-400/50 text-base">Scan for digital receipt</p>
      </motion.div>

      {/* Auto-reset countdown */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="text-center"
      >
        <p className="text-white/40 text-lg mb-3">
          Returning to home in <span className="text-saffron-400 font-bold">{countdown}s</span>
        </p>
        <div className="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden mx-auto mb-4">
          <motion.div
            className="h-full bg-saffron-400 rounded-full"
            style={{ width: `${(countdown / AUTO_RESET_SECONDS) * 100}%` }}
          />
        </div>
        <button
          onClick={resetKiosk}
          className="bg-saffron-gradient text-white font-black text-xl px-12 py-5 rounded-full shadow-xl ripple pay-btn-pulse"
        >
          Start Over 🙏
        </button>
      </motion.div>
    </div>
  )
}
