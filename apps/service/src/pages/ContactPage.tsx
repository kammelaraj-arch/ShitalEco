import { useState } from 'react'
import { motion } from 'framer-motion'
import { useStore, t } from '../store'

export function ContactPage() {
  const { language, setScreen, setContactInfo, giftAidTotal, giftAidDeclaration, items } = useStore()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [gdpr, setGdpr] = useState(false)
  const [terms, setTerms] = useState(false)
  const [error, setError] = useState('')

  const hasGiftAidItems = giftAidTotal > 0
  const requiresContact = items.some((i) =>
    ['SOFT_DONATION', 'PROJECT_DONATION', 'SPONSORSHIP', 'SHOP'].includes(i.category || '')
  )

  function validate() {
    if (anonymous) return true
    if (requiresContact && !name.trim()) {
      setError('Please enter your name')
      return false
    }
    if (!anonymous && (name || email || phone) && !gdpr) {
      setError('Please accept the data protection notice')
      return false
    }
    if (!anonymous && (name || email || phone) && !terms) {
      setError('Please accept the terms & conditions')
      return false
    }
    return true
  }

  function proceed() {
    setError('')
    if (!validate()) return
    setContactInfo({
      name: anonymous ? '' : name.trim(),
      email: anonymous ? '' : email.trim(),
      phone: anonymous ? '' : phone.trim(),
      gdprConsent: anonymous ? false : gdpr,
      termsConsent: anonymous ? false : terms,
      anonymous,
    })
    // Route to gift-aid only if eligible, not anonymous, and user hasn't already declined at basket
    if (hasGiftAidItems && !anonymous && giftAidDeclaration === null) {
      setScreen('gift-aid')
    } else {
      setScreen('payment')
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-32">
      <button
        onClick={() => setScreen('basket')}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 mb-5 font-medium"
      >
        ← {t('back', language)}
      </button>

      <h1 className="text-xl font-black text-gray-900 mb-1">Your Details</h1>
      <p className="text-sm text-gray-400 mb-6">Provide your details to receive a receipt. All fields are optional.</p>

      {/* Anonymous toggle */}
      <div className="bg-white rounded-2xl p-4 mb-4 border border-gray-100 shadow-sm">
        <button
          onClick={() => setAnonymous(!anonymous)}
          className="flex items-center justify-between w-full"
        >
          <div>
            <p className="font-bold text-gray-900 text-sm">Donate Anonymously</p>
            <p className="text-xs text-gray-400 mt-0.5">Your details will not be recorded</p>
          </div>
          <div className={`w-12 h-6 rounded-full transition-colors relative ${anonymous ? 'bg-orange-500' : 'bg-gray-200'}`}>
            <motion.div
              animate={{ x: anonymous ? 24 : 2 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
            />
          </div>
        </button>
      </div>

      {!anonymous && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3 mb-4"
        >
          {/* Name */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
              Full Name {requiresContact && <span className="text-red-400">*</span>}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm bg-white"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm bg-white"
            />
            {email && (
              <p className="text-xs text-blue-500 mt-1 ml-1">📧 We'll send your receipt here</p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
              Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+44 7700 000 000"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm bg-white"
            />
          </div>

          {(name || email || phone) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-2 pt-1"
            >
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gdpr}
                  onChange={(e) => setGdpr(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-orange-500"
                />
                <div>
                  <p className="text-xs font-semibold text-gray-700">Data Protection (GDPR)</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Your data will be held securely in accordance with UK GDPR and will not be shared with third parties.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-orange-500"
                />
                <div>
                  <p className="text-xs font-semibold text-gray-700">Terms & Conditions</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    By proceeding you confirm your donation is made voluntarily and you agree to our donation terms.
                  </p>
                </div>
              </label>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* Gift Aid notice */}
      {hasGiftAidItems && !anonymous && (
        <div className="bg-green-50 rounded-xl px-4 py-3 mb-4 flex items-start gap-3">
          <span className="text-xl">🇬🇧</span>
          <div>
            <p className="text-sm font-bold text-green-800">You may be eligible for Gift Aid!</p>
            <p className="text-xs text-green-600 mt-0.5">
              On the next step we'll ask if you're a UK taxpayer — HMRC will add 25% to your donation at no extra cost.
            </p>
          </div>
        </div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-red-50 text-red-600 text-sm font-medium px-4 py-3 rounded-xl mb-4"
        >
          {error}
        </motion.div>
      )}

      <button
        onClick={proceed}
        className="w-full py-4 rounded-2xl text-white font-black text-base shadow-lg active:scale-[0.99] transition-transform"
        style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)' }}
      >
        {t('continue', language)} →
      </button>
    </div>
  )
}
