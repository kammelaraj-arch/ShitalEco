import { useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'

// "Sponsor the Build" — physical-unit sponsorship for the Future Legacy
// Appeal (pay off the mortgage + the interim extension beside the Wembley
// temple). Devotees sponsor bricks, square feet, windows, a doorway or a
// whole room; each choice adds a single gift-aid-eligible DONATION line
// item to the basket and continues through the normal basket → contact →
// gift-aid → payment (PayPal) checkout — reusing the basket exactly like
// CustomDonationCard. Screen id stays 'sqft' so existing links/QRs work.

const SAI_IMG =
  'https://admin.shital.org.uk/api/v1/media/library/00a4a66d-d25b-4195-8d33-57b1f2853f63'

interface Product {
  key: string
  tier: string       // Square Foot, Red Brick, …
  emoji?: string     // defaults to 🧱
  color: string      // accent / plaque colour
  price: number
  blurb: string
  wall: string       // recognition on the digital donor wall
  featured?: boolean
}

// Every gift funds the one Future Legacy Appeal. The Square Foot is the
// priority — it clears the mortgage (secures the ground). Bricks help build
// the future. The higher the tier, the larger the name on the temple's
// (virtual) donor wall.
const PRODUCTS: Product[] = [
  { key: 'sqft',   tier: 'Square Foot', emoji: '🏛', color: '#d4af37', price: 351, featured: true,
    blurb: 'Secures a square foot of the sacred ground — this clears the mortgage.',
    wall: 'Your name on the digital donor wall' },
  { key: 'red',    tier: 'Red Brick',    color: '#c0392b', price: 51,
    blurb: 'A brick to build our future — for every devotee, child and family.',
    wall: 'Your name on the donor wall' },
  { key: 'bronze', tier: 'Bronze Brick', color: '#cd7f32', price: 151,
    blurb: 'A lasting mark of your seva.',
    wall: 'A bronze plaque on the donor wall' },
  { key: 'gold',   tier: 'Gold Brick',   color: '#d4af37', price: 1008,
    blurb: 'A generous gift that builds the future.',
    wall: 'A prominent gold plaque' },
  { key: 'founder', tier: 'Founder Brick', color: '#e5e4e2', price: 5100,
    blurb: 'Help shape a whole space in the new build.',
    wall: 'A premium Founder panel — our largest recognition' },
]

const gbp = (n: number) => '£' + n.toLocaleString('en-GB')

const goldBtn: React.CSSProperties = {
  background: 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)',
  color: '#4a0e18', boxShadow: '0 6px 20px rgba(212,175,55,0.4)',
}

function SponsorCard({ p }: { p: Product }) {
  const addItem = useStore(s => s.addItem)
  const setScreen = useStore(s => s.setScreen)
  const [qty, setQty] = useState(1)

  const valid = Number.isFinite(qty) && qty >= 1
  const total = (valid ? qty : 0) * p.price

  function add() {
    if (!valid) return
    addItem({
      type: 'DONATION',
      name: `${p.tier}${qty > 1 ? ` ×${qty}` : ''}`,
      quantity: qty,
      unitPrice: p.price,
      totalPrice: total,
      referenceId: `${p.key}-${Date.now()}`,
      giftAidEligible: true,
      category: 'SPONSORSHIP',
    })
    setScreen('basket')
  }

  return (
    <div className="temple-card p-4 flex flex-col"
      style={{ borderLeft: `4px solid ${p.color}`,
               ...(p.featured ? { boxShadow: `0 0 24px -6px ${p.color}88` } : {}) }}>
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 text-xl"
          style={{ background: `linear-gradient(135deg, ${p.color}, ${p.color}bb)`,
                   border: '1px solid rgba(255,255,255,0.25)', boxShadow: `0 2px 12px ${p.color}66` }}>
          {p.emoji ?? '🧱'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm leading-tight" style={{ color: 'var(--text)' }}>{p.tier}</p>
          <p className="text-lg font-black price-display" style={{ color: 'rgba(212,175,55,0.95)' }}>{gbp(p.price)}<span className="text-[11px] font-semibold opacity-70"> each</span></p>
        </div>
      </div>

      <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>{p.blurb}</p>
      <p className="text-[11px] mt-1.5 font-semibold" style={{ color: 'rgba(212,175,55,0.85)' }}>🏛 {p.wall}</p>

      {/* Quantity stepper */}
      <div className="flex items-center justify-center gap-3 mt-3">
        <button onClick={() => setQty(q => Math.max(1, (Number.isFinite(q) ? q : 1) - 1))} aria-label="Fewer"
          className="w-9 h-9 rounded-full font-black text-lg active:scale-90 transition-transform"
          style={{ background: 'rgba(0,0,0,0.25)', color: 'var(--text)', border: '1.5px solid rgba(212,175,55,0.5)' }}>−</button>
        <input type="number" inputMode="numeric" min={1} max={9999} value={Number.isFinite(qty) ? qty : ''}
          onChange={e => setQty(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          className="w-16 text-center py-1.5 rounded-lg text-lg font-black outline-none price-display"
          style={{ background: 'rgba(0,0,0,0.30)', border: '1.5px solid rgba(212,175,55,0.35)', color: 'var(--text)' }} />
        <button onClick={() => setQty(q => Math.min(9999, (Number.isFinite(q) ? q : 0) + 1))} aria-label="More"
          className="w-9 h-9 rounded-full font-black text-lg active:scale-90 transition-transform"
          style={{ background: 'rgba(0,0,0,0.25)', color: 'var(--text)', border: '1.5px solid rgba(212,175,55,0.5)' }}>+</button>
      </div>

      <button onClick={add} disabled={!valid}
        className="w-full mt-3 py-2.5 rounded-xl font-black text-sm transition-all active:scale-[0.98] disabled:opacity-50"
        style={valid ? goldBtn : { background: 'rgba(0,0,0,0.3)', color: 'var(--text-muted)', border: '1.5px solid rgba(212,175,55,0.4)' }}>
        Add {gbp(total)} to basket →
      </button>
    </div>
  )
}

export function SqFtPage() {
  const setScreen = useStore(s => s.setScreen)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="max-w-3xl mx-auto px-4 py-6"
    >
      <button onClick={() => setScreen('browse')}
        className="text-sm font-semibold mb-4 opacity-75 hover:opacity-100 transition-opacity"
        style={{ color: 'var(--text-muted)' }}>← Back</button>

      {/* Hero */}
      <div className="text-center mb-6">
        <img src={SAI_IMG} alt="Shirdi Sai Baba" loading="eager"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          className="mx-auto mb-4"
          style={{ width: 130, height: 'auto', borderRadius: 16, border: '2px solid rgba(212,175,55,0.6)',
                   boxShadow: '0 10px 30px rgba(0,0,0,0.45)' }} />
        <p className="text-xs font-bold tracking-widest uppercase" style={{ color: 'rgba(212,175,55,0.85)' }}>
          Future Legacy Appeal
        </p>
        <h1 className="font-display text-2xl sm:text-3xl font-black mt-1" style={{ color: 'var(--text)' }}>
          Secure our ground · build our future
        </h1>
        <p className="text-sm mt-3 max-w-xl mx-auto" style={{ color: 'var(--text-muted)' }}>
          Sponsor a <strong style={{ color: 'var(--text)' }}>square foot</strong> to help
          <strong style={{ color: 'var(--text)' }}> clear the mortgage</strong>, or a <strong style={{ color: 'var(--text)' }}>brick</strong> to
          build our future. The higher the tier, the larger your name on the temple’s
          <strong style={{ color: 'var(--text)' }}> digital donor wall</strong>. Every gift is <strong style={{ color: 'var(--text)' }}>Gift-Aided (+25%)</strong>.
        </p>
      </div>

      {/* Sponsorship options */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PRODUCTS.map(p => <SponsorCard key={p.key} p={p} />)}

        {/* Any-amount fallback */}
        <button onClick={() => setScreen('browse')}
          className="temple-card p-4 flex flex-col items-center justify-center text-center min-h-[140px] transition-all hover:brightness-110 active:scale-[0.99]"
          style={{ borderStyle: 'dashed' }}>
          <div className="text-2xl mb-1">💛</div>
          <p className="font-black text-sm" style={{ color: 'var(--text)' }}>Give any amount</p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Every gift helps — donate whatever your heart allows.</p>
        </button>
      </div>

      <p className="text-[11px] mt-5 text-center" style={{ color: 'rgba(74,222,128,0.75)' }}>
        ✓ Gift Aid eligible — adds 25% at no cost to you. All gifts go to the Future Legacy Appeal.
      </p>
    </motion.div>
  )
}
