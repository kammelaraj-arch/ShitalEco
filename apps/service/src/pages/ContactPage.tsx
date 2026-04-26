import { useState } from 'react'
import { motion } from 'framer-motion'
import { useStore, useGiftAidTotal, t } from '../store'
import { api } from '../api'

export function ContactPage() {
  const { language, setScreen, setContactInfo, giftAidDeclaration, items } = useStore()
  const giftAidTotal = useGiftAidTotal()
  const [firstName, setFirstName] = useState('')
  const [surname, setSurname] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [postcode, setPostcode] = useState('')
  const [addresses, setAddresses] = useState<Array<{ formatted: string; uprn: string }>>([])
  const [selectedAddress, setSelectedAddress] = useState('')
  const [selectedUprn, setSelectedUprn] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [addressError, setAddressError] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [gdpr, setGdpr] = useState(false)
  const [terms, setTerms] = useState(false)
  const [error, setError] = useState('')

  const hasGiftAidItems = giftAidTotal > 0
  const requiresContact = items.some((i) =>
    ['SOFT_DONATION', 'PROJECT_DONATION', 'SPONSORSHIP', 'SHOP'].includes(i.category || '')
  )
  const hasData = !!(firstName.trim() || surname.trim() || email.trim() || phone.trim())
  const name = [firstName.trim(), surname.trim()].filter(Boolean).join(' ')

  async function lookupPostcode() {
    setAddressError('')
    if (!postcode.trim()) return
    setLookingUp(true)
    const found = await api.lookupPostcode(postcode)
    setLookingUp(false)
    if (!found.length) setAddressError('No addresses found — check your postcode.')
    else setAddresses(found)
  }

  function validate() {
    if (anonymous) return true
    if (requiresContact && !firstName.trim()) {
      setError('Please enter your first name')
      return false
    }
    if (!anonymous && hasData && !gdpr) {
      setError('Please accept the data protection notice')
      return false
    }
    if (!anonymous && hasData && !terms) {
      setError('Please accept the terms & conditions')
      return false
    }
    return true
  }

  function proceed() {
    setError('')
    if (!validate()) return
    setContactInfo({
      name: anonymous ? '' : name,
      firstName: anonymous ? '' : firstName.trim(),
      surname: anonymous ? '' : surname.trim(),
      email: anonymous ? '' : email.trim(),
      phone: anonymous ? '' : phone.trim(),
      postcode: anonymous ? '' : postcode.trim(),
      address: anonymous ? '' : selectedAddress,
      uprn: anonymous ? '' : selectedUprn,
      gdprConsent: anonymous ? false : gdpr,
      termsConsent: anonymous ? false : terms,
      anonymous,
    })
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
          <div className="w-12 h-6 rounded-full transition-colors relative flex-shrink-0"
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
          {/* Name — split for PayPal pre-populate */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                style={{ color: 'rgba(212,175,55,0.6)' }}>
                First Name {requiresContact && <span style={{ color: '#C62828' }}>*</span>}
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                className="w-full px-4 py-3 rounded-xl text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                style={{ color: 'rgba(212,175,55,0.6)' }}>
                Surname
              </label>
              <input
                type="text"
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
                placeholder="Surname"
                className="w-full px-4 py-3 rounded-xl text-sm"
              />
            </div>
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

          {/* Postcode lookup — optional, pre-fills PayPal */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
              style={{ color: 'rgba(212,175,55,0.6)' }}>
              UK Postcode{' '}
              <span style={{ color: 'rgba(212,175,55,0.4)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: '10px' }}>
                (optional)
              </span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={postcode}
                onChange={(e) => { setPostcode(e.target.value.toUpperCase()); setAddresses([]); setSelectedAddress(''); setSelectedUprn('') }}
                onKeyDown={(e) => e.key === 'Enter' && lookupPostcode()}
                placeholder="e.g. HA9 0BB"
                className="flex-1 px-4 py-3 rounded-xl text-sm uppercase"
              />
              <button onClick={lookupPostcode} disabled={lookingUp || !postcode.trim()}
                className="px-4 py-3 rounded-xl font-bold text-sm disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#6B0000' }}>
                {lookingUp ? '…' : 'Find'}
              </button>
            </div>
            {addressError && <p className="text-xs mt-1" style={{ color: '#f87171' }}>{addressError}</p>}
          </div>

          {addresses.length > 0 && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                style={{ color: 'rgba(212,175,55,0.6)' }}>
                Select Address
              </label>
              <select
                value={selectedAddress}
                onChange={(e) => {
                  const chosen = addresses.find(a => a.formatted === e.target.value)
                  setSelectedAddress(e.target.value)
                  setSelectedUprn(chosen?.uprn ?? '')
                }}
                className="w-full px-4 py-3 rounded-xl text-sm"
              >
                <option value="">— Select your address —</option>
                {addresses.map((a, i) => <option key={i} value={a.formatted}>{a.formatted}</option>)}
              </select>
            </div>
          )}

          {hasData && (
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
                    By proceeding you confirm your donation is made voluntarily and you agree to our{' '}
                    <a href="https://shital.org.uk/terms" target="_blank" rel="noopener noreferrer"
                      style={{ color: '#D4AF37', textDecoration: 'underline' }}>donation terms</a>.
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
