import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, t } from '../store'
import { api } from '../api'

type Step = 'choice' | 'form' | 'decline'

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
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 mb-5 font-medium"
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
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">🇬🇧</div>
              <h1 className="text-xl font-black text-gray-900 mb-2">Boost Your Donation</h1>
              <p className="text-sm text-gray-500">
                If you're a UK taxpayer, HMRC will add <strong className="text-green-600">£{boost.toFixed(2)}</strong> to your
                £{giftAidTotal.toFixed(2)} at no cost to you.
              </p>
            </div>

            {/* Summary */}
            <div className="bg-green-50 rounded-2xl p-4 mb-6 space-y-2">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Your donation</span>
                <span className="font-bold">£{total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-green-700">
                <span>HMRC Gift Aid (+25%)</span>
                <span className="font-bold">+£{boost.toFixed(2)}</span>
              </div>
              <div className="border-t border-green-200 pt-2 flex justify-between">
                <span className="font-bold text-gray-900">Temple receives</span>
                <span className="font-black text-green-700 text-lg">£{totalWithBoost.toFixed(2)}</span>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => setStep('form')}
                className="w-full py-4 rounded-2xl text-white font-black text-base shadow-lg"
                style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}
              >
                Yes — Boost with Gift Aid 🎉
              </button>
              <button
                onClick={decline}
                className="w-full py-3.5 rounded-2xl border-2 border-gray-200 text-gray-600 font-bold text-sm hover:bg-gray-50"
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
              <h1 className="text-xl font-black text-gray-900 mb-1">Gift Aid Declaration</h1>
              <p className="text-sm text-gray-400">HMRC requires your name and UK address</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Full Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm bg-white"
              />
            </div>

            {/* Postcode lookup */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Postcode *</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && lookupPostcode()}
                  placeholder="e.g. HA9 0BB"
                  className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm bg-white uppercase"
                />
                <button
                  onClick={lookupPostcode}
                  disabled={lookingUp}
                  className="px-4 py-3 rounded-xl text-white font-bold text-sm disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)' }}
                >
                  {lookingUp ? '…' : 'Find'}
                </button>
              </div>
              {addressError && <p className="text-xs text-red-500 mt-1">{addressError}</p>}
            </div>

            {addresses.length > 0 && (
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Select Address *</label>
                <select
                  value={selectedAddress}
                  onChange={(e) => setSelectedAddress(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm bg-white"
                >
                  <option value="">— Select your address —</option>
                  {addresses.map((a, i) => <option key={i} value={a}>{a}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm bg-white"
              />
            </div>

            <div className="bg-amber-50 rounded-xl p-4 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-green-600" />
                <p className="text-xs text-gray-700">
                  <strong>Gift Aid Declaration:</strong> I confirm I am a UK taxpayer and understand that if I pay less Income Tax or Capital Gains Tax than the amount of Gift Aid claimed on all my donations in that tax year, it is my responsibility to pay any difference.
                </p>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={termsOk} onChange={(e) => setTermsOk(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-green-600" />
                <p className="text-xs text-gray-700">
                  I agree to the terms and conditions and consent to my data being held in accordance with UK GDPR for Gift Aid purposes.
                </p>
              </label>
            </div>

            {error && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="bg-red-50 text-red-600 text-sm font-medium px-4 py-3 rounded-xl">
                {error}
              </motion.div>
            )}

            <div className="space-y-3 pt-1">
              <button onClick={confirm}
                className="w-full py-4 rounded-2xl text-white font-black text-base shadow-lg"
                style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
                Confirm Gift Aid & Pay →
              </button>
              <button onClick={() => setStep('choice')}
                className="w-full py-3.5 rounded-2xl border-2 border-gray-200 text-gray-500 font-bold text-sm">
                ← Back
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
