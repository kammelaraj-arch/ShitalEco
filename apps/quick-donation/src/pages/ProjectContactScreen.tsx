import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'
import { TILE_CATALOG } from './ProjectStartScreen'
import { PLEDGE_CATEGORIES } from './ProjectPledgeScreen'

// Shared donor-details form for every Project Donation flow that needs
// contact capture.
//
// Mode is derived from pickedCategory:
//   PAYMENT: brick / sqft / general / any → fills pendingGiftAid + sets
//           Amount → goes to the Tap screen for a card payment.
//   PLEDGE:  services / volunt / material / business → posts
//           /kiosk/project-pledge with selectedPledgeItems + donor
//           fields, no card tap, no Gift Aid block (there's no payment
//           to Gift-Aid).
//
// Address capture is the SAME postcode-lookup flow the service portal
// + kiosk Gift Aid form use.
interface LookupAddress { formatted: string; uprn: string }

export function ProjectContactScreen() {
  const {
    pickedCategory, amount, setPendingGiftAid, setScreen,
    selectedPledgeItems, branchId, kioskDeviceId, setSelectedPledgeItems,
  } = useDonationStore()
  const tile = TILE_CATALOG.find(t => t.id === pickedCategory)
  const accent = tile?.accent || '#F6C454'
  const isPledge = PLEDGE_CATEGORIES.has(pickedCategory)

  const [firstName, setFirstName] = useState('')
  const [surname, setSurname]     = useState('')
  const [email, setEmail]         = useState('')
  const [phone, setPhone]         = useState('')
  const [postcode, setPostcode]   = useState('')
  const [notes, setNotes]         = useState('')
  const [giftAid, setGiftAid]     = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr]   = useState('')
  const [pledgeDone, setPledgeDone] = useState(false)

  // Address lookup state — mirrors apps/service AddressLookup.tsx
  const [results, setResults]   = useState<LookupAddress[]>([])
  const [address, setAddress]   = useState<string>('')
  const [uprn, setUprn]         = useState<string>('')
  const [lookupErr, setLookupErr] = useState('')
  const [looking, setLooking]   = useState(false)

  async function findAddress() {
    setLookupErr('')
    setResults([])
    const pc = postcode.trim()
    if (pc.length < 3) {
      setLookupErr('Enter a postcode first')
      return
    }
    setLooking(true)
    try {
      const r = await fetch(`/api/v1/kiosk/postcode/${encodeURIComponent(pc)}`)
      if (!r.ok) {
        setLookupErr('Lookup failed — try again')
        return
      }
      const d = await r.json() as { addresses?: unknown[] }
      const raw: unknown[] = d.addresses ?? []
      const found: LookupAddress[] = raw.map((a) =>
        typeof a === 'string'
          ? { formatted: a, uprn: '' }
          : { formatted: (a as { formatted?: string }).formatted ?? '',
              uprn:      (a as { uprn?: string }).uprn ?? '' })
      setResults(found)
      if (!found.length) setLookupErr('No addresses found — check the postcode')
    } catch {
      setLookupErr('Lookup offline — try again')
    } finally {
      setLooking(false)
    }
  }

  function clearAddress() {
    setAddress('')
    setUprn('')
    setResults([])
  }

  const canContinue =
    firstName.trim().length > 0 &&
    surname.trim().length > 0 &&
    email.trim().length > 3 &&
    phone.trim().length > 3 &&
    postcode.trim().length > 0 &&
    address.length > 0

  async function submit() {
    if (!canContinue) return
    // Pledge flow — no card tap. Post the selections + donor fields to
    // /kiosk/project-pledge, clear the staged items, show confirmation.
    if (isPledge) {
      setSubmitting(true)
      setSubmitErr('')
      try {
        const r = await fetch('/api/v1/kiosk/project-pledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category:        pickedCategory,
            selected_items:  selectedPledgeItems,
            donor_name:      `${firstName.trim()} ${surname.trim()}`.trim(),
            donor_email:     email.trim().toLowerCase(),
            donor_phone:     phone.trim(),
            notes:           [address, postcode.trim().toUpperCase(), notes.trim()]
                               .filter(Boolean).join(' — '),
            branch_id:       branchId || null,
            kiosk_device_id: kioskDeviceId || null,
          }),
        })
        if (!r.ok) {
          const d = await r.json().catch(() => null)
          setSubmitErr(d?.detail || 'Could not save — try again')
          return
        }
        setSelectedPledgeItems([])
        setPledgeDone(true)
        // Auto-return to the tile grid after a few seconds so the next
        // donor sees a clean screen.
        setTimeout(() => setScreen('donate'), 3500)
      } catch {
        setSubmitErr('Save failed — try again')
      } finally {
        setSubmitting(false)
      }
      return
    }
    // Payment flow — stash Gift Aid payload, go to card tap.
    setPendingGiftAid({
      firstName: firstName.trim(),
      surname: surname.trim(),
      // Backend's gift_aid_declarations only has houseNum + postcode —
      // we pass the picked (PAF-matched) formatted address as houseNum
      // so the declaration always carries real PAF data.
      houseNum: address,
      postcode: postcode.trim().toUpperCase(),
      email: email.trim().toLowerCase(),
    })
    if (!giftAid) setPendingGiftAid(null)
    setScreen('tap')
  }

  const addressSelected = address.length > 0

  // Pledge thank-you — short "Dhanyavaad" overlay with a very explicit
  // "no payment" banner (operator asked for this — a donor who ticked
  // Volunteering shouldn't be left wondering whether a card charge is
  // coming), auto-returns to the tile grid via the setTimeout above.
  if (pledgeDone) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-white"
           style={{ background: `linear-gradient(170deg, ${tile?.bg || '#140606'} 0%, #140606 100%)` }}>
        <div className="text-7xl mb-4">🙏</div>
        <h1 className="text-4xl font-black mb-2" style={{ fontFamily: 'serif' }}>Dhanyavaad!</h1>
        <p className="text-lg opacity-80 text-center max-w-md mb-5">
          Thank you for offering {tile?.name?.toLowerCase() ?? 'your support'}. Someone from the temple will be in touch soon.
        </p>
        {/* No-payment banner — impossible to miss, mirrors the email we
            send so the donor sees the same reassurance on both channels */}
        <div className="rounded-2xl px-5 py-4 max-w-md text-center"
             style={{
               background: 'rgba(74,222,128,0.15)',
               border: '2px solid rgba(74,222,128,0.6)',
               boxShadow: '0 0 24px rgba(74,222,128,0.25)',
             }}>
          <div className="font-black text-base" style={{ color: '#BCE7CB' }}>
            ✓ This is a volunteer offer — no payment required
          </div>
          <div className="text-sm mt-1 opacity-80" style={{ color: '#BCE7CB' }}>
            You won't be charged. We're just recording what you kindly offered to help with.
          </div>
        </div>
        {email.trim() && (
          <p className="text-xs mt-4 opacity-60">
            A confirmation has been emailed to {email.trim().toLowerCase()}.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 py-5 text-white"
         style={{ background: `linear-gradient(170deg, ${tile?.bg || '#140606'} 0%, #140606 100%)` }}>
      <header className="flex items-center mb-5">
        <button onClick={() => setScreen(isPledge ? 'project-pledge' : 'project-tiers')}
                className="px-4 py-2 rounded-xl text-white font-bold text-sm hover:bg-white/15 border border-white/25"
                style={{ background: 'rgba(255,255,255,0.08)' }}>
          ← Back
        </button>
        <div className="ml-3 flex-1">
          <div className="text-xs uppercase tracking-widest" style={{ color: accent }}>Your details</div>
          <div className="font-black text-2xl" style={{ fontFamily: 'serif' }}>
            {isPledge
              ? `${tile?.emoji ?? ''} ${tile?.name ?? ''} · ${selectedPledgeItems.length} selected`
              : `£${amount.toFixed(2)} · ${tile?.name ?? ''}`}
          </div>
        </div>
      </header>

      {/* Up-front "no payment" reassurance on the form itself, so donors
          see it BEFORE they hand over contact details — not only on the
          thank-you screen afterwards. Payment flows don't show this. */}
      {isPledge && (
        <div className="rounded-2xl px-4 py-3 mb-4 flex items-center gap-3"
             style={{
               background: 'rgba(74,222,128,0.1)',
               border: '1px solid rgba(74,222,128,0.4)',
             }}>
          <div className="text-2xl">✓</div>
          <div>
            <div className="font-bold text-sm" style={{ color: '#BCE7CB' }}>
              This is a volunteer offer — no payment required
            </div>
            <div className="text-xs opacity-80" style={{ color: '#BCE7CB' }}>
              We just need a few details so the temple can get in touch.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-4">
        <Field label="First name *" value={firstName} onChange={setFirstName} placeholder="Raj" />
        <Field label="Surname *"    value={surname}   onChange={setSurname}   placeholder="Patel" />
        <Field label="Email *"      value={email}     onChange={setEmail}     placeholder="you@example.com" type="email" full />
        <Field label="Phone *"      value={phone}     onChange={setPhone}     placeholder="07700 900 000" type="tel" full />
      </div>

      {/* Postcode row + Find address — hidden once an address is picked */}
      {!addressSelected && (
        <div>
          <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1">Postcode *</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={postcode}
              onChange={e => setPostcode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && findAddress()}
              placeholder="HA9 0ZZ"
              className="flex-1 bg-black/30 rounded-xl px-4 py-3 text-base text-white outline-none uppercase"
            />
            <button
              type="button"
              disabled={looking || postcode.trim().length < 3}
              onClick={findAddress}
              className="px-5 py-3 rounded-xl font-black text-base disabled:opacity-40 border border-white/30 hover:brightness-110 shadow-lg"
              style={{
                background: '#F6C454',
                color: '#180324',
                boxShadow: '0 4px 14px rgba(246,196,84,0.35)',
              }}>
              {looking ? 'Searching…' : 'Find address'}
            </button>
          </div>
          {lookupErr && (
            <div className="text-sm mt-2" style={{ color: '#FF9B9B' }}>{lookupErr}</div>
          )}

          {/* Dropdown of matching addresses */}
          <AnimatePresence>
            {results.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mt-3">
                <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1">
                  Select your address *
                </div>
                <select
                  value={address}
                  onChange={e => {
                    const v = e.target.value
                    const chosen = results.find(r => r.formatted === v)
                    setAddress(v)
                    setUprn(chosen?.uprn ?? '')
                  }}
                  className="w-full bg-black/30 rounded-xl px-4 py-3 text-base text-white outline-none">
                  <option value="">— Select —</option>
                  {results.map((a, i) => (
                    <option key={i} value={a.formatted} style={{ background: '#1a0a0a' }}>
                      {a.formatted}
                    </option>
                  ))}
                </select>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Locked address panel with Change button */}
      {addressSelected && (
        <div className="rounded-2xl p-4"
             style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.35)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: '#BCE7CB' }}>
                ✓ Address
              </div>
              <div className="font-bold text-base">{address}</div>
              {uprn && (
                <div className="text-[10px] opacity-60 font-mono mt-1">UPRN {uprn}</div>
              )}
            </div>
            <button
              type="button"
              onClick={clearAddress}
              className="px-3 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/15 shrink-0">
              Change
            </button>
          </div>
        </div>
      )}

      {/* Gift Aid consent — only on PAYMENT flows. Nothing to Gift-Aid
          on a pledge (no card is tapped). */}
      {!isPledge && (
        <label className="flex items-center gap-3 rounded-2xl p-4 cursor-pointer mt-4"
               style={{
                 background: giftAid ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.03)',
                 border: `1px solid ${giftAid ? 'rgba(74,222,128,0.5)' : 'rgba(255,255,255,0.1)'}`,
               }}>
          <input type="checkbox" checked={giftAid} onChange={e => setGiftAid(e.target.checked)} className="w-5 h-5 accent-green-500" />
          <div className="flex-1">
            <div className="font-bold text-sm" style={{ color: giftAid ? '#BCE7CB' : '#FFF' }}>
              🇬🇧 Gift Aid — boosts your donation by 25% at no cost
            </div>
            <div className="text-xs opacity-70 mt-0.5">
              I confirm I pay enough UK Income Tax to cover the Gift Aid on my donation.
            </div>
          </div>
        </label>
      )}

      {/* Optional free-text notes — pledge flow only. The text rides along
          on the project_pledges row so the admin has context when they
          follow up (e.g. "available weekends", "20 years PQS experience"). */}
      {isPledge && (
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1">Anything else (optional)</div>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Availability, relevant experience, etc."
            className="w-full bg-black/30 rounded-xl px-4 py-3 text-base text-white outline-none" />
        </div>
      )}

      {submitErr && (
        <div className="mt-3 text-sm" style={{ color: '#FF9B9B' }}>{submitErr}</div>
      )}

      <button
        disabled={!canContinue || submitting}
        onClick={submit}
        className="w-full mt-5 py-5 rounded-2xl font-black text-xl disabled:opacity-40 border-2 border-white/40 hover:brightness-110"
        style={{
          background: '#F6C454',
          color: '#180324',
          boxShadow: '0 8px 28px rgba(246,196,84,0.45)',
        }}>
        {submitting
          ? 'Saving…'
          : isPledge
            ? `Submit pledge (${selectedPledgeItems.length}) →`
            : 'Continue to card tap →'}
      </button>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type, full }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  type?: string
  full?: boolean
}) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1">{label}</div>
      <input
        type={type || 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-black/30 rounded-xl px-4 py-3 text-base text-white outline-none"
      />
    </div>
  )
}
