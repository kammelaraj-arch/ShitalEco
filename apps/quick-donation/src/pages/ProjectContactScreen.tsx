import { useState } from 'react'
import { useDonationStore } from '../store/donation.store'
import { TILE_CATALOG } from './ProjectStartScreen'

// Mandatory donor-details form for the project donation flow. Gift Aid
// defaults ON (per operator direction) but can be unticked. On submit we
// stash the data into pendingGiftAid + the amount already set from the
// tier screen, then advance to the existing 'tap' screen which handles
// the card reader + payment confirmation — same flow as today's Quick
// Donation Other Amount path.
export function ProjectContactScreen() {
  const { pickedCategory, amount, setPendingGiftAid, setScreen } = useDonationStore()
  const tile = TILE_CATALOG.find(t => t.id === pickedCategory)
  const accent = tile?.accent || '#F6C454'

  const [firstName, setFirstName] = useState('')
  const [surname, setSurname]     = useState('')
  const [email, setEmail]         = useState('')
  const [phone, setPhone]         = useState('')
  const [houseNum, setHouseNum]   = useState('')
  const [postcode, setPostcode]   = useState('')
  const [giftAid, setGiftAid]     = useState(true)   // defaults ON

  const canContinue =
    firstName.trim().length > 0 &&
    surname.trim().length > 0 &&
    email.trim().length > 3 &&
    phone.trim().length > 3 &&
    houseNum.trim().length > 0 &&
    postcode.trim().length > 0

  function submit() {
    if (!canContinue) return
    setPendingGiftAid({
      firstName: firstName.trim(),
      surname: surname.trim(),
      houseNum: houseNum.trim(),
      postcode: postcode.trim().toUpperCase(),
      email: email.trim().toLowerCase(),
    })
    // Gift Aid elected? The existing /quick-donation/record path reads
    // pendingGiftAid and records a gift_aid_declarations row when the
    // user ticks it. We clear pendingGiftAid if they untick so the
    // record call still succeeds but skips the declaration insert.
    if (!giftAid) {
      setPendingGiftAid(null)
    }
    setScreen('tap')
  }

  return (
    <div className="min-h-screen px-4 py-5 text-white"
         style={{ background: `linear-gradient(170deg, ${tile?.bg || '#140606'} 0%, #140606 100%)` }}>
      <header className="flex items-center mb-5">
        <button onClick={() => setScreen('project-tiers')}
                className="px-3 py-2 rounded-xl text-white/80 hover:bg-white/10 text-sm">
          ← Back
        </button>
        <div className="ml-3 flex-1">
          <div className="text-xs uppercase tracking-widest" style={{ color: accent }}>Your details</div>
          <div className="font-black text-2xl" style={{ fontFamily: 'serif' }}>
            £{amount.toFixed(2)} · {tile?.name}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <Field label="First name *" value={firstName} onChange={setFirstName} placeholder="Raj" />
        <Field label="Surname *"    value={surname}   onChange={setSurname}   placeholder="Patel" />
        <Field label="Email *"      value={email}     onChange={setEmail}     placeholder="you@example.com" type="email" full />
        <Field label="Phone *"      value={phone}     onChange={setPhone}     placeholder="07700 900 000" type="tel" />
        <Field label="Postcode *"   value={postcode}  onChange={v => setPostcode(v.toUpperCase())} placeholder="HA9 0ZZ" />
        <Field label="House / street *" value={houseNum} onChange={setHouseNum} placeholder="140 White Lion Rd" full />
      </div>

      <label className="flex items-center gap-3 rounded-2xl p-4 cursor-pointer"
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

      <button
        disabled={!canContinue}
        onClick={submit}
        className="w-full mt-5 py-5 rounded-2xl font-black text-xl disabled:opacity-40"
        style={{ background: accent, color: '#180324' }}>
        Continue to card tap →
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
