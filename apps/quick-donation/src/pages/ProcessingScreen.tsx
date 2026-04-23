import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

/** Works on HTTP and HTTPS — crypto.randomUUID() requires a secure context */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/**
 * ProcessingScreen — creates basket, order, payment intent, and sends to card reader.
 * Supports Stripe Terminal and SumUp Solo. Fully automated — transitions to TapScreen on success.
 */
export function ProcessingScreen() {
  const {
    amount, branchId, stripeReaderId,
    readerProvider, sumupReaderId, sumupReaderApiId,
    pendingGiftAid,
    setScreen, setOrderResult, setReader,
  } = useDonationStore()

  const [error, setError] = useState('')
  const [stage, setStage] = useState('Creating donation...')
  const isSumUp = readerProvider === 'sumup'
  const isReaderError = isSumUp ? !sumupReaderId?.trim() : !stripeReaderId?.trim()

  async function recordDonation(basketId: string, orderRef: string, amountPence: number, paymentRef: string, readerId: string, provider = 'SUMUP') {
    try {
      await fetch(`${API_BASE}/kiosk/quick-donation/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basket_id: basketId,
          order_ref: orderRef,
          amount_pence: amountPence,
          branch_id: branchId,
          payment_intent_id: paymentRef,
          payment_provider: provider,
          reader_id: readerId,
          ...(pendingGiftAid ? {
            ga_first_name: pendingGiftAid.firstName,
            ga_surname: pendingGiftAid.surname,
            ga_house_number: pendingGiftAid.houseNum,
            ga_postcode: pendingGiftAid.postcode,
            ga_email: pendingGiftAid.email,
            ga_declared: true,
          } : {}),
        }),
      })
    } catch { /* non-fatal — reconciled via payment provider webhook */ }
  }

  async function processPayment() {
    setError('')
    if (isReaderError) {
      setError('No card reader configured for this device.')
      return
    }
    try {
      const amountPence = Math.round(amount * 100)

      if (isSumUp) {
        // ── SumUp Solo flow ──────────────────────────────────────────────────
        setStage('Creating donation...')
        const basketId = generateUUID()
        const orderRef = `DON-${basketId.slice(0, 8).toUpperCase()}`

        // Save PENDING record before sending to reader so it always appears in admin
        await recordDonation(basketId, orderRef, amountPence, '', sumupReaderId, 'SUMUP')

        setStage('Sending to SumUp reader...')
        const res = await fetch(`${API_BASE}/kiosk/sumup/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount_pence: amountPence,
            order_id: basketId,
            description: `Shital Temple Donation £${amount.toFixed(2)}`,
            reader_serial: sumupReaderId,
            reader_id: sumupReaderApiId,
          }),
        })
        if (!res.ok) {
          const txt = await res.text()
          throw new Error(`SumUp error (${res.status}): ${txt.slice(0, 120)}`)
        }
        const data = await res.json()
        if (data.error) throw new Error(data.error)

        setOrderResult(basketId, orderRef, data.checkout_id, '')
        setScreen('tap')
        return
      }

      // ── Stripe Terminal flow ─────────────────────────────────────────────
      // 1. Create basket
      setStage('Creating donation...')
      let basketId = generateUUID()
      try {
        const basketRes = await fetch(`${API_BASE}/kiosk/basket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch_id: branchId }),
        })
        if (basketRes.ok) {
          const bdata = await basketRes.json()
          if (bdata.basket_id) basketId = bdata.basket_id
        }
      } catch { /* DB unavailable — continue with local UUID */ }

      // 2. Add donation item
      setStage('Recording donation...')
      try {
        await fetch(`${API_BASE}/kiosk/basket/item`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            basket_id: basketId,
            item_type: 'DONATION',
            reference_id: 'quick-donation-general',
            name: 'Quick Donation — General Fund',
            quantity: 1,
            unit_price: amount,
          }),
        })
      } catch { /* non-fatal */ }

      // 3. Create PaymentIntent via Stripe Terminal
      setStage('Preparing card reader...')
      const piRes = await fetch(`${API_BASE}/kiosk/terminal/payment-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_pence: amountPence,
          order_id: basketId,
          description: `Shital Temple Quick Donation £${amount.toFixed(2)}`,
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
      setStage('Sending to card reader...')
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

      // 5. Record and transition
      const orderRef = `DON-${basketId.slice(0, 8).toUpperCase()}`
      await recordDonation(basketId, orderRef, amountPence, pi.payment_intent_id, stripeReaderId)
      setOrderResult(basketId, orderRef, pi.payment_intent_id, pi.client_secret)
      setScreen('tap')

    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Payment failed. Please try again.')
    }
  }

  useEffect(() => {
    processPayment()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-6 px-8 bg-temple-gradient">
      {error ? (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="text-center max-w-sm w-full">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="font-black text-xl text-white mb-2">Something went wrong</h2>
          <p className="text-saffron-400/60 text-sm mb-6">{error}</p>
          <div className="flex gap-3">
            <button
              onClick={() => setScreen('donate')}
              className="flex-1 py-3.5 rounded-2xl glass-card text-white/70 font-bold text-sm"
            >
              ← Back
            </button>
            {isReaderError ? (
              <button
                onClick={() => { setReader('', ''); setScreen('admin') }}
                className="py-3.5 px-6 rounded-2xl bg-saffron-gradient text-white font-black text-sm shadow-lg"
                style={{ flex: 2 }}
              >
                ⚙ Admin Setup
              </button>
            ) : (
              <button
                onClick={processPayment}
                className="py-3.5 px-6 rounded-2xl bg-saffron-gradient text-white font-black text-sm shadow-lg"
                style={{ flex: 2 }}
              >
                Try Again
              </button>
            )}
          </div>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            className="text-7xl mb-6 inline-block"
          >
            🕉
          </motion.div>
          <h2 className="font-black text-3xl text-gold-gradient mb-2">
            £{amount.toFixed(2)}
          </h2>
          <p className="text-saffron-400/60 font-medium text-lg">{stage}</p>
          <div className="mt-6 flex gap-1.5 justify-center">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="w-2.5 h-2.5 rounded-full bg-saffron-400"
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
