import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'
const SESSION_SECONDS = 120

type ReaderStatus = 'waiting' | 'processing' | 'succeeded' | 'failed' | 'cancelled'

export function TapScreen() {
  const {
    amount, orderRef, paymentIntentId, stripeReaderId, stripeReaderLabel,
    readerProvider, sumupReaderId, cloverDeviceId,
    setScreen, reset,
  } = useDonationStore()

  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS)
  const [readerStatus, setReaderStatus] = useState<ReaderStatus>('waiting')
  const [statusMessage, setStatusMessage] = useState('Present your card to the reader')
  const readerStatusRef = useRef<ReaderStatus>('waiting')

  // Keep ref in sync so the timer closure can read latest status without a dep
  useEffect(() => { readerStatusRef.current = readerStatus }, [readerStatus])

  const isSumUp = readerProvider === 'sumup' || (!!sumupReaderId && !stripeReaderId && !cloverDeviceId)
  const isClover = readerProvider === 'clover' || (!!cloverDeviceId && !stripeReaderId && !sumupReaderId)

  // Countdown timer — resets to donate screen on expiry, but not mid-payment
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timer)
          // Only abandon if no payment has succeeded yet
          if (readerStatusRef.current !== 'succeeded') reset()
          return 0
        }
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
          const amountPence = Math.round(amount * 100)

          const onSumUpSuccess = () => {
            clearInterval(poll)
            setReaderStatus('succeeded')
            setStatusMessage('Payment successful!')
            setTimeout(() => setScreen('confirmation'), 1500)
            fetch(`${API_BASE}/kiosk/order/confirm`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ order_ref: orderRef, payment_ref: paymentIntentId }),
            }).catch(() => {})
          }

          // Run checkout status and transaction history in parallel
          const [checkoutRes, txnRes] = await Promise.allSettled([
            fetch(`${API_BASE}/kiosk/sumup/checkout/${paymentIntentId}`).then(r => r.json()),
            fetch(`${API_BASE}/kiosk/sumup/recent-transaction?amount_pence=${amountPence}`).then(r => r.json()),
          ])

          // Transaction history hit — fastest signal for standalone reader payments
          if (txnRes.status === 'fulfilled' && txnRes.value?.paid) {
            onSumUpSuccess(); return
          }

          if (checkoutRes.status !== 'fulfilled') return
          const s = (checkoutRes.value?.status || '').toUpperCase()

          if (s === 'PAID' || s === 'COMPLETED' || s === 'SUCCESSFUL') {
            onSumUpSuccess()
          } else if (s === 'FAILED' || s === 'DECLINED') {
            clearInterval(poll)
            setReaderStatus('failed')
            setStatusMessage('Payment declined — please try again.')
          } else if (s === 'EXPIRED' || s === 'CANCELLED' || s === 'CANCELED') {
            clearInterval(poll)
            setReaderStatus('cancelled')
            setStatusMessage('Payment session expired.')
          } else {
            if (s === 'PROCESSING') {
              setStatusMessage('Processing payment...')
            } else {
              setStatusMessage('Waiting for card...')
            }
          }
        } else if (isClover) {
          // Clover Flex
          const res = await fetch(`${API_BASE}/kiosk/clover/payment/${paymentIntentId}`)
          if (!res.ok) { setStatusMessage(`Poll error (${res.status}) — retrying...`); return }
          const d = await res.json()
          const s = d.status

          if (s === 'COMPLETED') {
            clearInterval(poll)
            setReaderStatus('succeeded')
            setStatusMessage('Payment successful!')
            setTimeout(() => setScreen('confirmation'), 1500)
            fetch(`${API_BASE}/kiosk/order/confirm`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ order_ref: orderRef, payment_ref: paymentIntentId }),
            }).catch(() => {})
          } else if (s === 'FAILED') {
            clearInterval(poll)
            setReaderStatus('failed')
            setStatusMessage('Payment declined — please try again.')
          } else if (s === 'CANCELLED') {
            clearInterval(poll)
            setReaderStatus('cancelled')
            setStatusMessage('Payment session expired.')
          } else {
            setStatusMessage('Waiting for card...')
          }
        } else {
          // Stripe Terminal
          const res = await fetch(`${API_BASE}/kiosk/terminal/payment-intent-status?id=${paymentIntentId}`)
          const d = await res.json()
          if (d.status === 'succeeded') {
            clearInterval(poll)
            setReaderStatus('succeeded')
            setStatusMessage('Payment successful!')
            setTimeout(() => setScreen('confirmation'), 1500)
            fetch(`${API_BASE}/kiosk/order/confirm`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ order_ref: orderRef, payment_ref: paymentIntentId }),
            }).catch(() => {})
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
      } catch { /* network error — retry on next tick */ }
    }, 1000)

    return () => clearInterval(poll)
  }, [paymentIntentId, isSumUp, isClover, setScreen, orderRef])

  const handleCancel = async () => {
    if (!isSumUp && stripeReaderId && paymentIntentId) {
      await fetch(`${API_BASE}/kiosk/terminal/cancel-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reader_id: stripeReaderId, payment_intent_id: paymentIntentId }),
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
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <p className="text-saffron-400/50 text-base mb-1">Donating</p>
          <p className="text-5xl font-black text-gold-gradient">£{amount.toFixed(2)}</p>
          {orderRef && <p className="text-saffron-400/30 text-xs mt-2">Ref: {orderRef}</p>}
        </motion.div>

        {/* Card reader visual */}
        <div className="relative inline-flex flex-col items-center mb-8">
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

          <div className="relative w-44 bg-gray-800 rounded-3xl shadow-2xl overflow-hidden border-4 border-gray-700 mt-8">
            <div
              className="h-32 flex flex-col items-center justify-center gap-2 m-2 rounded-2xl transition-all duration-500"
              style={{
                background:
                  readerStatus === 'succeeded' ? 'linear-gradient(135deg,#22C55E,#16A34A)'
                  : readerStatus === 'failed' || readerStatus === 'cancelled' ? 'linear-gradient(135deg,#EF4444,#DC2626)'
                  : 'linear-gradient(135deg,#1E293B,#0F172A)',
              }}
            >
              <AnimatePresence mode="wait">
                {readerStatus === 'succeeded' ? (
                  <motion.div key="ok" initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-6xl success-pop">✓</motion.div>
                ) : readerStatus === 'failed' || readerStatus === 'cancelled' ? (
                  <motion.div key="fail" initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-6xl">✗</motion.div>
                ) : (
                  <motion.div key="waiting" animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }} transition={{ duration: 1.8, repeat: Infinity }} className="text-5xl">💳</motion.div>
                )}
              </AnimatePresence>
              <p className="text-white/80 text-xs font-bold px-3 text-center leading-tight">
                {readerStatus === 'succeeded' ? 'Approved' : readerStatus === 'failed' ? 'Declined' : readerStatus === 'cancelled' ? 'Cancelled' : 'Tap, Insert or Swipe'}
              </p>
            </div>
            <div className="mx-4 mb-2 h-1.5 bg-gray-600 rounded-full" />
            <div className="mx-auto mb-3 w-10 h-10 rounded-full border-2 border-gray-600 flex items-center justify-center">
              <motion.div
                animate={readerStatus === 'processing' || readerStatus === 'waiting' ? { scale: [1, 1.4, 1], opacity: [1, 0.3, 1] } : {}}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="text-gray-500 text-sm"
              >)))
              </motion.div>
            </div>
          </div>

          <motion.div
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full border-2 border-white shadow-lg"
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            style={{ background: statusColor }}
          />
        </div>

        {/* Status text */}
        <h2 className="font-black text-2xl text-white mb-2">
          {readerStatus === 'succeeded' ? '✓ Donation Received!' : readerStatus === 'cancelled' ? 'Payment Cancelled' : 'Tap Your Card'}
        </h2>
        <p className="text-saffron-400/50 text-sm mb-1">{stripeReaderLabel && `Reader: ${stripeReaderLabel}`}</p>
        <p className="text-saffron-400/40 text-sm">{statusMessage}</p>

        {/* Timer bar */}
        <div className="mt-8 mb-5">
          <div className="flex justify-between text-xs text-saffron-400/40 mb-1">
            <span>Session expires</span>
            <span className={timeLeft < 10 ? 'text-red-500 font-bold' : ''}>
              {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
            </span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ width: `${(timeLeft / SESSION_SECONDS) * 100}%`, background: timeLeft < 10 ? '#EF4444' : '#FF9933' }}
              transition={{ duration: 1 }}
            />
          </div>
        </div>

        {readerStatus !== 'succeeded' && (
          <button onClick={handleCancel} className="w-full py-4 rounded-2xl glass-card text-white/60 font-semibold text-sm active:scale-95 transition-all">
            ← Cancel Donation
          </button>
        )}
      </motion.div>
    </div>
  )
}
