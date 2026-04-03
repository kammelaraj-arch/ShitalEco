import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'

// ─── Postcode lookup (mock + real) ───────────────────────────────────────────
const MOCK_ADDRESSES: Record<string, string[]> = {
  'HA9': [
    '1 Empire Way, Wembley, Middlesex, HA9 0EW',
    '15 Olympic Way, Wembley, HA9 0NP',
    '42 Wembley Park Drive, Wembley, HA9 8HB',
    '7 Brook Avenue, Wembley, HA9 8PW',
  ],
  'HA0': [
    '23 High Road, Wembley, HA0 2AB',
    '101 Harrow Road, Wembley, HA0 1HR',
    '5 Ealing Road, Wembley, HA0 4LP',
  ],
  DEFAULT: [
    '1 High Street, London',
    '2 Church Lane, London',
    '45 Green Road, London',
    '12 Victoria Avenue, London',
  ],
}

// getAddress.io domain token — authorized for shital-kiosk.vercel.app
const GETADDRESS_TOKEN = 'dtoken_hEDzcyiWMr1qCTSk0cxR1UiFKYfoDY3s3jc_aRAgJJVRVewqW--9F41eyhADhPZyqh-3OOe5ZYGHNFnjs4KY_iVR5xK-A2gNuc0ZtCh7-SsYFN8AOt_vA0vsvz8x4TIJyq2f8fAByc6oAs5CE3Sp6vsCjrSOJT7FQoFJmCVQZ_I8uG3viS1QgAAqS9-N2Maf10ujT9HiQxfrUXm_iqXInw'

async function lookupPostcode(postcode: string): Promise<string[]> {
  const clean = postcode.trim().toUpperCase()
  try {
    const res = await fetch(
      `https://api.getaddress.io/find/${encodeURIComponent(clean)}?api-key=${GETADDRESS_TOKEN}&expand=true`,
      { signal: AbortSignal.timeout(10000) }
    )
    if (res.ok) {
      const data = await res.json()
      if (data.addresses?.length) {
        return data.addresses.map((a: any) =>
          typeof a === 'string' ? a : [a.line_1, a.line_2, a.town_or_city, a.county, a.postcode].filter(Boolean).join(', ')
        )
      }
    }
  } catch {}
  const prefix = clean.slice(0, 3)
  return MOCK_ADDRESSES[prefix] ?? MOCK_ADDRESSES.DEFAULT
}

// ─── Main GiftAidScreen ───────────────────────────────────────────────────────
export function GiftAidScreen() {
  const {
    items, setScreen, setGiftAidDeclaration, setPendingPayment, language, theme,
  } = useKioskStore()
  const th = THEMES[theme]

  const eligibleTotal = items
    .filter(i => i.giftAidEligible)
    .reduce((s, i) => s + i.totalPrice, 0)
  const hmrcAdd = eligibleTotal * 0.25
  const totalWithGA = eligibleTotal + hmrcAdd

  const [step, setStep] = useState<'choice' | 'form' | 'no-form'>('choice')

  // Form state
  const [fullName, setFullName] = useState('')
  const [postcode, setPostcode] = useState('')
  const [addressList, setAddressList] = useState<string[]>([])
  const [address, setAddress] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [contactMode, setContactMode] = useState<'email' | 'phone'>('email')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [declaration, setDeclaration] = useState(false)

  // No-form (just contact)
  const [noFormMode, setNoFormMode] = useState<'email' | 'phone'>('email')
  const [noFormEmail, setNoFormEmail] = useState('')
  const [noFormPhone, setNoFormPhone] = useState('')

  const handleLookup = async () => {
    setLookingUp(true)
    try {
      const addrs = await lookupPostcode(postcode)
      setAddressList(addrs)
    } finally {
      setLookingUp(false)
    }
  }

  const handleConfirm = () => {
    setGiftAidDeclaration({
      agreed: true,
      fullName,
      postcode,
      address,
      contactEmail: contactMode === 'email' ? email : '',
      contactPhone: contactMode === 'phone' ? phone : '',
    })
    setPendingPayment(true)
    setScreen('checkout')
  }

  const handleNoThanks = () => {
    setGiftAidDeclaration({ agreed: false, fullName: '', postcode: '', address: '', contactEmail: '', contactPhone: '' })
    setPendingPayment(true)
    setScreen('checkout')
  }

  const handleNoFormContinue = () => {
    setGiftAidDeclaration({
      agreed: false,
      fullName: '',
      postcode: '',
      address: '',
      contactEmail: noFormMode === 'email' ? noFormEmail : '',
      contactPhone: noFormMode === 'phone' ? noFormPhone : '',
    })
    setPendingPayment(true)
    setScreen('checkout')
  }

  const formValid = fullName.trim().length > 1 && address.trim().length > 3 && declaration && (email.trim() || phone.trim())

  return (
    <div className="w-full h-full flex flex-col" style={{ fontFamily: 'Inter, system-ui, sans-serif', background: th.mainBg }}>

      {/* Header */}
      <header
        className="flex items-center h-16 px-4 gap-3 flex-shrink-0 z-20"
        style={{ background: th.headerBg, borderBottom: `2px solid rgba(255,153,51,0.25)`, boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}
      >
        <button
          onClick={() => setScreen('basket')}
          className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg active:scale-95"
          style={{ background: `${th.langActive}20`, color: th.headerText }}
        >←</button>
        <div className="flex-1">
          <h1 className="font-black text-base leading-tight" style={{ color: th.headerText }}>
            {language === 'gu' ? 'ગિફ્ટ એઇડ' : language === 'hi' ? 'गिफ्ट एड' : 'Boost Your Donation with Gift Aid'}
          </h1>
          <p className="text-xs" style={{ color: th.headerSub }}>UK Government adds 25% at no cost to you</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4" style={{ scrollbarWidth: 'none' }}>

        {/* Calculation box */}
        <div className="rounded-2xl border-2 p-4 mb-5 shadow-sm" style={{ background: '#FFFBEB', borderColor: '#FDE68A' }}>
          <h2 className="font-black text-base text-amber-900 mb-3">🧮 Gift Aid Calculation</h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Your Gift Aid eligible items:</span>
              <span className="font-bold text-gray-900">£{eligibleTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">HMRC will add (25%):</span>
              <span className="font-black text-green-700">+ £{hmrcAdd.toFixed(2)}</span>
            </div>
            <div className="h-px bg-amber-200 my-1" />
            <div className="flex justify-between">
              <span className="font-black text-amber-900">Total charity receives:</span>
              <span className="font-black text-xl text-green-700">£{totalWithGA.toFixed(2)}</span>
            </div>
          </div>
          <p className="text-xs text-amber-700 mt-3">
            ✨ The government adds <strong>£{hmrcAdd.toFixed(2)}</strong> extra — at no extra cost to you!
          </p>
        </div>

        <AnimatePresence mode="wait">

          {/* ── STEP: Choice ── */}
          {step === 'choice' && (
            <motion.div key="choice" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <p className="text-center text-gray-500 text-sm mb-5">Are you a UK taxpayer? If yes, you can boost your donation by 25% for free.</p>

              <button
                onClick={() => setStep('form')}
                className="w-full py-5 rounded-2xl text-white font-black text-xl mb-3 transition-all active:scale-[0.98] shadow-lg"
                style={{ background: `linear-gradient(135deg,#FF9933,#FF6600)`, boxShadow: '0 8px 24px #FF993350' }}
              >
                🙏 Yes — Add Gift Aid
                <p className="text-sm font-medium mt-0.5 opacity-90">Charity receives £{totalWithGA.toFixed(2)}</p>
              </button>

              <button
                onClick={() => setStep('no-form')}
                className="w-full py-4 rounded-2xl font-bold text-base transition-all active:scale-[0.98]"
                style={{ background: '#F3F4F6', color: '#6B7280' }}
              >
                No thanks, continue without Gift Aid
              </button>
            </motion.div>
          )}

          {/* ── STEP: Gift Aid Form ── */}
          {step === 'form' && (
            <motion.div key="form" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">

              {/* Full Name */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Full Name *</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="e.g. Ramesh Patel"
                  className="w-full px-4 py-3.5 rounded-2xl border-2 text-base font-medium outline-none transition-all"
                  style={{
                    borderColor: fullName.length > 1 ? '#22C55E' : '#E5E7EB',
                    background: '#fff',
                  }}
                />
              </div>

              {/* Postcode lookup */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Postcode *</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={postcode}
                    onChange={e => setPostcode(e.target.value.toUpperCase())}
                    placeholder="e.g. HA9 0EW"
                    className="flex-1 px-4 py-3.5 rounded-2xl border-2 text-base font-medium outline-none uppercase"
                    style={{ borderColor: postcode.length > 2 ? '#22C55E' : '#E5E7EB', background: '#fff' }}
                  />
                  <button
                    onClick={handleLookup}
                    disabled={postcode.trim().length < 3 || lookingUp}
                    className="px-4 py-3.5 rounded-2xl font-bold text-sm text-white transition-all active:scale-95 disabled:opacity-50"
                    style={{ background: th.basketBtn, minWidth: 110 }}
                  >
                    {lookingUp ? '...' : 'Find Address'}
                  </button>
                </div>

                {/* Address dropdown */}
                {addressList.length > 0 && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-2 rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-md">
                    {addressList.map((a, i) => (
                      <button
                        key={i}
                        onClick={() => { setAddress(a); setAddressList([]) }}
                        className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 border-b last:border-0 transition-colors"
                        style={{ borderColor: '#F3F4F6' }}
                      >
                        {a}
                      </button>
                    ))}
                  </motion.div>
                )}
              </div>

              {/* Selected / manual address */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Address *</label>
                <textarea
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="Select from above or type your address"
                  rows={3}
                  className="w-full px-4 py-3 rounded-2xl border-2 text-sm font-medium outline-none resize-none transition-all"
                  style={{ borderColor: address.length > 3 ? '#22C55E' : '#E5E7EB', background: '#fff' }}
                />
              </div>

              {/* Contact — email or phone toggle */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Contact *</label>
                <div className="flex gap-2 mb-2">
                  {(['email', 'phone'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setContactMode(mode)}
                      className="flex-1 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95"
                      style={{
                        background: contactMode === mode ? th.langActive : '#F3F4F6',
                        color: contactMode === mode ? '#fff' : '#6B7280',
                      }}
                    >
                      {mode === 'email' ? '📧 Email' : '📱 Phone'}
                    </button>
                  ))}
                </div>
                {contactMode === 'email' ? (
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full px-4 py-3.5 rounded-2xl border-2 text-base font-medium outline-none"
                    style={{ borderColor: email.includes('@') ? '#22C55E' : '#E5E7EB', background: '#fff' }}
                  />
                ) : (
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="07xxx xxxxxx"
                    className="w-full px-4 py-3.5 rounded-2xl border-2 text-base font-medium outline-none"
                    style={{ borderColor: phone.length > 7 ? '#22C55E' : '#E5E7EB', background: '#fff' }}
                  />
                )}
              </div>

              {/* Declaration */}
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                <p className="text-xs text-blue-800 mb-3 leading-relaxed">
                  <strong>Gift Aid Declaration:</strong> I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital Gains Tax in the current tax year than the amount of Gift Aid claimed on all my donations it is my responsibility to pay any difference.
                </p>
                <button
                  onClick={() => setDeclaration(!declaration)}
                  className="flex items-center gap-3 text-sm font-bold transition-all active:scale-95"
                  style={{ color: declaration ? '#166534' : '#374151' }}
                >
                  <div
                    className="w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all"
                    style={{ borderColor: declaration ? '#22C55E' : '#9CA3AF', background: declaration ? '#22C55E' : '#fff' }}
                  >
                    {declaration && <span className="text-white text-xs font-black">✓</span>}
                  </div>
                  I confirm the above declaration
                </button>
              </div>

              {/* GDPR notice */}
              <p className="text-xs text-gray-400 text-center px-2">
                🔒 Your data will be used only for Gift Aid records as required by HMRC and will not be shared with third parties.
              </p>

              {/* Confirm button */}
              <button
                onClick={handleConfirm}
                disabled={!formValid}
                className="w-full py-4 rounded-2xl text-white font-black text-lg transition-all active:scale-[0.98] shadow-lg disabled:opacity-40"
                style={{ background: `linear-gradient(135deg,#22C55E,#16A34A)`, boxShadow: '0 6px 20px #22C55E40' }}
              >
                ✓ Confirm Gift Aid &amp; Continue →
              </button>

              <button
                onClick={() => setStep('choice')}
                className="w-full py-3 rounded-2xl font-medium text-sm text-gray-400 transition-all active:scale-95"
              >
                ← Go back
              </button>
            </motion.div>
          )}

          {/* ── STEP: No Gift Aid — just contact capture ── */}
          {step === 'no-form' && (
            <motion.div key="no-form" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
              <div className="rounded-2xl border border-gray-200 bg-white p-4 text-center">
                <p className="text-gray-600 text-sm mb-1">Please provide your contact details to receive your receipt:</p>
              </div>

              <div className="flex gap-2">
                {(['email', 'phone'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setNoFormMode(mode)}
                    className="flex-1 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95"
                    style={{
                      background: noFormMode === mode ? th.langActive : '#F3F4F6',
                      color: noFormMode === mode ? '#fff' : '#6B7280',
                    }}
                  >
                    {mode === 'email' ? '📧 Email' : '📱 Phone'}
                  </button>
                ))}
              </div>

              {noFormMode === 'email' ? (
                <input
                  type="email"
                  value={noFormEmail}
                  onChange={e => setNoFormEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-4 py-4 rounded-2xl border-2 text-base font-medium outline-none"
                  style={{ borderColor: noFormEmail.includes('@') ? '#22C55E' : '#E5E7EB', background: '#fff' }}
                />
              ) : (
                <input
                  type="tel"
                  value={noFormPhone}
                  onChange={e => setNoFormPhone(e.target.value)}
                  placeholder="07xxx xxxxxx"
                  className="w-full px-4 py-4 rounded-2xl border-2 text-base font-medium outline-none"
                  style={{ borderColor: noFormPhone.length > 7 ? '#22C55E' : '#E5E7EB', background: '#fff' }}
                />
              )}

              <button
                onClick={handleNoFormContinue}
                className="w-full py-4 rounded-2xl text-white font-black text-lg transition-all active:scale-[0.98] shadow-lg"
                style={{ background: `linear-gradient(135deg,${th.basketBtn},${th.basketBtnHover})`, boxShadow: `0 6px 20px ${th.basketBtn}40` }}
              >
                Continue to Payment →
              </button>

              <button
                onClick={() => setStep('choice')}
                className="w-full py-3 rounded-2xl font-medium text-sm text-gray-400 transition-all active:scale-95"
              >
                ← Go back
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}
