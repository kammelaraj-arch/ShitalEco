import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'
import { QRCodeSVG } from 'qrcode.react'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

type ReaderStatus = 'waiting' | 'processing' | 'succeeded' | 'failed' | 'cancelled'

export function PaymentScreen() {
  const { setScreen, paymentIntent, orderRef, items, theme } = useKioskStore()
  const th = THEMES[theme]

  const total = items.reduce((s, i) => s + i.totalPrice, 0)
  const pi = paymentIntent as Record<string, unknown>
  const provider = pi?.provider as string
  const approvalUrl = pi?.approval_url as string
  const readerLabel = pi?.reader_label as string
  const paymentIntentId = pi?.payment_intent_id as string
  const readerId = pi?.reader_id as string
  const checkoutId = pi?.checkout_id as string
  const cloverOrderId = pi?.clover_order_id as string
  const sumupCheckoutId = pi?.sumup_checkout_id as string
  const readerSerial = pi?.reader_serial as string

  const [timeLeft, setTimeLeft] = useState(300)
  const [readerStatus, setReaderStatus] = useState<ReaderStatus>('waiting')
  const [statusMessage, setStatusMessage] = useState('')

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timer); setScreen('home'); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Poll reader status for Stripe Terminal
  useEffect(() => {
    if (provider !== 'STRIPE_TERMINAL' || !readerId || !paymentIntentId) return
    setReaderStatus('processing')
    setStatusMessage('Waiting for card...')
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/kiosk/terminal/payment-intent-status?id=${paymentIntentId}`)
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
          setStatusMessage('Present card to the reader...')
        } else if (d.status === 'processing') {
          setStatusMessage('Processing payment...')
        }
      } catch { }
    }, 2000)
    return () => clearInterval(poll)
  }, [provider, readerId, paymentIntentId])

  // Poll Square Terminal
  useEffect(() => {
    if (provider !== 'SQUARE' || !checkoutId) return
    setReaderStatus('processing')
    setStatusMessage('Waiting for card on Square Terminal...')
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/kiosk/square/terminal-checkout/${checkoutId}`)
        const d = await res.json()
        if (d.status === 'COMPLETED') {
          clearInterval(poll)
          setReaderStatus('succeeded')
          setStatusMessage('Payment successful!')
          setTimeout(() => setScreen('confirmation'), 1500)
        } else if (['CANCELED', 'CANCEL_REQUESTED'].includes(d.status)) {
          clearInterval(poll)
          setReaderStatus('cancelled')
          setStatusMessage('Payment was cancelled.')
        }
      } catch { }
    }, 2500)
    return () => clearInterval(poll)
  }, [provider, checkoutId])

  // Poll SumUp
  useEffect(() => {
    if (provider !== 'SUMUP' || !sumupCheckoutId) return
    setReaderStatus('processing')
    setStatusMessage('Waiting for card on SumUp reader...')
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/kiosk/sumup/checkout/${sumupCheckoutId}`)
        const d = await res.json()
        if (d.status === 'PAID') {
          clearInterval(poll)
          setReaderStatus('succeeded')
          setStatusMessage('Payment successful!')
          setTimeout(() => setScreen('confirmation'), 1500)
        } else if (d.status === 'FAILED') {
          clearInterval(poll)
          setReaderStatus('failed')
          setStatusMessage('Payment declined.')
        } else if (d.status === 'EXPIRED') {
          clearInterval(poll)
          setReaderStatus('cancelled')
          setStatusMessage('Payment session expired.')
        }
      } catch { }
    }, 2500)
    return () => clearInterval(poll)
  }, [provider, sumupCheckoutId])

  // Poll Clover Flex
  useEffect(() => {
    if (provider !== 'CLOVER' || !cloverOrderId) return
    setReaderStatus('processing')
    setStatusMessage('Waiting for card on Clover Flex...')
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/kiosk/clover/payment/${cloverOrderId}`)
        const d = await res.json()
        if (d.status === 'COMPLETED') {
          clearInterval(poll)
          setReaderStatus('succeeded')
          setStatusMessage('Payment successful!')
          setTimeout(() => setScreen('confirmation'), 1500)
        } else if (d.status === 'FAILED') {
          clearInterval(poll)
          setReaderStatus('failed')
          setStatusMessage('Payment declined.')
        } else if (d.status === 'CANCELLED') {
          clearInterval(poll)
          setReaderStatus('cancelled')
          setStatusMessage('Payment was cancelled.')
        }
      } catch { }
    }, 2500)
    return () => clearInterval(poll)
  }, [provider, cloverOrderId])

  const handleCancel = async () => {
    if (provider === 'STRIPE_TERMINAL' && readerId) {
      await fetch(`${API_BASE}/kiosk/terminal/cancel-action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reader_id: readerId, payment_intent_id: paymentIntentId }),
      }).catch(() => {})
    }
    setScreen('basket')
  }

  const statusColors: Record<ReaderStatus, string> = {
    waiting: '#F59E0B', processing: '#3B82F6', succeeded: '#22C55E', failed: '#EF4444', cancelled: '#6B7280',
  }

  const isTerminal = provider === 'STRIPE_TERMINAL' || provider === 'SQUARE' || provider === 'CLOVER' || provider === 'SUMUP'

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8 py-6" style={{ background: th.mainBg }}>
      <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md">

        {isTerminal && (
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-3 mb-6">
              <div className="px-4 py-2 rounded-xl text-white text-sm font-black shadow-md" style={{ background: provider === 'STRIPE_TERMINAL' ? '#6366F1' : provider === 'CLOVER' ? '#FF6B00' : provider === 'SUMUP' ? '#00B4D8' : '#3E4348' }}>
                {provider === 'STRIPE_TERMINAL' ? '🔷 Stripe Terminal' : provider === 'CLOVER' ? '🍀 Clover Flex' : provider === 'SUMUP' ? '💳 SumUp' : '◼ Square Terminal'}
              </div>
            </div>
            <motion.div className="relative inline-flex flex-col items-center mb-6">
              <div className="relative w-40 bg-gray-800 rounded-3xl shadow-2xl overflow-hidden border-4 border-gray-700">
                <div className="h-28 flex flex-col items-center justify-center gap-2 m-2 rounded-2xl" style={{ background: readerStatus === 'succeeded' ? 'linear-gradient(135deg,#22C55E,#16A34A)' : readerStatus === 'failed' || readerStatus === 'cancelled' ? 'linear-gradient(135deg,#EF4444,#DC2626)' : 'linear-gradient(135deg,#1E293B,#0F172A)' }}>
                  <AnimatePresence mode="wait">
                    {readerStatus === 'succeeded' ? (
                      <motion.div key="ok" initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-5xl">✓</motion.div>
                    ) : readerStatus === 'failed' || readerStatus === 'cancelled' ? (
                      <motion.div key="fail" initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-5xl">✗</motion.div>
                    ) : (
                      <motion.div key="waiting" animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }} transition={{ duration: 1.8, repeat: Infinity }} className="text-4xl">
                        {provider === 'STRIPE_TERMINAL' ? '📦' : provider === 'CLOVER' ? '🍀' : provider === 'SUMUP' ? '💳' : '◼'}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <p className="text-white/80 text-xs font-bold px-3 text-center leading-tight">
                    {readerStatus === 'succeeded' ? 'Approved' : readerStatus === 'failed' ? 'Declined' : readerStatus === 'cancelled' ? 'Cancelled' : 'Tap, Insert or Swipe'}
                  </p>
                </div>
                <div className="mx-4 mb-2 h-1.5 bg-gray-600 rounded-full" />
                <div className="mx-auto mb-3 w-10 h-10 rounded-full border-2 border-gray-600 flex items-center justify-center">
                  <motion.div animate={readerStatus === 'processing' ? { scale: [1, 1.4, 1], opacity: [1, 0.3, 1] } : {}} transition={{ duration: 1.5, repeat: Infinity }} className="text-gray-500 text-sm">)))</motion.div>
                </div>
              </div>
              <motion.div className="absolute -top-2 -right-2 w-5 h-5 rounded-full border-2 border-white shadow-lg" animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1.5, repeat: Infinity }} style={{ background: statusColors[readerStatus] }} />
            </motion.div>
            <h2 className="font-black text-2xl mb-2" style={{ color: th.sectionTitleColor }}>
              {readerStatus === 'succeeded' ? '✓ Payment Approved' : readerStatus === 'cancelled' ? 'Payment Cancelled' : 'Tap or Insert Card'}
            </h2>
            <p className="text-sm font-medium mb-1" style={{ color: th.sectionCountColor }}>{readerLabel ? `Reader: ${readerLabel}` : provider}</p>
            <p className="text-gray-400 text-sm">{statusMessage || 'Present your card to the reader'}</p>
            <div className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-2xl shadow-sm" style={{ background: `${th.basketBtn}15` }}>
              <span className="font-black text-2xl" style={{ color: th.sectionTitleColor }}>£{total.toFixed(2)}</span>
              <span className="text-sm text-gray-400">{orderRef}</span>
            </div>
          </div>
        )}

        {provider === 'PAYPAL' && (
          <div className="text-center mb-6">
            <h2 className="font-black text-2xl mb-4" style={{ color: th.sectionTitleColor }}>Scan to Pay</h2>
            <div className="bg-white rounded-3xl p-6 shadow-lg inline-block mb-4">
              {approvalUrl ? <QRCodeSVG value={approvalUrl} size={200} bgColor="white" fgColor="#1C0000" level="M" /> : <div className="w-48 h-48 bg-gray-100 rounded-2xl flex items-center justify-center text-gray-300 text-4xl">📱</div>}
            </div>
            <p className="text-gray-500 text-sm">Scan with PayPal app or phone camera</p>
            <div className="mt-4 inline-block px-5 py-2.5 rounded-2xl shadow-sm" style={{ background: `${th.basketBtn}15` }}>
              <span className="font-black text-2xl" style={{ color: th.sectionTitleColor }}>£{total.toFixed(2)}</span>
            </div>
          </div>
        )}

        {provider === 'CASH' && (
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">💷</div>
            <h2 className="font-black text-2xl mb-2" style={{ color: th.sectionTitleColor }}>Pay at the Counter</h2>
            <p className="text-gray-500 mb-5">Show this reference to staff:</p>
            <div className="bg-white rounded-2xl p-5 shadow-lg border-2 border-dashed border-gray-200 mb-4">
              <p className="font-black text-4xl tracking-widest text-center" style={{ color: th.sectionCountColor }}>{orderRef}</p>
            </div>
            <p className="text-gray-400 text-sm">Amount due: <span className="font-black" style={{ color: th.sectionTitleColor }}>£{total.toFixed(2)}</span></p>
          </div>
        )}

        <div className="mb-5">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Session expires</span>
            <span className={timeLeft < 60 ? 'text-red-500 font-bold' : ''}>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <motion.div className="h-full rounded-full" style={{ width: `${(timeLeft / 300) * 100}%`, background: timeLeft < 60 ? '#EF4444' : th.basketBtn }} transition={{ duration: 1 }} />
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={handleCancel} className="flex-1 py-4 rounded-2xl border-2 border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-colors active:scale-95">
            ← Cancel
          </button>
          {!isTerminal && (
            <button onClick={() => setScreen('confirmation')} className="py-4 px-6 rounded-2xl text-white font-black text-sm transition-all active:scale-95 shadow-lg" style={{ background: `linear-gradient(135deg,${th.basketBtn},${th.basketBtnHover})`, flex: 2 }}>
              ✓ Confirm Payment
            </button>
          )}
        </div>

      </motion.div>
    </div>
  )
}
