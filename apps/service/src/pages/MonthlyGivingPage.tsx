import { useEffect, useState, useCallback, useRef, type ComponentType } from 'react'
import { motion } from 'framer-motion'
import {
  PayPalScriptProvider as _PPP,
  PayPalButtons as _PPB,
  type PayPalButtonsComponentProps,
  type ReactPayPalScriptOptions,
} from '@paypal/react-paypal-js'
import { useStore } from '../store'
import { api, type GivingTier } from '../api'

const DEFAULT_TIERS: GivingTier[] = [
  { id: 'default-5',  amount: 5,  label: 'Lamp Supporter',  description: 'Supports daily lamp lighting at the temple',   frequency: 'MONTH', is_default: false, display_order: 1 },
  { id: 'default-11', amount: 11, label: 'Prasad Patron',   description: 'Provides weekly prasad offering to devotees',  frequency: 'MONTH', is_default: true,  display_order: 2 },
  { id: 'default-21', amount: 21, label: 'Puja Sponsor',    description: 'Sponsors a monthly puja ceremony',             frequency: 'MONTH', is_default: false, display_order: 3 },
  { id: 'default-51', amount: 51, label: 'Festival Friend', description: 'Helps cover special festival and event costs', frequency: 'MONTH', is_default: false, display_order: 4 },
]

const PayPalScriptProvider = _PPP as ComponentType<{ options: ReactPayPalScriptOptions; children: React.ReactNode }>
const PayPalButtons = _PPB as ComponentType<PayPalButtonsComponentProps>

export function MonthlyGivingPage() {
  const { branchId, setScreen } = useStore()
  const [tiers, setTiers]           = useState<GivingTier[]>([])
  const [selected, setSelected]     = useState<GivingTier | null>(null)
  const [clientId, setClientId]     = useState('')
  const [loading, setLoading]       = useState(true)
  const [planId, setPlanId]         = useState('')

  // Donor details
  const [firstName, setFirstName]   = useState('')
  const [surname, setSurname]       = useState('')
  const [donorEmail, setDonorEmail] = useState('')
  const [donorPhone, setDonorPhone] = useState('')
  const [postcode, setPostcode]     = useState('')
  const [addresses, setAddresses]   = useState<Array<{ formatted: string; uprn: string }>>([])
  const [selectedAddress, setSelectedAddress] = useState('')
  const [lookingUp, setLookingUp]   = useState(false)
  const [addressError, setAddressError] = useState('')

  const [step, setStep]             = useState<'pick' | 'details' | 'pay' | 'done'>('pick')
  const [error, setError]           = useState('')

  // Custom amount path — devotee picks their own £/month value when none of
  // the preset tiers feel right. Built as a synthetic GivingTier with a
  // sentinel id so the rest of the flow (subscribe → approve → confirm)
  // doesn't need to special-case it.
  const [customMode, setCustomMode] = useState(false)
  const [customAmount, setCustomAmount] = useState('')
  const customAmountValid = (() => {
    const n = parseFloat(customAmount)
    return Number.isFinite(n) && n >= 1 && n <= 1000
  })()
  function pickCustom() {
    setCustomMode(true)
    setSelected(null)
  }
  function confirmCustom() {
    if (!customAmountValid) return
    const n = parseFloat(customAmount)
    setSelected({
      id: 'custom',
      amount: n,
      label: 'Custom Monthly Gift',
      description: `£${n.toFixed(2)} every month`,
      frequency: 'MONTH',
      is_default: false,
      display_order: 999,
    })
  }

  const detailsValid = firstName.trim().length > 0 && surname.trim().length > 0 && donorEmail.trim().includes('@') && selectedAddress.length > 3

  useEffect(() => {
    Promise.all([
      api.givingTiers().then(d => {
        const tiers = d.tiers.length > 0 ? d.tiers : DEFAULT_TIERS
        setTiers(tiers)
        const def = tiers.find(t => t.is_default) ?? tiers[0]
        if (def) setSelected(def)
      }),
      api.paypalConfig().then(cfg => setClientId(cfg.client_id)),
    ]).finally(() => setLoading(false))
  }, [])

  async function lookupPostcode() {
    setAddressError('')
    if (!postcode.trim()) return
    setLookingUp(true)
    const found = await api.lookupPostcode(postcode)
    setLookingUp(false)
    if (!found.length) setAddressError('No addresses found — check your postcode.')
    else setAddresses(found)
  }

  async function goToPay() {
    if (!selected) return
    setError('')
    try {
      const isCustom = selected.id === 'custom'
      const res = await api.givingSubscribe(
        selected.id, branchId,
        firstName.trim(), surname.trim(), donorEmail.trim(),
        postcode.trim(), selectedAddress,
        donorPhone.trim(),
        isCustom ? Number(selected.amount) : null,
        isCustom ? selected.label : '',
      )
      setPlanId(res.plan_id)
      setStep('pay')
    } catch {
      setError('Could not set up subscription. Please try again.')
    }
  }

  // PayPalButtons.onApprove must be identity-stable: if its reference
  // changes between when the user opens the popup and when they approve,
  // the callback either fires with stale state or doesn't fire at all
  // (PayPal SDK caches the props at button-render time). The previous
  // useCallback rebuilt every keystroke in any donor field, so the
  // approve handler the SDK had captured was already stale by the time
  // the popup callback returned, and the subscription wasn't recorded
  // server-side.
  //
  // Same pattern as PaymentPage.tsx: read mutable state through a ref
  // so the callback's identity stays stable for the lifetime of the
  // page.
  const approveRef = useRef({
    selected, planId, branchId,
    firstName, surname, donorEmail, donorPhone, postcode, selectedAddress,
  })
  useEffect(() => {
    approveRef.current = {
      selected, planId, branchId,
      firstName, surname, donorEmail, donorPhone, postcode, selectedAddress,
    }
  })

  const handleApprove = useCallback(async (data: { subscriptionID?: string }) => {
    const s = approveRef.current
    if (!data.subscriptionID || !s.selected || !s.planId) return
    await api.givingApprove({
      subscription_id: data.subscriptionID,
      plan_id: s.planId,
      tier_id: s.selected.id,
      amount: s.selected.amount,
      frequency: s.selected.frequency,
      branch_id: s.branchId,
      donor_first_name: s.firstName.trim(),
      donor_surname: s.surname.trim(),
      donor_email: s.donorEmail.trim(),
      donor_phone: s.donorPhone.trim(),
      donor_postcode: s.postcode.trim(),
      donor_address: s.selectedAddress,
    }).catch(() => {})
    setStep('done')
  }, [])  // ← stable identity; reads via approveRef

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }} className="text-5xl">🕉</motion.div>
        <p className="text-xs tracking-widest uppercase font-semibold" style={{ color: 'rgba(212,175,55,0.5)' }}>Loading…</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-32">
      <button onClick={() => setScreen('browse')} className="flex items-center gap-2 text-sm font-medium mb-6"
        style={{ color: 'rgba(255,248,220,0.4)' }}>← Back
      </button>

      {/* Header */}
      <div className="text-center mb-6">
        <div className="text-4xl mb-2">🕉</div>
        <h1 className="font-display font-bold text-2xl text-gold-400 mb-1">Monthly Temple Support</h1>
        <p className="text-sm" style={{ color: 'rgba(255,248,220,0.5)' }}>
          Join our family of regular supporters. Cancel anytime.
        </p>
      </div>

      {/* Step: Pick amount */}
      {step === 'pick' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'rgba(212,175,55,0.6)' }}>
            Choose your monthly amount
          </p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {tiers.map(tier => (
              <button key={tier.id} onClick={() => { setCustomMode(false); setSelected(tier) }}
                className="rounded-2xl p-4 text-left transition-all active:scale-[0.98]"
                style={{
                  background: selected?.id === tier.id && !customMode
                    ? 'linear-gradient(135deg,rgba(212,175,55,0.25),rgba(212,175,55,0.12))'
                    : 'rgba(255,255,255,0.04)',
                  border: `2px solid ${selected?.id === tier.id && !customMode ? '#D4AF37' : 'rgba(255,255,255,0.1)'}`,
                }}>
                {tier.is_default && (
                  <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full mb-2 inline-block"
                    style={{ background: 'rgba(212,175,55,0.2)', color: '#D4AF37' }}>Popular</span>
                )}
                <p className="font-black text-2xl text-gold-400">£{Number(tier.amount).toFixed(0)}</p>
                <p className="text-xs font-bold text-ivory-200 mt-0.5">{tier.label}</p>
                <p className="text-xs mt-1" style={{ color: 'rgba(255,248,220,0.4)' }}>{tier.description}</p>
              </button>
            ))}

            {/* Custom amount tile — toggles to an input box when tapped */}
            <button onClick={pickCustom}
              className="rounded-2xl p-4 text-left transition-all active:scale-[0.98] col-span-2"
              style={{
                background: customMode
                  ? 'linear-gradient(135deg,rgba(212,175,55,0.25),rgba(212,175,55,0.12))'
                  : 'rgba(255,255,255,0.04)',
                border: `2px dashed ${customMode ? '#D4AF37' : 'rgba(255,255,255,0.15)'}`,
              }}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">✨</span>
                <div className="flex-1">
                  <p className="font-bold text-sm text-ivory-100">Other amount</p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,248,220,0.4)' }}>
                    Enter your own monthly gift — any amount from £1 to £1,000
                  </p>
                </div>
              </div>
            </button>
          </div>

          {customMode && (
            <div className="rounded-2xl p-4 mb-4"
              style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)' }}>
              <label className="block text-xs font-bold uppercase tracking-widest mb-2"
                style={{ color: 'rgba(212,175,55,0.8)' }}>
                Your monthly amount (£)
              </label>
              <div className="flex gap-2 items-center">
                <span className="text-2xl font-black text-gold-400">£</span>
                <input type="number" min="1" max="1000" step="0.01"
                  inputMode="decimal"
                  value={customAmount}
                  onChange={e => setCustomAmount(e.target.value)}
                  onBlur={confirmCustom}
                  placeholder="e.g. 30"
                  className="flex-1 px-3 py-2 rounded-xl text-2xl font-black bg-black/30 border border-white/10 focus:border-saffron-400/50 outline-none text-gold-400 placeholder-white/20"
                  autoFocus />
                <button onClick={confirmCustom} disabled={!customAmountValid}
                  className="px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-40"
                  style={{ background: 'rgba(212,175,55,0.25)', color: '#FFD980', border: '1px solid rgba(212,175,55,0.4)' }}>
                  Set
                </button>
              </div>
              {customAmount && !customAmountValid && (
                <p className="text-xs mt-2" style={{ color: '#fca5a5' }}>
                  Please enter an amount between £1 and £1,000.
                </p>
              )}
              {selected?.id === 'custom' && customAmountValid && (
                <p className="text-xs mt-2" style={{ color: 'rgba(255,248,220,0.6)' }}>
                  ✓ £{Number(selected.amount).toFixed(2)} per month
                </p>
              )}
            </div>
          )}

          <button onClick={() => setStep('details')}
            disabled={!selected || (customMode && !customAmountValid)}
            className="w-full py-4 rounded-2xl font-black text-base disabled:opacity-40 transition-all active:scale-[0.99]"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
            Continue — £{selected ? Number(selected.amount).toFixed(2).replace(/\.00$/, '') : '—'}/month →
          </button>

          <p className="text-center text-xs mt-3" style={{ color: 'rgba(255,248,220,0.3)' }}>
            Secure recurring payment via PayPal · Cancel anytime
          </p>
        </motion.div>
      )}

      {/* Step: Contact details */}
      {step === 'details' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="temple-card p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(212,175,55,0.6)' }}>Monthly donation</p>
              <p className="font-black text-2xl text-gold-400">£{selected ? Number(selected.amount).toFixed(0) : '—'}/month</p>
              <p className="text-xs text-ivory-200">{selected?.label}</p>
            </div>
            <button onClick={() => setStep('pick')} className="text-xs font-bold" style={{ color: 'rgba(212,175,55,0.6)' }}>Change</button>
          </div>

          {/* Name — split fields */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>First Name *</label>
              <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                placeholder="First name" className="w-full px-4 py-3 rounded-xl text-sm" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Surname *</label>
              <input type="text" value={surname} onChange={e => setSurname(e.target.value)}
                placeholder="Surname" className="w-full px-4 py-3 rounded-xl text-sm" />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Email *</label>
            <input type="email" value={donorEmail} onChange={e => setDonorEmail(e.target.value)}
              placeholder="your@email.com" className="w-full px-4 py-3 rounded-xl text-sm" />
            {donorEmail && <p className="text-xs mt-1 ml-1" style={{ color: '#60a5fa' }}>📧 Subscription confirmation sent here</p>}
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Phone</label>
            <input type="tel" value={donorPhone} onChange={e => setDonorPhone(e.target.value)}
              placeholder="07123 456789" autoComplete="tel"
              className="w-full px-4 py-3 rounded-xl text-sm" />
            <p className="text-xs mt-1 ml-1" style={{ color: 'rgba(255,248,220,0.4)' }}>Optional — speeds up PayPal checkout</p>
          </div>

          {/* Postcode lookup */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>UK Postcode *</label>
            <div className="flex gap-2">
              <input
                type="text" value={postcode}
                onChange={e => setPostcode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && lookupPostcode()}
                placeholder="e.g. HA9 0BB"
                className="flex-1 px-4 py-3 rounded-xl text-sm uppercase"
              />
              <button onClick={lookupPostcode} disabled={lookingUp}
                className="px-4 py-3 rounded-xl font-bold text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#6B0000' }}>
                {lookingUp ? '…' : 'Find'}
              </button>
            </div>
            {addressError && <p className="text-xs mt-1" style={{ color: '#f87171' }}>{addressError}</p>}
          </div>

          {/* Address dropdown */}
          {addresses.length > 0 && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Select Address *</label>
              <select value={selectedAddress} onChange={e => setSelectedAddress(e.target.value)} className="w-full px-4 py-3 rounded-xl text-sm">
                <option value="">— Select your address —</option>
                {addresses.map((a, i) => <option key={i} value={a.formatted}>{a.formatted}</option>)}
              </select>
            </div>
          )}

          {selectedAddress && (
            <div className="px-4 py-3 rounded-xl text-xs font-medium" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80' }}>
              ✓ {selectedAddress}
            </div>
          )}

          {error && (
            <p className="text-sm font-medium rounded-xl px-4 py-3"
              style={{ background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.3)' }}>
              {error}
            </p>
          )}

          <button onClick={goToPay} disabled={!detailsValid}
            className="w-full py-4 rounded-2xl font-black text-base transition-all active:scale-[0.99] disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
            Proceed to Payment →
          </button>
        </motion.div>
      )}

      {/* Step: PayPal subscription */}
      {step === 'pay' && planId && clientId && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="temple-card p-4 mb-4">
            <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(212,175,55,0.6)' }}>Monthly donation</p>
            <p className="font-black text-2xl text-gold-400">£{selected ? Number(selected.amount).toFixed(0) : '—'}/month</p>
            <p className="text-xs text-ivory-200 mt-0.5">{firstName} {surname} · {donorEmail}</p>
            <button onClick={() => setStep('details')} className="text-xs font-bold mt-2" style={{ color: 'rgba(212,175,55,0.6)' }}>Change details</button>
          </div>

          <PayPalScriptProvider options={{ clientId, vault: true, intent: 'subscription', currency: 'GBP' }}>
            <PayPalButtons
              style={{ layout: 'vertical', color: 'gold', shape: 'rect', label: 'subscribe', height: 48 }}
              createSubscription={(_data, actions) => {
                // Pre-fill PayPal checkout (debit/credit card form) with the
                // donor details we already collected.
                //
                // Pre-fill behavior of /v1/billing/subscriptions:
                //   - subscriber.name → cardholder name on Guest Card form
                //   - subscriber.email_address → email field
                //   - subscriber.shipping_address → shipping AND billing
                //     address (when SET_PROVIDED_ADDRESS); also drives the
                //     country dial-code default on the phone field
                //   - application_context.brand_name + locale → required for
                //     reliable Guest Card pre-fill (without locale, PayPal
                //     falls back to browser language and may suppress some
                //     pre-fill paths)
                // Note: subscriber.phone is NOT documented in the v1 subscriber
                // schema (only name / email_address / shipping_address /
                // payer_id are). PayPal silently drops unknown fields, which
                // is why a previous attempt to pre-fill phone via that path
                // had no effect — leaving it out keeps the payload clean.
                // Defensive parse — PayPal silently drops the entire payer /
                // subscriber block if any sub-field is malformed, so we
                // omit > submit-with-junk.
                const trimmedAddr = selectedAddress.trim()
                const parts = trimmedAddr.split(',').map(p => p.trim()).filter(Boolean)
                const ukPostRe = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i
                const nonPcParts = parts.filter(p => !ukPostRe.test(p))
                const addressL1 = nonPcParts[0] || ''
                const city      = nonPcParts.length >= 2 ? nonPcParts[nonPcParts.length - 1] : ''
                const addressL2 = nonPcParts.length >= 3 ? nonPcParts[1] : ''

                const givenName  = firstName.trim()
                const familyName = surname.trim()
                const haveName   = !!(givenName && familyName)
                const havePostcode = !!postcode.trim()
                const haveAddress  = !!(addressL1 && havePostcode)  // postcode-only is useless to PayPal
                const fullName     = haveName ? `${givenName} ${familyName}` : ''

                // Email validation — PayPal returns 422 on "user@" without TLD.
                const email = donorEmail.trim()
                const haveEmail = !!email && email.includes('@') && email.split('@')[1].includes('.')

                // Phone: strip everything non-digit, drop +44/0 prefix, keep
                // 9-11 digits. Anything else PayPal rejects with INVALID_PARAMETER_VALUE.
                let phoneDigits = donorPhone.replace(/\D/g, '')
                if (phoneDigits.startsWith('44') && phoneDigits.length >= 12) phoneDigits = phoneDigits.slice(2)
                if (phoneDigits.startsWith('0')) phoneDigits = phoneDigits.slice(1)
                const havePhone = phoneDigits.length >= 9 && phoneDigits.length <= 11

                const addressBlock = haveAddress ? {
                  address_line_1: addressL1,
                  ...(addressL2 && addressL2 !== city && { address_line_2: addressL2 }),
                  ...(city && { admin_area_2: city }),
                  postal_code: postcode.trim(),
                  country_code: 'GB',
                } : null

                const subscriber: Record<string, unknown> = {
                  ...(haveName  && { name: { given_name: givenName, surname: familyName } }),
                  ...(haveEmail && { email_address: email }),
                  ...(addressBlock && {
                    shipping_address: {
                      ...(fullName && { name: { full_name: fullName } }),
                      address: addressBlock,
                    },
                  }),
                }
                // Belt-and-braces pre-fill. PayPal Live's Guest Card form is
                // unreliable about reading subscriber.shipping_address —
                // (#29, #33). Send the same identity in MULTIPLE shapes so
                // PayPal's checkout state machine picks at least one:
                //   (a) `subscriber` (subscriptions API canonical)
                //   (b) `payer` (orders API shape — Smart Buttons forwards)
                //   (c) `application_context.landing_page='BILLING'`
                const payer: Record<string, unknown> = {
                  ...(haveName  && { name: { given_name: givenName, surname: familyName } }),
                  ...(haveEmail && { email_address: email }),
                  ...(havePhone && {
                    phone: {
                      phone_type: 'MOBILE',
                      phone_number: { national_number: phoneDigits },
                    },
                  }),
                  ...(addressBlock && { address: addressBlock }),
                }
                // `payer` isn't in @paypal subscriptions typings but Smart
                // Buttons forwards unknown fields onto the checkout context
                // — required to coax PayPal Live into pre-filling the Guest
                // Card billing-address form. Cast the whole thing.
                return actions.subscription.create({
                  plan_id: planId,
                  subscriber,
                  payer,
                  application_context: {
                    brand_name:          'Shital Temple',
                    locale:              'en-GB',
                    // SET_PROVIDED_ADDRESS only when we actually provided one,
                    // otherwise PayPal returns 422 SHIPPING_ADDRESS_INVALID.
                    shipping_preference: addressBlock ? 'SET_PROVIDED_ADDRESS' : 'NO_SHIPPING',
                    user_action:         'SUBSCRIBE_NOW',
                    landing_page:        'BILLING',
                    return_url: `${window.location.origin}/?screen=monthly-giving&status=approved`,
                    cancel_url: `${window.location.origin}/?screen=monthly-giving&status=cancelled`,
                  },
                } as Parameters<typeof actions.subscription.create>[0])
              }}
              onApprove={(data) => handleApprove({ subscriptionID: (data as { subscriptionID?: string }).subscriptionID })}
              onError={() => setError('PayPal encountered an error. Please try again.')}
              onCancel={() => setStep('details')}
            />
          </PayPalScriptProvider>

          {error && (
            <p className="text-sm font-medium mt-3 rounded-xl px-4 py-3"
              style={{ background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.3)' }}>
              {error}
            </p>
          )}
        </motion.div>
      )}

      {/* Step: Done */}
      {step === 'done' && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8 space-y-4">
          <div className="text-6xl">🙏</div>
          <h2 className="font-display font-bold text-2xl text-gold-400">Baba's Blessings!</h2>
          <p className="text-sm" style={{ color: 'rgba(255,248,220,0.6)' }}>
            Your monthly support of <strong className="text-gold-400">£{selected ? Number(selected.amount).toFixed(0) : '—'}</strong> has been set up.
            {donorEmail && ` A confirmation will be sent to ${donorEmail}.`}
          </p>

          {/* How to cancel / unsubscribe — surfaced prominently so donors
              never feel locked-in. PayPal owns the subscription, so cancel
              must happen on their side; we just point the way. */}
          <div className="mt-6 mx-auto max-w-md text-left rounded-xl px-4 py-4"
            style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.2)' }}>
            <p className="text-sm font-bold text-gold-400 mb-2">How to cancel or pause</p>
            <ol className="text-xs space-y-1.5 list-decimal list-inside" style={{ color: 'rgba(255,248,220,0.7)' }}>
              <li>Sign in at <a href="https://www.paypal.com/myaccount/autopay" target="_blank" rel="noopener noreferrer"
                  className="underline text-gold-400">paypal.com/myaccount/autopay</a></li>
              <li>Find <strong>SHITAL</strong> in your automatic payments list</li>
              <li>Click <strong>Cancel</strong> — it stops immediately, no further charges</li>
            </ol>
            <p className="text-xs mt-3" style={{ color: 'rgba(255,248,220,0.5)' }}>
              Need help? Email <a href="mailto:info@shital.org.uk" className="underline text-gold-400">info@shital.org.uk</a> and we'll cancel for you.
            </p>
            <p className="text-xs mt-3 pt-3" style={{ color: 'rgba(255,248,220,0.5)', borderTop: '1px solid rgba(212,175,55,0.15)' }}>
              <strong>Stop emails about this payment?</strong>
            </p>
            <ul className="text-xs mt-1 space-y-1 list-disc list-inside" style={{ color: 'rgba(255,248,220,0.5)' }}>
              <li>From PayPal: <a href="https://www.paypal.com/myaccount/notifications" target="_blank" rel="noopener noreferrer"
                  className="underline text-gold-400">paypal.com/myaccount/notifications</a> → uncheck subscription notifications.</li>
              <li>From SHITAL: reply "unsubscribe" to any email and we'll remove you.</li>
            </ul>
          </div>

          <button onClick={() => setScreen('browse')}
            className="mt-4 px-6 py-3 rounded-xl font-bold text-sm"
            style={{ background: 'rgba(212,175,55,0.15)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.3)' }}>
            Return to Temple
          </button>
        </motion.div>
      )}
    </div>
  )
}
