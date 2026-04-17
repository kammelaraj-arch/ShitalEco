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
    // Route to gift-aid if eligible and user chose "Boost" (giftAidDeclaration===null means undecided/boost)
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
        className="flex items-center gap-2 text-sm font-medium mb-6 transition-colors"
        style={{ color: 'rgba(255,248,220,0.4)' }}
      >
        ← {t('back', language)}
      </button>

      <h1 className="font-display font-bold text-xl text-gold-400 mb-1">Your Details</h1>
      <p className="text-sm mb-6" style={{ color: 'rgba(255,248,220,0.45)' }}>
        Provide your details to receive a receipt. All fields are optional.
      </p>

      {/* Anonymous toggle */}
      <div className="temple-card p-4 mb-4">
        <button
          onClick={() => setAnonymous(!anonymous)}
          className="flex items-center justify-between w-full"
        >
          <div className="text-left">
            <p className="font-bold text-ivory-200 text-sm">Donate Anonymously</p>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,248,220,0.4)' }}>Your details will not be recorded</p>
          </div>
          <div className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${anonymous ? '' : ''}`}
            style={{ background: anonymous ? '#FF9933' : 'rgba(255,255,255,0.1)' }}>
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
            <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
              style={{ color: 'rgba(212,175,55,0.6)' }}>
              Full Name {requiresContact && <span style={{ color: '#C62828' }}>*</span>}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              className="w-full px-4 py-3 rounded-xl text-sm"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
              style={{ color: 'rgba(212,175,55,0.6)' }}>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full px-4 py-3 rounded-xl text-sm"
            />
            {email && (
              <p className="text-xs mt-1 ml-1" style={{ color: '#60a5fa' }}>📧 We'll send your receipt here</p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
              style={{ color: 'rgba(212,175,55,0.6)' }}>
              Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+44 7700 000 000"
              className="w-full px-4 py-3 rounded-xl text-sm"
            />
          </div>

          {(name || email || phone) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-3 pt-1"
            >
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gdpr}
                  onChange={(e) => setGdpr(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded flex-shrink-0"
                  style={{ accentColor: '#D4AF37' }}
                />
                <div>
                  <p className="text-xs font-semibold text-ivory-200">Data Protection (GDPR)</p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,248,220,0.4)' }}>
                    Your data will be held securely in accordance with UK GDPR and will not be shared with third parties.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded flex-shrink-0"
                  style={{ accentColor: '#D4AF37' }}
                />
                <div>
                  <p className="text-xs font-semibold text-ivory-200">Terms &amp; Conditions</p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,248,220,0.4)' }}>
                    By proceeding you confirm your donation is made voluntarily and you agree to our donation terms.
                  </p>
                </div>
              </label>
            </motion.div>
          )}
        </motion.div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl px-4 py-3 mb-4 text-sm font-medium"
          style={{ background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.3)' }}
        >
          {error}
        </motion.div>
      )}

      <button onClick={proceed} className="btn-gold">
        {t('continue', language)} →
      </button>
    </div>
  )
}
