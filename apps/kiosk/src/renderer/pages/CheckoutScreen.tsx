import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { useKioskStore, t } from '../store/kiosk.store'

type PaymentMethod = 'STRIPE' | 'PAYPAL' | 'CASH'

const PAYMENT_METHODS = [
  { id: 'STRIPE' as PaymentMethod, label: 'Card Payment', icon: '💳', sub: 'Debit or Credit Card', color: 'from-blue-600 to-indigo-500' },
  { id: 'PAYPAL' as PaymentMethod, label: 'PayPal / QR Code', icon: '📱', sub: 'Scan with your phone', color: 'from-blue-500 to-cyan-400' },
  { id: 'CASH' as PaymentMethod, label: 'Cash at Counter', icon: '💷', sub: 'Pay at the front desk', color: 'from-green-600 to-emerald-500' },
]

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

export function CheckoutScreen() {
  const { language, setScreen, items, setOrderResult, branchId, setBasketId } = useKioskStore()
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('STRIPE')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const total = items.reduce((s, i) => s + i.totalPrice, 0)

  const handlePay = async () => {
    setLoading(true)
    setError('')
    try {
      // Create basket on backend
      const basketRes = await fetch(`${API_BASE}/kiosk/basket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: branchId }),
      })
      const { basket_id, session_id } = await basketRes.json()
      setBasketId(basket_id)

      // Add all items
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

      // Checkout
      const checkoutRes = await fetch(`${API_BASE}/kiosk/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basket_id,
          payment_provider: selectedMethod,
          branch_id: branchId,
        }),
      })
      const order = await checkoutRes.json()
      setOrderResult(order.order_id, order.reference, order.payment || {})
      setScreen('payment')
    } catch (e) {
      setError('Could not process payment. Please try again or ask for assistance.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full h-full flex flex-col">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="px-10 pt-8 pb-4"
      >
        <button onClick={() => setScreen('basket')} className="text-saffron-400/60 text-lg mb-2 block">← Back to Basket</button>
        <h1 className="text-4xl font-black text-gold-gradient">{t('checkout', language)}</h1>
      </motion.div>

      {/* Progress steps */}
      <div className="px-10 mb-6">
        <div className="flex items-center gap-2">
          {['Basket', 'Payment Method', 'Pay'].map((step, i) => (
            <React.Fragment key={step}>
              <div className={`step-indicator flex-1 ${i <= 1 ? 'bg-saffron-400' : 'bg-white/10'}`} />
              <span className={`text-sm font-medium ${i <= 1 ? 'text-saffron-400' : 'text-white/30'}`}>{step}</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="flex-1 px-10 kiosk-scroll">
        <h2 className="text-white/70 text-xl font-semibold mb-5">How would you like to pay?</h2>

        <div className="grid grid-cols-1 gap-4 mb-6">
          {PAYMENT_METHODS.map((method, i) => (
            <motion.button
              key={method.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              onClick={() => setSelectedMethod(method.id)}
              className={`
                relative overflow-hidden rounded-4xl p-7 flex items-center gap-6
                transition-all service-card ripple
                ${selectedMethod === method.id
                  ? `bg-gradient-to-r ${method.color} shadow-2xl scale-[1.02]`
                  : 'glass-card border-white/10'}
              `}
            >
              {selectedMethod === method.id && (
                <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent pointer-events-none" />
              )}
              <span className="text-5xl">{method.icon}</span>
              <div className="text-left flex-1">
                <p className="text-white font-black text-2xl">{method.label}</p>
                <p className="text-white/60 text-lg">{method.sub}</p>
              </div>
              {selectedMethod === method.id && (
                <div className="w-8 h-8 rounded-full bg-white/30 flex items-center justify-center">
                  <span className="text-white text-lg font-bold">✓</span>
                </div>
              )}
            </motion.button>
          ))}
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-red-500/20 border border-red-500/30 rounded-3xl p-5 mb-4"
          >
            <p className="text-red-400 font-semibold">{error}</p>
          </motion.div>
        )}
      </div>

      {/* Total & Pay */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="px-10 pb-8"
      >
        <div className="flex justify-between items-center mb-5">
          <span className="text-white/60 text-2xl font-semibold">{t('total', language)}</span>
          <span className="text-white font-black text-4xl">£{total.toFixed(2)}</span>
        </div>
        <button
          onClick={handlePay}
          disabled={loading}
          className="w-full bg-saffron-gradient py-7 rounded-4xl font-black text-3xl text-white shadow-2xl pay-btn-pulse ripple disabled:opacity-50"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-3">
              <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                🕉️
              </motion.span>
              Processing...
            </span>
          ) : (
            `${t('pay_now', language)} · £${total.toFixed(2)}`
          )}
        </button>
      </motion.div>
    </div>
  )
}
