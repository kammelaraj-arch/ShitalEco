import React from 'react'
import { motion } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'

/**
 * PaymentMethodScreen — final step before checkout.
 *
 * The customer picks Card or Cash. Sits between BasketScreen (gift-aid /
 * contact capture) and CheckoutScreen (which auto-dispatches to the payment
 * pipeline). Bypassed entirely when the device is configured as a cash-only
 * counter — for those there's no choice to make.
 *
 * Card → keeps the device's configured cardProvider path
 *        (stripe_terminal / square / clover / sumup).
 * Cash → forces the CASH branch in CheckoutScreen, prints an order ref the
 *        customer takes to the front desk.
 *
 * Gift Aid + contact details captured earlier carry through unchanged — same
 * `savePending` body either way.
 */
export function PaymentMethodScreen() {
  const { items, setScreen, setPaymentMethodOverride, theme } = useKioskStore()
  const th = THEMES[theme]
  const total = items.reduce((s, i) => s + i.totalPrice, 0)

  function choose(method: 'card' | 'cash') {
    setPaymentMethodOverride(method)
    setScreen('checkout')
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8 py-10"
         style={{ background: th.bg }}>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  className="text-center mb-8">
        <p className="text-sm font-bold uppercase tracking-widest"
           style={{ color: th.muted }}>Total to pay</p>
        <p className="text-7xl font-black mt-2" style={{ color: th.text }}>
          £{total.toFixed(2)}
        </p>
        <h1 className="text-3xl font-bold mt-8" style={{ color: th.text }}>
          How would you like to pay?
        </h1>
      </motion.div>

      <div className="grid grid-cols-2 gap-6 w-full max-w-3xl">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => choose('card')}
          className="rounded-3xl p-10 flex flex-col items-center gap-4 shadow-xl active:opacity-80"
          style={{ background: th.accent, color: '#fff' }}>
          <span className="text-7xl">💳</span>
          <span className="text-3xl font-black">Card</span>
          <span className="text-sm opacity-80 text-center">
            Tap, insert, or swipe at the reader
          </span>
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => choose('cash')}
          className="rounded-3xl p-10 flex flex-col items-center gap-4 shadow-xl active:opacity-80"
          style={{ background: '#2E7D32', color: '#fff' }}>
          <span className="text-7xl">💷</span>
          <span className="text-3xl font-black">Cash</span>
          <span className="text-sm opacity-80 text-center">
            Pay at the front desk with your order number
          </span>
        </motion.button>
      </div>

      <button onClick={() => setScreen('basket')}
              className="mt-10 text-sm underline"
              style={{ color: th.muted }}>
        ← Back to basket
      </button>
    </div>
  )
}
