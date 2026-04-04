import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore } from '../store/kiosk.store'

const AUTO_RESET_SECONDS = 60
const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

export function ConfirmationScreen() {
  const { orderRef, items, resetKiosk, contactInfo, branchId, endScreenTemplate } = useKioskStore()
  const [countdown, setCountdown] = useState(AUTO_RESET_SECONDS)
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [ratedDone, setRatedDone] = useState(false)

  // Receipt state
  const [receiptContact, setReceiptContact] = useState('')
  const [receiptMode, setReceiptMode] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [sentMsg, setSentMsg] = useState('')
  const [autoSent, setAutoSent] = useState(false)

  const total = items.reduce((s, i) => s + i.totalPrice, 0)
  const branchName = branchId === 'main' ? 'Wembley' : branchId === 'leicester' ? 'Leicester'
    : branchId === 'reading' ? 'Reading' : branchId === 'mk' ? 'Milton Keynes' : 'Shital Temple'

  const hasContact = contactInfo && !contactInfo.anonymous && (contactInfo.email || contactInfo.phone)

  // Pre-fill from contact info
  useEffect(() => {
    if (hasContact) setReceiptContact(contactInfo!.email || contactInfo!.phone)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-send if contact provided
  useEffect(() => {
    if (autoSent || !hasContact) return
    setAutoSent(true)
    const destination = contactInfo!.email || contactInfo!.phone
    const type = contactInfo!.email ? 'email' : 'whatsapp'
    fetch(`${API_BASE}/kiosk/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_ref: orderRef, type, destination, total,
        branch_name: `Shital Temple ${branchName}`,
        items: items.map(i => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice })),
      }),
    }).then(() => {
      setSentMsg(`Receipt sent to ${destination}`)
      setReceiptMode('sent')
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown
  useEffect(() => {
    const t = setInterval(() => {
      setCountdown(c => { if (c <= 1) { resetKiosk(); return 0 } return c - 1 })
    }, 1000)
    return () => clearInterval(t)
  }, [resetKiosk])

  async function handleSendReceipt() {
    if (!receiptContact.trim() || receiptMode === 'sending') return
    setReceiptMode('sending')
    const isEmail = receiptContact.includes('@')
    try {
      await fetch(`${API_BASE}/kiosk/receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_ref: orderRef,
          type: isEmail ? 'email' : 'whatsapp',
          destination: receiptContact,
          total, branch_name: `Shital Temple ${branchName}`,
          items: items.map(i => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice })),
        }),
      })
    } catch {}
    setSentMsg(isEmail ? `Receipt sent to ${receiptContact}` : `WhatsApp sent to ${receiptContact}`)
    setReceiptMode('sent')
  }

  function handlePrint() {
    window.print()
  }

  function handleStarClick(star: number) {
    setRating(star)
    setTimeout(() => setRatedDone(true), 600)
  }

  const { icon, thankYouLine, subMessage } = endScreenTemplate

  return (
    <div className="w-full h-full flex flex-col bg-white" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Print styles injected into head ── */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-receipt, .print-receipt * { visibility: visible; }
          .print-receipt { position: fixed; top: 0; left: 0; width: 100%; }
        }
      `}</style>

      <div className="flex-1 flex flex-col items-center justify-start px-6 text-center overflow-y-auto py-5 gap-4">

        {/* Icon */}
        <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', damping: 14, stiffness: 180 }}
          style={{ fontSize: 72, lineHeight: 1 }}>
          {icon}
        </motion.div>

        {/* Badge */}
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="px-5 py-1.5 rounded-full text-sm font-black text-white shadow"
          style={{ background: 'linear-gradient(135deg,#22C55E,#16A34A)' }}>
          ✓ Payment Confirmed
        </motion.div>

        {/* Thank you + tagline */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <h1 className="font-black text-gray-900 leading-tight" style={{ fontSize: '1.75rem' }}>
            Thank you{contactInfo?.name && !contactInfo.anonymous ? `, ${contactInfo.name.split(' ')[0]}` : ''}!
          </h1>
          <p className="font-black mt-0.5" style={{ color: '#FF9933', fontSize: '1.2rem' }}>{thankYouLine}</p>
          {subMessage && <p className="text-gray-500 text-sm mt-1">{subMessage}</p>}
        </motion.div>

        {/* Print-visible receipt block */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
          className="print-receipt w-full max-w-xs bg-gray-50 rounded-2xl px-5 py-3 text-left space-y-1 border border-gray-100">
          <p className="text-xs text-gray-400 text-center">Order ref: <span className="font-black text-gray-700">{orderRef}</span></p>
          <p className="text-2xl font-black text-gray-900 text-center">£{total.toFixed(2)}</p>
          <div className="border-t border-gray-200 pt-2 mt-1 space-y-0.5">
            {items.map(item => (
              <div key={item.id} className="flex justify-between text-xs text-gray-600">
                <span>{item.name} × {item.quantity}</span>
                <span className="font-semibold">£{item.totalPrice.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ── Star rating ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}
          className="w-full max-w-xs">
          <AnimatePresence mode="wait">
            {!ratedDone ? (
              <motion.div key="stars" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="text-center">
                <p className="text-xs font-semibold text-gray-500 mb-2">How was your experience?</p>
                <div className="flex justify-center gap-3">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button key={star}
                      onClick={() => handleStarClick(star)}
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(0)}
                      className="text-3xl transition-transform active:scale-90"
                      style={{ transform: (hoverRating || rating) >= star ? 'scale(1.15)' : 'scale(1)' }}>
                      <span style={{ color: (hoverRating || rating) >= star ? '#FF9933' : '#d1d5db' }}>★</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div key="rated" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                className="text-center py-1">
                <p className="text-sm font-bold text-green-600">
                  {rating >= 4 ? '🙏 Thank you! Your feedback means a lot.' : rating >= 3 ? '🙏 Thank you for your feedback.' : '🙏 Thank you — we will improve!'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ── Receipt section ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65 }}
          className="w-full max-w-xs space-y-2">
          <AnimatePresence mode="wait">
            {receiptMode === 'sent' ? (
              <motion.div key="sent" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="bg-green-50 border border-green-200 text-green-700 text-sm font-semibold px-4 py-3 rounded-2xl text-center">
                ✓ {sentMsg}
              </motion.div>
            ) : (
              <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                <p className="text-xs font-semibold text-gray-500">
                  {hasContact ? 'Send another copy' : 'Get a receipt (optional)'}
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={receiptContact}
                    onChange={e => setReceiptContact(e.target.value)}
                    placeholder="email or phone"
                    className="flex-1 border-2 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none bg-white"
                    style={{ borderColor: receiptContact.length > 4 ? '#FF9933' : '#e5e7eb' }}
                  />
                  <button
                    onClick={handleSendReceipt}
                    disabled={receiptContact.length < 5 || receiptMode === 'sending'}
                    className="px-4 py-2.5 rounded-xl text-white font-black text-sm shadow active:scale-95 disabled:opacity-40 transition-all"
                    style={{ background: '#FF9933' }}>
                    {receiptMode === 'sending' ? '…' : 'Send'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Print button */}
          <button
            onClick={handlePrint}
            className="w-full py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all">
            🖨 Print Receipt
          </button>
        </motion.div>

      </div>

      {/* ── Start New Customer — prominent CTA ── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75 }}
        className="w-full px-6 pb-2">
        <button
          onClick={resetKiosk}
          className="w-full py-4 rounded-2xl text-white font-black text-lg shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)', boxShadow: '0 8px 24px #FF993350' }}
        >
          🙏 Start New Customer
        </button>
      </motion.div>

      {/* ── Footer: countdown ── */}
      <div className="flex-shrink-0 px-5 pb-4 pt-2">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <motion.div className="h-full rounded-full"
              style={{ background: '#FF9933', width: `${(countdown / AUTO_RESET_SECONDS) * 100}%` }}
              transition={{ duration: 1 }} />
          </div>
          <p className="text-xs text-gray-400 flex-shrink-0">
            Auto-reset in <span className="font-bold text-gray-600">{countdown}s</span>
          </p>
        </div>
      </div>
    </div>
  )
}
