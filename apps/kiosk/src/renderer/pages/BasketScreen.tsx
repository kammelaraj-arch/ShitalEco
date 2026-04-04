import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'

// ─── Postcode lookup ─────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'
// getAddress.io — domain-restricted key (safe to use client-side at shital-kiosk.vercel.app)
const GETADDRESS_KEY = 'kSZi9RxDcUCLhU4A6ShTBg48103'

async function lookupPostcode(postcode: string): Promise<{ addresses: string[]; valid: boolean }> {
  const clean = postcode.trim().replace(/\s/g, '').toLowerCase()
  if (clean.length < 5) return { addresses: [], valid: false }

  // 1. Call getAddress.io directly — browser Origin header matches domain restriction
  try {
    const res = await fetch(
      `https://api.getaddress.io/find/${encodeURIComponent(clean)}?api-key=${GETADDRESS_KEY}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (res.ok) {
      const data = await res.json() as { addresses?: string[] }
      const pc = postcode.trim().replace(/\s/g, '').toUpperCase().replace(/^(.+?)(\d\w+)$/, '$1 $2')
      const addrs = (data.addresses ?? [])
        .map((a: string) => {
          const parts = a.split(',').map(p => p.trim()).filter(Boolean)
          if (!parts.some(p => p.toUpperCase().includes(clean.slice(0, 4).toUpperCase()))) {
            parts.push(pc)
          }
          return parts.join(', ')
        })
        .filter(Boolean)
      if (addrs.length) return { addresses: addrs, valid: true }
    }
  } catch { /* fall through */ }

  // 2. Fallback — Vercel edge function (proxies getAddress.io from UK edge)
  try {
    const res = await fetch(
      `/api/address-lookup?postcode=${encodeURIComponent(clean)}`,
      { signal: AbortSignal.timeout(10000) }
    )
    if (res.ok) {
      const data = await res.json()
      if (data.addresses?.length) return { addresses: data.addresses, valid: true }
    }
  } catch { /* fall through */ }

  return { addresses: [], valid: false }
}

// ─── Gift Aid full-screen form ────────────────────────────────────────────────

function GiftAidScreen({
  total,
  eligibleAmt,
  onConfirm,
  onBack,
}: {
  total: number
  eligibleAmt: number
  onConfirm: (decl: { fullName: string; postcode: string; address: string; email: string; phone: string; agreed: boolean }) => void
  onBack: () => void
}) {
  const bonus = eligibleAmt * 0.25

  const [agreed,     setAgreed]     = useState(true)
  const [gdpr,       setGdpr]       = useState(true)
  const [fullName,   setFullName]   = useState('')
  const [postcode,   setPostcode]   = useState('')
  const [addresses,  setAddresses]  = useState<string[]>([])
  const [address,    setAddress]    = useState('')
  const [lookingUp,  setLookingUp]  = useState(false)
  const [phone,      setPhone]      = useState('')
  const [email,      setEmail]      = useState('')
  const [error,      setError]      = useState('')

  async function handleLookup() {
    if (!postcode.trim()) return
    setLookingUp(true)
    setAddresses([])
    setAddress('')
    const result = await lookupPostcode(postcode)
    setLookingUp(false)
    if (result.valid && result.addresses.length > 0) {
      setAddresses(result.addresses)
      if (result.addresses.length === 1) setAddress(result.addresses[0])
    } else {
      setError('Postcode not found — please type your address below')
    }
  }

  function handleContinue() {
    if (!fullName.trim())        { setError('Please enter your full name'); return }
    if (!address.trim())         { setError('Please find and select your address'); return }
    if (!phone.trim() && !email.trim()) { setError('Please enter at least a phone number or email'); return }
    if (!agreed)                 { setError('Please confirm the Gift Aid declaration'); return }
    setError('')
    onConfirm({ fullName, postcode, address, email, phone, agreed })
  }

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'tween', duration: 0.25 }}
      className="w-full h-full flex flex-col bg-white"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #15803d, #16a34a)', boxShadow: '0 2px 12px rgba(0,0,0,0.15)' }}
      >
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white font-bold text-lg active:scale-90"
        >←</button>
        <div className="flex-1">
          <h1 className="text-white font-black text-lg leading-tight">🇬🇧 Gift Aid Declaration</h1>
          <p className="text-green-200 text-xs">UK taxpayers can boost donations by 25% at no extra cost</p>
        </div>
      </div>

      {/* Payment summary row */}
      <div className="grid grid-cols-2 gap-0 flex-shrink-0" style={{ borderBottom: '2px solid #f0fdf4' }}>
        <div className="px-6 py-4 flex flex-col gap-0.5" style={{ background: '#f9fafb', borderRight: '1px solid #e5e7eb' }}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">You Pay</p>
          <p className="text-3xl font-black text-gray-900">£{total.toFixed(2)}</p>
          <p className="text-xs text-gray-400">{eligibleAmt > 0 ? `£${eligibleAmt.toFixed(2)} is Gift Aid eligible` : 'No change to your amount'}</p>
        </div>
        <div className="px-6 py-4 flex flex-col gap-0.5" style={{ background: '#f0fdf4' }}>
          <p className="text-xs font-semibold text-green-600 uppercase tracking-wide">Temple Receives</p>
          <p className="text-3xl font-black text-green-700">£{(total + bonus).toFixed(2)}</p>
          <p className="text-xs text-green-600 font-semibold">+£{bonus.toFixed(2)} from HMRC — free!</p>
        </div>
      </div>

      {/* Scrollable form */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4" style={{ scrollbarWidth: 'thin', scrollbarColor: '#16a34a40 transparent' }}>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-2xl font-medium">
            ⚠ {error}
          </div>
        )}

        {/* Gift Aid declaration — pre-ticked */}
        <button
          onClick={() => setAgreed(a => !a)}
          className={`w-full flex items-start gap-3 p-4 rounded-2xl border-2 text-left transition-all ${agreed ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'}`}
        >
          <div className={`w-6 h-6 rounded-md border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${agreed ? 'bg-green-500 border-green-500' : 'border-gray-300 bg-white'}`}>
            {agreed && <span className="text-white text-xs font-black">✓</span>}
          </div>
          <p className="text-gray-700 text-xs leading-relaxed text-left">
            <span className="font-black text-gray-900 text-sm">Gift Aid Declaration </span><br />
            I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital Gains Tax than the amount of Gift Aid claimed on all my donations in that tax year it is my responsibility to pay any difference.
          </p>
        </button>

        {/* GDPR — pre-ticked */}
        <button
          onClick={() => setGdpr(g => !g)}
          className={`w-full flex items-start gap-3 p-3.5 rounded-2xl border-2 text-left transition-all ${gdpr ? 'border-blue-300 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}
        >
          <div className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${gdpr ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white'}`}>
            {gdpr && <span className="text-white text-[9px] font-black">✓</span>}
          </div>
          <p className="text-gray-500 text-xs leading-relaxed">
            <span className="font-semibold text-gray-700">GDPR Consent — </span>
            I consent to Shital Temple processing my personal data for Gift Aid reclaiming purposes under HMRC guidelines. My data will not be shared with third parties.
          </p>
        </button>

        {/* Full Name */}
        <div>
          <label className="block text-sm font-black text-gray-800 mb-1.5">Full Name <span className="text-red-500">*</span></label>
          <input
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder="e.g. Priya Patel"
            className="w-full border-2 rounded-2xl px-4 py-3.5 text-gray-900 text-base font-medium focus:outline-none bg-white transition-colors"
            style={{ borderColor: fullName.length > 1 ? '#16a34a' : '#e5e7eb' }}
          />
        </div>

        {/* Postcode + Address lookup */}
        <div>
          <label className="block text-sm font-black text-gray-800 mb-1.5">Postcode &amp; Address <span className="text-red-500">*</span></label>
          <div className="flex gap-2">
            <input
              value={postcode}
              onChange={e => { setPostcode(e.target.value.toUpperCase()); setAddresses([]); setAddress('') }}
              onKeyDown={e => e.key === 'Enter' && handleLookup()}
              placeholder="e.g. HA9 0EW"
              className="flex-1 border-2 rounded-2xl px-4 py-3.5 text-gray-900 text-base font-mono focus:outline-none bg-white transition-colors"
              style={{ borderColor: address ? '#16a34a' : '#e5e7eb' }}
            />
            <button
              onClick={handleLookup}
              disabled={lookingUp || postcode.trim().length < 5}
              className="px-5 py-3.5 rounded-2xl font-black text-sm text-white disabled:opacity-50 active:scale-95 transition-all flex-shrink-0"
              style={{ background: '#16a34a', minWidth: 100 }}
            >
              {lookingUp ? '…' : '🔍 Find'}
            </button>
          </div>

          {addresses.length > 0 && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2">
              <select
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="w-full border-2 rounded-2xl px-4 py-3 text-gray-900 text-sm focus:outline-none bg-white"
                style={{ borderColor: address ? '#16a34a' : '#6ee7b7' }}
                size={Math.min(addresses.length + 1, 6)}
              >
                <option value="">— Select your address —</option>
                {addresses.map((a, i) => <option key={i} value={a}>{a}</option>)}
              </select>
            </motion.div>
          )}

          {/* Manual fallback */}
          {addresses.length === 0 && postcode.length >= 5 && !lookingUp && (
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Or type your full address here"
              className="w-full mt-2 border-2 border-gray-200 rounded-2xl px-4 py-3 text-gray-900 text-sm focus:outline-none bg-white"
            />
          )}
        </div>

        {/* Phone */}
        <div>
          <label className="block text-sm font-black text-gray-800 mb-1.5">
            Phone Number <span className="text-gray-400 text-xs font-normal">(required if no email)</span>
          </label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="07xxx xxxxxx"
            className="w-full border-2 rounded-2xl px-4 py-3.5 text-gray-900 text-base font-medium focus:outline-none bg-white transition-colors"
            style={{ borderColor: phone.length > 7 ? '#16a34a' : '#e5e7eb' }}
          />
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-black text-gray-800 mb-1.5">
            Email Address <span className="text-gray-400 text-xs font-normal">(required if no phone)</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="w-full border-2 rounded-2xl px-4 py-3.5 text-gray-900 text-base font-medium focus:outline-none bg-white transition-colors"
            style={{ borderColor: email.includes('@') ? '#16a34a' : '#e5e7eb' }}
          />
        </div>

        <div className="h-4" />
      </div>

      {/* Bottom buttons — 2 columns in same row */}
      <div className="flex-shrink-0 px-5 pb-6 pt-3 flex gap-3" style={{ borderTop: '2px solid #f0fdf4', background: '#fff' }}>
        <button
          onClick={onBack}
          className="flex-1 py-4 rounded-2xl font-bold text-gray-600 text-base border-2 border-gray-200 active:scale-[0.97] transition-all"
        >
          ← Back
        </button>
        <button
          onClick={handleContinue}
          className="flex-[2] py-4 rounded-2xl font-black text-white text-base shadow-xl active:scale-[0.98] transition-all"
          style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)', boxShadow: '0 4px 16px #16a34a40' }}
        >
          Continue to Pay · £{total.toFixed(2)} →
        </button>
      </div>
    </motion.div>
  )
}

// ─── Contact Capture Screen ───────────────────────────────────────────────────

function ContactCaptureScreen({
  total,
  onConfirm,
  onBack,
}: {
  total: number
  onConfirm: (info: { name: string; email: string; phone: string; anonymous: boolean }) => void
  onBack: () => void
}) {
  const [anonymous, setAnonymous] = useState(false)
  const [name,  setName]  = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [gdpr,  setGdpr]  = useState(true)
  const [terms, setTerms] = useState(true)
  const [error, setError] = useState('')

  function handleContinue() {
    if (!terms) { setError('Please accept the Terms & Conditions to proceed'); return }
    if (!gdpr && !anonymous) { setError('Please accept the privacy consent'); return }
    setError('')
    onConfirm({ name, email, phone, anonymous })
  }

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'tween', duration: 0.25 }}
      className="w-full h-full flex flex-col bg-white"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)', boxShadow: '0 2px 12px rgba(0,0,0,0.15)' }}>
        <button onClick={onBack}
          className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white font-bold text-lg active:scale-90">←</button>
        <div className="flex-1">
          <h1 className="text-white font-black text-lg leading-tight">Your Details</h1>
          <p className="text-orange-100 text-xs">Optional — skip anonymously or add details for a receipt</p>
        </div>
      </div>

      {/* Scrollable form */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4" style={{ scrollbarWidth: 'thin' }}>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-2xl font-medium">
            ⚠ {error}
          </div>
        )}

        {/* Receipt info banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex gap-3 items-start">
          <span className="text-xl flex-shrink-0">📧</span>
          <p className="text-amber-800 text-sm leading-snug">
            <span className="font-black">Get your receipt & stay connected.</span><br/>
            By sharing your email or phone, we can send your payment receipt and keep you updated about temple events and services.
          </p>
        </div>

        {/* Anonymous toggle */}
        <button
          onClick={() => { setAnonymous(a => !a); setName(''); setEmail(''); setPhone('') }}
          className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all ${anonymous ? 'border-gray-400 bg-gray-50' : 'border-gray-100'}`}
        >
          <div className={`w-6 h-6 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-all ${anonymous ? 'bg-gray-500 border-gray-500' : 'border-gray-300 bg-white'}`}>
            {anonymous && <span className="text-white text-xs font-black">✓</span>}
          </div>
          <div>
            <p className="font-black text-gray-800 text-sm">Donate Anonymously</p>
            <p className="text-gray-400 text-xs">No details required — no receipt will be sent</p>
          </div>
        </button>

        {/* Contact fields — hidden when anonymous */}
        {!anonymous && (
          <>
            <div>
              <label className="block text-sm font-black text-gray-800 mb-1.5">Full Name <span className="text-gray-400 font-normal text-xs">(optional)</span></label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Priya Patel"
                className="w-full border-2 rounded-2xl px-4 py-3.5 text-gray-900 text-base font-medium focus:outline-none bg-white transition-colors"
                style={{ borderColor: name.length > 1 ? '#FF9933' : '#e5e7eb' }} />
            </div>

            <div>
              <label className="block text-sm font-black text-gray-800 mb-1.5">Email Address <span className="text-gray-400 font-normal text-xs">(for receipt)</span></label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com"
                className="w-full border-2 rounded-2xl px-4 py-3.5 text-gray-900 text-base font-medium focus:outline-none bg-white transition-colors"
                style={{ borderColor: email.includes('@') ? '#FF9933' : '#e5e7eb' }} />
            </div>

            <div>
              <label className="block text-sm font-black text-gray-800 mb-1.5">Phone / WhatsApp <span className="text-gray-400 font-normal text-xs">(for WhatsApp receipt)</span></label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="07xxx xxxxxx"
                className="w-full border-2 rounded-2xl px-4 py-3.5 text-gray-900 text-base font-medium focus:outline-none bg-white transition-colors"
                style={{ borderColor: phone.length > 7 ? '#FF9933' : '#e5e7eb' }} />
            </div>

            {/* GDPR */}
            <button onClick={() => setGdpr(g => !g)}
              className={`w-full flex items-start gap-3 p-3.5 rounded-2xl border-2 text-left transition-all ${gdpr ? 'border-blue-300 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
              <div className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${gdpr ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white'}`}>
                {gdpr && <span className="text-white text-[9px] font-black">✓</span>}
              </div>
              <p className="text-gray-500 text-xs leading-relaxed">
                <span className="font-semibold text-gray-700">Privacy Consent (GDPR) — </span>
                I consent to Shital Temple storing my contact details to send receipts and updates about temple activities. My data will not be shared with third parties and I can unsubscribe at any time.
              </p>
            </button>
          </>
        )}

        {/* T&C — always shown */}
        <button onClick={() => setTerms(t => !t)}
          className={`w-full flex items-start gap-3 p-3.5 rounded-2xl border-2 text-left transition-all ${terms ? 'border-orange-300 bg-orange-50' : 'border-gray-100 bg-gray-50'}`}>
          <div className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${terms ? 'bg-orange-500 border-orange-500' : 'border-gray-300 bg-white'}`}>
            {terms && <span className="text-white text-[9px] font-black">✓</span>}
          </div>
          <p className="text-gray-500 text-xs leading-relaxed">
            <span className="font-semibold text-gray-700">Terms & Conditions — </span>
            All payments are voluntary donations to Shital Temple, a registered UK charity. Donations are non-refundable unless made in error. By proceeding you confirm you are authorised to make this payment.
          </p>
        </button>

        <div className="h-2" />
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-5 pb-6 pt-3 flex gap-3" style={{ borderTop: '2px solid #f3f4f6', background: '#fff' }}>
        <button onClick={onBack}
          className="flex-1 py-4 rounded-2xl font-bold text-gray-600 text-base border-2 border-gray-200 active:scale-[0.97] transition-all">
          ← Back
        </button>
        <button onClick={handleContinue}
          className="flex-[2] py-4 rounded-2xl font-black text-white text-base shadow-xl active:scale-[0.98] transition-all"
          style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)', boxShadow: '0 4px 16px #FF993340' }}>
          {anonymous ? 'Pay Anonymously' : 'Continue to Pay'} · £{total.toFixed(2)} →
        </button>
      </div>
    </motion.div>
  )
}

// ─── Main BasketScreen — "Your Order" McDonald's style ───────────────────────

export function BasketScreen() {
  const { language, setScreen, items, removeItem, updateQuantity, theme, setGiftAidDeclaration, setContactInfo, setPendingPayment, resetKiosk } = useKioskStore()
  const th = THEMES[theme]

  const total        = items.reduce((s, i) => s + i.totalPrice, 0)
  const eligibleAmt  = items.filter(i => i.giftAidEligible || i.type === 'DONATION').reduce((s, i) => s + i.totalPrice, 0)
  const giftAidBonus = eligibleAmt * 0.25
  const hasEligible  = eligibleAmt > 0

  const [showGiftAid, setShowGiftAid]       = useState(false)
  const [showContactCapture, setShowContact] = useState(false)

  function handleNormalCheckout() {
    setGiftAidDeclaration(null)
    setShowContact(true)
  }

  function handleContactConfirm(info: { name: string; email: string; phone: string; anonymous: boolean }) {
    setContactInfo({
      name: info.name, email: info.email, phone: info.phone,
      anonymous: info.anonymous, gdprConsent: true, termsConsent: true,
    })
    setPendingPayment(true)
    setScreen('checkout')
  }

  function handleGiftAidConfirm(decl: { fullName: string; postcode: string; address: string; email: string; phone: string; agreed: boolean }) {
    setGiftAidDeclaration({
      agreed: decl.agreed, fullName: decl.fullName, postcode: decl.postcode,
      address: decl.address, contactEmail: decl.email, contactPhone: decl.phone,
    })
    setContactInfo({
      name: decl.fullName, email: decl.email, phone: decl.phone,
      anonymous: false, gdprConsent: true, termsConsent: true,
    })
    setPendingPayment(true)
    setScreen('checkout')
  }

  if (showContactCapture) {
    return (
      <AnimatePresence mode="wait">
        <ContactCaptureScreen
          key="contact"
          total={total}
          onConfirm={handleContactConfirm}
          onBack={() => setShowContact(false)}
        />
      </AnimatePresence>
    )
  }

  if (showGiftAid) {
    return (
      <AnimatePresence mode="wait">
        <GiftAidScreen
          key="giftaid"
          total={total}
          eligibleAmt={eligibleAmt}
          onConfirm={handleGiftAidConfirm}
          onBack={() => setShowGiftAid(false)}
        />
      </AnimatePresence>
    )
  }

  return (
    <motion.div
      key="basket"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full h-full flex flex-col bg-white"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
        style={{ borderBottom: '1px solid #e5e7eb' }}
      >
        {/* Logo */}
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl font-black flex-shrink-0 shadow border border-gray-100"
          style={{ background: th.logoBg, color: th.logoText }}
        >
          🕉
        </div>
        <h1 className="font-black text-2xl text-gray-900 flex-1">Your Order</h1>
        <span className="text-sm font-semibold text-gray-400">
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Items list ── */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
            <span className="text-7xl opacity-20">🛒</span>
            <p className="text-lg font-bold text-gray-400 text-center">Your basket is empty</p>
            <button
              onClick={() => setScreen('home')}
              className="mt-2 font-black text-white text-sm px-8 py-3 rounded-xl shadow"
              style={{ background: th.langActive }}
            >
              Browse Items
            </button>
          </div>
        ) : (
          <>
            <AnimatePresence>
              {items.map((item, idx) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20, height: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className="flex items-center gap-3 px-5 py-4"
                  style={{ borderBottom: '1px solid #f3f4f6' }}
                >
                  {/* Icon */}
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                    style={{ background: `${th.langActive}15` }}
                  >
                    {item.type === 'DONATION' ? '🙏' : '✨'}
                  </div>

                  {/* Name + badges */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-bold text-gray-900 text-sm leading-tight">{item.name}</p>
                      {(item.giftAidEligible || item.type === 'DONATION') && (
                        <span className="text-[9px] font-black bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full border border-green-200 flex-shrink-0">GA</span>
                      )}
                    </div>
                    <p className="text-gray-400 text-xs mt-0.5">£{item.unitPrice.toFixed(2)} each</p>
                  </div>

                  {/* Qty controls */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      className="w-8 h-8 rounded-lg bg-gray-100 text-gray-600 text-base font-black flex items-center justify-center active:scale-90"
                    >
                      −
                    </button>
                    <span className="font-black text-gray-900 text-base w-6 text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      className="w-8 h-8 rounded-lg text-white text-base font-black flex items-center justify-center active:scale-90"
                      style={{ background: th.langActive }}
                    >
                      +
                    </button>
                  </div>

                  {/* Price */}
                  <p className="font-black text-gray-900 text-base min-w-[56px] text-right flex-shrink-0">
                    £{item.totalPrice.toFixed(2)}
                  </p>

                  {/* Remove */}
                  <button
                    onClick={() => removeItem(item.id)}
                    className="text-xs font-semibold text-gray-400 px-2 py-1 rounded-lg border border-gray-200 active:scale-90 flex-shrink-0 hover:border-red-300 hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </>
        )}
      </div>

      {/* ── Order summary ── */}
      {items.length > 0 && (
        <div className="flex-shrink-0 px-5 py-4" style={{ borderTop: '1px solid #e5e7eb' }}>
          <div className="flex justify-between items-center py-1.5">
            <span className="text-sm text-gray-500">Sub Total</span>
            <span className="text-sm font-semibold text-gray-700">£{total.toFixed(2)}</span>
          </div>
          {hasEligible && (
            <div className="flex justify-between items-center py-1.5">
              <span className="text-sm text-green-600">🇬🇧 Gift Aid (on £{eligibleAmt.toFixed(2)})</span>
              <span className="text-sm font-semibold text-green-600">+£{giftAidBonus.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-2 mt-1" style={{ borderTop: '2px solid #f3f4f6' }}>
            <span className="font-black text-gray-900 text-lg">Total</span>
            <span className="font-black text-gray-900 text-2xl">£{total.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* ── Bottom buttons — McDonald's style ── */}
      <div
        className="flex-shrink-0 px-4 pt-3 pb-4"
        style={{ borderTop: '1px solid #e5e7eb', background: '#fff' }}
      >
        {items.length > 0 && (
          <>
            {/* Primary button row */}
            {hasEligible ? (
              <div className="grid grid-cols-2 gap-3 mb-3">
                {/* Without Gift Aid — outlined */}
                <button
                  onClick={handleNormalCheckout}
                  className="py-4 rounded-xl border-2 border-gray-300 text-gray-700 font-black text-sm active:scale-97 transition-all"
                >
                  <div className="text-xs font-semibold text-gray-400 mb-0.5">Without Gift Aid</div>
                  <div>Confirm &amp; Pay · £{total.toFixed(2)}</div>
                </button>

                {/* With Gift Aid — green filled */}
                <button
                  onClick={() => setShowGiftAid(true)}
                  className="py-4 rounded-xl text-white font-black text-sm shadow-lg active:scale-97 transition-all"
                  style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}
                >
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <span className="text-base">🇬🇧</span>
                    <span className="text-xs text-green-200">Boost with Gift Aid</span>
                  </div>
                  <div>Temple gets £{(total + giftAidBonus).toFixed(2)}</div>
                </button>
              </div>
            ) : (
              <div className="mb-3">
                <button
                  onClick={handleNormalCheckout}
                  className="w-full py-4 rounded-xl text-white font-black text-base shadow-lg active:scale-[0.98] transition-all"
                  style={{ background: th.langActive }}
                >
                  Confirm &amp; Pay · £{total.toFixed(2)} →
                </button>
              </div>
            )}
          </>
        )}

        {/* Secondary row */}
        <div className="flex gap-2">
          <button
            onClick={() => setScreen('home')}
            className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm active:scale-97 transition-all"
          >
            ← Order More
          </button>
          <button
            onClick={() => { if (window.confirm('Clear basket and start again?')) { resetKiosk(); setScreen('home') } }}
            className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-400 font-semibold text-sm active:scale-97 transition-all"
          >
            Start Again
          </button>
        </div>
      </div>
    </motion.div>
  )
}
