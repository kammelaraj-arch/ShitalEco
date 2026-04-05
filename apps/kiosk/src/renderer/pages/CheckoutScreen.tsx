import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useKioskStore, THEMES, generateId } from '../store/kiosk.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

/**
 * CheckoutScreen — invisible processing step.
 * Immediately creates the basket + sends amount to Stripe Terminal on mount.
 * No UI selection needed — always uses the configured Stripe WisePOS E reader.
 */
export function CheckoutScreen() {
  const {
    items, setScreen, setOrderResult, setBasketId,
    branchId, stripeReaderId, stripeReaderLabel,
    pendingPayment, setPendingPayment, theme,
  } = useKioskStore()
  const th = THEMES[theme]

  const total = items.reduce((s, i) => s + i.totalPrice, 0)
  const [error, setError] = useState('')
  const [stage, setStage] = useState('Creating order…')

  async function processPayment() {
    setError('')
    try {
      // 1. Create basket (non-fatal — DB may not be available; payment still proceeds)
      setStage('Creating order…')
      let basket_id = generateId()
      try {
        const basketRes = await fetch(`${API_BASE}/kiosk/basket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch_id: branchId }),
        })
        if (basketRes.ok) {
          const data = await basketRes.json()
          if (data.basket_id) basket_id = data.basket_id
        }
      } catch { /* DB unavailable — continue with local UUID */ }
      setBasketId(basket_id)

      // 2. Add items (best-effort — non-fatal)
      setStage('Adding items…')
      for (const item of items) {
        try {
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
        } catch { /* non-fatal */ }
      }

      // 3. Create PaymentIntent
      setStage('Preparing payment…')
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
      if (!piRes.ok) {
        const txt = await piRes.text()
        throw new Error(`Payment setup failed (${piRes.status}): ${txt.slice(0, 120)}`)
      }
      const pi = await piRes.json()
      if (pi.error) throw new Error(pi.error)

      // 4. Send to WisePOS E reader
      setStage('Sending to card reader…')
      const prRes = await fetch(`${API_BASE}/kiosk/terminal/process-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reader_id: stripeReaderId,
          payment_intent_id: pi.payment_intent_id,
        }),
      })
      if (!prRes.ok) {
        const txt = await prRes.text()
        throw new Error(`Reader error (${prRes.status}): ${txt.slice(0, 120)}`)
      }
      const pr = await prRes.json()
      if (pr.error) throw new Error(pr.error)

      const orderRef = `ORD-${basket_id.slice(0, 8).toUpperCase()}`
      setOrderResult(basket_id, orderRef, {
        provider: 'STRIPE_TERMINAL',
        payment_intent_id: pi.payment_intent_id,
        client_secret: pi.client_secret,
        reader_id: stripeReaderId,
        reader_label: stripeReaderLabel,
      })
      setScreen('payment')

    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Payment failed. Please try again.')
    }
  }

  // Fire immediately on mount (pendingPayment clears itself)
  useEffect(() => {
    if (pendingPayment) setPendingPayment(false)
    processPayment()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-6 px-8"
      style={{ background: th.mainBg, fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {error ? (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="text-center max-w-sm w-full">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="font-black text-xl text-gray-900 mb-2">Something went wrong</h2>
          <p className="text-gray-500 text-sm mb-6">{error}</p>
          <div className="flex gap-3">
            <button
              onClick={() => setScreen('basket')}
              className="flex-1 py-3.5 rounded-2xl border-2 border-gray-200 text-gray-600 font-bold text-sm"
            >
              ← Back to Basket
            </button>
            <button
              onClick={processPayment}
              className="flex-2 py-3.5 px-6 rounded-2xl text-white font-black text-sm shadow-lg"
              style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)', flex: 2 }}
            >
              Try Again →
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
          {/* Spinning logo */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            className="text-7xl mb-6 inline-block"
          >
            🕉
          </motion.div>
          <h2 className="font-black text-2xl mb-2" style={{ color: th.sectionTitleColor }}>
            £{total.toFixed(2)}
          </h2>
          <p className="text-gray-500 font-medium">{stage}</p>
          <div className="mt-6 flex gap-1.5 justify-center">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="w-2 h-2 rounded-full"
                style={{ background: th.basketBtn }}
                animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </div>
        </motion.div>
      )}
    </div>
  )
}