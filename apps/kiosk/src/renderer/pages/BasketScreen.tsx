import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'
import { KioskKeyboard } from '../components/KioskKeyboard'

// ─── Address lookup — Ideal Postcodes (client-side, CORS-enabled) ────────────

const IDEAL_KEY = 'ak_mnkd7wshn7wBmgOHx8CUKLmaJMePr'

interface IdealAddress {
  line_1: string; line_2: string; line_3: string;
  post_town: string; postcode: string;
}

async function lookupAddresses(raw: string): Promise<{ addresses: string[]; postcode: string }> {
  const postcode = raw.trim().toUpperCase().replace(/\s+/g, ' ')
  const encoded = encodeURIComponent(postcode.replace(/\s/g, ''))
  const res = await fetch(
    `https://api.ideal-postcodes.co.uk/v1/postcodes/${encoded}?api_key=${IDEAL_KEY}`,
    { signal: AbortSignal.timeout(10000) }
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(body.message || `Error ${res.status}`)
  }
  const data = await res.json() as { result?: IdealAddress[] }
  const addresses = (data.result ?? []).map((a: IdealAddress) =>
    [a.line_1, a.line_2, a.line_3, a.post_town, a.postcode].filter(Boolean).join(', ')
  ).filter(Boolean)
  if (addresses.length === 0) throw new Error('No addresses found — please check the postcode')
  return { addresses, postcode: data.result?.[0]?.postcode || postcode }
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

  const [agreed,    setAgreed]   = useState(true)
  const [gdpr,      setGdpr]     = useState(true)
  const [terms,     setTerms]    = useState(false)
  const [fullName,  setFullName] = useState('')
  const [postcode,  setPostcode] = useState('')
  const [addresses, setAddresses]= useState<string[]>([])
  const [resolvedPc,setResolvedPc]=useState('')
  const [address,   setAddress]  = useState('')
  const [lookingUp, setLookingUp]= useState(false)
  const [phone,     setPhone]    = useState('')
  const [email,     setEmail]    = useState('')
  const [error,     setError]    = useState('')

  // On-screen keyboard
  const [activeField, setActiveField] = useState<string | null>(null)
  const [kbValue, setKbValue] = useState('')
  const kbMode = activeField === 'postcode' ? 'postcode' as const
               : activeField === 'phone' ? 'numeric' as const
               : 'text' as const

  const openKb = (field: string, initial: string) => { setKbValue(initial); setActiveField(field) }
  const closeKb = () => setActiveField(null)
  const handleKbChange = (v: string) => {
    setKbValue(v)
    if (activeField === 'fullname') setFullName(v)
    else if (activeField === 'postcode') setPostcode(v.toUpperCase())
    else if (activeField === 'phone') setPhone(v)
    else if (activeField === 'email') setEmail(v)
  }

  async function handleFind() {
    if (!postcode.trim()) return
    setLookingUp(true)
    setAddresses([])
    setAddress('')
    setResolvedPc('')
    setError('')
    try {
      const result = await lookupAddresses(postcode)
      if (result.addresses.length > 0) {
        setAddresses(result.addresses)
        setResolvedPc(result.postcode)
      } else {
        setError('No addresses found for this postcode — please check and try again')
      }
    } catch (e) {
      setError(String(e).replace('Error: ', ''))
    } finally {
      setLookingUp(false)
    }
  }

  function handleContinue() {
    if (!agreed) { setError('Please confirm the Gift Aid declaration'); return }
    if (!terms)  { setError('Please accept the Terms & Conditions to proceed'); return }
    if (!fullName.trim()) { setError('Please enter your full name'); return }
    if (!address) { setError('Please look up your postcode and select your address'); return }
    if (!phone.trim() && !email.trim()) { setError('Please enter a phone number or email'); return }
    setError('')
    onConfirm({ fullName, postcode: resolvedPc || postcode.toUpperCase(), address, email, phone, agreed })
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
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4" style={{ scrollbarWidth: 'thin', scrollbarColor: '#16a34a40 transparent', paddingBottom: activeField ? 320 : undefined }}>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-2xl font-medium">
            ⚠ {error}
          </div>
        )}

        {/* Gift Aid declaration — pre-ticked, mandatory */}
        <button
          type="button"
          onClick={() => setAgreed(a => !a)}
          className={`w-full flex items-start gap-3 p-4 rounded-2xl border-2 text-left transition-all active:scale-[0.98] ${agreed ? 'border-green-400 bg-green-50' : 'border-red-200 bg-red-50'}`}
        >
          <div className={`w-6 h-6 rounded-md border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${agreed ? 'bg-green-500 border-green-500' : 'border-red-400 bg-white'}`}>
            {agreed && <span className="text-white text-xs font-black">✓</span>}
          </div>
          <p className="text-xs leading-relaxed text-left">
            <span className={`font-black text-sm ${agreed ? 'text-gray-900' : 'text-red-700'}`}>Gift Aid Declaration * </span><br />
            <span className="text-gray-700">I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital Gains Tax than the amount of Gift Aid claimed on all my donations in that tax year it is my responsibility to pay any difference.</span>
          </p>
        </button>

        {/* GDPR — pre-ticked */}
        <button
          type="button"
          onClick={() => setGdpr(g => !g)}
          className={`w-full flex items-start gap-3 p-3.5 rounded-2xl border-2 text-left transition-all active:scale-[0.98] ${gdpr ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'}`}
        >
          <div className={`w-6 h-6 rounded-md border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${gdpr ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white'}`}>
            {gdpr && <span className="text-white text-xs font-black">✓</span>}
          </div>
          <p className="text-gray-500 text-xs leading-relaxed">
            <span className="font-semibold text-gray-700">GDPR Consent — </span>
            I consent to Shital Temple processing my personal data for Gift Aid reclaiming purposes under HMRC guidelines. My data will not be shared with third parties.
          </p>
        </button>

        {/* T&C — mandatory, starts un-ticked */}
        <button
          type="button"
          onClick={() => setTerms(t => !t)}
          className={`w-full flex items-start gap-3 p-3.5 rounded-2xl border-2 text-left transition-all active:scale-[0.98] ${terms ? 'border-amber-300 bg-amber-50' : 'border-red-200 bg-red-50'}`}
        >
          <div className={`w-6 h-6 rounded-md border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${terms ? 'bg-amber-500 border-amber-500' : 'border-red-400 bg-white'}`}>
            {terms && <span className="text-white text-xs font-black">✓</span>}
          </div>
          <p className="text-xs leading-relaxed">
            <span className={`font-bold text-sm ${terms ? 'text-amber-800' : 'text-red-700'}`}>Terms &amp; Conditions * </span>
            <span className={terms ? 'text-amber-700' : 'text-red-600'}>
              By proceeding you confirm that your donation is made voluntarily and you agree to our charitable donation terms. This consent is required to continue.
            </span>
          </p>
        </button>

        {/* Full Name */}
        <div>
          <label className="block text-sm font-black text-gray-800 mb-1.5">Full Name <span className="text-red-500">*</span></label>
          <div
            onClick={() => openKb('fullname', fullName)}
            className="w-full border-2 rounded-2xl px-4 py-3.5 text-base font-medium cursor-pointer flex items-center min-h-[52px] bg-white transition-colors"
            style={{ borderColor: activeField === 'fullname' ? '#16a34a' : fullName.length > 1 ? '#16a34a' : '#e5e7eb', boxShadow: activeField === 'fullname' ? '0 0 0 3px #16a34a25' : 'none' }}
          >
            {fullName ? <span className="text-gray-900">{fullName}</span> : <span className="text-gray-400">Tap to enter full name</span>}
          </div>
        </div>

        {/* Postcode → Address */}
        <div>
          <label className="block text-sm font-black text-gray-800 mb-1.5">
            Postcode &amp; Address <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-2">
            <div
              onClick={() => openKb('postcode', postcode)}
              className="flex-1 border-2 rounded-2xl px-4 py-3.5 text-gray-900 text-lg font-mono tracking-widest cursor-pointer flex items-center min-h-[52px] bg-white transition-colors uppercase"
              style={{ borderColor: activeField === 'postcode' ? '#16a34a' : addresses.length > 0 ? '#16a34a' : '#e5e7eb', boxShadow: activeField === 'postcode' ? '0 0 0 3px #16a34a25' : 'none' }}
            >
              {postcode || <span className="text-gray-400 normal-case text-base font-medium">Tap to enter postcode</span>}
            </div>
            <button
              onClick={handleFind}
              disabled={lookingUp || postcode.trim().replace(/\s/g,'').length < 5}
              className="px-6 py-3.5 rounded-2xl font-black text-base text-white disabled:opacity-40 active:scale-95 transition-all flex-shrink-0 shadow-md"
              style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', minWidth: 110 }}
            >
              {lookingUp ? '…' : 'Find'}
            </button>
          </div>

          {/* ── Address picker ── */}
          {addresses.length > 0 && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-3">
              {address ? (
                /* Selected state — show confirmation + change button */
                <div className="flex items-center gap-2 px-4 py-3 rounded-2xl border-2 border-green-400 bg-green-50">
                  <span className="text-green-600 text-lg flex-shrink-0">✓</span>
                  <span className="flex-1 text-green-900 font-bold text-sm">{address}</span>
                  <button
                    onClick={() => setAddress('')}
                    className="text-xs text-green-600 font-semibold underline flex-shrink-0 active:opacity-60"
                  >Change</button>
                </div>
              ) : (
                /* Picker list */
                <div className="border-2 border-green-200 rounded-2xl overflow-hidden">
                  <div className="px-4 py-2 bg-green-50 border-b border-green-100">
                    <span className="text-xs font-bold text-green-700">{addresses.length} addresses — tap to select</span>
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
                    {addresses.map((a, i) => {
                      // Strip trailing postcode to keep rows short
                      const display = a.replace(/,?\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i, '').trim().replace(/,$/, '')
                      return (
                        <button
                          key={i}
                          onClick={() => setAddress(a)}
                          className="w-full text-left px-4 py-3 text-gray-800 text-sm font-medium active:bg-green-50 transition-colors"
                          style={{ borderBottom: i < addresses.length - 1 ? '1px solid #f0fdf4' : 'none' }}
                        >
                          {display}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>

        {/* Phone */}
        <div>
          <label className="block text-sm font-black text-gray-800 mb-1.5">
            Phone Number <span className="text-gray-400 text-xs font-normal">(required if no email)</span>
          </label>
          <div
            onClick={() => openKb('phone', phone)}
            className="w-full border-2 rounded-2xl px-4 py-3.5 text-base font-medium cursor-pointer flex items-center min-h-[52px] bg-white transition-colors"
            style={{ borderColor: activeField === 'phone' ? '#16a34a' : phone.length > 7 ? '#16a34a' : '#e5e7eb', boxShadow: activeField === 'phone' ? '0 0 0 3px #16a34a25' : 'none' }}
          >
            {phone ? <span className="text-gray-900">{phone}</span> : <span className="text-gray-400">Tap to enter phone number</span>}
          </div>
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-black text-gray-800 mb-1.5">
            Email Address <span className="text-gray-400 text-xs font-normal">(required if no phone)</span>
          </label>
          <div
            onClick={() => openKb('email', email)}
            className="w-full border-2 rounded-2xl px-4 py-3.5 text-base font-medium cursor-pointer flex items-center min-h-[52px] bg-white transition-colors"
            style={{ borderColor: activeField === 'email' ? '#16a34a' : email.includes('@') ? '#16a34a' : '#e5e7eb', boxShadow: activeField === 'email' ? '0 0 0 3px #16a34a25' : 'none' }}
          >
            {email ? <span className="text-gray-900">{email}</span> : <span className="text-gray-400">Tap to enter email address</span>}
          </div>
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

      {/* On-screen keyboard */}
      <KioskKeyboard
        value={kbValue}
        onChange={handleKbChange}
        mode={kbMode}
        visible={activeField !== null}
        onDone={() => {
          if (activeField === 'postcode' && postcode.trim().length >= 3) {
            closeKb()
            handleFind()
          } else {
            closeKb()
          }
        }}
        accent="#16a34a"
      />
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
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  const [anonymous,  setAnonymous]  = useState(false)
  const [firstName,  setFirstName]  = useState('')
  const [surname,    setSurname]    = useState('')
  const [email,      setEmail]      = useState('')
  const [phone,      setPhone]      = useState('')
  const [gdpr,       setGdpr]       = useState(true)
  const [terms,      setTerms]      = useState(true)
  const [error,      setError]      = useState('')

  // On-screen keyboard (kiosk only — hidden on mobile)
  const [activeField, setActiveField] = useState<string | null>(null)
  const [kbValue, setKbValue] = useState('')
  const kbMode = activeField === 'phone' ? 'numeric' as const : 'text' as const

  const openKb = (field: string, initial: string) => { if (!isMobile) { setKbValue(initial); setActiveField(field) } }
  const closeKb = () => setActiveField(null)
  const handleKbChange = (v: string) => {
    setKbValue(v)
    if (activeField === 'firstname') setFirstName(v)
    else if (activeField === 'surname') setSurname(v)
    else if (activeField === 'email') setEmail(v)
    else if (activeField === 'phone') setPhone(v)
  }

  function handleContinue() {
    if (!anonymous) {
      if (!firstName.trim()) { setError('Please enter your first name'); return }
      if (!surname.trim()) { setError('Please enter your surname'); return }
      if (!email.trim() || !email.includes('@')) { setError('Please enter a valid email address'); return }
      if (!terms) { setError('Please accept the Terms & Conditions to proceed'); return }
      if (!gdpr) { setError('Please accept the privacy consent'); return }
    }
    setError('')
    onConfirm({ name: `${firstName.trim()} ${surname.trim()}`.trim(), email, phone, anonymous })
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
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4" style={{ scrollbarWidth: 'thin', paddingBottom: activeField ? 320 : undefined }}>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-2xl font-medium">
            ⚠ {error}
          </div>
        )}

        {/* Details / Anonymous radio selector */}
        <div className="flex gap-2">
          {/* Details option */}
          <button
            type="button"
            onClick={() => { setAnonymous(false) }}
            className="flex-1 flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 text-left transition-all active:scale-[0.97]"
            style={{ borderColor: !anonymous ? '#FF9933' : '#e5e7eb', background: !anonymous ? '#FFF7ED' : '#fff' }}
          >
            {/* Radio circle */}
            <div className="w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all"
              style={{ borderColor: !anonymous ? '#FF9933' : '#9CA3AF' }}>
              {!anonymous && <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#FF9933' }} />}
            </div>
            <div>
              <p className="font-black text-sm" style={{ color: !anonymous ? '#C2410C' : '#374151' }}>Details</p>
              <p className="text-[10px] text-gray-400">Name, email or phone</p>
            </div>
          </button>

          {/* Anonymous option */}
          <button
            type="button"
            onClick={() => { setAnonymous(true); setName(''); setEmail(''); setPhone('') }}
            className="flex-1 flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 text-left transition-all active:scale-[0.97]"
            style={{ borderColor: anonymous ? '#6B7280' : '#e5e7eb', background: anonymous ? '#F9FAFB' : '#fff' }}
          >
            {/* Radio circle */}
            <div className="w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all"
              style={{ borderColor: anonymous ? '#6B7280' : '#9CA3AF' }}>
              {anonymous && <div className="w-2.5 h-2.5 rounded-full bg-gray-500" />}
            </div>
            <div>
              <p className="font-black text-sm" style={{ color: anonymous ? '#374151' : '#9CA3AF' }}>Anonymous</p>
              <p className="text-[10px] text-gray-400">No receipt sent</p>
            </div>
          </button>
        </div>

        {/* Receipt info banner — only shown when Details selected */}
        {!anonymous && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex gap-3 items-start">
            <span className="text-xl flex-shrink-0">📧</span>
            <p className="text-amber-800 text-sm leading-snug">
              <span className="font-black">Get your receipt &amp; stay connected.</span><br/>
              By sharing your email or phone, we can send your payment receipt and keep you updated about temple events and services.
            </p>
          </div>
        )}

        {/* Contact fields — hidden when anonymous */}
        {!anonymous && (
          <>
            {/* First Name + Surname side by side */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-sm font-black text-gray-800 mb-1.5">First Name <span className="text-red-500">*</span></label>
                {isMobile ? (
                  <input
                    type="text" inputMode="text" autoCapitalize="words"
                    value={firstName} onChange={e => setFirstName(e.target.value)}
                    placeholder="First name"
                    className="w-full border-2 rounded-2xl px-4 py-3.5 text-base font-medium min-h-[52px] bg-white outline-none"
                    style={{ borderColor: firstName.length > 0 ? '#FF9933' : '#e5e7eb' }}
                  />
                ) : (
                  <div
                    onClick={() => openKb('firstname', firstName)}
                    className="w-full border-2 rounded-2xl px-4 py-3.5 text-base font-medium cursor-pointer flex items-center min-h-[52px] bg-white"
                    style={{ borderColor: activeField === 'firstname' ? '#FF9933' : firstName.length > 0 ? '#FF9933' : '#e5e7eb', boxShadow: activeField === 'firstname' ? '0 0 0 3px #FF993325' : 'none' }}
                  >
                    {firstName ? <span className="text-gray-900">{firstName}</span> : <span className="text-gray-400">First name</span>}
                  </div>
                )}
              </div>
              <div className="flex-1">
                <label className="block text-sm font-black text-gray-800 mb-1.5">Surname <span className="text-red-500">*</span></label>
                {isMobile ? (
                  <input
                    type="text" inputMode="text" autoCapitalize="words"
                    value={surname} onChange={e => setSurname(e.target.value)}
                    placeholder="Surname"
                    className="w-full border-2 rounded-2xl px-4 py-3.5 text-base font-medium min-h-[52px] bg-white outline-none"
                    style={{ borderColor: surname.length > 0 ? '#FF9933' : '#e5e7eb' }}
                  />
                ) : (
                  <div
                    onClick={() => openKb('surname', surname)}
                    className="w-full border-2 rounded-2xl px-4 py-3.5 text-base font-medium cursor-pointer flex items-center min-h-[52px] bg-white"
                    style={{ borderColor: activeField === 'surname' ? '#FF9933' : surname.length > 0 ? '#FF9933' : '#e5e7eb', boxShadow: activeField === 'surname' ? '0 0 0 3px #FF993325' : 'none' }}
                  >
                    {surname ? <span className="text-gray-900">{surname}</span> : <span className="text-gray-400">Surname</span>}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-black text-gray-800 mb-1.5">Email Address <span className="text-red-500">*</span></label>
              {isMobile ? (
                <input
                  type="email" inputMode="email"
                  value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full border-2 rounded-2xl px-4 py-3.5 text-base font-medium min-h-[52px] bg-white outline-none"
                  style={{ borderColor: email.includes('@') ? '#FF9933' : '#e5e7eb' }}
                />
              ) : (
                <div
                  onClick={() => openKb('email', email)}
                  className="w-full border-2 rounded-2xl px-4 py-3.5 text-base font-medium cursor-pointer flex items-center min-h-[52px] bg-white transition-colors"
                  style={{ borderColor: activeField === 'email' ? '#FF9933' : email.includes('@') ? '#FF9933' : '#e5e7eb', boxShadow: activeField === 'email' ? '0 0 0 3px #FF993325' : 'none' }}
                >
                  {email ? <span className="text-gray-900">{email}</span> : <span className="text-gray-400">Tap to enter email address</span>}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-black text-gray-800 mb-1.5">Phone / WhatsApp <span className="text-gray-400 font-normal text-xs">(optional)</span></label>
              {isMobile ? (
                <input
                  type="tel" inputMode="tel"
                  value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="07700 000000"
                  className="w-full border-2 rounded-2xl px-4 py-3.5 text-base font-medium min-h-[52px] bg-white outline-none"
                  style={{ borderColor: phone.length > 7 ? '#FF9933' : '#e5e7eb' }}
                />
              ) : (
                <div
                  onClick={() => openKb('phone', phone)}
                  className="w-full border-2 rounded-2xl px-4 py-3.5 text-base font-medium cursor-pointer flex items-center min-h-[52px] bg-white transition-colors"
                  style={{ borderColor: activeField === 'phone' ? '#FF9933' : phone.length > 7 ? '#FF9933' : '#e5e7eb', boxShadow: activeField === 'phone' ? '0 0 0 3px #FF993325' : 'none' }}
                >
                  {phone ? <span className="text-gray-900">{phone}</span> : <span className="text-gray-400">Tap to enter phone number</span>}
                </div>
              )}
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

        {/* T&C — only when Details selected */}
        {!anonymous && (
          <button onClick={() => setTerms(t => !t)}
            className={`w-full flex items-start gap-3 p-3.5 rounded-2xl border-2 text-left transition-all ${terms ? 'border-orange-300 bg-orange-50' : 'border-red-200 bg-red-50'}`}>
            <div className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${terms ? 'bg-orange-500 border-orange-500' : 'border-red-400 bg-white'}`}>
              {terms && <span className="text-white text-[9px] font-black">✓</span>}
            </div>
            <p className="text-xs leading-relaxed">
              <span className={`font-bold text-sm ${terms ? 'text-orange-800' : 'text-red-700'}`}>Terms & Conditions * </span>
              <span className={terms ? 'text-gray-500' : 'text-red-600'}>
                All payments are voluntary donations to Shital Temple, a registered UK charity. Donations are non-refundable unless made in error. By proceeding you confirm you are authorised to make this payment.
              </span>
            </p>
          </button>
        )}

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

      {/* On-screen keyboard */}
      <KioskKeyboard
        value={kbValue}
        onChange={handleKbChange}
        mode={kbMode}
        visible={activeField !== null}
        onDone={closeKb}
        accent="#FF9933"
      />
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

      {/* ── Bottom buttons — all in one row, graduated sizing ── */}
      <div
        className="flex-shrink-0 px-4 pt-3 pb-4"
        style={{ borderTop: '1px solid #e5e7eb', background: '#fff' }}
      >
        <div className="flex gap-2 items-stretch">

          {/* Start Again — smallest */}
          <button
            onClick={() => { if (window.confirm('Clear basket and start again?')) { resetKiosk(); setScreen('home') } }}
            className="flex-none px-2.5 py-3 rounded-xl border border-gray-200 text-gray-400 font-medium text-[11px] leading-tight active:scale-95 transition-all text-center"
            style={{ minWidth: 52 }}
          >
            Start<br/>Again
          </button>

          {/* Back — slightly larger */}
          <button
            onClick={() => setScreen('home')}
            className="flex-none px-3 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm active:scale-95 transition-all"
            style={{ minWidth: 72 }}
          >
            ← Back
          </button>

          {/* Confirm & Pay — medium-large */}
          {items.length > 0 && (
            <button
              onClick={handleNormalCheckout}
              className="flex-1 py-3 rounded-xl font-black text-sm active:scale-[0.97] transition-all"
              style={hasEligible
                ? { border: '2px solid #d1d5db', color: '#374151', background: '#fff' }
                : { background: th.langActive, color: '#fff', boxShadow: `0 4px 14px ${th.langActive}50` }
              }
            >
              {hasEligible && <div className="text-[10px] font-semibold opacity-60 mb-0.5">Without Gift Aid</div>}
              <div>Pay · £{total.toFixed(2)}</div>
            </button>
          )}

          {/* Boost with Gift Aid — biggest */}
          {items.length > 0 && hasEligible && (
            <button
              onClick={() => setShowGiftAid(true)}
              className="flex-[1.4] py-3 rounded-xl text-white font-black text-sm shadow-lg active:scale-[0.97] transition-all"
              style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}
            >
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <span className="text-base">🇬🇧</span>
                <span className="text-xs text-green-200">Boost with Gift Aid (£{giftAidBonus.toFixed(2)} for free)</span>
              </div>
              <div>Temple gets £{(total + giftAidBonus).toFixed(2)}</div>
            </button>
          )}

        </div>
      </div>
    </motion.div>
  )
}
