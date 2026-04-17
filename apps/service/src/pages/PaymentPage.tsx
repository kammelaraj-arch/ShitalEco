import { useEffect, useState, useCallback, type ComponentType } from 'react'
import { motion } from 'framer-motion'
import {
  PayPalScriptProvider as _PayPalScriptProvider,
  PayPalButtons as _PayPalButtons,
  type PayPalButtonsComponentProps,
  type ReactPayPalScriptOptions,
} from '@paypal/react-paypal-js'
import { useStore, t } from '../store'
import { api } from '../api'

// Cast to ComponentType<any> to avoid React 18/19 JSX type incompatibility
const PayPalScriptProvider = _PayPalScriptProvider as ComponentType<{
  options: ReactPayPalScriptOptions; children: React.ReactNode
}>
const PayPalButtons = _PayPalButtons as ComponentType<PayPalButtonsComponentProps>

export function PaymentPage() {
  const {
    language, items, total, giftAidTotal, branchId, basketId, setBasketId,
    contactInfo, giftAidDeclaration, setScreen, setOrderResult,
  } = useStore()

  const [paypalClientId, setPaypalClientId] = useState('')
  const [configLoading, setConfigLoading] = useState(true)
  const [error, setError] = useState('')
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    // Load PayPal config + create basket in parallel
    Promise.all([
      api.paypalConfig().then((cfg) => setPaypalClientId(cfg.client_id)),
      (async () => {
        const bid = await api.createBasket(branchId)
        if (bid) {
          setBasketId(bid)
          for (const item of items) {
            await api.addBasketItem({
              basket_id: bid,
              item_type: item.type,
              reference_id: item.referenceId,
              name: item.name,
              quantity: item.quantity,
              unit_price: item.unitPrice,
            })
          }
        }
      })(),
    ]).finally(() => setConfigLoading(false))
  }, [])

  const handleCreateOrder = useCallback(async (): Promise<string> => {
    const desc = items.slice(0, 3).map(i => i.name).join(', ') || 'Shital Temple Donation'
    return api.paypalCreateOrder(total, desc, branchId)
  }, [total, branchId, items])

  const handleApprove = useCallback(async (data: { orderID: string }) => {
    setCapturing(true)
    setError('')
    try {
      const result = await api.paypalCapture({
        paypal_order_id: data.orderID,
        amount: total,
        branch_id: branchId,
        contact_name: contactInfo?.name || '',
        contact_email: contactInfo?.email || '',
        contact_phone: contactInfo?.phone || '',
        gift_aid: giftAidDeclaration?.agreed ?? false,
        gift_aid_postcode: giftAidDeclaration?.postcode || '',
        gift_aid_address: giftAidDeclaration?.address || '',
      })
      if (result.success) {
        setOrderResult({
          order_id: result.order_id,
          order_ref: result.order_ref,
          paypal_order_id: data.orderID,
          amount: total,
        })
        // Send receipt if email was provided
        if (contactInfo?.email && result.order_ref) {
          await api.sendReceipt({
            basket_id: basketId || result.order_id,
            email: contactInfo.email,
            name: contactInfo.name,
            total,
            items: items.map((i) => ({
              name: i.name,
              quantity: i.quantity,
              unit_price: i.unitPrice,
            })),
          }).catch(() => {})
        }
        setScreen('confirmation')
      } else {
        setError('Payment could not be confirmed. Please contact the temple.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed. Please try again.')
    } finally {
      setCapturing(false)
    }
  }, [total, branchId, contactInfo, giftAidDeclaration, items, basketId])

  const boost = giftAidTotal * 0.25

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-32">
      <button
        onClick={() => setScreen(giftAidTotal > 0 ? 'gift-aid' : 'contact')}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 mb-5 font-medium"
      >
        ← {t('back', language)}
      </button>

      <h1 className="text-xl font-black text-gray-900 mb-1">Complete Payment</h1>
      <p className="text-sm text-gray-400 mb-5">Pay securely via PayPal. No account required — pay with card too.</p>

      {/* Order Summary */}
      <div className="bg-white rounded-2xl p-4 mb-5 border border-gray-100 shadow-sm space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex justify-between text-sm text-gray-600">
            <span className="truncate mr-2">{item.name} × {item.quantity}</span>
            <span className="font-semibold text-gray-800 flex-shrink-0">£{item.totalPrice.toFixed(2)}</span>
          </div>
        ))}
        {giftAidDeclaration?.agreed && boost > 0 && (
          <div className="flex justify-between text-sm text-green-600 pt-1 border-t border-dashed border-gray-100">
            <span>🇬🇧 Gift Aid boost (HMRC)</span>
            <span className="font-bold">+£{boost.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between pt-2 border-t border-gray-100">
          <span className="font-bold text-gray-900">You pay</span>
          <span className="font-black text-xl text-gray-900">£{total.toFixed(2)}</span>
        </div>
      </div>

      {/* PayPal Button */}
      {configLoading ? (
        <div className="flex flex-col items-center py-12 gap-4">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            className="text-5xl">🕉</motion.div>
          <p className="text-gray-400 text-sm">Preparing payment…</p>
        </div>
      ) : capturing ? (
        <div className="flex flex-col items-center py-12 gap-4">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            className="text-5xl">🕉</motion.div>
          <p className="text-gray-700 font-semibold">Processing your payment…</p>
          <p className="text-gray-400 text-sm">Please wait, do not close this page</p>
        </div>
      ) : !paypalClientId ? (
        <div className="bg-amber-50 rounded-2xl p-5 text-center">
          <div className="text-3xl mb-3">⚠️</div>
          <p className="text-sm font-bold text-amber-800">PayPal not configured</p>
          <p className="text-xs text-amber-600 mt-1">
            An administrator needs to add PAYPAL_CLIENT_ID in Admin → API Keys.
          </p>
          <button
            onClick={() => setScreen('browse')}
            className="mt-4 px-4 py-2 rounded-xl bg-amber-200 text-amber-800 font-bold text-sm"
          >Back to Browse</button>
        </div>
      ) : (
        <div>
          <PayPalScriptProvider options={{
            clientId: paypalClientId,
            currency: 'GBP',
            intent: 'capture',
          }}>
            <div className="paypal-buttons-container">
              <PayPalButtons
                style={{
                  layout: 'vertical',
                  color: 'gold',
                  shape: 'rect',
                  label: 'pay',
                  height: 48,
                }}
                createOrder={handleCreateOrder}
                onApprove={handleApprove}
                onError={(err) => {
                  console.error('PayPal error', err)
                  setError('PayPal encountered an error. Please try again or use a different payment method.')
                }}
                onCancel={() => setError('')}
              />
            </div>
          </PayPalScriptProvider>

          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 bg-red-50 text-red-600 text-sm font-medium px-4 py-3 rounded-xl"
            >
              {error}
            </motion.div>
          )}

          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-400">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Secured by PayPal · 256-bit SSL encryption</span>
          </div>
        </div>
      )}
    </div>
  )
}
