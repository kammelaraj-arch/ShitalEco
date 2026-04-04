import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'

// Categories where Name + (Phone or Email) are required unless anonymous
const REQUIRES_NAMED_CONTACT = new Set([
  'GRAINS', 'OIL_ESSENTIALS', 'PULSES', 'PUJA_ITEMS', 'PRASAD',
  'BOOKS', 'MURTIS', 'MALAS', 'PUJA_ACCESSORIES',
  'PROJECT_DONATION', 'SPONSORSHIP',
])

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

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

async function lookupPostcode(postcode: string): Promise<string[]> {
  const clean = postcode.trim().toUpperCase().replace(/\s+/g, ' ')
  try {
    // Use backend proxy — avoids CORS, uses server-side API key
    const res = await fetch(
      `${API_BASE}/kiosk/postcode/${encodeURIComponent(clean)}`,
      { signal: AbortSignal.timeout(10000) }
    )
    if (res.ok) {
      const data = await res.json()
      if (data.addresses?.length) return data.addresses
    }
  } catch {}
  // Fallback mock
  const prefix = clean.slice(0, 3)
  return MOCK_ADDRESSES[prefix] ?? MOCK_ADDRESSES.DEFAULT
}

// ─── Main GiftAidScreen ───────────────────────────────────────────────────────
export function GiftAidScreen() {
  const {
    items, setScreen, setGiftAidDeclaration, setContactInfo, setPendingPayment, language, theme, formTextConfig,
  } = useKioskStore()
  const th = THEMES[theme]
  const hasNamedDonations = items.some(i => REQUIRES_NAMED_CONTACT.has(i.category ?? ''))

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
  const [gaTerms,     setGaTerms]     = useState(false)

  // No-form — improved personal details capture
  const [noAnonymous, setNoAnonymous] = useState(false)
  const [noFormName,  setNoFormName]  = useState('')
  const [noFormEmail, setNoFormEmail] = useState('')
  const [noFormPhone, setNoFormPhone] = useState('')
  const [noFormGdpr,  setNoFormGdpr]  = useState(false)
  const [noFormTerms, setNoFormTerms] = useState(false)

  const noHasAnyData = !!(noFormName.trim() || noFormEmail.trim() || noFormPhone.trim())
  const noContactOk  = noFormEmail.includes('@') || noFormPhone.trim().length > 7
  const noFormValid  = noAnonymous
    ? true
    : hasNamedDonations
      ? noFormName.trim().length > 1 && noContactOk && (!noHasAnyData || (noFormGdpr && noFormTerms))
      : !noHasAnyData || (noFormGdpr && noFormTerms)

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
    const name  = noAnonymous ? '' : noFormName.trim()
    const email = noAnonymous ? '' : noFormEmail.trim()
    const phone = noAnonymous ? '' : noFormPhone.trim()
    setGiftAidDeclaration({ agreed: false, fullName: name, postcode: '', address: '', contactEmail: email, contactPhone: phone })
    setContactInfo({ name, email, phone, gdprConsent: noAnonymous ? false : noFormGdpr, termsConsent: noAnonymous ? false : noFormTerms, anonymous: noAnonymous })
    setPendingPayment(true)
    setScreen('checkout')
  }

  const formValid = fullName.trim().length > 1 && address.trim().length > 3 && declaration && gaTerms && (email.trim() || phone.trim())

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

              {/* Declaration — mandatory, starts un-ticked */}
              <button
                type="button"
                onClick={() => setDeclaration(!declaration)}
                className="w-full flex items-start gap-3 p-4 rounded-2xl border-2 text-left transition-all active:scale-[0.98]"
                style={{ borderColor: declaration ? '#22C55E' : '#EF4444', background: declaration ? '#F0FDF4' : '#FEF2F2' }}
              >
                <div
                  className="w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all"
                  style={{ borderColor: declaration ? '#22C55E' : '#EF4444', background: declaration ? '#22C55E' : '#fff' }}
                >
                  {declaration && <span className="text-white text-xs font-black">✓</span>}
                </div>
                <p className="text-xs leading-relaxed">
                  <span className={`font-black text-sm ${declaration ? '#166534' : 'text-red-700'}`}>Gift Aid Declaration *</span><br />
                  <span className="text-gray-700">I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital Gains Tax in the current tax year than the amount of Gift Aid claimed on all my donations it is my responsibility to pay any difference.</span>
                </p>
              </button>

              {/* T&C — mandatory, starts un-ticked */}
              <button
                type="button"
                onClick={() => setGaTerms(!gaTerms)}
                className="w-full flex items-start gap-3 p-4 rounded-2xl border-2 text-left transition-all active:scale-[0.98]"
                style={{ borderColor: gaTerms ? '#F59E0B' : '#EF4444', background: gaTerms ? '#FFFBEB' : '#FEF2F2' }}
              >
                <div
                  className="w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all"
                  style={{ borderColor: gaTerms ? '#F59E0B' : '#EF4444', background: gaTerms ? '#F59E0B' : '#fff' }}
                >
                  {gaTerms && <span className="text-white text-xs font-black">✓</span>}
                </div>
                <p className="text-xs leading-relaxed">
                  <span className={`font-black text-sm ${gaTerms ? 'text-amber-800' : 'text-red-700'}`}>Terms &amp; Conditions *</span><br />
                  <span className={gaTerms ? 'text-amber-700' : 'text-red-600'}>{formTextConfig.termsText}</span>
                </p>
              </button>

              {/* GDPR notice */}
              <p className="text-xs text-gray-400 text-center px-2">
                🔒 {formTextConfig.gdprText}
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

          {/* ── STEP: No Gift Aid — personal details ── */}
          {step === 'no-form' && (
            <motion.div key="no-form" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">

              {/* Heading */}
              <div className="rounded-2xl border border-gray-100 bg-white p-4">
                <p className="font-bold text-gray-800 text-sm">{formTextConfig.noFormHeading}</p>
                <p className="text-xs text-gray-400 mt-0.5">{formTextConfig.noFormSub}</p>
                {hasNamedDonations && (
                  <p className="text-xs font-bold text-amber-700 mt-2 bg-amber-50 px-2 py-1 rounded-lg">
                    ⚠️ Name and contact details are required for this type of donation.
                  </p>
                )}
              </div>

              {/* Details / Anonymous radio row */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNoAnonymous(false)}
                  className="flex-1 flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 text-left transition-all active:scale-[0.97]"
                  style={{ borderColor: !noAnonymous ? th.langActive : '#e5e7eb', background: !noAnonymous ? '#FFF7ED' : '#fff' }}
                >
                  <div className="w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all"
                    style={{ borderColor: !noAnonymous ? th.langActive : '#9CA3AF' }}>
                    {!noAnonymous && <div className="w-2.5 h-2.5 rounded-full" style={{ background: th.langActive }} />}
                  </div>
                  <div>
                    <p className="font-black text-sm" style={{ color: !noAnonymous ? '#C2410C' : '#374151' }}>Details</p>
                    <p className="text-[10px] text-gray-400">Name, email or phone</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => { setNoAnonymous(true); setNoFormName(''); setNoFormEmail(''); setNoFormPhone('') }}
                  className="flex-1 flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 text-left transition-all active:scale-[0.97]"
                  style={{ borderColor: noAnonymous ? '#6B7280' : '#e5e7eb', background: noAnonymous ? '#F9FAFB' : '#fff' }}
                >
                  <div className="w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all"
                    style={{ borderColor: noAnonymous ? '#6B7280' : '#9CA3AF' }}>
                    {noAnonymous && <div className="w-2.5 h-2.5 rounded-full bg-gray-500" />}
                  </div>
                  <div>
                    <p className="font-black text-sm" style={{ color: noAnonymous ? '#374151' : '#9CA3AF' }}>{formTextConfig.anonymousLabel}</p>
                    <p className="text-[10px] text-gray-400">No receipt sent</p>
                  </div>
                </button>
              </div>

              {/* Personal detail fields — hidden when anonymous */}
              <AnimatePresence>
                {!noAnonymous && (
                  <motion.div key="fields" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden space-y-3">

                    {/* Full Name */}
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                        {formTextConfig.nameLabel}&nbsp;
                        {hasNamedDonations
                          ? <span className="text-red-500">*</span>
                          : <span className="text-gray-300 font-normal normal-case">(optional)</span>
                        }
                      </label>
                      <input type="text" value={noFormName} onChange={e => setNoFormName(e.target.value)}
                        placeholder="e.g. Ramesh Patel"
                        className="w-full px-4 py-3.5 rounded-2xl border-2 text-base font-medium outline-none transition-all"
                        style={{ borderColor: noFormName.length > 1 ? '#22C55E' : '#E5E7EB', background: '#fff' }} />
                    </div>

                    {/* Email */}
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                        {formTextConfig.emailLabel}&nbsp;
                        {hasNamedDonations
                          ? <span className="text-gray-400 font-normal normal-case">(phone or email required)</span>
                          : <span className="text-gray-300 font-normal normal-case">(optional)</span>
                        }
                      </label>
                      <input type="email" value={noFormEmail} onChange={e => setNoFormEmail(e.target.value)}
                        placeholder="your@email.com"
                        className="w-full px-4 py-3.5 rounded-2xl border-2 text-base font-medium outline-none transition-all"
                        style={{ borderColor: noFormEmail.includes('@') ? '#22C55E' : '#E5E7EB', background: '#fff' }} />
                    </div>

                    {/* Phone */}
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                        {formTextConfig.phoneLabel}&nbsp;
                        {hasNamedDonations
                          ? <span className="text-gray-400 font-normal normal-case">(or email)</span>
                          : <span className="text-gray-300 font-normal normal-case">(optional)</span>
                        }
                      </label>
                      <input type="tel" value={noFormPhone} onChange={e => setNoFormPhone(e.target.value)}
                        placeholder="07xxx xxxxxx"
                        className="w-full px-4 py-3.5 rounded-2xl border-2 text-base font-medium outline-none transition-all"
                        style={{ borderColor: noFormPhone.trim().length > 7 ? '#22C55E' : '#E5E7EB', background: '#fff' }} />
                    </div>

                    {/* GDPR + T&C — only shown if any data entered */}
                    <AnimatePresence>
                      {noHasAnyData && (
                        <motion.div key="consents" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">

                          {/* GDPR */}
                          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                            <p className="text-xs font-bold text-blue-800 mb-1">🔒 {formTextConfig.gdprTitle}</p>
                            <p className="text-xs text-blue-700 leading-relaxed mb-3">{formTextConfig.gdprText}</p>
                            <button onClick={() => setNoFormGdpr(!noFormGdpr)}
                              className="flex items-center gap-3 text-sm font-bold transition-all active:scale-95"
                              style={{ color: noFormGdpr ? '#166534' : '#374151' }}>
                              <div className="w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all"
                                style={{ borderColor: noFormGdpr ? '#22C55E' : '#9CA3AF', background: noFormGdpr ? '#22C55E' : '#fff' }}>
                                {noFormGdpr && <span className="text-white text-xs font-black">✓</span>}
                              </div>
                              I understand and consent
                            </button>
                          </div>

                          {/* T&C */}
                          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                            <p className="text-xs font-bold text-amber-800 mb-1">📋 {formTextConfig.termsTitle}</p>
                            <p className="text-xs text-amber-700 leading-relaxed mb-3">{formTextConfig.termsText}</p>
                            <button onClick={() => setNoFormTerms(!noFormTerms)}
                              className="flex items-center gap-3 text-sm font-bold transition-all active:scale-95"
                              style={{ color: noFormTerms ? '#166534' : '#374151' }}>
                              <div className="w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all"
                                style={{ borderColor: noFormTerms ? '#22C55E' : '#9CA3AF', background: noFormTerms ? '#22C55E' : '#fff' }}>
                                {noFormTerms && <span className="text-white text-xs font-black">✓</span>}
                              </div>
                              I agree to the terms
                            </button>
                          </div>

                        </motion.div>
                      )}
                    </AnimatePresence>

                  </motion.div>
                )}
              </AnimatePresence>

              <button
                onClick={handleNoFormContinue}
                disabled={!noFormValid}
                className="w-full py-4 rounded-2xl text-white font-black text-lg transition-all active:scale-[0.98] shadow-lg disabled:opacity-40"
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
