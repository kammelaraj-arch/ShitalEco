import { useEffect, useMemo, useState, useCallback, useRef, type ComponentType } from 'react'
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
  const [stripeEnabled, setStripeEnabled] = useState(false)
  const [stripeBusy, setStripeBusy] = useState(false)

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

  const [giftAidDeclared, setGiftAidDeclared] = useState(false)

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
      // Is Stripe recurring available? (enabled only once the webhook secret is set)
      fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/service/stripe/config`)
        .then(r => r.json()).then(c => setStripeEnabled(!!c?.enabled)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  // Returning from a hosted checkout (Stripe or PayPal redirect) lands here with
  // ?status=approved. Show the thank-you ('done') and, for display only, the
  // amount passed as `amt`. Then clean the URL so a refresh doesn't re-fire.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('status') === 'approved') {
      const amt = Number(p.get('amt') || '')
      if (Number.isFinite(amt) && amt > 0) {
        setSelected(s => s ?? {
          id: 'return', amount: amt, label: 'Monthly Gift',
          description: `£${amt.toFixed(2)} every month`, frequency: 'MONTH',
          is_default: false, display_order: 0,
        })
      }
      // Belt-and-braces: activate the Stripe subscription immediately on return
      // (don't wait for a webhook / manual sync). The confirm endpoint is
      // idempotent and never fails the donor — it flips the row to ACTIVE and
      // records the first payment. Without this, paid subs sit at PENDING_APPROVAL.
      const sessionId = p.get('session_id') || ''
      if (p.get('provider') === 'stripe' && sessionId) {
        fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/service/giving/stripe/confirm`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        }).catch(() => { /* webhook / sync will still reconcile it */ })
      }
      setStep('done')
      window.history.replaceState(null, '', `${window.location.pathname}?screen=monthly-giving`)
    }
  }, [])

  // Stripe card: go STRAIGHT to Stripe Checkout from the amount step — no
  // on-site details form. Stripe collects name/email/address on its hosted page.
  async function payByStripe() {
    if (!selected) return
    setStripeBusy(true)
    setError('')
    try {
      const r = await fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/service/giving/stripe/create-checkout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(selected.amount), branch_id: branchId,
          tier_label: selected.label || 'Monthly Giving', return_origin: window.location.origin,
        }),
      })
      const d = await r.json()
      if (r.ok && d.url) { window.location.href = d.url; return }
      throw new Error(d.detail || 'Could not start card checkout.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start card checkout. Please try again.')
      setStripeBusy(false)
    }
  }

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

  const approveRef = useRef({
    selected, planId, branchId, firstName, surname,
    donorEmail, donorPhone, postcode, selectedAddress, giftAidDeclared,
  })
  useEffect(() => {
    approveRef.current = {
      selected, planId, branchId, firstName, surname,
      donorEmail, donorPhone, postcode, selectedAddress, giftAidDeclared,
    }
  })

  const handleApprove = useCallback(async (data: { subscriptionID?: string }) => {
    const s = approveRef.current
    if (!data.subscriptionID || !s.selected || !s.planId) return
    setError('')
    try {
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
        gift_aid_declared: s.giftAidDeclared,
        tier_label: s.selected.label,
      })
      setStep('done')
    } catch {
      // The donor's PayPal subscription is already active at this point — we
      // failed only to record it server-side. Surface the subscription ID so
      // they can email it to us; never silently advance to 'done' or they'll
      // think everything's fine and we'll have a phantom charge with no DB row.
      setError(
        `Your PayPal subscription (${data.subscriptionID}) is active, but we couldn't record it on our side. ` +
        `Please email info@shital.org.uk with this reference so we can confirm your monthly support and send your receipt.`,
      )
    }
  }, [])

  // PayPalScriptProvider's `options` prop must keep the same object
  // identity across renders or the SDK keeps tearing down + remounting
  // the buttons iframe — the user sees "Payment was interrupted" the
  // moment they finally click Subscribe. PR #77 stabilised the
  // callbacks but missed this object literal.
  const paypalScriptOptions = useMemo(() => ({
    clientId, vault: true, intent: 'subscription', currency: 'GBP', enableFunding: 'card',
  }), [clientId])

  // Identity-stable PayPalButtons callbacks. Inline arrow functions =
  // fresh reference every keystroke in the donor fields, which made the
  // SDK remount the Subscribe button mid-typing — next click then failed
  // with the postrobot interrupted error.
  const handleOnApprove = useCallback((data: unknown) => {
    const d = data as { subscriptionID?: string } | null
    return handleApprove({ subscriptionID: d?.subscriptionID })
  }, [handleApprove])
  const handlePayPalError = useCallback(() => setError('PayPal encountered an error. Please try again.'), [])
  const handlePayPalCancel = useCallback(() => setStep('details'), [])

  // Shared subscription builder for both the Card and PayPal buttons. Reads
  // from approveRef so it stays identity-stable (the SDK remounts the buttons
  // iframe if this changes identity mid-typing — same issue PR #77 fixed).
  const handleCreateSubscription = useCallback<NonNullable<PayPalButtonsComponentProps['createSubscription']>>((_data, actions) => {
    const s = approveRef.current
    const trimmedAddr = s.selectedAddress.trim()
    const parts = trimmedAddr.split(',').map(p => p.trim()).filter(Boolean)
    const ukPostRe = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i
    const nonPcParts = parts.filter(p => !ukPostRe.test(p))
    const addressL1 = nonPcParts[0] || ''
    const city      = nonPcParts.length >= 2 ? nonPcParts[nonPcParts.length - 1] : ''
    const addressL2 = nonPcParts.length >= 3 ? nonPcParts[1] : ''

    const givenName  = s.firstName.trim()
    const familyName = s.surname.trim()
    const haveName   = !!(givenName && familyName)
    const havePostcode = !!s.postcode.trim()
    const haveAddress  = !!(addressL1 && havePostcode)
    const fullName     = haveName ? `${givenName} ${familyName}` : ''

    const email = s.donorEmail.trim()
    const haveEmail = !!email && email.includes('@') && email.split('@')[1].includes('.')

    let phoneDigits = s.donorPhone.replace(/\D/g, '')
    if (phoneDigits.startsWith('44') && phoneDigits.length >= 12) phoneDigits = phoneDigits.slice(2)
    if (phoneDigits.startsWith('0')) phoneDigits = phoneDigits.slice(1)
    const havePhone = phoneDigits.length >= 9 && phoneDigits.length <= 11

    const addressBlock = haveAddress ? {
      address_line_1: addressL1,
      ...(addressL2 && addressL2 !== city && { address_line_2: addressL2 }),
      ...(city && { admin_area_2: city }),
      postal_code: s.postcode.trim(),
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
    return actions.subscription.create({
      plan_id: s.planId,
      subscriber,
      payer,
      application_context: {
        brand_name:          'Shital Temple',
        locale:              'en-GB',
        shipping_preference: addressBlock ? 'SET_PROVIDED_ADDRESS' : 'NO_SHIPPING',
        user_action:         'SUBSCRIBE_NOW',
        landing_page:        'BILLING',
        return_url: `${window.location.origin}/?screen=monthly-giving&status=approved`,
        cancel_url: `${window.location.origin}/?screen=monthly-giving&status=cancelled`,
      },
    } as Parameters<typeof actions.subscription.create>[0])
  }, [])

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

      <div className="text-center mb-6">
        <div className="text-4xl mb-2">🕉</div>
        <h1 className="font-display font-bold text-2xl text-gold-400 mb-1">Monthly Temple Support</h1>
        <p className="text-sm" style={{ color: 'rgba(255,248,220,0.5)' }}>
          Join our family of regular supporters. Cancel anytime.
        </p>
      </div>

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

          {/* Stripe card — primary: straight to Stripe's hosted card page, no
              on-site form (Stripe captures name/email/address). */}
          {stripeEnabled && (
            <button onClick={payByStripe}
              disabled={!selected || (customMode && !customAmountValid) || stripeBusy}
              className="w-full py-4 rounded-2xl font-black text-base disabled:opacity-40 transition-all active:scale-[0.99] flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)', color: '#3B0000' }}>
              {stripeBusy ? 'Connecting to secure card checkout…'
                : `💳 Pay by Card — £${selected ? Number(selected.amount).toFixed(2).replace(/\.00$/, '') : '—'}/month`}
            </button>
          )}

          <button onClick={() => setStep('details')}
            disabled={!selected || (customMode && !customAmountValid)}
            className="w-full py-4 rounded-2xl font-black text-base disabled:opacity-40 transition-all active:scale-[0.99]"
            style={ stripeEnabled
              ? { background: 'rgba(255,255,255,0.06)', color: '#FFF8DC', border: '1px solid rgba(255,255,255,0.15)', marginTop: '0.7rem' }
              : { background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' } }>
            {stripeEnabled
              ? 'Or pay with PayPal →'
              : `Continue — £${selected ? Number(selected.amount).toFixed(2).replace(/\.00$/, '') : '—'}/month →`}
          </button>

          {error && (
            <p className="text-sm font-medium rounded-xl px-4 py-3 mt-3"
              style={{ background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.3)' }}>
              {error}
            </p>
          )}

          <p className="text-center text-xs mt-3" style={{ color: 'rgba(255,248,220,0.3)' }}>
            Secure recurring payment · Cancel anytime
          </p>
        </motion.div>
      )}

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

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Email *</label>
            <input type="email" value={donorEmail} onChange={e => setDonorEmail(e.target.value)}
              placeholder="your@email.com" className="w-full px-4 py-3 rounded-xl text-sm" />
            {donorEmail && <p className="text-xs mt-1 ml-1" style={{ color: '#60a5fa' }}>📧 Subscription confirmation sent here</p>}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Phone</label>
            <input type="tel" value={donorPhone} onChange={e => setDonorPhone(e.target.value)}
              placeholder="07123 456789" autoComplete="tel"
              className="w-full px-4 py-3 rounded-xl text-sm" />
            <p className="text-xs mt-1 ml-1" style={{ color: 'rgba(255,248,220,0.4)' }}>Optional — speeds up PayPal checkout</p>
          </div>

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

          <button type="button" onClick={() => setGiftAidDeclared(v => !v)}
            className="w-full text-left rounded-2xl p-4 transition-all"
            style={{
              background: giftAidDeclared
                ? 'linear-gradient(135deg,rgba(34,197,94,0.18),rgba(34,197,94,0.08))'
                : 'rgba(255,255,255,0.04)',
              border: `2px solid ${giftAidDeclared ? '#22C55E' : 'rgba(255,255,255,0.1)'}`,
            }}>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{
                  background: giftAidDeclared ? '#22C55E' : 'rgba(255,255,255,0.05)',
                  border: giftAidDeclared ? 'none' : '2px solid rgba(255,255,255,0.2)',
                  color: 'white',
                }}>
                {giftAidDeclared ? '✓' : ''}
              </div>
              <div className="flex-1">
                <p className="font-bold text-sm text-ivory-100">Add Gift Aid — make my £{selected ? Number(selected.amount).toFixed(0) : '—'} worth £{selected ? (Number(selected.amount) * 1.25).toFixed(2) : '—'}</p>
                <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'rgba(255,248,220,0.55)' }}>
                  I'm a UK taxpayer, this is my own money, and I'd like SHITAL to claim Gift Aid on every monthly donation. I understand if I pay less Income/Capital Gains Tax than the amount of Gift Aid claimed in a year, it's my responsibility to pay the difference.
                </p>
              </div>
            </div>
          </button>

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

      {step === 'pay' && planId && clientId && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="temple-card p-4 mb-4">
            <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(212,175,55,0.6)' }}>Monthly donation</p>
            <p className="font-black text-2xl text-gold-400">£{selected ? Number(selected.amount).toFixed(0) : '—'}/month</p>
            <p className="text-xs text-ivory-200 mt-0.5">{firstName} {surname} · {donorEmail}</p>
            <button onClick={() => setStep('details')} className="text-xs font-bold mt-2" style={{ color: 'rgba(212,175,55,0.6)' }}>Change details</button>
          </div>

          <PayPalScriptProvider options={paypalScriptOptions}>
            {/* Dedicated Debit/Credit Card button — opens PayPal's guest card
                screen directly (no login-first). */}
            <PayPalButtons
              fundingSource="card"
              style={{ layout: 'vertical', color: 'black', shape: 'rect', label: 'pay', height: 48 }}
              createSubscription={handleCreateSubscription}
              onApprove={handleOnApprove}
              onError={handlePayPalError}
              onCancel={handlePayPalCancel}
            />
            {/* PayPal button for donors who prefer to log in. */}
            <PayPalButtons
              fundingSource="paypal"
              style={{ layout: 'vertical', color: 'gold', shape: 'rect', label: 'subscribe', height: 48 }}
              createSubscription={handleCreateSubscription}
              onApprove={handleOnApprove}
              onError={handlePayPalError}
              onCancel={handlePayPalCancel}
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

      {step === 'done' && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8 space-y-4">
          <div className="text-6xl">🙏</div>
          <h2 className="font-display font-bold text-2xl text-gold-400">Baba's Blessings, {firstName || 'Friend'}!</h2>
          <p className="text-sm" style={{ color: 'rgba(255,248,220,0.7)' }}>
            Your monthly support of <strong className="text-gold-400">
              £{selected ? Number(selected.amount).toFixed(2).replace(/\.00$/, '') : '—'}/{selected?.frequency.toLowerCase() ?? 'month'}
            </strong> is now active.
          </p>

          {giftAidDeclared && (
            <div className="rounded-xl mx-auto max-w-xs px-4 py-3 text-xs"
              style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#86efac' }}>
              ✓ Gift Aid declared — SHITAL will reclaim 25p extra for every £1 you give.
            </div>
          )}

          {donorEmail && (
            <p className="text-xs" style={{ color: 'rgba(255,248,220,0.55)' }}>
              📧 A confirmation email is on its way to <strong>{donorEmail}</strong>
            </p>
          )}

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

          <div className="flex gap-2 justify-center mt-4">
            <button onClick={() => setScreen('browse')}
              className="px-6 py-3 rounded-xl font-bold text-sm"
              style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
              Return to Temple
            </button>
          </div>
        </motion.div>
      )}
    </div>
  )
}
