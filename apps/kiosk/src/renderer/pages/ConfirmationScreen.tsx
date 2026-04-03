import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore } from '../store/kiosk.store'

const AUTO_RESET_SECONDS = 45
const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

export function ConfirmationScreen() {
  const { language, orderRef, items, resetKiosk } = useKioskStore()
  const [countdown, setCountdown] = useState(AUTO_RESET_SECONDS)
  const [receiptStep, setReceiptStep] = useState<'options' | 'email' | 'sms' | 'done'>('options')
  const [receiptInput, setReceiptInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sentMsg, setSentMsg] = useState('')

  const total = items.reduce((s, i) => s + i.totalPrice, 0)

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { resetKiosk(); return 0 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [resetKiosk])

  async function sendReceipt(type: 'email' | 'sms') {
    if (!receiptInput.trim()) return
    setSending(true)
    try {
      await fetch(`${API_BASE}/kiosk/receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_ref: orderRef,
          type: type === 'sms' ? 'whatsapp' : 'email',
          destination: receiptInput,
          total,
          items: items.map(i => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice })),
        }),
      })
    } catch {}
    setSending(false)
    setSentMsg(type === 'email' ? `Receipt sent to ${receiptInput}` : `WhatsApp receipt sent to ${receiptInput}`)
    setReceiptStep('done')
  }

  return (
    <div
      className="w-full h-full flex flex-col bg-white"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {/* ── Main content — big centered text like McDonald's ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">

        {/* Big animated 🕉 */}
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', damping: 14, stiffness: 180 }}
          className="mb-6"
          style={{ fontSize: 96, lineHeight: 1 }}
        >
          🕉
        </motion.div>

        {/* Big thank-you text */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="font-black text-gray-900 leading-tight mb-3"
          style={{ fontSize: '2.2rem' }}
        >
          Thank you for your
          <br />
          generous donation.
          <br />
          <span style={{ color: '#FF9933' }}>Jay Shri Krishna 🙏</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-gray-400 text-lg mb-2"
        >
          Order ref: <span className="font-black text-gray-600">{orderRef}</span>
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-gray-900 font-black text-2xl mb-8"
        >
          Total Paid: £{total.toFixed(2)}
        </motion.p>

        {/* Receipt options */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="w-full max-w-sm"
        >
          <AnimatePresence mode="wait">
            {receiptStep === 'options' && (
              <motion.div key="options" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p className="text-sm font-semibold text-gray-500 mb-3">Would you like a receipt?</p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={() => setReceiptStep('email')}
                    className="flex-1 py-3.5 rounded-xl border-2 border-gray-200 text-gray-700 font-bold text-sm active:scale-95 transition-all hover:border-gray-300"
                  >
                    📧 Email
                  </button>
                  <button
                    onClick={() => setReceiptStep('sms')}
                    className="flex-1 py-3.5 rounded-xl border-2 border-gray-200 text-gray-700 font-bold text-sm active:scale-95 transition-all hover:border-gray-300"
                  >
                    💬 WhatsApp
                  </button>
                  <button
                    onClick={() => setReceiptStep('done')}
                    className="flex-1 py-3.5 rounded-xl border-2 border-gray-100 text-gray-400 font-semibold text-sm active:scale-95 transition-all"
                  >
                    No thanks
                  </button>
                </div>
              </motion.div>
            )}

            {(receiptStep === 'email' || receiptStep === 'sms') && (
              <motion.div key="input" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
                <p className="text-sm font-semibold text-gray-600">
                  {receiptStep === 'email' ? 'Enter your email address' : 'Enter your mobile number'}
                </p>
                <input
                  type={receiptStep === 'email' ? 'email' : 'tel'}
                  value={receiptInput}
                  onChange={e => setReceiptInput(e.target.value)}
                  placeholder={receiptStep === 'email' ? 'your@email.com' : '07xxx xxxxxx'}
                  className="w-full border-2 rounded-xl px-4 py-3 text-gray-900 text-base focus:outline-none bg-white"
                  style={{ borderColor: receiptInput.length > 4 ? '#FF9933' : '#e5e7eb' }}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setReceiptStep('options'); setReceiptInput('') }}
                    className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-500 font-semibold text-sm"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={() => sendReceipt(receiptStep)}
                    disabled={sending || receiptInput.length < 5}
                    className="flex-2 py-3 px-6 rounded-xl text-white font-black text-sm shadow active:scale-95 disabled:opacity-50 transition-all"
                    style={{ background: '#FF9933', flex: 2 }}
                  >
                    {sending ? 'Sending…' : 'Send Receipt →'}
                  </button>
                </div>
              </motion.div>
            )}

            {receiptStep === 'done' && sentMsg && (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                <div className="bg-green-50 border border-green-200 text-green-700 text-sm font-semibold px-4 py-3 rounded-xl">
                  ✓ {sentMsg}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* ── Bottom bar ── */}
      <div
        className="flex-shrink-0 px-5 pb-6 pt-4"
        style={{ borderTop: '1px solid #e5e7eb' }}
      >
        {/* Progress bar */}
        <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden mb-4">
          <motion.div
            className="h-full rounded-full"
            style={{ background: '#FF9933', width: `${(countdown / AUTO_RESET_SECONDS) * 100}%` }}
            transition={{ duration: 1 }}
          />
        </div>

        <div className="flex gap-3 items-center">
          <p className="flex-1 text-xs text-gray-400">
            Starting over in <span className="font-bold text-gray-600">{countdown}s</span>
          </p>
          <button
            onClick={resetKiosk}
            className="px-6 py-3 rounded-xl text-white font-black text-sm shadow-md active:scale-95 transition-all"
            style={{ background: '#FF9933' }}
          >
            New Order
          </button>
        </div>
      </div>
    </div>
  )
}
