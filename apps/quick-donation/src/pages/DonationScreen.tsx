import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  PayPalScriptProvider as _PPSProvider,
  PayPalButtons as _PPButtons,
  type PayPalButtonsComponentProps,
  type ReactPayPalScriptOptions,
} from '@paypal/react-paypal-js'
import { useDonationStore } from '../store/donation.store'

// Cast to any-prop components to avoid strict type issues
const PayPalScriptProvider = _PPSProvider as React.ComponentType<{ options: ReactPayPalScriptOptions; children: React.ReactNode }>
const PayPalButtons = _PPButtons as React.ComponentType<PayPalButtonsComponentProps>

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

// ── Monthly giving tiers ───────────────────────────────────────────────────────
const MONTHLY_TIERS = [
  { amount: 5,  title: 'Lamp Supporter',  desc: 'Supports daily lamp lighting at the temple' },
  { amount: 11, title: 'Prasad Patron',   desc: 'Provides weekly prasad offering to devotees', popular: true },
  { amount: 21, title: 'Puja Sponsor',    desc: 'Sponsors a monthly puja ceremony' },
  { amount: 51, title: 'Festival Friend', desc: 'Helps cover special festival and event costs' },
]

type MonthlyStep = 0 | 1 | 2 | 3 | 'done'

interface MonthlyResult {
  approval_url?: string | null
  plan_id?: string | null
  paypal_client_id?: string
  name: string
  amount: number
}

// ── Confirmation: two options — QR scan or on-screen PayPal ──────────────────
function DoneOptions({
  result, firstName, surname, email, houseNum, postcode, branchId, onClose,
}: {
  result: MonthlyResult
  firstName: string; surname: string; email: string
  houseNum: string; postcode: string; branchId: string
  onClose: () => void
}) {
  const [tab, setTab] = useState<'qr' | 'card'>('qr')
  const [subscribed, setSubscribed] = useState(false)

  const tabStyle = (active: boolean) => ({
    flex: 1, padding: '10px', borderRadius: '12px', fontWeight: 900, fontSize: 13,
    background: active ? 'rgba(212,175,55,0.2)' : 'transparent',
    color: active ? '#D4AF37' : 'rgba(255,248,220,0.4)',
    border: active ? '1.5px solid rgba(212,175,55,0.4)' : '1.5px solid transparent',
    cursor: 'pointer',
  })

  return (
    <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="pb-4 pt-2">
      <div className="text-center mb-4">
        <div className="text-4xl mb-2">🙏</div>
        <h2 className="text-lg font-black" style={{ color: '#D4AF37' }}>
          Thank you, {result.name.split(' ')[0]}!
        </h2>
        <p className="text-xs mt-1" style={{ color: 'rgba(255,248,220,0.5)' }}>
          Monthly support of <strong style={{ color: '#D4AF37' }}>£{result.amount}/month</strong> — choose how to complete:
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2 mb-4 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <button style={tabStyle(tab === 'qr')} onClick={() => setTab('qr')}>📱 Scan QR</button>
        <button style={tabStyle(tab === 'card')} onClick={() => setTab('card')}>💳 Pay Here</button>
      </div>

      {/* QR tab */}
      {tab === 'qr' && (
        <div className="flex flex-col items-center">
          {result.approval_url ? (
            <>
              <div className="p-3 rounded-2xl mb-3" style={{ background: '#fff' }}>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=190x190&data=${encodeURIComponent(result.approval_url)}`}
                  alt="PayPal QR"
                  className="w-48 h-48"
                />
              </div>
              <p className="text-xs font-bold mb-1 text-center" style={{ color: 'rgba(212,175,55,0.8)' }}>
                Scan with your phone camera
              </p>
              <p className="text-[10px] text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
                Approve your PayPal subscription · Cancel anytime
              </p>
            </>
          ) : (
            <p className="text-xs text-center px-4" style={{ color: 'rgba(255,248,220,0.45)' }}>
              We'll send setup details to <span style={{ color: '#D4AF37' }}>{email}</span>
            </p>
          )}
        </div>
      )}

      {/* Pay on screen tab — PayPal buttons */}
      {tab === 'card' && !subscribed && result.plan_id && result.paypal_client_id && (
        <div>
          <p className="text-xs text-center mb-3" style={{ color: 'rgba(255,248,220,0.4)' }}>
            Complete your monthly donation securely on this screen
          </p>
          <PayPalScriptProvider options={{
            clientId: result.paypal_client_id,
            currency: 'GBP',
            vault: true,
            intent: 'subscription',
          } as ReactPayPalScriptOptions}>
            <PayPalButtons
              style={{ layout: 'vertical', color: 'gold', shape: 'rect', label: 'subscribe', height: 48 }}
              createSubscription={(_data: Record<string, unknown>, actions: Record<string, unknown>) => {
                const subActions = actions as { subscription: { create: (o: unknown) => Promise<string> } }
                return subActions.subscription.create({
                  plan_id: result.plan_id,
                  subscriber: {
                    name: { given_name: firstName, surname },
                    email_address: email,
                    shipping_address: postcode ? {
                      name: { full_name: `${firstName} ${surname}` },
                      address: { address_line_1: houseNum, postal_code: postcode.toUpperCase().replace(' ', ''), country_code: 'GB' },
                    } : undefined,
                  },
                })
              }}
              onApprove={async (data: Record<string, unknown>) => {
                await fetch(`${API_BASE}/service/giving/subscription/approve`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    subscription_id: data.subscriptionID,
                    plan_id: result.plan_id,
                    amount: result.amount,
                    frequency: 'MONTH',
                    branch_id: branchId,
                    donor_first_name: firstName,
                    donor_surname: surname,
                    donor_email: email,
                    donor_postcode: postcode,
                    donor_address: houseNum,
                  }),
                }).catch(() => {})
                setSubscribed(true)
              }}
              onError={() => setTab('qr')}
            />
          </PayPalScriptProvider>
        </div>
      )}

      {tab === 'card' && !subscribed && (!result.plan_id || !result.paypal_client_id) && (
        <p className="text-xs text-center px-4" style={{ color: 'rgba(255,248,220,0.4)' }}>
          PayPal not configured — please use the QR code option.
        </p>
      )}

      {subscribed && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex flex-col items-center py-4">
          <div className="text-4xl mb-2">✅</div>
          <p className="font-black" style={{ color: '#4ade80' }}>Subscription confirmed!</p>
          <p className="text-xs mt-1" style={{ color: 'rgba(255,248,220,0.4)' }}>
            Thank you for your ongoing support.
          </p>
        </motion.div>
      )}

      <button onClick={onClose}
        className="w-full mt-5 py-3 rounded-2xl font-black text-sm"
        style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,248,220,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
        ← Back to Donate
      </button>
    </motion.div>
  )
}


function MonthlyGivingFlow({
  defaultAmount,
  branchId,
  onClose,
}: {
  defaultAmount: number
  branchId: string
  onClose: () => void
}) {
  const [step, setStep]             = useState<MonthlyStep>(0)
  const [amount, setAmount]         = useState(defaultAmount || 11)
  const [firstName, setFirstName]   = useState('')
  const [surname, setSurname]       = useState('')
  const [houseNum, setHouseNum]     = useState('')
  const [postcode, setPostcode]     = useState('')
  const [email, setEmail]           = useState('')
  const [giftAid, setGiftAid]       = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult]         = useState<MonthlyResult | null>(null)

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/kiosk/quick-donation/monthly-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim(), surname: surname.trim(),
          house_number: houseNum.trim(), postcode: postcode.trim(),
          email: email.trim(), amount, gift_aid: giftAid, branch_id: branchId,
        }),
      })
      const data = await res.json()
      setResult({ approval_url: data.approval_url, plan_id: data.plan_id, paypal_client_id: data.paypal_client_id, name: data.name, amount })
      setStep('done')
    } catch {
      setResult({ name: `${firstName} ${surname}`, amount })
      setStep('done')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls = "w-full px-4 py-3.5 rounded-2xl text-base font-semibold outline-none"
  const inputStyle = {
    background: 'rgba(255,255,255,0.07)', color: '#fff',
    border: '1.5px solid rgba(212,175,55,0.3)', caretColor: '#D4AF37',
  }
  const labelCls = "block text-xs font-black uppercase tracking-widest mb-2"
  const labelStyle = { color: 'rgba(212,175,55,0.7)' }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-30 flex flex-col"
      style={{ background: 'linear-gradient(160deg,#0d0500 0%,#1a0a00 60%,#0d0500 100%)' }}
    >
      {/* OM header */}
      <div className="text-center pt-6 pb-2 flex-shrink-0">
        <div className="text-3xl mb-1" style={{ color: '#D4AF37' }}>ॐ</div>
        <h1 className="text-xl font-black tracking-widest" style={{ color: '#D4AF37', fontVariant: 'small-caps' }}>
          Monthly Temple Support
        </h1>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(212,175,55,0.5)' }}>
          Join our family of regular supporters. Cancel anytime.
        </p>
      </div>

      {/* Step indicator */}
      {step !== 'done' && (
        <div className="flex justify-center gap-2 py-3 flex-shrink-0">
          {([0,1,2,3] as const).map(s => (
            <div key={s} className="w-2 h-2 rounded-full transition-all"
              style={{ background: step === s ? '#D4AF37' : 'rgba(212,175,55,0.2)', transform: step === s ? 'scale(1.3)' : 'scale(1)' }} />
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <AnimatePresence mode="wait">

          {/* Screen 0 — Amount picker */}
          {step === 0 && (
            <motion.div key="s0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
              <p className="text-[10px] font-black uppercase tracking-widest text-center mb-4"
                style={{ color: 'rgba(212,175,55,0.5)' }}>Choose your monthly amount</p>
              <div className="grid grid-cols-2 gap-3">
                {MONTHLY_TIERS.map(t => (
                  <button key={t.amount} onClick={() => setAmount(t.amount)}
                    className="relative text-left p-4 rounded-2xl transition-all active:scale-95"
                    style={{
                      background: amount === t.amount ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.04)',
                      border: `1.5px solid ${amount === t.amount ? 'rgba(212,175,55,0.6)' : 'rgba(255,255,255,0.1)'}`,
                      boxShadow: amount === t.amount ? '0 0 20px rgba(212,175,55,0.15)' : 'none',
                    }}>
                    {t.popular && (
                      <span className="absolute top-2 right-2 text-[9px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: '#D4AF37', color: '#1a0000' }}>POPULAR</span>
                    )}
                    <p className="text-2xl font-black" style={{ color: amount === t.amount ? '#D4AF37' : '#fff' }}>
                      £{t.amount}
                    </p>
                    <p className="text-xs font-bold mt-0.5" style={{ color: amount === t.amount ? '#D4AF37' : 'rgba(255,255,255,0.6)' }}>
                      {t.title}
                    </p>
                    <p className="text-[10px] mt-1 leading-tight" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      {t.desc}
                    </p>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Screen 1 — Name */}
          {step === 1 && (
            <motion.div key="s1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-4 pt-2">
              <div>
                <label className={labelCls} style={labelStyle}>First Name *</label>
                <input className={inputCls} style={inputStyle} placeholder="First name"
                  value={firstName} onChange={e => setFirstName(e.target.value)} autoFocus />
              </div>
              <div>
                <label className={labelCls} style={labelStyle}>Surname *</label>
                <input className={inputCls} style={inputStyle} placeholder="Surname"
                  value={surname} onChange={e => setSurname(e.target.value)} />
              </div>
            </motion.div>
          )}

          {/* Screen 2 — Address */}
          {step === 2 && (
            <motion.div key="s2" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-4 pt-2">
              <div>
                <label className={labelCls} style={labelStyle}>House Number</label>
                <input className={inputCls} style={inputStyle} placeholder="House number"
                  value={houseNum} onChange={e => setHouseNum(e.target.value)} autoFocus />
              </div>
              <div>
                <label className={labelCls} style={labelStyle}>Postcode</label>
                <input className={inputCls} style={inputStyle} placeholder="e.g. HP7 9NQ"
                  value={postcode} onChange={e => setPostcode(e.target.value.toUpperCase())} />
              </div>
            </motion.div>
          )}

          {/* Screen 3 — Email + Gift Aid */}
          {step === 3 && (
            <motion.div key="s3" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-4 pt-2">
              <div>
                <label className={labelCls} style={labelStyle}>Email *</label>
                <input className={inputCls} style={inputStyle} placeholder="your@email.com"
                  type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
              </div>
              <button onClick={() => setGiftAid(v => !v)}
                className="w-full flex items-start gap-3 p-4 rounded-2xl text-left transition-all"
                style={{
                  background: giftAid ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `1.5px solid ${giftAid ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.1)'}`,
                }}>
                <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: giftAid ? '#22c55e' : 'rgba(255,255,255,0.1)', border: giftAid ? 'none' : '2px solid rgba(255,255,255,0.25)' }}>
                  {giftAid && <span className="text-white text-xs font-black">✓</span>}
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: giftAid ? '#4ade80' : 'rgba(255,255,255,0.7)' }}>
                    Gift Aid declaration
                  </p>
                  <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    I am a UK taxpayer. HMRC will add 25p to every £1 I donate at no cost to me.
                  </p>
                </div>
              </button>
            </motion.div>
          )}

          {/* Done — two options: QR or pay on screen */}
          {step === 'done' && result && (
            <DoneOptions
              result={result}
              firstName={firstName} surname={surname}
              email={email} houseNum={houseNum} postcode={postcode}
              branchId={branchId}
              onClose={onClose}
            />
          )}

        </AnimatePresence>
      </div>

      {/* Nav buttons */}
      {step !== 'done' && (
        <div className="flex gap-3 px-5 pb-6 pt-3 flex-shrink-0"
          style={{ borderTop: '1px solid rgba(212,175,55,0.1)' }}>
          <button
            onClick={() => step === 0 ? onClose() : setStep((step - 1) as MonthlyStep)}
            className="flex-1 py-3.5 rounded-2xl font-black text-sm"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
            {step === 0 ? '← Back' : 'Back'}
          </button>
          <button
            onClick={() => {
              if (step === 0) setStep(1)
              else if (step === 1) { if (!firstName.trim() || !surname.trim()) return; setStep(2) }
              else if (step === 2) setStep(3)
              else if (step === 3) { if (!email.trim()) return; handleSubmit() }
            }}
            disabled={submitting || (step === 1 && (!firstName.trim() || !surname.trim())) || (step === 3 && !email.trim())}
            className="flex-[2] py-3.5 rounded-2xl font-black text-base disabled:opacity-40 transition-all active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#1a0000' }}>
            {submitting ? 'Setting up…' : step === 3 ? 'Complete →' : 'Next →'}
          </button>
        </div>
      )}

      {step === 0 && (
        <p className="text-center text-[10px] pb-4 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Secure recurring payment via PayPal · Cancel anytime
        </p>
      )}
    </motion.div>
  )
}

interface AmountTile {
  id: string
  price: number
  description?: string
  name?: string
}

const FALLBACK_TILES: AmountTile[] = [
  { id: 'f3',  price: 3,  name: 'Small Offering',  description: 'Provide prasad for a devotee' },
  { id: 'f5',  price: 5,  name: 'Daily Seva',      description: 'Support daily temple rituals' },
  { id: 'f8',  price: 8,  name: 'Lamp Offering',   description: 'Light a diya for your family' },
  { id: 'f11', price: 11, name: 'Food Donation',   description: 'Help feed those in need' },
  { id: 'f15', price: 15, name: 'Weekly Seva',     description: 'Support a week of worship' },
  { id: 'f21', price: 21, name: 'Festival Seva',   description: 'Contribute to festivals' },
  { id: 'f25', price: 25, name: 'Blessing Seva',   description: 'Special blessing ceremony' },
]

const NUM_ROWS = [['7','8','9'],['4','5','6'],['1','2','3'],['.','0','⌫']]

function NumKey({ k, onPress }: { k: string; onPress: (k: string) => void }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.88 }}
      onPointerDown={() => onPress(k)}
      className="rounded-2xl font-black flex items-center justify-center select-none"
      style={{ background: k === '⌫' ? '#FEE2E2' : '#fff', color: k === '⌫' ? '#DC2626' : '#111', border: '2px solid #F3F4F6', height: 70, fontSize: 26, flex: 1 }}
    >
      {k}
    </motion.button>
  )
}

// Simple Gift Aid overlay — shown after tile tap when enableGiftAid is true
function GiftAidOverlay({
  amount,
  onYes,
  onNo,
}: {
  amount: number
  onYes: () => void
  onNo: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 flex flex-col items-center justify-end z-20"
      style={{ background: 'rgba(0,0,0,0.72)' }}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        className="w-full rounded-t-3xl p-6 space-y-4"
        style={{ background: 'linear-gradient(160deg,#0d2a0a,#122a10)', border: '1px solid rgba(74,222,128,0.25)' }}
      >
        <div className="text-center">
          <p className="text-2xl mb-1">🇬🇧</p>
          <h2 className="font-black text-xl" style={{ color: '#4ade80' }}>Are you a UK taxpayer?</h2>
          <p className="text-sm mt-1" style={{ color: 'rgba(74,222,128,0.75)' }}>
            HMRC will add <strong style={{ color: '#4ade80' }}>£{(amount * 0.25).toFixed(2)}</strong> to your £{amount.toFixed(2)} donation — <strong>completely free</strong>.
          </p>
          <p className="text-xs mt-1" style={{ color: 'rgba(255,248,220,0.4)' }}>
            ✓ No extra payment &nbsp;·&nbsp; ✓ Takes 30 seconds &nbsp;·&nbsp; ✓ HMRC approved
          </p>
        </div>

        <div className="flex gap-3">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onYes}
            className="flex-1 py-4 rounded-2xl font-black text-base"
            style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', color: '#fff',
              boxShadow: '0 6px 20px rgba(22,163,74,0.4)' }}
          >
            Yes — Claim Gift Aid
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onNo}
            className="flex-[0.55] py-4 rounded-2xl font-bold text-sm"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.45)',
              border: '1px solid rgba(255,255,255,0.1)' }}
          >
            No thanks
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// Inline Gift Aid form — collect name + postcode
function GiftAidForm({
  amount,
  onSubmit,
  onSkip,
}: {
  amount: number
  onSubmit: (firstName: string, surname: string, postcode: string) => void
  onSkip: () => void
}) {
  const [firstName, setFirstName] = useState('')
  const [surname, setSurname]     = useState('')
  const [postcode, setPostcode]   = useState('')
  const valid = firstName.trim().length > 0 && surname.trim().length > 0 && postcode.trim().length >= 5

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      className="absolute inset-0 flex flex-col justify-end z-30"
      style={{ background: 'rgba(0,0,0,0.8)' }}
    >
      <div className="w-full rounded-t-3xl p-6 space-y-4"
        style={{ background: 'linear-gradient(160deg,#0d2a0a,#122a10)', border: '1px solid rgba(74,222,128,0.25)' }}>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: 'rgba(74,222,128,0.6)' }}>Gift Aid Declaration</p>
          <p className="text-sm font-bold" style={{ color: '#4ade80' }}>
            Temple will receive £{(amount * 1.25).toFixed(2)} (+£{(amount * 0.25).toFixed(2)} free)
          </p>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,248,220,0.45)' }}>First Name</label>
            <input
              value={firstName} onChange={e => setFirstName(e.target.value)}
              placeholder="First name"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,248,220,0.45)' }}>Surname</label>
            <input
              value={surname} onChange={e => setSurname(e.target.value)}
              placeholder="Surname"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,248,220,0.45)' }}>UK Postcode</label>
          <input
            value={postcode} onChange={e => setPostcode(e.target.value.toUpperCase())}
            placeholder="e.g. HA9 0BB"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none uppercase"
            style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          />
          <p className="text-xs mt-1" style={{ color: 'rgba(255,248,220,0.3)' }}>
            I confirm I am a UK taxpayer and understand that Gift Aid will be reclaimed on this donation.
          </p>
        </div>

        <div className="flex gap-3">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onSubmit(firstName.trim(), surname.trim(), postcode.trim())}
            disabled={!valid}
            className="flex-1 py-4 rounded-2xl font-black text-base disabled:opacity-40"
            style={{ background: valid ? 'linear-gradient(135deg,#16a34a,#15803d)' : 'rgba(255,255,255,0.06)', color: '#fff' }}
          >
            Confirm Gift Aid
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onSkip}
            className="flex-[0.55] py-4 rounded-2xl font-bold text-sm"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.4)',
              border: '1px solid rgba(255,255,255,0.1)' }}
          >
            Skip
          </motion.button>
        </div>
      </div>
    </motion.div>
  )
}

export function DonationScreen() {
  const { setScreen, setAmount, branchId, showMonthlyGiving, enableGiftAid, donateTitle, monthlyGivingText, monthlyGivingAmount } = useDonationStore()

  const [tiles, setTiles]         = useState<AmountTile[]>([])
  const [loading, setLoading]     = useState(true)
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherVal, setOtherVal]   = useState('')

  // Hidden staff access: tap top-right corner 5× within 3 s → admin screen
  const cornerTaps = React.useRef(0)
  const cornerTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleCornerTap = () => {
    cornerTaps.current += 1
    if (cornerTimer.current) clearTimeout(cornerTimer.current)
    if (cornerTaps.current >= 3) {
      cornerTaps.current = 0
      setScreen('admin')
      return
    }
    cornerTimer.current = setTimeout(() => { cornerTaps.current = 0 }, 3000)
  }

  // Monthly giving flow
  const [monthlyOpen, setMonthlyOpen] = useState(false)

  // Gift Aid overlay state
  const [pendingAmount, setPendingAmount]     = useState<number | null>(null)
  const [giftAidStep, setGiftAidStep]         = useState<'none' | 'ask' | 'form'>('none')
  const [giftAidInfo, setGiftAidInfo]         = useState<{ firstName: string; surname: string; postcode: string } | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const branch = branchId || 'main'
        const res  = await fetch(`${API_BASE}/items/?category=QUICK_DONATION&branch_id=${branch}`)
        const data = await res.json()
        const items: AmountTile[] = (data.items || [])
          .filter((i: { is_active?: boolean }) => i.is_active !== false)
          .map((i: { id: string; price: number; name?: string; description?: string }) => ({
            id: i.id, price: i.price, name: i.name, description: i.description,
          }))
        setTiles(items.length ? items : FALLBACK_TILES)
      } catch {
        setTiles(FALLBACK_TILES)
      }
      setLoading(false)
    }
    load()
  }, [branchId])

  const handleKey = (k: string) => {
    if (k === '⌫') { setOtherVal(v => v.slice(0, -1)); return }
    if (k === '.' && otherVal.includes('.')) return
    if (k === '.' && !otherVal) { setOtherVal('0.'); return }
    const next = otherVal + k
    if (parseFloat(next) > 9999) return
    const parts = next.split('.')
    if (parts[1] && parts[1].length > 2) return
    setOtherVal(next)
  }

  const proceedToPayment = (amount: number, gaInfo?: { firstName: string; surname: string; postcode: string } | null) => {
    setAmount(amount)
    // TODO: pass gaInfo to checkout if needed
    void gaInfo
    setGiftAidStep('none')
    setPendingAmount(null)
    setGiftAidInfo(null)
    setScreen('processing')
  }

  const handleTileTap = (price: number) => {
    if (enableGiftAid) {
      setPendingAmount(price)
      setGiftAidStep('ask')
    } else {
      setAmount(price)
      setScreen('processing')
    }
  }

  const handleOtherConfirm = () => {
    const amt = parseFloat(otherVal)
    if (!amt || amt <= 0) return
    if (enableGiftAid) {
      setPendingAmount(amt)
      setGiftAidStep('ask')
      setOtherOpen(false)
      setOtherVal('')
    } else {
      setAmount(amt)
      setScreen('processing')
    }
  }

  const otherAmount = parseFloat(otherVal) || 0

  return (
    <div className="w-full h-full flex flex-col bg-temple-gradient relative">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-3 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-black text-gold-gradient">{donateTitle || 'Tap & Donate'}</h1>
          <p className="text-saffron-400/60 text-base mt-0.5">Tap an amount to donate</p>
        </div>
        <div className="flex items-center gap-2">
          {enableGiftAid && (
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl glass-card">
              <span className="text-green-400 font-black text-sm">✓</span>
              <span className="text-white/70 font-bold text-xs">Gift Aid</span>
            </div>
          )}
          {/* Hidden staff access zone — tap 5× to open admin */}
          <div
            onPointerDown={handleCornerTap}
            className="w-10 h-10 rounded-xl select-none"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          />
        </div>
      </div>

      {/* ── Monthly Giving banner (admin-configured) ────────────────────────── */}
      {showMonthlyGiving && (
        <div className="mx-5 mb-3 flex-shrink-0">
          <motion.button whileTap={{ scale: 0.98 }} onClick={() => setMonthlyOpen(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left"
            style={{ background: 'linear-gradient(135deg,rgba(22,163,74,0.18),rgba(15,107,50,0.12))',
              border: '1px solid rgba(74,222,128,0.3)' }}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(74,222,128,0.15)' }}>
              <span className="text-lg">💚</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'rgba(74,222,128,0.7)' }}>Monthly Giving</p>
              <p className="text-sm font-black leading-snug" style={{ color: '#4ade80' }}>{monthlyGivingText || `Make a big impact from just £${monthlyGivingAmount}/month`}</p>
              <p className="text-[10px]" style={{ color: 'rgba(74,222,128,0.55)' }}>Regular giving · Cancel anytime · Secure PayPal</p>
            </div>
            <span className="text-green-400/60 text-lg flex-shrink-0">›</span>
          </motion.button>
        </div>
      )}

      {/* ── Amount grid ─────────────────────────────────────────────────────── */}
      <div className="flex-1 px-5 pb-5 overflow-hidden">
        {loading ? (
          <div className="grid grid-cols-3 gap-3 h-full">
            {[1,2,3,4,5,6].map(i => (
              <div key={i} className="rounded-3xl animate-pulse" style={{ background: 'rgba(255,255,255,0.07)' }} />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 h-full" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: '1fr' }}>
            {tiles.map(tile => (
              <motion.button
                key={tile.id}
                whileTap={{ scale: 0.92 }}
                onClick={() => handleTileTap(tile.price)}
                className="rounded-3xl flex flex-col items-center justify-center font-black transition-all active:brightness-110 px-3 py-3 text-center"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1.5px solid rgba(255,255,255,0.12)',
                  color: '#fff',
                }}
              >
                <div className="flex items-baseline gap-0.5 leading-none">
                  <span className="text-white/50 text-base font-semibold">£</span>
                  <span style={{ fontSize: tile.price >= 100 ? 32 : 38 }}>
                    {tile.price % 1 === 0 ? tile.price : tile.price.toFixed(2)}
                  </span>
                </div>
                {tile.name && (
                  <span className="text-white/75 text-[11px] font-bold mt-1.5 leading-tight line-clamp-1">
                    {tile.name}
                  </span>
                )}
                {tile.description && (
                  <span className="text-white/40 text-[10px] font-medium mt-0.5 leading-tight line-clamp-2 px-1">
                    {tile.description}
                  </span>
                )}
                {enableGiftAid && (
                  <span className="text-green-400/60 text-[10px] font-semibold mt-1.5">
                    +GA £{(tile.price * 0.25).toFixed(2)}
                  </span>
                )}
              </motion.button>
            ))}

            {/* "Other" — double-width */}
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={() => { setOtherOpen(true); setOtherVal('') }}
              className="rounded-3xl flex flex-col items-center justify-center font-black col-span-2 transition-all"
              style={{
                background: otherOpen ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
                border: otherOpen ? '2px solid rgba(255,255,255,0.30)' : '1.5px solid rgba(255,255,255,0.10)',
                color: '#fff',
              }}
            >
              <span className="text-2xl mb-1">✏️</span>
              <span className="text-xl">Other</span>
            </motion.button>
          </div>
        )}
      </div>

      {/* ── Numeric keypad (Other) ───────────────────────────────────────────── */}
      <AnimatePresence>
        {otherOpen && (
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 350 }}
            className="flex-shrink-0 px-5 pb-4"
            style={{ background: '#1a0800', borderTop: '2px solid rgba(255,153,51,0.3)' }}
          >
            <div className="flex items-center justify-between py-3 mb-2">
              <span className="text-white/50 text-sm font-semibold">Enter custom amount</span>
              <div className="text-3xl font-black text-gold-gradient">£{otherVal || '0'}</div>
            </div>
            <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
              {NUM_ROWS.map((row, ri) => (
                <React.Fragment key={ri}>
                  {row.map(k => <NumKey key={k} k={k} onPress={handleKey} />)}
                </React.Fragment>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => { setOtherOpen(false); setOtherVal('') }}
                className="flex-1 py-3 rounded-2xl text-white/50 font-bold text-sm"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                Cancel
              </button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleOtherConfirm}
                disabled={otherAmount <= 0}
                className="flex-[2] py-3 rounded-2xl font-black text-base text-white disabled:opacity-30"
                style={{
                  background: otherAmount > 0 ? 'linear-gradient(135deg,#FF9933,#FF6B00)' : 'rgba(255,255,255,0.08)',
                  boxShadow: otherAmount > 0 ? '0 6px 20px rgba(255,153,51,0.45)' : 'none',
                }}
              >
                {otherAmount > 0 ? `Donate £${otherAmount.toFixed(2)}` : 'Enter amount'}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Gift Aid overlays ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {giftAidStep === 'ask' && pendingAmount !== null && (
          <GiftAidOverlay
            amount={pendingAmount}
            onYes={() => setGiftAidStep('form')}
            onNo={() => proceedToPayment(pendingAmount, null)}
          />
        )}
        {giftAidStep === 'form' && pendingAmount !== null && (
          <GiftAidForm
            amount={pendingAmount}
            onSubmit={(fn, sn, pc) => {
              setGiftAidInfo({ firstName: fn, surname: sn, postcode: pc })
              proceedToPayment(pendingAmount, { firstName: fn, surname: sn, postcode: pc })
            }}
            onSkip={() => proceedToPayment(pendingAmount, null)}
          />
        )}
      </AnimatePresence>

      {/* suppress unused warning */}
      {giftAidInfo && null}

      {/* ── Monthly Giving flow ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {monthlyOpen && (
          <MonthlyGivingFlow
            defaultAmount={monthlyGivingAmount || 11}
            branchId={branchId}
            onClose={() => setMonthlyOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
