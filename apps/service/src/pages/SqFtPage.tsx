import { useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'

// Dedicated "Sponsor a Square Foot" donation page for the Future Legacy
// Appeal (paying off the mortgage on the residential property beside the
// Wembley temple). The donor chooses how many square feet to sponsor at a
// fixed £351 each, sees which donor-wall tier they reach, then adds a single
// gift-aid-eligible DONATION line item to the basket and continues through
// the normal basket → contact → gift-aid → payment (PayPal) checkout.
//
// Reuses the existing basket exactly like CustomDonationCard: one addItem()
// then setScreen('basket'). Nothing new on the payment path.

const PRICE_PER_SQFT = 351
const PRESETS = [1, 5, 10, 25]
const SAI_IMG =
  'https://admin.shital.org.uk/api/v1/media/library/00a4a66d-d25b-4195-8d33-57b1f2853f63'

function tierFor(sqft: number, total: number): { label: string; blurb: string } {
  if (total >= 5000) return { label: 'Founder Panel', blurb: 'A premium Founder panel on the donor wall' }
  if (sqft >= 10)    return { label: 'Name Block',    blurb: 'A larger dedicated name block on the donor wall' }
  return { label: 'Donor Wall', blurb: 'Your name engraved on the donor wall' }
}

export function SqFtPage() {
  const addItem   = useStore(s => s.addItem)
  const setScreen = useStore(s => s.setScreen)

  const [sqft, setSqft] = useState<number>(1)

  const valid = Number.isFinite(sqft) && sqft >= 1
  const total = (valid ? sqft : 0) * PRICE_PER_SQFT
  const tier  = tierFor(sqft, total)

  function setPreset(n: number) { setSqft(n) }
  function step(delta: number)  { setSqft(s => Math.max(1, Math.min(9999, (Number.isFinite(s) ? s : 0) + delta))) }

  function addToBasket() {
    if (!valid) return
    addItem({
      type: 'DONATION',
      name: `Square Foot Sponsorship (${sqft} sq ft)`,
      quantity: 1,
      unitPrice: total,
      totalPrice: total,
      // Unique ref so each sponsorship is its own basket line (never merged
      // with a later one) — addItem dedupes on referenceId+type.
      referenceId: `sqft-${Date.now()}`,
      giftAidEligible: true,
      category: 'SPONSORSHIP',
    })
    setScreen('basket')
  }

  const goldBtn: React.CSSProperties = {
    background: 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)',
    color: '#4a0e18', boxShadow: '0 6px 20px rgba(212,175,55,0.4)',
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto px-4 py-6"
    >
      <button onClick={() => setScreen('browse')}
        className="text-sm font-semibold mb-4 opacity-75 hover:opacity-100 transition-opacity"
        style={{ color: 'var(--text-muted)' }}>← Back</button>

      {/* Hero */}
      <div className="text-center mb-6">
        <img src={SAI_IMG} alt="Shirdi Sai Baba" loading="eager"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          className="mx-auto mb-4"
          style={{ width: 140, height: 'auto', borderRadius: 16, border: '2px solid rgba(212,175,55,0.6)',
                   boxShadow: '0 10px 30px rgba(0,0,0,0.45)' }} />
        <p className="text-xs font-bold tracking-widest uppercase" style={{ color: 'rgba(212,175,55,0.85)' }}>
          Future Legacy Appeal
        </p>
        <h1 className="font-display text-2xl sm:text-3xl font-black mt-1" style={{ color: 'var(--text)' }}>
          Sponsor a Square Foot
        </h1>
        <p className="text-sm mt-3 max-w-lg mx-auto" style={{ color: 'var(--text-muted)' }}>
          Help pay off the mortgage on the residential property beside our Wembley temple.
          Every square foot you sponsor is <strong style={{ color: 'var(--text)' }}>£351</strong> — and your
          name goes on our <strong style={{ color: 'var(--text)' }}>donor wall</strong>, forever part of the foundation.
        </p>
      </div>

      {/* Selector card */}
      <div className="temple-card p-5">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: 'rgba(212,175,55,0.85)' }}>
          How many square feet?
        </p>

        {/* Presets */}
        <div className="flex flex-wrap gap-2 mb-4">
          {PRESETS.map(n => {
            const on = sqft === n
            return (
              <button key={n} onClick={() => setPreset(n)}
                className="px-3.5 py-2 rounded-xl font-black text-sm transition-all active:scale-95"
                style={on ? goldBtn : {
                  background: 'rgba(0,0,0,0.25)', color: 'var(--text)',
                  border: '1.5px solid rgba(212,175,55,0.5)',
                }}>
                {n} sq ft
              </button>
            )
          })}
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-4 mb-1">
          <button onClick={() => step(-1)} aria-label="Fewer"
            className="w-11 h-11 rounded-full font-black text-xl active:scale-90 transition-transform"
            style={{ background: 'rgba(0,0,0,0.25)', color: 'var(--text)', border: '1.5px solid rgba(212,175,55,0.5)' }}>−</button>
          <input
            type="number" inputMode="numeric" min={1} max={9999} value={Number.isFinite(sqft) ? sqft : ''}
            onChange={e => setSqft(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            className="w-24 text-center py-2 rounded-xl text-2xl font-black outline-none price-display"
            style={{ background: 'rgba(0,0,0,0.30)', border: '1.5px solid rgba(212,175,55,0.35)', color: 'var(--text)' }} />
          <button onClick={() => step(1)} aria-label="More"
            className="w-11 h-11 rounded-full font-black text-xl active:scale-90 transition-transform"
            style={{ background: 'rgba(0,0,0,0.25)', color: 'var(--text)', border: '1.5px solid rgba(212,175,55,0.5)' }}>+</button>
        </div>
        <p className="text-center text-xs" style={{ color: 'var(--text-faint)' }}>square feet</p>

        {/* Total */}
        <div className="mt-4 pt-4 flex items-baseline justify-between"
          style={{ borderTop: '1px solid rgba(212,175,55,0.2)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
            {valid ? sqft : 0} × £{PRICE_PER_SQFT}
          </span>
          <span className="font-black text-3xl price-display" style={{ color: 'var(--text)' }}>
            £{total.toLocaleString('en-GB')}
          </span>
        </div>

        {/* Tier + Gift Aid */}
        {valid && (
          <div className="mt-3 rounded-xl px-3 py-2.5 text-center"
            style={{ background: 'rgba(212,175,55,0.12)', border: '1px solid rgba(212,175,55,0.3)' }}>
            <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'rgba(212,175,55,0.95)' }}>
              🏛 {tier.label}
            </span>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{tier.blurb}</p>
          </div>
        )}

        <button onClick={addToBasket} disabled={!valid}
          className="w-full mt-4 py-3.5 rounded-xl font-black text-base transition-all active:scale-[0.98] disabled:opacity-50"
          style={valid ? goldBtn : { background: 'rgba(0,0,0,0.3)', color: 'var(--text-muted)', border: '1.5px solid rgba(212,175,55,0.4)' }}>
          {valid ? `Sponsor ${sqft} sq ft · £${total.toLocaleString('en-GB')} →` : 'Choose square feet'}
        </button>

        <p className="text-[11px] mt-2 text-center" style={{ color: 'rgba(74,222,128,0.75)' }}>
          ✓ Gift Aid eligible — adds 25% at no cost to you
        </p>
      </div>

      {/* Recognition tiers */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {[
          { a: '1 sq ft · £351', t: 'Your name on the donor wall' },
          { a: '10+ sq ft', t: 'A larger dedicated name block' },
          { a: '£5,000+', t: 'A Founder panel' },
        ].map((r) => (
          <div key={r.a} className="rounded-xl px-3 py-3 text-center"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,175,55,0.2)' }}>
            <p className="text-sm font-black" style={{ color: 'rgba(212,175,55,0.95)' }}>{r.a}</p>
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{r.t}</p>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
