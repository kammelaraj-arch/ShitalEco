import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'

// ─── GetAddress.io postcode lookup ────────────────────────────────────────────

async function lookupPostcode(postcode: string): Promise<string[]> {
  const clean = postcode.trim().toUpperCase()
  try {
    const res = await fetch(
      `https://api.getaddress.io/find/${encodeURIComponent(clean)}?api-key=CkqEZqIrkEOGlQhie_NL8w48103&expand=true`,
      { signal: AbortSignal.timeout(5000) }
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
  return ['1 Temple Road, Wembley, HA9 0EW', '2 Temple Road, Wembley, HA9 0EW', '3 High Road, Wembley, HA9 7AB']
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
    const found = await lookupPostcode(postcode)
    setAddresses(found)
    if (found.length === 1) setAddress(found[0])
    setLookingUp(false)
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
              disabled={lookingUp || postcode.trim().length < 3}
              className="px-5 py-3.5 rounded-2xl font-black text-sm text-white disabled:opacity-50 active:scale-95 transition-all flex-shrink-0"
              style={{ background: '#16a34a', minWidth: 100 }}
            >
              {lookingUp ? '…' : '🔍 Find'}
            </button>
          </div>

          {/* Address dropdown after lookup */}
          {addresses.length > 0 && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2">
              <select
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="w-full border-2 rounded-2xl px-4 py-3 text-gray-900 text-sm focus:outline-none bg-white"
                style={{ borderColor: address ? '#16a34a' : '#6ee7b7' }}
              >
                <option value="">— Select your address —</option>
                {addresses.map((a, i) => <option key={i} value={a}>{a}</option>)}
              </select>
            </motion.div>
          )}

          {/* Manual entry if postcode typed but no lookup yet */}
          {addresses.length === 0 && postcode.length > 3 && !lookingUp && (
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Or type address manually"
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

        {/* Spacer so button doesn't overlap last field */}
        <div className="h-4" />
      </div>

      {/* Continue to Pay button */}
      <div className="flex-shrink-0 px-5 pb-6 pt-3" style={{ borderTop: '2px solid #f0fdf4', background: '#fff' }}>
        <button
          onClick={handleContinue}
          className="w-full py-5 rounded-2xl font-black text-white text-lg shadow-xl active:scale-[0.98] transition-all"
          style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)', boxShadow: '0 6px 24px #16a34a40' }}
        >
          Continue to Pay · £{total.toFixed(2)} →
        </button>
        <button
          onClick={onBack}
          className="w-full mt-3 py-3 text-gray-400 text-sm font-medium active:opacity-70"
        >
          ← Back to Basket
        </button>
      </div>
    </motion.div>
  )
}

// ─── Main BasketScreen ────────────────────────────────────────────────────────

export function BasketScreen() {
  const { language, setScreen, items, removeItem, updateQuantity, theme, setGiftAidDeclaration, setPendingPayment } = useKioskStore()
  const th = THEMES[theme]

  const total        = items.reduce((s, i) => s + i.totalPrice, 0)
  const eligibleAmt  = items.filter(i => i.giftAidEligible || i.type === 'DONATION').reduce((s, i) => s + i.totalPrice, 0)
  const giftAidBonus = eligibleAmt * 0.25
  const hasEligible  = eligibleAmt > 0

  const [showGiftAid, setShowGiftAid] = useState(false)

  function handleNormalCheckout() {
    setGiftAidDeclaration(null)
    setPendingPayment(true)
    setScreen('checkout')
  }

  function handleGiftAidConfirm(decl: { fullName: string; postcode: string; address: string; email: string; phone: string; agreed: boolean }) {
    setGiftAidDeclaration({
      agreed: decl.agreed,
      fullName: decl.fullName,
      postcode: decl.postcode,
      address: decl.address,
      contactEmail: decl.email,
      contactPhone: decl.phone,
    })
    setPendingPayment(true)
    setScreen('checkout')
  }

  // Show Gift Aid form as full-screen overlay
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
      className="w-full h-full flex flex-col"
      style={{ background: th.mainBg, fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-6 py-4 flex-shrink-0"
        style={{ background: th.headerBg, borderBottom: `3px solid rgba(255,153,51,0.25)`, boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}
      >
        <button
          onClick={() => setScreen('home')}
          className="flex items-center gap-2 font-bold text-sm px-4 py-2 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.15)', color: th.headerText }}
        >← Back</button>
        <h1 className="font-black text-2xl flex-1 text-center tracking-tight" style={{ color: th.headerText }}>🛒 My Basket</h1>
        <span className="text-sm font-bold px-3 py-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.15)', color: th.headerSub }}>
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5" style={{ scrollbarWidth: 'none' }}>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <span className="text-8xl opacity-30">🛒</span>
            <p className="text-xl font-bold" style={{ color: th.sectionTitleColor, opacity: 0.5 }}>Your basket is empty</p>
            <button onClick={() => setScreen('home')} className="mt-2 font-black text-white text-base px-8 py-3.5 rounded-2xl shadow-lg" style={{ background: th.basketBtn }}>
              Browse &amp; Add Items
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {items.map((item, idx) => (
                <motion.div
                  key={item.id} layout
                  initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24, height: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className="bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 px-5 py-4"
                >
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style={{ background: `${th.logoBg}20` }}>
                    {item.type === 'DONATION' ? '🙏' : '✨'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black text-gray-900 text-base leading-tight truncate">{item.name}</p>
                      {(item.giftAidEligible || item.type === 'DONATION') && (
                        <span className="text-[10px] font-black bg-green-100 text-green-700 px-2 py-0.5 rounded-full border border-green-200 flex-shrink-0">✓ GA</span>
                      )}
                    </div>
                    <p className="text-gray-400 text-sm mt-0.5">£{item.unitPrice.toFixed(2)} each</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="w-10 h-10 rounded-xl bg-gray-100 text-gray-700 text-xl font-black flex items-center justify-center active:scale-90">−</button>
                    <span className="font-black text-gray-900 text-lg w-7 text-center">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="w-10 h-10 rounded-xl text-white text-xl font-black flex items-center justify-center active:scale-90" style={{ background: th.basketBtn }}>+</button>
                  </div>
                  <p className="font-black text-gray-900 text-xl min-w-[72px] text-right flex-shrink-0">£{item.totalPrice.toFixed(2)}</p>
                  <button onClick={() => removeItem(item.id)} className="w-9 h-9 rounded-xl bg-red-50 text-red-400 flex items-center justify-center active:scale-90 text-base font-bold flex-shrink-0">✕</button>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Summary */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 text-sm font-medium">Subtotal ({items.length} item{items.length !== 1 ? 's' : ''})</span>
                <span className="font-bold text-gray-900 text-base">£{total.toFixed(2)}</span>
              </div>
              {hasEligible && (
                <div className="flex items-center justify-between">
                  <span className="text-green-600 text-sm font-medium">🇬🇧 Gift Aid bonus <span className="text-green-500 text-xs">(on £{eligibleAmt.toFixed(2)} eligible)</span></span>
                  <span className="font-bold text-green-600 text-base">+£{giftAidBonus.toFixed(2)}</span>
                </div>
              )}
              <div className="border-t border-gray-100 pt-2.5 flex items-center justify-between">
                <span className="font-black text-gray-900 text-base">Total</span>
                <span className="font-black text-2xl" style={{ color: th.sectionCountColor }}>£{total.toFixed(2)}</span>
              </div>
              {hasEligible && (
                <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-2 flex items-center justify-between">
                  <span className="text-green-700 text-xs font-semibold">Temple receives with Gift Aid</span>
                  <span className="text-green-700 font-black text-base">£{(total + giftAidBonus).toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* CTAs */}
      {items.length > 0 && (
        <div className="flex-shrink-0 px-6 pb-6 pt-4" style={{ borderTop: '2px solid rgba(0,0,0,0.06)', background: th.mainBg }}>
          {hasEligible ? (
            <div className="grid grid-cols-2 gap-3">
              <motion.button onClick={handleNormalCheckout} whileTap={{ scale: 0.97 }}
                className="rounded-2xl px-5 py-5 flex flex-col justify-between shadow-lg"
                style={{ background: 'rgba(0,0,0,0.08)' }}>
                <span className="text-xl font-black" style={{ color: th.sectionTitleColor }}>→</span>
                <div>
                  <p className="font-black text-base" style={{ color: th.sectionTitleColor }}>Without Gift Aid</p>
                  <p className="font-black text-lg" style={{ color: th.sectionTitleColor }}>£{total.toFixed(2)}</p>
                </div>
              </motion.button>
              <motion.button onClick={() => setShowGiftAid(true)} whileTap={{ scale: 0.97 }}
                className="rounded-2xl px-5 py-5 flex flex-col gap-2 text-left shadow-xl"
                style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-3xl">🇬🇧</span>
                  <span className="text-white text-xl font-black">→</span>
                </div>
                <div>
                  <p className="text-white font-black text-base">Boost with Gift Aid</p>
                  <p className="text-white font-black text-lg">£{(total + giftAidBonus).toFixed(2)}</p>
                  <p className="text-green-200 text-xs">+£{giftAidBonus.toFixed(2)} free from HMRC</p>
                </div>
              </motion.button>
            </div>
          ) : (
            <motion.button onClick={handleNormalCheckout} whileTap={{ scale: 0.97 }}
              className="w-full rounded-2xl px-6 py-4 flex items-center justify-between text-white shadow-lg"
              style={{ background: th.basketBtn }}>
              <span className="font-black text-lg">Checkout · £{total.toFixed(2)}</span>
              <span className="text-xl font-black">→</span>
            </motion.button>
          )}
        </div>
      )}
    </motion.div>
  )
}
