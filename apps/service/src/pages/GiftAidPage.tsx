import { useState } from 'react'
import { motion } from 'framer-motion'
import { useStore, t } from '../store'
import { api } from '../api'

const DECLINED = { agreed: false, fullName: '', postcode: '', address: '', contactEmail: '', contactPhone: '' }

export function GiftAidPage() {
  const { language, setScreen, setGiftAidDeclaration, contactInfo, giftAidTotal, total } = useStore()
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
        className="flex items-center gap-2 text-sm font-medium mb-5 transition-colors"
        style={{ color: 'rgba(255,248,220,0.4)' }}
      >
        ← {t('back', language)}
      </button>

      {/* Header with boost summary */}
      <div className="temple-card p-4 mb-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">🇬🇧</span>
          <div>
            <h1 className="font-display font-bold text-lg text-gold-400">Gift Aid Declaration</h1>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,248,220,0.5)' }}>
              HMRC requires your details to claim Gift Aid
            </p>
          </div>
        </div>
        <div className="rounded-xl px-3 py-2 flex items-center justify-between text-sm"
          style={{ background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(74,222,128,0.2)' }}>
          <span style={{ color: '#4ade80' }}>HMRC adds +£{boost.toFixed(2)} free</span>
          <span className="font-black text-gold-400 price-display">Temple gets £{totalWithBoost.toFixed(2)}</span>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="space-y-4"
      >
        {/* Full Name */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
            style={{ color: 'rgba(212,175,55,0.6)' }}>Full Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="As it appears on your tax record"
            className="w-full px-4 py-3 rounded-xl text-sm"
          />
        </div>

        {/* Postcode lookup */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
            style={{ color: 'rgba(212,175,55,0.6)' }}>UK Postcode *</label>
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
              style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#6B0000' }}
            >
              {lookingUp ? '…' : 'Find'}
            </button>
          </div>
          {addressError && (
            <p className="text-xs mt-1" style={{ color: '#f87171' }}>{addressError}</p>
          )}
        </div>

        {/* Address select */}
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

        {/* Email */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
            style={{ color: 'rgba(212,175,55,0.6)' }}>Email *</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="For Gift Aid confirmation"
            className="w-full px-4 py-3 rounded-xl text-sm"
          />
        </div>

        {/* Phone */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
            style={{ color: 'rgba(212,175,55,0.6)' }}>Phone</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+44 7700 000 000"
            className="w-full px-4 py-3 rounded-xl text-sm"
          />
        </div>

        {/* Declarations */}
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
              I agree to my data being held in accordance with UK GDPR for Gift Aid purposes.
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

        <button onClick={confirm}
          className="w-full py-4 rounded-2xl font-black text-base shadow-lg active:scale-[0.99] transition-transform"
          style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', color: '#fff' }}>
          Confirm Gift Aid &amp; Pay →
        </button>

        {/* Decline option */}
        <button
          onClick={() => { setGiftAidDeclaration(DECLINED); setScreen('payment') }}
          className="w-full py-3 text-xs font-medium text-center transition-colors"
          style={{ color: 'rgba(255,248,220,0.3)' }}
        >
          Donate without Gift Aid · Pay £{total.toFixed(2)}
        </button>
      </motion.div>
    </div>
  )
}
