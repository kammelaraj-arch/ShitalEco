import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, useTotal, useGiftAidTotal, t, type GiftAidDeclaration } from '../store'
import { api } from '../api'

const DECLINED: GiftAidDeclaration = { agreed: false, fullName: '', postcode: '', address: '', contactEmail: '', contactPhone: '' }

type Step = 'choice' | 'form' | 'no-form'

export function GiftAidPage() {
  const { language, setScreen, setGiftAidDeclaration, setContactInfo, contactInfo, giftAidDeclaration } = useStore()
  const total = useTotal()
  const giftAidTotal = useGiftAidTotal()

  const boost = giftAidTotal * 0.25
  const totalWithBoost = total + boost

  // Determine starting step from basket button pressed
  const initialStep: Step = giftAidDeclaration === null
    ? 'form'
    : (giftAidDeclaration && !giftAidDeclaration.agreed)
      ? 'no-form'
      : 'choice'

  const [step, setStep] = useState<Step>(initialStep)

  // Gift Aid form
  const [name,            setName]            = useState(contactInfo?.name  || '')
  const [postcode,        setPostcode]        = useState('')
  const [addresses,       setAddresses]       = useState<string[]>([])
  const [selectedAddress, setSelectedAddress] = useState('')
  const [lookingUp,       setLookingUp]       = useState(false)
  const [addressError,    setAddressError]    = useState('')
  const [email,           setEmail]           = useState(contactInfo?.email || '')
  const [phone,           setPhone]           = useState(contactInfo?.phone || '')
  const [agreed,          setAgreed]          = useState(false)
  const [gaTerms,         setGaTerms]         = useState(false)

  // No-form (without Gift Aid)
  const [anonymous, setAnonymous] = useState(false)
  const [noName,    setNoName]    = useState(contactInfo?.name  || '')
  const [noEmail,   setNoEmail]   = useState(contactInfo?.email || '')
  const [noPhone,   setNoPhone]   = useState(contactInfo?.phone || '')
  const [noGdpr,    setNoGdpr]    = useState(false)
  const [noTerms,   setNoTerms]   = useState(false)

  const [error, setError] = useState('')

  const noHasData    = !!(noName.trim() || noEmail.trim() || noPhone.trim())
  const formValid    = name.trim().length > 1 && selectedAddress.length > 3 && agreed && gaTerms && (email.trim() || phone.trim())
  const noFormValid  = anonymous || !noHasData || (noGdpr && noTerms)

  async function lookupPostcode() {
    setAddressError('')
    if (!postcode.trim()) return
    setLookingUp(true)
    const found = await api.lookupPostcode(postcode)
    setLookingUp(false)
    if (!found.length) setAddressError('No addresses found — check your postcode.')
    else setAddresses(found)
  }

  function confirmGiftAid() {
    setError('')
    if (!name.trim())          { setError('Please enter your full name'); return }
    if (!selectedAddress)      { setError('Please select your address');  return }
    if (!email.trim() && !phone.trim()) { setError('Please provide email or phone'); return }
    if (!agreed)               { setError('Please confirm the Gift Aid declaration'); return }
    if (!gaTerms)              { setError('Please accept the terms'); return }

    setGiftAidDeclaration({ agreed: true, fullName: name, postcode, address: selectedAddress, contactEmail: email, contactPhone: phone })
    setContactInfo({ name, email, phone, gdprConsent: true, termsConsent: true, anonymous: false })
    setScreen('payment')
  }

  function proceedWithout() {
    const n = anonymous ? '' : noName.trim()
    const e = anonymous ? '' : noEmail.trim()
    const p = anonymous ? '' : noPhone.trim()
    setGiftAidDeclaration(DECLINED)
    setContactInfo({ name: n, email: e, phone: p, gdprConsent: !anonymous && noGdpr, termsConsent: !anonymous && noTerms, anonymous })
    setScreen('payment')
  }

  const backTarget = step === 'choice' ? 'basket' : 'choice'

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-32">
      <button
        onClick={() => step === 'choice' ? setScreen('basket') : setStep('choice')}
        className="flex items-center gap-2 text-sm font-medium mb-5 transition-colors"
        style={{ color: 'rgba(255,248,220,0.4)' }}
      >
        ← {backTarget === 'basket' ? t('back', language) : 'Choose again'}
      </button>

      {/* Calculation box — always visible */}
      {giftAidTotal > 0 && (
        <div className="temple-card p-4 mb-5">
          <h2 className="font-black text-sm text-gold-400 mb-3">🧮 Gift Aid Calculation</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span style={{ color: 'rgba(255,248,220,0.5)' }}>Gift Aid eligible donations:</span>
              <span className="font-bold text-ivory-200 price-display">£{giftAidTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between" style={{ color: '#4ade80' }}>
              <span>HMRC adds (25%):</span>
              <span className="font-black price-display">+£{boost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-2" style={{ borderTop: '1px solid rgba(212,175,55,0.2)' }}>
              <span className="font-black text-ivory-200">Temple receives:</span>
              <span className="font-black text-xl text-gold-400 price-display">£{totalWithBoost.toFixed(2)}</span>
            </div>
          </div>
          <p className="text-xs mt-2" style={{ color: 'rgba(74,222,128,0.7)' }}>
            ✨ Government adds <strong>£{boost.toFixed(2)}</strong> — completely free to you
          </p>
        </div>
      )}

      <AnimatePresence mode="wait">

        {/* ── STEP: Choice ── */}
        {step === 'choice' && (
          <motion.div key="choice" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <h1 className="font-display font-bold text-xl text-gold-400 mb-1">Boost Your Donation</h1>
            <p className="text-sm mb-5" style={{ color: 'rgba(255,248,220,0.45)' }}>
              Are you a UK taxpayer? The government adds 25% on top — at no extra cost to you.
            </p>

            <button
              onClick={() => { setGiftAidDeclaration(null); setStep('form') }}
              className="w-full rounded-2xl font-black active:scale-[0.99] transition-transform mb-3"
              style={{
                background: 'linear-gradient(135deg,#16a34a,#15803d)',
                color: '#fff',
                boxShadow: '0 6px 24px rgba(22,163,74,0.45), 0 2px 8px rgba(0,0,0,0.3)',
                padding: '1.1rem 1.5rem',
              }}
            >
              <div className="flex flex-col items-center leading-tight gap-1">
                <span className="text-xs font-bold uppercase tracking-widest opacity-80">🇬🇧 Recommended · UK Taxpayers</span>
                <span className="text-lg font-black">Yes — Boost with Gift Aid</span>
                <span className="text-sm font-bold opacity-90">Temple gets £{totalWithBoost.toFixed(2)}</span>
              </div>
            </button>

            <button
              onClick={() => { setGiftAidDeclaration(DECLINED); setStep('no-form') }}
              className="w-full py-4 rounded-2xl font-bold text-sm transition-all"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,248,220,0.55)' }}
            >
              No thanks — donate £{total.toFixed(2)} without Gift Aid
            </button>
          </motion.div>
        )}

        {/* ── STEP: Gift Aid form ── */}
        {step === 'form' && (
          <motion.div key="form" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <h1 className="font-display font-bold text-xl text-gold-400 mb-0.5">Gift Aid Declaration</h1>
            <p className="text-xs mb-2" style={{ color: 'rgba(255,248,220,0.45)' }}>HMRC requires your details to claim the 25% top-up</p>

            {/* Full Name */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Full Name *</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="As it appears on your tax record" className="w-full px-4 py-3 rounded-xl text-sm" />
            </div>

            {/* Postcode */}
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

            {/* Email */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Email *</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="For Gift Aid confirmation & receipt" className="w-full px-4 py-3 rounded-xl text-sm" />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Phone (optional)</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="+44 7700 000 000" className="w-full px-4 py-3 rounded-xl text-sm" />
            </div>

            {/* Declarations */}
            <div className="space-y-3">
              <button type="button" onClick={() => setAgreed(!agreed)}
                className="w-full flex items-start gap-3 p-4 rounded-2xl border-2 text-left transition-all active:scale-[0.99]"
                style={{ borderColor: agreed ? '#22C55E' : '#EF4444', background: agreed ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.06)' }}>
                <div className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all"
                  style={{ borderColor: agreed ? '#22C55E' : '#EF4444', background: agreed ? '#22C55E' : 'transparent' }}>
                  {agreed && <span className="text-white text-xs font-black">✓</span>}
                </div>
                <p className="text-xs text-ivory-200 leading-relaxed">
                  <strong className="text-gold-400">Gift Aid Declaration *</strong><br />
                  I am a UK taxpayer and understand that if I pay less Income Tax or Capital Gains Tax than the amount of Gift Aid claimed on all my donations in that tax year, it is my responsibility to pay any difference.
                </p>
              </button>

              <button type="button" onClick={() => setGaTerms(!gaTerms)}
                className="w-full flex items-start gap-3 p-4 rounded-2xl border-2 text-left transition-all active:scale-[0.99]"
                style={{ borderColor: gaTerms ? '#D4AF37' : '#EF4444', background: gaTerms ? 'rgba(212,175,55,0.08)' : 'rgba(239,68,68,0.06)' }}>
                <div className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all"
                  style={{ borderColor: gaTerms ? '#D4AF37' : '#EF4444', background: gaTerms ? '#D4AF37' : 'transparent' }}>
                  {gaTerms && <span className="text-white text-xs font-black">✓</span>}
                </div>
                <p className="text-xs text-ivory-200 leading-relaxed">
                  <strong className="text-gold-400">Terms &amp; Conditions *</strong><br />
                  I agree to my data being held securely in accordance with UK GDPR for Gift Aid purposes.
                </p>
              </button>
            </div>

            {error && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="rounded-xl px-4 py-3 text-sm font-medium"
                style={{ background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.3)' }}>
                {error}
              </motion.div>
            )}

            <button onClick={confirmGiftAid} disabled={!formValid}
              className="w-full py-4 rounded-2xl font-black text-base shadow-lg active:scale-[0.99] transition-transform disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', color: '#fff' }}>
              ✓ Confirm Gift Aid &amp; Pay →
            </button>
          </motion.div>
        )}

        {/* ── STEP: No Gift Aid — collect contact details ── */}
        {step === 'no-form' && (
          <motion.div key="no-form" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <h1 className="font-display font-bold text-xl text-gold-400 mb-0.5">Your Details</h1>
            <p className="text-sm mb-4" style={{ color: 'rgba(255,248,220,0.45)' }}>
              All fields are optional. Provide an email to receive your receipt.
            </p>

            {/* Anonymous toggle */}
            <div className="temple-card p-4">
              <button onClick={() => setAnonymous(!anonymous)} className="flex items-center justify-between w-full">
                <div className="text-left">
                  <p className="font-bold text-ivory-200 text-sm">Donate Anonymously</p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,248,220,0.4)' }}>Your details will not be recorded</p>
                </div>
                <div className="w-12 h-6 rounded-full transition-colors relative flex-shrink-0"
                  style={{ background: anonymous ? '#FF9933' : 'rgba(255,255,255,0.1)' }}>
                  <motion.div animate={{ x: anonymous ? 24 : 2 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm" />
                </div>
              </button>
            </div>

            {!anonymous && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Full Name</label>
                  <input type="text" value={noName} onChange={e => setNoName(e.target.value)}
                    placeholder="Your name (optional)" className="w-full px-4 py-3 rounded-xl text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Email</label>
                  <input type="email" value={noEmail} onChange={e => setNoEmail(e.target.value)}
                    placeholder="your@email.com" className="w-full px-4 py-3 rounded-xl text-sm" />
                  {noEmail && <p className="text-xs mt-1 ml-1" style={{ color: '#60a5fa' }}>📧 We'll send your receipt here</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Phone</label>
                  <input type="tel" value={noPhone} onChange={e => setNoPhone(e.target.value)}
                    placeholder="+44 7700 000 000" className="w-full px-4 py-3 rounded-xl text-sm" />
                </div>

                {noHasData && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3 pt-1">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={noGdpr} onChange={e => setNoGdpr(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded flex-shrink-0" style={{ accentColor: '#D4AF37' }} />
                      <div>
                        <p className="text-xs font-semibold text-ivory-200">Data Protection (GDPR)</p>
                        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,248,220,0.4)' }}>Your data will be held securely in accordance with UK GDPR and not shared with third parties.</p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={noTerms} onChange={e => setNoTerms(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded flex-shrink-0" style={{ accentColor: '#D4AF37' }} />
                      <div>
                        <p className="text-xs font-semibold text-ivory-200">Terms &amp; Conditions</p>
                        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,248,220,0.4)' }}>By proceeding you confirm your donation is made voluntarily and agree to our donation terms.</p>
                      </div>
                    </label>
                  </motion.div>
                )}
              </motion.div>
            )}

            <button onClick={proceedWithout} disabled={!noFormValid}
              className="btn-gold disabled:opacity-40">
              Continue to Payment →
            </button>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  )
}
