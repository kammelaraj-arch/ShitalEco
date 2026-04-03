import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

// ─── Postcode lookup ──────────────────────────────────────────────────────────

async function lookupPostcode(postcode: string): Promise<string[]> {
  try {
    const r = await fetch(`${API_BASE}/kiosk/postcode/${encodeURIComponent(postcode)}`)
    const d = await r.json()
    return d.addresses || []
  } catch {
    return [
      '1 Temple Road, Wembley, Middlesex',
      '2 Temple Road, Wembley, Middlesex',
      '3 Temple Road, Wembley, Middlesex',
    ]
  }
}

// ─── Gift Aid inline form ─────────────────────────────────────────────────────

function GiftAidForm({
  eligibleTotal,
  onConfirm,
  onSkip,
}: {
  eligibleTotal: number
  onConfirm: (decl: {
    fullName: string; postcode: string; address: string
    email: string; phone: string; agreed: boolean
  }) => void
  onSkip: () => void
}) {
  const [agreed, setAgreed]         = useState(true)   // pre-checked
  const [gdpr, setGdpr]             = useState(true)    // pre-checked
  const [fullName, setFullName]     = useState('')
  const [postcode, setPostcode]     = useState('')
  const [addresses, setAddresses]   = useState<string[]>([])
  const [address, setAddress]       = useState('')
  const [lookingUp, setLookingUp]   = useState(false)
  const [email, setEmail]           = useState('')
  const [phone, setPhone]           = useState('')
  const [errors, setErrors]         = useState<string[]>([])

  const bonus = eligibleTotal * 0.25

  async function handleLookup() {
    if (!postcode.trim()) return
    setLookingUp(true)
    const found = await lookupPostcode(postcode.trim())
    setAddresses(found)
    if (found.length === 1) setAddress(found[0])
    setLookingUp(false)
  }

  function validate() {
    const errs: string[] = []
    if (!fullName.trim())  errs.push('Full name is required')
    if (!postcode.trim())  errs.push('Postcode is required')
    if (!address.trim())   errs.push('Please select or enter your address')
    if (!agreed)           errs.push('You must confirm the Gift Aid declaration')
    setErrors(errs)
    return errs.length === 0
  }

  function handleConfirm() {
    if (!validate()) return
    onConfirm({ fullName, postcode, address, email, phone, agreed })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl overflow-hidden"
      style={{ border: '2px solid #16a34a20', background: '#f0fdf4' }}
    >
      {/* Header */}
      <div className="px-6 py-4" style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
        <div className="flex items-center gap-3">
          <span className="text-3xl">🇬🇧</span>
          <div>
            <p className="text-white font-black text-lg leading-tight">Gift Aid Declaration</p>
            <p className="text-green-200 text-sm">
              Temple receives <span className="font-black text-white">£{(eligibleTotal + bonus).toFixed(2)}</span> instead of £{eligibleTotal.toFixed(2)} — <span className="font-bold">free for you</span>
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
            {errors.map(e => <p key={e} className="text-red-600 text-sm">• {e}</p>)}
          </div>
        )}

        {/* 1. Gift Aid Declaration checkbox — top, pre-checked */}
        <button
          onClick={() => setAgreed(a => !a)}
          className={`w-full flex items-start gap-3 p-4 rounded-2xl border-2 text-left transition-all ${
            agreed ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'
          }`}
        >
          <div className={`w-6 h-6 rounded-lg border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${
            agreed ? 'bg-green-500 border-green-500' : 'border-gray-300'
          }`}>
            {agreed && <span className="text-white text-xs font-black">✓</span>}
          </div>
          <p className="text-gray-700 text-xs leading-relaxed">
            <span className="font-bold text-gray-900">Gift Aid Declaration: </span>
            I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital Gains Tax than the amount of Gift Aid claimed on all my donations in that tax year it is my responsibility to pay any difference.
          </p>
        </button>

        {/* 2. GDPR checkbox — pre-checked */}
        <button
          onClick={() => setGdpr(g => !g)}
          className={`w-full flex items-start gap-3 p-3 rounded-2xl border-2 text-left transition-all ${
            gdpr ? 'border-blue-300 bg-blue-50' : 'border-gray-100 bg-gray-50'
          }`}
        >
          <div className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${
            gdpr ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
          }`}>
            {gdpr && <span className="text-white text-[9px] font-black">✓</span>}
          </div>
          <p className="text-gray-500 text-xs leading-relaxed">
            <span className="font-semibold text-gray-600">GDPR Consent: </span>
            I consent to Shital Temple processing my data for Gift Aid reclaiming purposes. My information will not be shared with third parties.
          </p>
        </button>

        {/* 3. Full name */}
        <div>
          <label className="block text-gray-700 text-sm font-bold mb-1.5">Full Name <span className="text-red-500">*</span></label>
          <input
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder="e.g. Priya Patel"
            className="w-full border-2 border-gray-200 rounded-2xl px-4 py-3 text-gray-900 text-base font-medium focus:outline-none focus:border-green-400 bg-white"
          />
        </div>

        {/* 4. Postcode lookup */}
        <div>
          <label className="block text-gray-700 text-sm font-bold mb-1.5">Postcode <span className="text-red-500">*</span></label>
          <div className="flex gap-2">
            <input
              value={postcode}
              onChange={e => setPostcode(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter') handleLookup() }}
              placeholder="e.g. HA9 0AA"
              className="flex-1 border-2 border-gray-200 rounded-2xl px-4 py-3 text-gray-900 text-base font-mono focus:outline-none focus:border-green-400 bg-white"
            />
            <button
              onClick={handleLookup}
              disabled={lookingUp || !postcode.trim()}
              className="px-5 py-3 rounded-2xl font-black text-sm text-white disabled:opacity-50 flex-shrink-0"
              style={{ background: '#16a34a' }}
            >
              {lookingUp ? '…' : '🔍 Find'}
            </button>
          </div>
          {/* Address dropdown */}
          {addresses.length > 0 && (
            <select
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="w-full mt-2 border-2 border-green-300 rounded-2xl px-4 py-3 text-gray-900 text-sm focus:outline-none focus:border-green-400 bg-white"
            >
              <option value="">— Select your address —</option>
              {addresses.map((a, i) => <option key={i} value={a}>{a}</option>)}
            </select>
          )}
          {(addresses.length === 0 || address === '') && postcode.length > 2 && (
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="House number and street, Town"
              className="w-full mt-2 border-2 border-gray-200 rounded-2xl px-4 py-3 text-gray-900 text-sm focus:outline-none focus:border-green-400 bg-white"
            />
          )}
        </div>

        {/* 5. Email */}
        <div>
          <label className="block text-gray-700 text-sm font-bold mb-1.5">
            Email <span className="text-gray-400 font-normal text-xs">(optional — for receipt)</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="w-full border-2 border-gray-200 rounded-2xl px-4 py-3 text-gray-900 text-base font-medium focus:outline-none focus:border-green-400 bg-white"
          />
        </div>

        {/* 6. Phone */}
        <div>
          <label className="block text-gray-700 text-sm font-bold mb-1.5">
            Phone Number <span className="text-gray-400 font-normal text-xs">(optional)</span>
          </label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="07xxx xxxxxx"
            className="w-full border-2 border-gray-200 rounded-2xl px-4 py-3 text-gray-900 text-base font-medium focus:outline-none focus:border-green-400 bg-white"
          />
        </div>

        {/* 7. Action buttons */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onSkip}
            className="flex-1 py-3.5 rounded-2xl border-2 border-gray-200 text-gray-500 font-bold text-sm hover:bg-gray-50 transition-colors"
          >
            Skip Gift Aid
          </button>
          <button
            onClick={handleConfirm}
            className="py-3.5 px-6 rounded-2xl font-black text-white text-sm shadow-lg transition-all active:scale-95"
            style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)', flex: 2 }}
          >
            Confirm &amp; Continue →
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Main BasketScreen ────────────────────────────────────────────────────────

export function BasketScreen() {
  const { language, setScreen, items, removeItem, updateQuantity, theme, setGiftAidDeclaration } = useKioskStore()
  const th = THEMES[theme]

  const total        = items.reduce((s, i) => s + i.totalPrice, 0)
  const eligibleAmt  = items.filter(i => i.giftAidEligible).reduce((s, i) => s + i.totalPrice, 0)
  const giftAidBonus = eligibleAmt * 0.25
  const hasEligible  = eligibleAmt > 0

  const [showGiftAidForm, setShowGiftAidForm] = useState(false)

  function handleNormalCheckout() {
    setGiftAidDeclaration(null)
    setScreen('checkout')
  }

  function handleGiftAidConfirm(decl: {
    fullName: string; postcode: string; address: string
    email: string; phone: string; agreed: boolean
  }) {
    setGiftAidDeclaration({
      agreed: decl.agreed,
      fullName: decl.fullName,
      postcode: decl.postcode,
      address: decl.address,
      contactEmail: decl.email,
      contactPhone: decl.phone,
    })
    setScreen('checkout')
  }

  return (
    <div className="w-full h-full flex flex-col" style={{ background: th.mainBg, fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 px-6 py-4 flex-shrink-0"
        style={{
          background: th.headerBg,
          borderBottom: `3px solid rgba(255,153,51,0.25)`,
          boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
        }}
      >
        <button
          onClick={() => setScreen('home')}
          className="flex items-center gap-2 font-bold text-sm px-4 py-2 rounded-xl transition-colors"
          style={{ background: 'rgba(255,255,255,0.15)', color: th.headerText }}
        >
          ← Back
        </button>
        <h1 className="font-black text-2xl flex-1 text-center tracking-tight" style={{ color: th.headerText }}>
          🛒 My Basket
        </h1>
        <span className="text-sm font-bold px-3 py-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.15)', color: th.headerSub }}>
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5" style={{ scrollbarWidth: 'none' }}>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
            <span className="text-8xl opacity-30">🛒</span>
            <p className="text-xl font-bold" style={{ color: th.sectionTitleColor, opacity: 0.5 }}>Your basket is empty</p>
            <button
              onClick={() => setScreen('home')}
              className="mt-2 font-black text-white text-base px-8 py-3.5 rounded-2xl shadow-lg active:scale-95 transition-all"
              style={{ background: th.basketBtn }}
            >
              Browse & Add Items
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Item rows */}
            <AnimatePresence>
              {items.map((item, idx) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24, height: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className="bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 px-5 py-4"
                >
                  {/* Icon */}
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                    style={{ background: `${th.logoBg}20` }}
                  >
                    {item.type === 'DONATION' ? '🙏' : '✨'}
                  </div>

                  {/* Name + price */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black text-gray-900 text-base leading-tight truncate">{item.name}</p>
                      {item.giftAidEligible && (
                        <span className="text-[10px] font-black bg-green-100 text-green-700 px-2 py-0.5 rounded-full border border-green-200 flex-shrink-0">✓ GA</span>
                      )}
                    </div>
                    <p className="text-gray-400 text-sm mt-0.5">£{item.unitPrice.toFixed(2)} each</p>
                  </div>

                  {/* Qty controls */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      className="w-10 h-10 rounded-xl bg-gray-100 text-gray-700 text-xl font-black flex items-center justify-center hover:bg-gray-200 active:scale-90 transition-all"
                    >−</button>
                    <span className="font-black text-gray-900 text-lg w-7 text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      className="w-10 h-10 rounded-xl text-white text-xl font-black flex items-center justify-center active:scale-90 transition-all"
                      style={{ background: th.basketBtn }}
                    >+</button>
                  </div>

                  {/* Line total */}
                  <p className="font-black text-gray-900 text-xl min-w-[72px] text-right flex-shrink-0">
                    £{item.totalPrice.toFixed(2)}
                  </p>

                  {/* Remove */}
                  <button
                    onClick={() => removeItem(item.id)}
                    className="w-9 h-9 rounded-xl bg-red-50 text-red-400 flex items-center justify-center hover:bg-red-100 active:scale-90 transition-all text-base font-bold flex-shrink-0"
                  >✕</button>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Summary card */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 text-sm font-medium">Subtotal ({items.length} item{items.length !== 1 ? 's' : ''})</span>
                <span className="font-bold text-gray-900 text-base">£{total.toFixed(2)}</span>
              </div>
              {hasEligible && (
                <div className="flex items-center justify-between">
                  <span className="text-green-600 text-sm font-medium flex items-center gap-1.5">
                    🇬🇧 Gift Aid bonus <span className="text-green-500 text-xs">(on £{eligibleAmt.toFixed(2)} eligible)</span>
                  </span>
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

            {/* Gift Aid form */}
            <AnimatePresence>
              {showGiftAidForm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <GiftAidForm
                    eligibleTotal={eligibleAmt}
                    onConfirm={handleGiftAidConfirm}
                    onSkip={() => { setShowGiftAidForm(false); handleNormalCheckout() }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── Checkout CTAs ── */}
      {items.length > 0 && !showGiftAidForm && (
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex-shrink-0 px-6 pb-6 pt-4"
          style={{ borderTop: '2px solid rgba(0,0,0,0.06)', background: th.mainBg }}
        >
          {/* Always 2-column: checkout left, gift aid right */}
          <div className="grid grid-cols-2 gap-3">
            {/* Left — Continue / Checkout */}
            <motion.button
              onClick={handleNormalCheckout}
              whileTap={{ scale: 0.97 }}
              className="rounded-2xl px-5 py-5 flex flex-col justify-between shadow-lg"
              style={{ background: 'rgba(0,0,0,0.08)' }}
            >
              <span className="text-xl font-black" style={{ color: th.sectionTitleColor }}>→</span>
              <div>
                <p className="font-black text-base" style={{ color: th.sectionTitleColor }}>
                  {hasEligible ? 'Continue without Gift Aid' : 'Checkout'}
                </p>
                <p className="font-black text-lg" style={{ color: th.sectionTitleColor }}>£{total.toFixed(2)}</p>
              </div>
            </motion.button>

            {/* Right — Boost with Gift Aid (green) */}
            <motion.button
              onClick={() => setShowGiftAidForm(true)}
              whileTap={{ scale: 0.97 }}
              className="rounded-2xl px-5 py-5 flex flex-col gap-2 text-left shadow-xl"
              style={{ background: hasEligible ? 'linear-gradient(135deg, #16a34a, #15803d)' : 'linear-gradient(135deg, #6b7280, #4b5563)' }}
            >
              <div className="flex items-center gap-2">
                <span className="text-3xl">🇬🇧</span>
                <span className="text-white text-xl font-black flex-shrink-0">→</span>
              </div>
              <div>
                <p className="text-white font-black text-base leading-tight">Boost with Gift Aid</p>
                {hasEligible ? (
                  <>
                    <p className="text-white font-black text-lg">£{(total + giftAidBonus).toFixed(2)}</p>
                    <p className="text-green-200 text-xs mt-0.5">+£{giftAidBonus.toFixed(2)} extra from HMRC free</p>
                  </>
                ) : (
                  <p className="text-gray-300 text-xs mt-0.5">Add a donation to enable</p>
                )}
              </div>
            </motion.button>
          </div>
        </motion.div>
      )}
    </div>
  )
}
