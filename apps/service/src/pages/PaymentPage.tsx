import { useEffect, useState, useCallback, useRef, type ComponentType } from 'react'
import { motion } from 'framer-motion'
import {
  PayPalScriptProvider as _PayPalScriptProvider,
  PayPalButtons as _PayPalButtons,
  PayPalCardFieldsProvider as _PayPalCardFieldsProvider,
  PayPalNumberField as _PayPalNumberField,
  PayPalExpiryField as _PayPalExpiryField,
  PayPalCVVField as _PayPalCVVField,
  usePayPalCardFields,
  type PayPalButtonsComponentProps,
  type ReactPayPalScriptOptions,
} from '@paypal/react-paypal-js'
import { useStore, useTotal, useGiftAidTotal, t } from '../store'
import { api } from '../api'

const PayPalScriptProvider   = _PayPalScriptProvider   as ComponentType<{ options: ReactPayPalScriptOptions; children: React.ReactNode }>
const PayPalButtons          = _PayPalButtons          as ComponentType<PayPalButtonsComponentProps>
const PayPalCardFieldsProvider = _PayPalCardFieldsProvider as ComponentType<any>
const PayPalNumberField      = _PayPalNumberField      as ComponentType<any>
const PayPalExpiryField      = _PayPalExpiryField      as ComponentType<any>
const PayPalCVVField         = _PayPalCVVField         as ComponentType<any>

// ── Card submit button — must live inside PayPalCardFieldsProvider ─────────────
function CardSubmitButton({
  total, paying, setError, setCapturing, billingAddress,
}: {
  total: number
  paying: boolean
  setError: (e: string) => void
  setCapturing: (v: boolean) => void
  billingAddress: { addressLine1: string; postalCode: string; countryCode: string }
}) {
  const { cardFieldsForm } = usePayPalCardFields()

  async function handlePay() {
    setError('')
    setCapturing(true)
    try {
      await (cardFieldsForm as any).submit({ billingAddress })
    } catch (e: any) {
      setError(e?.message || 'Card payment failed. Please check your details and try again.')
      setCapturing(false)
    }
  }

  return (
    <button
      onClick={handlePay}
      disabled={paying}
      className="w-full py-4 rounded-2xl font-black text-base text-white disabled:opacity-50 transition-opacity"
      style={{ background: paying ? 'rgba(212,175,55,0.4)' : 'linear-gradient(135deg,#b45309,#92400e)' }}
    >
      {paying ? 'Processing…' : `Pay £${total.toFixed(2)}`}
    </button>
  )
}

export function PaymentPage() {
  const {
    language, items, branchId, basketId, setBasketId,
    contactInfo, giftAidDeclaration, setScreen, setOrderResult,
  } = useStore()
  const total        = useTotal()
  const giftAidTotal = useGiftAidTotal()

  const [paypalClientId, setPaypalClientId] = useState('')
  const [configLoading, setConfigLoading]   = useState(true)
  const [error, setError]                   = useState('')
  const [capturing, setCapturing]           = useState(false)
  const [cardFieldsReady, setCardFieldsReady] = useState(true)

  // Billing fields — pre-filled from Gift Aid / contact info
  const [billingFirst,    setBillingFirst]    = useState(giftAidDeclaration?.firstName  || contactInfo?.firstName  || contactInfo?.name?.split(' ')[0] || '')
  const [billingLast,     setBillingLast]     = useState(giftAidDeclaration?.surname    || contactInfo?.surname    || contactInfo?.name?.split(' ').slice(1).join(' ') || '')
  const [billingPostcode, setBillingPostcode] = useState(giftAidDeclaration?.postcode   || contactInfo?.postcode   || '')
  const [billingEmail,    setBillingEmail]    = useState(giftAidDeclaration?.contactEmail || contactInfo?.email   || '')
  const [billingPhone,    setBillingPhone]    = useState(giftAidDeclaration?.contactPhone || contactInfo?.phone   || '')
  const [billingAddress1, setBillingAddress1] = useState(() => {
    const addr = giftAidDeclaration?.address || contactInfo?.address || ''
    return addr.split(',')[0]?.trim() || ''
  })

  useEffect(() => {
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
    const desc      = items.slice(0, 3).map(i => i.name).join(', ') || 'Shital Temple Donation'
    const firstName = billingFirst || giftAidDeclaration?.firstName || contactInfo?.firstName || contactInfo?.name?.split(' ')[0] || ''
    const surname   = billingLast  || giftAidDeclaration?.surname   || contactInfo?.surname   || contactInfo?.name?.split(' ').slice(1).join(' ') || ''
    return api.paypalCreateOrder(total, desc, branchId, {
      contact_first_name: firstName,
      contact_surname:    surname,
      contact_name:       firstName && surname ? `${firstName} ${surname}` : contactInfo?.name || '',
      contact_email:      billingEmail || giftAidDeclaration?.contactEmail || contactInfo?.email || '',
      contact_phone:      billingPhone || giftAidDeclaration?.contactPhone || contactInfo?.phone || '',
      contact_postcode:   billingPostcode || giftAidDeclaration?.postcode  || contactInfo?.postcode || '',
      contact_address:    giftAidDeclaration?.address || contactInfo?.address || '',
      contact_uprn:       giftAidDeclaration?.uprn    || contactInfo?.uprn    || '',
    })
  }, [total, branchId, items, contactInfo, giftAidDeclaration, billingFirst, billingLast, billingEmail, billingPhone, billingPostcode])

  const handleApprove = useCallback(async (data: { orderID: string }) => {
    setCapturing(true)
    setError('')
    try {
      const firstName = billingFirst || giftAidDeclaration?.firstName || contactInfo?.firstName || ''
      const surname   = billingLast  || giftAidDeclaration?.surname   || contactInfo?.surname   || ''
      const fullName  = firstName && surname ? `${firstName} ${surname}` : contactInfo?.name || ''
      const result = await api.paypalCapture({
        paypal_order_id:    data.orderID,
        amount:             total,
        branch_id:          branchId,
        contact_name:       fullName,
        contact_first_name: firstName,
        contact_surname:    surname,
        contact_email:      billingEmail || giftAidDeclaration?.contactEmail || contactInfo?.email || '',
        contact_phone:      billingPhone || giftAidDeclaration?.contactPhone || contactInfo?.phone || '',
        gift_aid:           giftAidDeclaration?.agreed ?? false,
        gift_aid_postcode:  billingPostcode || giftAidDeclaration?.postcode || contactInfo?.postcode || '',
        gift_aid_address:   giftAidDeclaration?.address || contactInfo?.address || '',
        contact_uprn:       giftAidDeclaration?.uprn    || contactInfo?.uprn    || '',
      })
      if (result.success) {
        setOrderResult({
          order_id:          result.order_id,
          order_ref:         result.order_ref,
          paypal_order_id:   data.orderID,
          paypal_capture_id: result.paypal_capture_id || '',
          amount:            result.amount ?? total,
        })
        if (contactInfo?.email && result.order_ref) {
          await api.sendReceipt({
            basket_id: basketId || result.order_id,
            email:     contactInfo.email,
            name:      contactInfo.name,
            total,
            items: items.map((i) => ({ name: i.name, quantity: i.quantity, unit_price: i.unitPrice })),
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
  }, [total, branchId, contactInfo, giftAidDeclaration, items, basketId, billingFirst, billingLast, billingEmail, billingPhone, billingPostcode])

  const boost = giftAidTotal * 0.25

  const fieldStyle = 'w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-ivory-200 text-sm outline-none focus:border-amber-700/40 placeholder:text-white/20'
  const labelStyle = 'block text-xs font-bold uppercase tracking-wider mb-1 text-white/40'
  const hostedFieldStyle = {
    input: { color: '#f5f0dc', 'font-size': '14px', 'font-family': 'inherit', background: 'transparent' },
    '.invalid': { color: '#f87171' },
  }
  const hostedFieldClass = 'bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 h-10'

  const billingAddressPayload = {
    addressLine1: billingAddress1 || (giftAidDeclaration?.address || contactInfo?.address || '').split(',')[0]?.trim() || '',
    postalCode:   billingPostcode,
    countryCode:  'GB',
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-32">
      <button
        onClick={() => setScreen(giftAidTotal > 0 ? 'gift-aid' : 'contact')}
        className="flex items-center gap-2 text-sm font-medium mb-6 transition-colors"
        style={{ color: 'rgba(255,248,220,0.4)' }}
      >
        ← {t('back', language)}
      </button>

      <h1 className="font-display font-bold text-xl text-gold-400 mb-1">Complete Payment</h1>
      <p className="text-sm mb-5" style={{ color: 'rgba(255,248,220,0.45)' }}>
        Pay securely via PayPal. No account required — pay with card too.
      </p>

      {/* Order Summary */}
      <div className="temple-card p-4 mb-5 space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex justify-between text-sm">
            <span className="truncate mr-2" style={{ color: 'rgba(255,248,220,0.6)' }}>
              {item.name} × {item.quantity}
            </span>
            <span className="font-semibold text-ivory-200 flex-shrink-0 price-display">
              £{item.totalPrice.toFixed(2)}
            </span>
          </div>
        ))}
        {giftAidDeclaration?.agreed && boost > 0 && (
          <div className="flex justify-between text-sm pt-1"
            style={{ borderTop: '1px dashed rgba(212,175,55,0.15)', color: '#4ade80' }}>
            <span>Gift Aid boost (HMRC)</span>
            <span className="font-bold price-display">+£{boost.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between pt-2" style={{ borderTop: '1px solid rgba(212,175,55,0.15)' }}>
          <span className="font-bold text-ivory-200">You pay</span>
          <span className="font-black text-xl text-gold-400 price-display">£{total.toFixed(2)}</span>
        </div>
      </div>

      {/* Gift Aid Declaration Summary */}
      {giftAidDeclaration?.agreed && (
        <div className="rounded-2xl p-4 mb-5"
          style={{ background: 'linear-gradient(135deg,rgba(22,163,74,0.15),rgba(15,107,50,0.08))', border: '1px solid rgba(74,222,128,0.35)' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">✅</span>
            <p className="font-black text-sm" style={{ color: '#4ade80' }}>Gift Aid Declared</p>
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80' }}>+£{boost.toFixed(2)} HMRC</span>
          </div>
          <div className="space-y-1.5 text-xs" style={{ color: 'rgba(255,248,220,0.7)' }}>
            <div className="flex gap-2"><span className="opacity-60 w-16 flex-shrink-0">Name:</span><span className="font-semibold">{giftAidDeclaration.firstName} {giftAidDeclaration.surname}</span></div>
            <div className="flex gap-2"><span className="opacity-60 w-16 flex-shrink-0">Email:</span><span className="font-semibold">{giftAidDeclaration.contactEmail}</span></div>
            {giftAidDeclaration.postcode && <div className="flex gap-2"><span className="opacity-60 w-16 flex-shrink-0">Postcode:</span><span className="font-semibold">{giftAidDeclaration.postcode}</span></div>}
            {giftAidDeclaration.address  && <div className="flex gap-2"><span className="opacity-60 w-16 flex-shrink-0">Address:</span><span className="font-semibold">{giftAidDeclaration.address}</span></div>}
          </div>
          <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'rgba(74,222,128,0.55)' }}>
            I am a UK taxpayer and confirm this Gift Aid declaration is accurate. HMRC will reclaim 25p for every £1 donated.
          </p>
        </div>
      )}

      {/* Payment */}
      {configLoading ? (
        <div className="flex flex-col items-center py-12 gap-4">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }} className="text-5xl">🕉</motion.div>
          <p className="text-xs tracking-widest uppercase font-semibold" style={{ color: 'rgba(212,175,55,0.5)' }}>Preparing payment…</p>
        </div>
      ) : capturing ? (
        <div className="flex flex-col items-center py-12 gap-4">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }} className="text-5xl">🕉</motion.div>
          <p className="font-bold text-ivory-200">Processing your payment…</p>
          <p className="text-xs" style={{ color: 'rgba(255,248,220,0.4)' }}>Please wait, do not close this page</p>
        </div>
      ) : !paypalClientId ? (
        <div className="temple-card p-5 text-center">
          <div className="text-3xl mb-3">⚠️</div>
          <p className="text-sm font-bold text-gold-400">PayPal not configured</p>
          <p className="text-xs mt-1" style={{ color: 'rgba(255,248,220,0.45)' }}>
            An administrator needs to add PAYPAL_CLIENT_ID in Admin → API Keys.
          </p>
          <button onClick={() => setScreen('browse')} className="mt-4 px-4 py-2 rounded-xl font-bold text-sm"
            style={{ background: 'rgba(212,175,55,0.15)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.3)' }}>
            Back to Browse
          </button>
        </div>
      ) : (
        <PayPalScriptProvider options={{
          clientId: paypalClientId,
          currency: 'GBP',
          intent: 'capture',
          components: 'buttons,card-fields',
        }}>
          <div className="space-y-4">
            {/* PayPal wallet button */}
            <PayPalButtons
              style={{ layout: 'horizontal', color: 'gold', shape: 'rect', label: 'paypal', height: 48, tagline: false }}
              fundingSource="paypal"
              createOrder={handleCreateOrder}
              onApprove={handleApprove}
              onError={(err) => {
                console.error('PayPal error', err)
                setError('PayPal encountered an error. Please try again.')
              }}
              onCancel={() => setError('')}
            />

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: 'rgba(255,248,220,0.1)' }} />
              <span className="text-xs font-semibold" style={{ color: 'rgba(255,248,220,0.3)' }}>or pay by card</span>
              <div className="flex-1 h-px" style={{ background: 'rgba(255,248,220,0.1)' }} />
            </div>

            {/* Card form with pre-filled billing details */}
            {cardFieldsReady && (
              <PayPalCardFieldsProvider
                createOrder={handleCreateOrder}
                onApprove={handleApprove}
                onError={(e: any) => {
                  const msg = e?.message || ''
                  if (msg.includes('card_fields') || msg.includes('not eligible')) {
                    setCardFieldsReady(false)
                  } else {
                    setError(msg || 'Card payment failed. Please try again.')
                  }
                  setCapturing(false)
                }}
              >
                <div className="temple-card p-5 space-y-4">
                  {/* Billing name */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className={labelStyle}>First name</label>
                      <input className={fieldStyle} value={billingFirst} onChange={e => setBillingFirst(e.target.value)} placeholder="First name" autoComplete="given-name" />
                    </div>
                    <div className="flex-1">
                      <label className={labelStyle}>Last name</label>
                      <input className={fieldStyle} value={billingLast} onChange={e => setBillingLast(e.target.value)} placeholder="Last name" autoComplete="family-name" />
                    </div>
                  </div>

                  {/* Email + Phone */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className={labelStyle}>Email</label>
                      <input className={fieldStyle} type="email" value={billingEmail} onChange={e => setBillingEmail(e.target.value)} placeholder="Email" autoComplete="email" />
                    </div>
                    <div className="w-36">
                      <label className={labelStyle}>Mobile</label>
                      <input className={fieldStyle} type="tel" value={billingPhone} onChange={e => setBillingPhone(e.target.value)} placeholder="+44" autoComplete="tel" />
                    </div>
                  </div>

                  {/* Address + Postcode */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className={labelStyle}>Address</label>
                      <input className={fieldStyle} value={billingAddress1} onChange={e => setBillingAddress1(e.target.value)} placeholder="Street address" autoComplete="address-line1" />
                    </div>
                    <div className="w-32">
                      <label className={labelStyle}>Postcode</label>
                      <input className={fieldStyle + ' uppercase'} value={billingPostcode} onChange={e => setBillingPostcode(e.target.value.toUpperCase())} placeholder="Postcode" autoComplete="postal-code" />
                    </div>
                  </div>

                  {/* PayPal hosted card fields */}
                  <div>
                    <label className={labelStyle}>Card number</label>
                    <PayPalNumberField className={hostedFieldClass} style={hostedFieldStyle} />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className={labelStyle}>Expiry</label>
                      <PayPalExpiryField className={hostedFieldClass + ' w-full'} style={hostedFieldStyle} />
                    </div>
                    <div className="flex-1">
                      <label className={labelStyle}>Security code</label>
                      <PayPalCVVField className={hostedFieldClass + ' w-full'} style={hostedFieldStyle} />
                    </div>
                  </div>

                  <CardSubmitButton
                    total={total}
                    paying={capturing}
                    setError={setError}
                    setCapturing={setCapturing}
                    billingAddress={billingAddressPayload}
                  />
                </div>
              </PayPalCardFieldsProvider>
            )}

            {/* Fallback if card fields not supported by this PayPal account */}
            {!cardFieldsReady && (
              <div className="temple-card p-4 text-center text-xs" style={{ color: 'rgba(255,248,220,0.4)' }}>
                Use the PayPal button above to pay — choose "Debit or Credit Card" inside PayPal.
              </div>
            )}

            {error && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="rounded-xl px-4 py-3 text-sm font-medium"
                style={{ background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.3)' }}>
                {error}
              </motion.div>
            )}

            <div className="flex items-center justify-center gap-2 text-xs" style={{ color: 'rgba(255,248,220,0.3)' }}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>Secured by PayPal · 256-bit SSL encryption</span>
            </div>
          </div>
        </PayPalScriptProvider>
      )}
    </div>
  )
}
