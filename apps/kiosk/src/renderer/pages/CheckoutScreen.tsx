import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'
import { DeviceConfigScreen } from './DeviceConfigScreen'

const API_BASE = import.meta.env.VITE_API_URL || 'https://sshitaleco.onrender.com/api/v1'

type PaymentMethod = 'STRIPE_TERMINAL' | 'STRIPE_ONLINE' | 'SQUARE' | 'PAYPAL' | 'CASH'

export function CheckoutScreen() {
  const {
    language, setScreen, items, setOrderResult, branchId, setBasketId,
    theme, cardProvider, stripeReaderId, stripeReaderLabel, squareDeviceId,
    pendingPayment, setPendingPayment,
  } = useKioskStore()
  const th = THEMES[theme]

  const total = items.reduce((s, i) => s + i.totalPrice, 0)

  // Auto-select based on configured device
  const defaultMethod: PaymentMethod =
    cardProvider === 'stripe_terminal' ? 'STRIPE_TERMINAL' :
    cardProvider === 'square' ? 'SQUARE' : 'CASH'

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>(defaultMethod)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showDeviceConfig, setShowDeviceConfig] = useState(false)

  const PAYMENT_METHODS: {
    id: PaymentMethod; label: string; sub: string; icon: string
    badge?: string; badgeColor?: string; color: string; borderColor: string
  }[] = [
    {
      id: 'STRIPE_TERMINAL',
      label: 'Card Reader',
      sub: stripeReaderId
        ? `WisePOS E — ${stripeReaderLabel || stripeReaderId.slice(-8)}`
        : 'Stripe WisePOS E · tap/chip/contactless',
      icon: '📟',
      badge: stripeReaderId ? 'Ready' : 'No reader',
      badgeColor: stripeReaderId ? '#22C55E' : '#F59E0B',
      color: '#EEF2FF',
      borderColor: '#6366F1',
    },
    {
      id: 'SQUARE',
      label: 'Square Terminal',
      sub: squareDeviceId
        ? `Square Device — ${squareDeviceId.slice(0, 12)}`
        : 'Square card present device',
      icon: '◼',
      badge: squareDeviceId ? 'Ready' : 'Not configured',
      badgeColor: squareDeviceId ? '#22C55E' : '#F59E0B',
      color: '#F9FAFB',
      borderColor: '#3E4348',
    },
    {
      id: 'PAYPAL',
      label: 'PayPal / QR',
      sub: 'Scan QR code with phone',
      icon: '📱',
      color: '#EFF6FF',
      borderColor: '#3B82F6',
    },
    {
      id: 'CASH',
      label: 'Cash at Counter',
      sub: 'Pay at the front desk',
      icon: '💷',
      color: '#F0FDF4',
      borderColor: '#22C55E',
    },
  ]

  const hasGiftAidItems = items.some(i => i.giftAidEligible)

  // Show email/phone modal before payment when no gift aid items
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactMode, setContactMode] = useState<'email' | 'phone'>('email')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')

  const handlePayClick = () => {
    if (hasGiftAidItems) {
      setScreen('gift-aid')
    } else {
      setShowContactModal(true)
    }
  }

  // Auto-proceed to payment when returning from gift-aid screen
  useEffect(() => {
    if (pendingPayment) {
      setPendingPayment(false)
      handlePay()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPayment])

  const handlePay = useCallback(async () => {
    setShowContactModal(false)
    setLoading(true)
    setError('')
    try {
      // Create basket
      const basketRes = await fetch(`${API_BASE}/kiosk/basket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: branchId }),
      })
      const { basket_id } = await basketRes.json()
      setBasketId(basket_id)

      // Add items
      for (const item of items) {
        await fetch(`${API_BASE}/kiosk/basket/item`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            basket_id,
            item_type: item.type,
            reference_id: item.referenceId,
            name: item.name,
            quantity: item.quantity,
            unit_price: item.unitPrice,
          }),
        })
      }

      if (selectedMethod === 'STRIPE_TERMINAL') {
        // Stripe Terminal: create PaymentIntent → send to reader → poll for result
        const piRes = await fetch(`${API_BASE}/kiosk/terminal/payment-intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount_pence: Math.round(total * 100),
            order_id: basket_id,
            description: 'Shital Temple Payment',
            reader_id: stripeReaderId,
          }),
        })
        const pi = await piRes.json()
        if (pi.error) throw new Error(pi.error)

        // Send to reader
        if (stripeReaderId) {
          await fetch(`${API_BASE}/kiosk/terminal/process-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reader_id: stripeReaderId, payment_intent_id: pi.payment_intent_id }),
          })
        }

        const orderRef = `ORD-${basket_id.slice(0, 8).toUpperCase()}`
        setOrderResult(basket_id, orderRef, {
          provider: 'STRIPE_TERMINAL',
          payment_intent_id: pi.payment_intent_id,
          client_secret: pi.client_secret,
          reader_id: stripeReaderId,
          reader_label: stripeReaderLabel,
        })
        setScreen('payment')

      } else if (selectedMethod === 'SQUARE') {
        const sqRes = await fetch(`${API_BASE}/kiosk/square/terminal-checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount_pence: Math.round(total * 100),
            order_id: basket_id,
            device_id: squareDeviceId,
            description: 'Shital Temple Payment',
          }),
        })
        const sq = await sqRes.json()
        if (sq.error) throw new Error(sq.error)

        const orderRef = `ORD-${basket_id.slice(0, 8).toUpperCase()}`
        setOrderResult(basket_id, orderRef, {
          provider: 'SQUARE',
          checkout_id: sq.checkout_id,
          device_id: squareDeviceId,
        })
        setScreen('payment')

      } else {
        // PayPal / Cash: use legacy checkout
        const checkoutRes = await fetch(`${API_BASE}/kiosk/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            basket_id,
            payment_provider: selectedMethod === 'PAYPAL' ? 'PAYPAL' : 'CASH',
            branch_id: branchId,
          }),
        })
        const order = await checkoutRes.json()
        setOrderResult(order.order_id, order.reference, order.payment || {})
        setScreen('payment')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not process payment. Please try again.')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMethod, items, total, branchId, stripeReaderId, stripeReaderLabel, squareDeviceId])

  return (
    <div className="w-full h-full flex flex-col" style={{ background: THEMES[theme].mainBg }}>

      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-4 border-b"
        style={{ background: th.headerBg, borderColor: 'rgba(0,0,0,0.06)' }}
      >
        <button
          onClick={() => setScreen('basket')}
          className="text-sm font-semibold px-3 py-2 rounded-xl transition-colors"
          style={{ color: th.sectionCountColor, background: `${th.langActive}15` }}
        >
          ← Back
        </button>
        <h1 className="font-black text-xl flex-1" style={{ color: th.headerText }}>Checkout</h1>
        <div className="text-right">
          <p className="text-xs font-medium opacity-50" style={{ color: th.headerText }}>{items.length} items</p>
          <p className="font-black text-lg" style={{ color: th.sectionCountColor }}>£{total.toFixed(2)}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5" style={{ scrollbarWidth: 'none' }}>

        {/* Section label */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400">How would you like to pay?</p>
          <button
            onClick={() => setShowDeviceConfig(true)}
            className="text-xs font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: th.sectionCountColor, background: `${th.langActive}12` }}
          >
            ⚙ Device Setup
          </button>
        </div>

        {/* Payment method cards */}
        <div className="flex flex-col gap-3 mb-5">
          {PAYMENT_METHODS.map((method, i) => {
            const isActive = selectedMethod === method.id
            return (
              <motion.button
                key={method.id}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                onClick={() => setSelectedMethod(method.id)}
                className="flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all active:scale-[0.98]"
                style={{
                  borderColor: isActive ? method.borderColor : '#E5E7EB',
                  background: isActive ? method.color : 'white',
                  boxShadow: isActive ? `0 4px 16px ${method.borderColor}25` : '0 1px 3px rgba(0,0,0,0.05)',
                }}
              >
                <span className="text-3xl w-10 text-center">{method.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-gray-900 text-base">{method.label}</p>
                    {method.badge && (
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ background: `${method.badgeColor}20`, color: method.badgeColor }}
                      >
                        {method.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-500 text-sm truncate">{method.sub}</p>
                </div>
                {isActive && (
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: method.borderColor }}
                  >
                    <span className="text-white text-xs font-black">✓</span>
                  </div>
                )}
              </motion.button>
            )
          })}
        </div>

        {/* Info box */}
        {selectedMethod === 'STRIPE_TERMINAL' && !stripeReaderId && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 mb-4"
          >
            <p className="font-bold mb-1">⚠ No reader configured</p>
            <p className="text-xs text-amber-700">Tap <strong>Device Setup</strong> above to connect a Stripe WisePOS E reader. Payment will still be created but won't be sent to a reader.</p>
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4 text-sm text-red-700"
          >
            <p className="font-bold mb-0.5">Payment failed</p>
            <p>{error}</p>
          </motion.div>
        )}

        {/* Order summary with Gift Aid indicators */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Order Summary</p>
          {items.map(item => (
            <div key={item.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0 gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {item.giftAidEligible ? (
                  <span className="flex-shrink-0 text-xs font-black text-green-600" title="Gift Aid eligible">✓</span>
                ) : (
                  <span className="flex-shrink-0 text-xs font-medium text-gray-300" title="Not Gift Aid eligible">—</span>
                )}
                <span className="text-gray-700 truncate">{item.name} × {item.quantity}</span>
              </div>
              <span className="font-semibold text-gray-900 flex-shrink-0">£{item.totalPrice.toFixed(2)}</span>
            </div>
          ))}
          <div className="flex justify-between font-black text-base mt-3 pt-3 border-t border-gray-200">
            <span>Total</span>
            <span style={{ color: th.sectionCountColor }}>£{total.toFixed(2)}</span>
          </div>
          {hasGiftAidItems && (
            <div className="mt-2 rounded-xl bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
              <span className="font-bold">✓ Gift Aid eligible items detected.</span> You'll be asked about Gift Aid next.
            </div>
          )}
        </div>
      </div>

      {/* Pay button */}
      <div className="px-5 pb-5 pt-3 border-t border-gray-100">
        <button
          onClick={handlePayClick}
          disabled={loading}
          className="w-full py-5 rounded-2xl text-white font-black text-xl transition-all active:scale-[0.98] shadow-lg disabled:opacity-50"
          style={{
            background: loading ? '#9CA3AF' : `linear-gradient(135deg, ${th.basketBtn}, ${th.basketBtnHover})`,
            boxShadow: `0 8px 24px ${th.basketBtn}50`,
          }}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-3">
              <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>🕉</motion.span>
              Processing...
            </span>
          ) : hasGiftAidItems ? (
            `Next: Gift Aid →`
          ) : (
            `Pay £${total.toFixed(2)} →`
          )}
        </button>
      </div>

      {/* Contact modal (no gift aid items) */}
      <AnimatePresence>
        {showContactModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={() => setShowContactModal(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="w-full bg-white rounded-t-3xl p-6 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
              <h3 className="font-black text-xl text-gray-900 mb-1">Receive Your Receipt</h3>
              <p className="text-gray-500 text-sm mb-4">Please provide your email or phone to receive a receipt.</p>

              <div className="flex gap-2 mb-3">
                {(['email', 'phone'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setContactMode(mode)}
                    className="flex-1 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95"
                    style={{
                      background: contactMode === mode ? th.langActive : '#F3F4F6',
                      color: contactMode === mode ? '#fff' : '#6B7280',
                    }}
                  >
                    {mode === 'email' ? '📧 Email' : '📱 Phone'}
                  </button>
                ))}
              </div>

              {contactMode === 'email' ? (
                <input
                  type="email"
                  value={contactEmail}
                  onChange={e => setContactEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-4 py-4 rounded-2xl border-2 text-base font-medium outline-none mb-4"
                  style={{ borderColor: contactEmail.includes('@') ? '#22C55E' : '#E5E7EB', background: '#F9FAFB' }}
                />
              ) : (
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={e => setContactPhone(e.target.value)}
                  placeholder="07xxx xxxxxx"
                  className="w-full px-4 py-4 rounded-2xl border-2 text-base font-medium outline-none mb-4"
                  style={{ borderColor: contactPhone.length > 7 ? '#22C55E' : '#E5E7EB', background: '#F9FAFB' }}
                />
              )}

              <button
                onClick={handlePay}
                className="w-full py-4 rounded-2xl text-white font-black text-lg transition-all active:scale-[0.98] shadow-lg"
                style={{ background: `linear-gradient(135deg,${th.basketBtn},${th.basketBtnHover})`, boxShadow: `0 6px 20px ${th.basketBtn}40` }}
              >
                Pay £{total.toFixed(2)} →
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Device config overlay */}
      <AnimatePresence>
        {showDeviceConfig && <DeviceConfigScreen onClose={() => setShowDeviceConfig(false)} />}
      </AnimatePresence>
    </div>
  )
}
