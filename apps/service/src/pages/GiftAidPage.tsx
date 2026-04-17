import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, t } from '../store'
import { api } from '../api'

type Step = 'choice' | 'form'

export function GiftAidPage() {
  const { language, setScreen, setGiftAidDeclaration, contactInfo, giftAidTotal, total } = useStore()
  const [step, setStep] = useState<Step>('choice')
  const [name, setName] = useState(contactInfo?.name || '')
  const [postcode, setPostcode] = useState('')
  const [addresses, setAddresses] = useState<string[]>([])
  const [selectedAddress, setSelectedAddress] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [addressError, setAddressError] = useState('')
  const [email, setEmail] = useState(contactInfo?.email || '')
  const [phone, setPhone] = useState(contactInfo?.phone || '')
  const [agreed, setAgreed] = useState(false)
  const [termsOk, setTermsOk] = useState(false)
  const [error, setError] = useState('')

  const boost = giftAidTotal * 0.25
  const totalWithBoost = total + boost

  async function lookupPostcode() {
    setAddressError('')
    if (!postcode.trim()) return
    setLookingUp(true)
    const found = await api.lookupPostcode(postcode)
    setLookingUp(false)
    if (found.length === 0) {
      setAddressError('No addresses found. Please check your postcode.')
    } else {
      setAddresses(found)
    }
  }

  function decline() {
    setGiftAidDeclaration(null)
    setScreen('payment')
  }

  function confirm() {
    setError('')
    if (!name.trim()) { setError('Please enter your full name'); return }
    if (!selectedAddress) { setError('Please select your address'); return }
    if (!email.trim() && !phone.trim()) { setError('Please provide email or phone'); return }
    if (!agreed) { setError('Please confirm the Gift Aid declaration'); return }
    if (!termsOk) { setError('Please accept the terms'); return }

    setGiftAidDeclaration({
      agreed: true,
      fullName: name,
      postcode,
      address: selectedAddress,
      contactEmail: email,
      contactPhone: phone,
    })
    setScreen('payment')
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-32">
      <button
        onClick={() => setScreen('contact')}
        className="flex items-center gap-2 text-sm font-medium mb-6 transition-colors"
        style={{ color: 'rgba(255,248,220,0.4)' }}
      >
        ← {t('back', language)}
      </button>

      <AnimatePresence mode="wait">
        {step === 'choice' && (
          <motion.div
            key="choice"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <div className="text-center mb-8">
              <div className="text-5xl mb-4">🇬🇧</div>
              <h1 className="font-display font-bold text-xl text-gold-400 mb-2">Boost Your Donation</h1>
              <p className="text-sm" style={{ color: 'rgba(255,248,220,0.5)' }}>
                If you're a UK taxpayer, HMRC will add{' '}
                <strong style={{ color: '#4ade80' }}>£{boost.toFixed(2)}</strong>{' '}
                to your £{giftAidTotal.toFixed(2)} at no cost to you.
              </p>
            </div>

            {/* Summary */}
            <div className="temple-card p-4 mb-6 space-y-2.5">
              <div className="flex justify-between text-sm">
                <span style={{ color: 'rgba(255,248,220,0.5)' }}>Your donation</span>
                <span className="font-bold text-ivory-200 price-display">£{total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm" style={{ color: '#4ade80' }}>
                <span>HMRC Gift Aid (+25%)</span>
                <span className="font-bold price-display">+£{boost.toFixed(2)}</span>
              </div>
              <div className="pt-2.5 flex justify-between"
                style={{ borderTop: '1px solid rgba(212,175,55,0.15)' }}>
                <span className="font-bold text-ivory-200">Temple receives</span>
                <span className="font-black text-gold-400 text-lg price-display">£{totalWithBoost.toFixed(2)}</span>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => setStep('form')}
                className="w-full py-4 rounded-2xl font-black text-base shadow-lg active:scale-[0.99] transition-transform"
                style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', color: '#fff' }}
              >
                Yes — Boost with Gift Aid 🎉
              </button>
              <button
                onClick={decline}
                className="btn-ghost"
              >
                No thanks — continue without
              </button>
            </div>
          </motion.div>
        )}

        {step === 'form' && (
          <motion.div
            key="form"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-4"
          >
            <div>
              <h1 className="font-display font-bold text-xl text-gold-400 mb-1">Gift Aid Declaration</h1>
              <p className="text-sm" style={{ color: 'rgba(255,248,220,0.45)' }}>
                HMRC requires your name and UK address
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                style={{ color: 'rgba(212,175,55,0.6)' }}>Full Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm"
              />
            </div>

            {/* Postcode lookup */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                style={{ color: 'rgba(212,175,55,0.6)' }}>Postcode *</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && lookupPostcode()}
                  placeholder="e.g. HA9 0BB"
                  className="flex-1 px-4 py-3 rounded-xl text-sm uppercase"
                />
                <button
                  onClick={lookupPostcode}
                  disabled={lookingUp}
                  className="px-4 py-3 rounded-xl font-bold text-sm disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#1A0606' }}
                >
                  {lookingUp ? '…' : 'Find'}
                </button>
              </div>
              {addressError && (
                <p className="text-xs mt-1" style={{ color: '#f87171' }}>{addressError}</p>
              )}
            </div>

            {addresses.length > 0 && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                  style={{ color: 'rgba(212,175,55,0.6)' }}>Select Address *</label>
                <select
                  value={selectedAddress}
                  onChange={(e) => setSelectedAddress(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-sm"
                >
                  <option value="">— Select your address —</option>
                  {addresses.map((a, i) => <option key={i} value={a}>{a}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                style={{ color: 'rgba(212,175,55,0.6)' }}>Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                style={{ color: 'rgba(212,175,55,0.6)' }}>Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm"
              />
            </div>

            <div className="temple-card p-4 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 flex-shrink-0"
                  style={{ accentColor: '#4ade80' }} />
                <p className="text-xs text-ivory-200">
                  <strong className="text-gold-400">Gift Aid Declaration:</strong> I confirm I am a UK taxpayer and understand that if I pay less Income Tax or Capital Gains Tax than the amount of Gift Aid claimed on all my donations in that tax year, it is my responsibility to pay any difference.
                </p>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={termsOk} onChange={(e) => setTermsOk(e.target.checked)}
                  className="mt-0.5 w-4 h-4 flex-shrink-0"
                  style={{ accentColor: '#4ade80' }} />
                <p className="text-xs text-ivory-200">
                  I agree to the terms and conditions and consent to my data being held in accordance with UK GDPR for Gift Aid purposes.
                </p>
              </label>
            </div>

            {error && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="rounded-xl px-4 py-3 text-sm font-medium"
                style={{ background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.3)' }}>
                {error}
              </motion.div>
            )}

            <div className="space-y-3 pt-1">
              <button onClick={confirm}
                className="w-full py-4 rounded-2xl font-black text-base shadow-lg active:scale-[0.99] transition-transform"
                style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', color: '#fff' }}>
                Confirm Gift Aid &amp; Pay →
              </button>
              <button onClick={() => setStep('choice')}
                className="btn-ghost">
                ← Back
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
