import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useKioskStore } from '../store/kiosk.store'
import { QRCodeSVG } from 'qrcode.react'

export function PaymentScreen() {
  const { setScreen, paymentIntent, orderRef, items } = useKioskStore()
  const [timeLeft, setTimeLeft] = useState(300) // 5 min timeout
  const total = items.reduce((s, i) => s + i.totalPrice, 0)

  const provider = (paymentIntent as Record<string, unknown>)?.provider as string
  const approvalUrl = (paymentIntent as Record<string, unknown>)?.approval_url as string
  const clientSecret = (paymentIntent as Record<string, unknown>)?.client_secret as string

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(timer)
          setScreen('home')
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Simulate payment completion for demo
  const handleSimulatePayment = () => {
    setScreen('confirmation')
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-10">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-xl text-center"
      >
        {/* Header */}
        <div className="mb-8">
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="text-7xl mb-4"
          >
            {provider === 'PAYPAL' ? '📱' : provider === 'CASH' ? '💷' : '💳'}
          </motion.div>
          <h1 className="text-4xl font-black text-white mb-2">
            {provider === 'PAYPAL' ? 'Scan to Pay with PayPal' :
             provider === 'CASH' ? 'Pay at the Counter' :
             'Tap or Insert Your Card'}
          </h1>
          <p className="text-saffron-400/60 text-xl">Order {orderRef} · £{total.toFixed(2)}</p>
        </div>

        {/* Payment UI */}
        {provider === 'PAYPAL' && approvalUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass-card rounded-4xl p-8 mb-8"
          >
            <QRCodeSVG
              value={approvalUrl}
              size={220}
              bgColor="transparent"
              fgColor="#FF9933"
              level="M"
              className="mx-auto"
            />
            <p className="text-white/60 text-base mt-4">Scan with PayPal app or camera</p>
          </motion.div>
        )}

        {provider === 'STRIPE' && (
          <div className="glass-card rounded-4xl p-10 mb-8">
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              className="text-8xl mb-4"
            >
              💳
            </motion.div>
            <p className="text-white text-2xl font-bold mb-2">Please tap, insert or swipe your card</p>
            <p className="text-saffron-400/60 text-lg">on the card reader below the screen</p>
          </div>
        )}

        {provider === 'CASH' && (
          <div className="glass-card rounded-4xl p-10 mb-8">
            <p className="text-white text-2xl font-bold mb-3">Please proceed to the front desk</p>
            <p className="text-saffron-400/60 text-xl mb-4">Quote your order reference:</p>
            <p className="text-4xl font-black text-gold-gradient">{orderRef}</p>
          </div>
        )}

        {/* Timeout indicator */}
        <div className="mb-6">
          <div className="flex justify-between text-white/40 text-sm mb-1">
            <span>Session expires in</span>
            <span>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-saffron-400 rounded-full"
              style={{ width: `${(timeLeft / 300) * 100}%` }}
              transition={{ duration: 1 }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-4">
          <button
            onClick={() => setScreen('checkout')}
            className="flex-1 glass-card py-5 rounded-3xl text-white/60 font-bold text-xl ripple"
          >
            ← Back
          </button>
          {/* Demo button — remove in production */}
          <button
            onClick={handleSimulatePayment}
            className="flex-2 bg-saffron-gradient py-5 px-8 rounded-3xl text-white font-black text-xl ripple"
          >
            ✓ Payment Complete
          </button>
        </div>
      </motion.div>
    </div>
  )
}
