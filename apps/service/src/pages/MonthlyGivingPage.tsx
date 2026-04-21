import { useEffect, useState, useCallback, type ComponentType } from 'react'
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
  const [postcode, setPostcode]     = useState('')
  const [addresses, setAddresses]   = useState<string[]>([])
  const [selectedAddress, setSelectedAddress] = useState('')
  const [lookingUp, setLookingUp]   = useState(false)
  const [addressError, setAddressError] = useState('')

  const [step, setStep]             = useState<'pick' | 'details' | 'pay' | 'done'>('pick')
  const [error, setError]           = useState('')

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
      const res = await api.givingSubscribe(
        selected.id, branchId,
        firstName.trim(), surname.trim(), donorEmail.trim(),
        postcode.trim(), selectedAddress,
      )
      setPlanId(res.plan_id)
      setStep('pay')
    } catch {
      setError('Could not set up subscription. Please try again.')
    }
  }

  const handleApprove = useCallback(async (data: { subscriptionID?: string }) => {
    if (!data.subscriptionID || !selected || !planId) return
    await api.givingApprove({
      subscription_id: data.subscriptionID,
      plan_id: planId,
      tier_id: selected.id,
      amount: selected.amount,
      frequency: selected.frequency,
      branch_id: branchId,
      donor_first_name: firstName.trim(),
      donor_surname: surname.trim(),
      donor_email: donorEmail.trim(),
      donor_postcode: postcode.trim(),
      donor_address: selectedAddress,
    }).catch(() => {})
    setStep('done')
  }, [selected, planId, branchId, firstName, surname, donorEmail, postcode, selectedAddress])

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
          <div className="grid grid-cols-2 gap-3 mb-4">
            {tiers.map(tier => (
              <button key={tier.id} onClick={() => setSelected(tier)}
                className="rounded-2xl p-4 text-left transition-all active:scale-[0.98]"
                style={{
                  background: selected?.id === tier.id
                    ? 'linear-gradient(135deg,rgba(212,175,55,0.25),rgba(212,175,55,0.12))'
                    : 'rgba(255,255,255,0.04)',
                  border: `2px solid ${selected?.id === tier.id ? '#D4AF37' : 'rgba(255,255,255,0.1)'}`,
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
          </div>

          <button onClick={() => setStep('details')} disabled={!selected}
            className="w-full py-4 rounded-2xl font-black text-base disabled:opacity-40 transition-all active:scale-[0.99]"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
            Continue — £{selected ? Number(selected.amount).toFixed(0) : '—'}/month →
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
                {addresses.map((a, i) => <option key={i} value={a}>{a}</option>)}
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
              createSubscription={(_data, actions) =>
                actions.subscription.create({ plan_id: planId })
              }
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
          <p className="text-xs" style={{ color: 'rgba(255,248,220,0.35)' }}>
            You can cancel anytime through your PayPal account.
          </p>
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
