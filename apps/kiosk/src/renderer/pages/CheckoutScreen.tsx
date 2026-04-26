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
    branchId, cardProvider,
    stripeReaderId, stripeReaderLabel,
    squareDeviceId, squareDeviceName,
    cloverDeviceId, cloverDeviceName,
    sumupReaderId, sumupReaderLabel,
    kioskDeviceId, kioskDeviceName,
    pendingPayment, setPendingPayment, theme,
    contactInfo, giftAidDeclaration,
  } = useKioskStore()
  const th = THEMES[theme]

  const total = items.reduce((s, i) => s + i.totalPrice, 0)
  const [error, setError] = useState('')
  const [stage, setStage] = useState('Creating order…')

  async function processPayment() {
    setError('')

    // ── Pre-flight: validate device config ───────────────────────────────────
    if (cardProvider === 'stripe_terminal' && (!stripeReaderId || !stripeReaderId.trim())) {
      setError('No Stripe reader configured. Go to Admin Settings → Device Config and assign a reader.')
      return
    }
    if (cardProvider === 'square' && (!squareDeviceId || !squareDeviceId.trim())) {
      setError('No Square device configured. Go to Admin Settings → Device Config and assign a device.')
      return
    }
    if (cardProvider === 'clover' && (!cloverDeviceId || !cloverDeviceId.trim())) {
      setError('No Clover device configured. Go to Admin Settings → Device Config and assign a Clover Flex.')
      return
    }
    if (cardProvider === 'sumup' && (!sumupReaderId || !sumupReaderId.trim())) {
      setError('No SumUp reader configured. Go to Admin Settings → Device Config and assign a SumUp reader.')
      return
    }

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

      const orderRef = `ORD-${basket_id.slice(0, 8).toUpperCase()}`

      // Save PENDING order — awaited before screen transition so the fetch is never cancelled by unmount
      const savePending = async (provider: string, paymentIntentId = '') => {
        await fetch(`${API_BASE}/kiosk/order/pending`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            basket_id:         basket_id,
            order_ref:         orderRef,
            payment_provider:  provider,
            payment_intent_id: paymentIntentId,
            branch_id:         branchId,
            device_id:         kioskDeviceId,
            device_label:      kioskDeviceName,
            source:            'kiosk',
            total_amount:      total,
            contact_name:      contactInfo?.anonymous ? '' : (contactInfo?.name || ''),
            contact_email:     contactInfo?.anonymous ? '' : (contactInfo?.email || ''),
            contact_phone:     contactInfo?.anonymous ? '' : (contactInfo?.phone || ''),
            gift_aid_eligible: !!giftAidDeclaration?.agreed,
            ga_full_name:  giftAidDeclaration?.agreed ? (giftAidDeclaration.fullName || '') : '',
            ga_postcode:   giftAidDeclaration?.agreed ? (giftAidDeclaration.postcode || '') : '',
            ga_address:    giftAidDeclaration?.agreed ? (giftAidDeclaration.address || '') : '',
            ga_email:      giftAidDeclaration?.agreed ? (giftAidDeclaration.contactEmail || '') : '',
          }),
        }).catch(() => { /* non-fatal */ })
      }

      // ── Stripe Terminal ───────────────────────────────────────────────────
      if (cardProvider === 'stripe_terminal') {
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
        if (!piRes.ok) throw new Error(`Payment setup failed (${piRes.status}): ${(await piRes.text()).slice(0, 120)}`)
        const pi = await piRes.json()
        if (pi.error) throw new Error(pi.error)

        setStage('Sending to card reader…')
        const prRes = await fetch(`${API_BASE}/kiosk/terminal/process-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reader_id: stripeReaderId, payment_intent_id: pi.payment_intent_id }),
        })
        if (!prRes.ok) throw new Error(`Reader error (${prRes.status}): ${(await prRes.text()).slice(0, 120)}`)
        const pr = await prRes.json()
        if (pr.error) throw new Error(pr.error)

        await savePending('STRIPE_TERMINAL', pi.payment_intent_id)
        setOrderResult(basket_id, orderRef, {
          provider: 'STRIPE_TERMINAL',
          payment_intent_id: pi.payment_intent_id,
          client_secret: pi.client_secret,
          reader_id: stripeReaderId,
          reader_label: stripeReaderLabel,
        })
        setScreen('payment')
        return
      }

      // ── Square Terminal ───────────────────────────────────────────────────
      if (cardProvider === 'square') {
        setStage('Sending to Square Terminal…')
        const sqRes = await fetch(`${API_BASE}/kiosk/square/terminal-checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount_pence: Math.round(total * 100),
            order_id: basket_id,
            description: 'Shital Temple Payment',
            device_id: squareDeviceId,
          }),
        })
        const sq = await sqRes.json()
        if (sq.error) throw new Error(sq.error)

        await savePending('SQUARE', sq.checkout_id)
        setOrderResult(basket_id, orderRef, {
          provider: 'SQUARE',
          checkout_id: sq.checkout_id,
          device_id: squareDeviceId,
          reader_label: squareDeviceName,
        })
        setScreen('payment')
        return
      }

      // ── Clover Flex ───────────────────────────────────────────────────────
      if (cardProvider === 'clover') {
        setStage('Sending to Clover Flex…')
        const clRes = await fetch(`${API_BASE}/kiosk/clover/payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount_pence: Math.round(total * 100),
            order_id: basket_id,
            description: 'Shital Temple Payment',
            device_id: cloverDeviceId,
            items: items.map(i => ({
              name: i.name,
              unit_price_pence: Math.round(i.unitPrice * 100),
              quantity: i.quantity,
            })),
          }),
        })
        const cl = await clRes.json()
        if (cl.error) throw new Error(cl.error)

        await savePending('CLOVER', cl.clover_order_id)
        setOrderResult(basket_id, orderRef, {
          provider: 'CLOVER',
          clover_order_id: cl.clover_order_id,
          device_id: cloverDeviceId,
          reader_label: cloverDeviceName,
        })
        setScreen('payment')
        return
      }

      // ── SumUp Solo ───────────────────────────────────────────────────────
      if (cardProvider === 'sumup') {
        // Save order BEFORE sending to reader so it always appears in admin
        await savePending('SUMUP', '')

        setStage('Sending to SumUp reader…')
        const suRes = await fetch(`${API_BASE}/kiosk/sumup/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount_pence: Math.round(total * 100),
            description: 'Shital Temple Payment',
            order_id: basket_id,
            reader_serial: sumupReaderId,
          }),
        })
        if (!suRes.ok) throw new Error(`SumUp error (${suRes.status}): ${(await suRes.text()).slice(0, 120)}`)
        const su = await suRes.json()
        if (su.error) throw new Error(su.error)

        setOrderResult(basket_id, orderRef, {
          provider: 'SUMUP',
          sumup_checkout_id: su.checkout_id,
          reader_serial: sumupReaderId,
          reader_label: sumupReaderLabel,
        })
        setScreen('payment')
        return
      }

      // ── Cash / Counter ────────────────────────────────────────────────────
      await savePending('CASH')
      setOrderResult(basket_id, orderRef, { provider: 'CASH' })
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