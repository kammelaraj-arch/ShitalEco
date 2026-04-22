import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

type ReaderStatus = 'waiting' | 'processing' | 'succeeded' | 'failed' | 'cancelled'

export function TapScreen() {
  const {
    amount, orderRef, paymentIntentId, stripeReaderId, stripeReaderLabel,
    readerProvider,
    setScreen, reset,
  } = useDonationStore()

  const [timeLeft, setTimeLeft] = useState(120)
  const [readerStatus, setReaderStatus] = useState<ReaderStatus>('waiting')
  const [statusMessage, setStatusMessage] = useState('Present your card to the reader')

  const isSumUp = readerProvider === 'sumup'

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timer); reset(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [reset])

  // Poll payment status — branches on provider
  useEffect(() => {
    if (!paymentIntentId) return
    setReaderStatus('processing')
    setStatusMessage('Waiting for card...')

    const poll = setInterval(async () => {
      try {
        if (isSumUp) {
          // SumUp checkout status
          const res = await fetch(`${API_BASE}/kiosk/sumup/checkout/${paymentIntentId}`)
          const d = await res.json()
          const s = (d.status || '').toUpperCase()
          if (s === 'COMPLETED') {
            clearInterval(poll)
            setReaderStatus('succeeded')
            setStatusMessage('Payment successful!')
            setTimeout(() => setScreen('confirmation'), 1500)
          } else if (s === 'FAILED' || s === 'EXPIRED') {
            clearInterval(poll)
            setReaderStatus('failed')
            setStatusMessage('Payment failed — please try again.')
          } else if (s === 'PROCESSING') {
            setStatusMessage('Processing payment...')
          }
        } else {
          // Stripe Terminal payment intent status
          const res = await fetch(
            `${API_BASE}/kiosk/terminal/payment-intent-status?id=${paymentIntentId}`
          )
          const d = await res.json()
          if (d.status === 'succeeded') {
            clearInterval(poll)
            setReaderStatus('succeeded')
            setStatusMessage('Payment successful!')
            setTimeout(() => setScreen('confirmation'), 1500)
          } else if (d.status === 'canceled') {
            clearInterval(poll)
            setReaderStatus('cancelled')
            setStatusMessage('Payment was cancelled.')
          } else if (d.status === 'requires_payment_method') {
            setStatusMessage('Tap, insert or swipe your card...')
          } else if (d.status === 'processing') {
            setStatusMessage('Processing payment...')
          }
        }
      } catch { /* retry on next poll */ }
    }, 2000)

    return () => clearInterval(poll)
  }, [paymentIntentId, isSumUp, setScreen])

  const handleCancel = async () => {
    if (!isSumUp && stripeReaderId && paymentIntentId) {
      await fetch(`${API_BASE}/kiosk/terminal/cancel-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reader_id: stripeReaderId,
          payment_intent_id: paymentIntentId,
        }),
      }).catch(() => {})
    }
    reset()
  }

  const statusColor =
    readerStatus === 'succeeded' ? '#22C55E' :
    readerStatus === 'failed' || readerStatus === 'cancelled' ? '#EF4444' :
    '#FF9933'

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8 bg-temple-gradient">
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md text-center"
      >
        {/* Amount display */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <p className="text-saffron-400/50 text-base mb-1">Donating</p>
          <p className="text-5xl font-black text-gold-gradient">£{amount.toFixed(2)}</p>
          {orderRef && (
            <p className="text-saffron-400/30 text-xs mt-2">Ref: {orderRef}</p>
          )}
        </motion.div>

        {/* Card reader visual */}
        <div className="relative inline-flex flex-col items-center mb-8">
          {/* Contactless waves */}
          <AnimatePresence>
            {readerStatus !== 'succeeded' && readerStatus !== 'cancelled' && (
              <div className="absolute -top-12 left-1/2 -translate-x-1/2 flex flex-col items-center">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    className={`absolute w-16 h-16 rounded-full border-2 border-saffron-400/40 ${
                      i === 0 ? 'contactless-wave' : i === 1 ? 'contactless-wave-delayed' : 'contactless-wave-delayed-2'
                    }`}
                  />
                ))}
                <svg className="w-8 h-8 text-saffron-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M8.5 14.5A7 7 0 0 0 13 17m-5.5-5A5 5 0 0 0 11 14m-3.5-5A3 3 0 0 0 9 11" strokeLinecap="round" />
                </svg>
              </div>
            )}
          </AnimatePresence>

          {/* Reader device */}
          <div className="relative w-44 bg-gray-800 rounded-3xl shadow-2xl overflow-hidden border-4 border-gray-700 mt-8">
            <div
              className="h-32 flex flex-col items-center justify-center gap-2 m-2 rounded-2xl transition-all duration-500"
              style={{
                background:
                  readerStatus === 'succeeded'
                    ? 'linear-gradient(135deg,#22C55E,#16A34A)'
                    : readerStatus === 'failed' || readerStatus === 'cancelled'
                    ? 'linear-gradient(135deg,#EF4444,#DC2626)'
                    : 'linear-gradient(135deg,#1E293B,#0F172A)',
              }}
            >
              <AnimatePresence mode="wait">
                {readerStatus === 'succeeded' ? (
                  <motion.div key="ok" initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-6xl success-pop">
                    ✓
                  </motion.div>
                ) : readerStatus === 'failed' || readerStatus === 'cancelled' ? (
                  <motion.div key="fail" initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-6xl">
                    ✗
                  </motion.div>
                ) : (
                  <motion.div
                    key="waiting"
                    animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
                    transition={{ duration: 1.8, repeat: Infinity }}
                    className="text-5xl"
                  >
                    💳
                  </motion.div>
                )}
              </AnimatePresence>
              <p className="text-white/80 text-xs font-bold px-3 text-center leading-tight">
                {readerStatus === 'succeeded'
                  ? 'Approved'
                  : readerStatus === 'failed'
                  ? 'Declined'
                  : readerStatus === 'cancelled'
                  ? 'Cancelled'
                  : 'Tap, Insert or Swipe'}
              </p>
            </div>
            {/* NFC indicator */}
            <div className="mx-4 mb-2 h-1.5 bg-gray-600 rounded-full" />
            <div className="mx-auto mb-3 w-10 h-10 rounded-full border-2 border-gray-600 flex items-center justify-center">
              <motion.div
                animate={
                  readerStatus === 'processing' || readerStatus === 'waiting'
                    ? { scale: [1, 1.4, 1], opacity: [1, 0.3, 1] }
                    : {}
                }
                transition={{ duration: 1.5, repeat: Infinity }}
                className="text-gray-500 text-sm"
              >
                )))
              </motion.div>
            </div>
          </div>

          {/* Status LED */}
          <motion.div
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full border-2 border-white shadow-lg"
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            style={{ background: statusColor }}
          />
        </div>

        {/* Status text */}
        <h2 className="font-black text-2xl text-white mb-2">
          {readerStatus === 'succeeded'
            ? '✓ Donation Received!'
            : readerStatus === 'cancelled'
            ? 'Payment Cancelled'
            : 'Tap Your Card'}
        </h2>
        <p className="text-saffron-400/50 text-sm mb-1">
          {stripeReaderLabel && `Reader: ${stripeReaderLabel}`}
        </p>
        <p className="text-saffron-400/40 text-sm">{statusMessage}</p>

        {/* Timer bar */}
        <div className="mt-8 mb-5">
          <div className="flex justify-between text-xs text-saffron-400/40 mb-1">
            <span>Session expires</span>
            <span className={timeLeft < 30 ? 'text-red-500 font-bold' : ''}>
              {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
            </span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                width: `${(timeLeft / 120) * 100}%`,
                background: timeLeft < 30 ? '#EF4444' : '#FF9933',
              }}
              transition={{ duration: 1 }}
            />
          </div>
        </div>

        {/* Cancel */}
        {readerStatus !== 'succeeded' && (
          <button
            onClick={handleCancel}
            className="w-full py-4 rounded-2xl glass-card text-white/60 font-semibold text-sm active:scale-95 transition-all"
          >
            ← Cancel Donation
          </button>
        )}
      </motion.div>
    </div>
  )
}
