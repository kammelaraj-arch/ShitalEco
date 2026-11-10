import { useState } from 'react'
import { motion } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'
import { TILE_CATALOG } from './ProjectStartScreen'

// Hard-coded tier lists per category. Future work: pull from catalog_items
// filtered by the device's linked_project_ids so the admin can edit tiers
// in the catalog instead of a code change. Shipping with these presets
// now so the flow is usable from day one.
interface Tier { label: string; price: number; sub?: string; featured?: boolean }
const CATEGORY_TIERS: Record<string, Tier[]> = {
  brick: [
    { label: 'Red Brick',     price: 51,   sub: 'Named engraving on donor wall' },
    { label: 'Bronze Brick',  price: 151,  sub: 'Family name + annual mention' },
    { label: 'Silver Brick',  price: 508,  sub: 'Patron plaque · lifetime pass' },
    { label: 'Gold Brick',    price: 1008, sub: 'Centrepiece plaque · trustee letter', featured: true },
    { label: 'Founder Brick', price: 5008, sub: 'Named in temple opening ceremony' },
  ],
  sqft: [
    { label: '1 square foot', price: 351,  sub: 'One foot of hall floor · name engraved', featured: true },
    { label: 'Family plot',   price: 2501, sub: '≈7 ft² · family named entrance tile' },
  ],
}

// £ per sq ft used for the live size readout on Any Amount
const SQFT_RATE = 351

export function ProjectTiersScreen() {
  const { pickedCategory, setAmount, setScreen } = useDonationStore()
  const [custom, setCustom] = useState<string>('')
  const tile = TILE_CATALOG.find(t => t.id === pickedCategory)
  const tiers = CATEGORY_TIERS[pickedCategory] || []
  const bg = tile?.bg || '#2E86AB'
  const accent = tile?.accent || '#A0D8F1'

  function pickTier(amount: number) {
    setAmount(amount)
    setScreen('project-contact')
  }

  function pickCustom() {
    const n = parseFloat(custom)
    if (!isFinite(n) || n <= 0) return
    setAmount(n)
    setScreen('project-contact')
  }

  const customNum = parseFloat(custom)
  const sqftReadout = pickedCategory === 'sqft' && isFinite(customNum) && customNum > 0
    ? `Sponsors ${(customNum / SQFT_RATE).toFixed(2).replace(/\.?0+$/, '')} ft² of hall floor`
    : ''

  return (
    <div className="min-h-screen flex flex-col px-4 py-5 text-white"
         style={{ background: `linear-gradient(170deg, ${bg} 0%, #140606 100%)` }}>
      <header className="flex items-center mb-5">
        <button onClick={() => setScreen('donate')}
                className="px-3 py-2 rounded-xl text-white/80 hover:bg-white/10 text-sm">
          ← Back
        </button>
        <div className="ml-3 flex-1">
          <div className="text-xs uppercase tracking-widest" style={{ color: accent }}>Choose a tier</div>
          <div className="font-black text-2xl" style={{ fontFamily: 'serif' }}>{tile?.emoji} {tile?.name}</div>
        </div>
      </header>

      {tiers.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {tiers.map(tier => (
            <motion.button key={tier.label} whileTap={{ scale: 0.95 }}
                           onClick={() => pickTier(tier.price)}
                           className="rounded-2xl p-5 text-left relative"
                           style={{
                             background: tier.featured ? `${accent}20` : 'rgba(255,255,255,0.05)',
                             border: tier.featured ? `2px solid ${accent}` : '2px solid rgba(255,255,255,0.1)',
                           }}>
              {tier.featured && (
                <div className="absolute top-3 right-3 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                     style={{ background: accent, color: '#180324' }}>Most chosen</div>
              )}
              <div className="font-black text-lg mb-1" style={{ fontFamily: 'serif' }}>{tier.label}</div>
              {tier.sub && <div className="text-xs opacity-70 mb-3 leading-snug">{tier.sub}</div>}
              <div className="font-black text-3xl" style={{ color: accent, fontFamily: 'serif' }}>
                £{tier.price.toLocaleString()}
              </div>
            </motion.button>
          ))}
        </div>
      )}

      {/* Any Amount keypad input — always available */}
      <div className="rounded-2xl p-5 border-2 border-dashed mt-auto"
           style={{ borderColor: `${accent}60`, background: 'rgba(255,255,255,0.04)' }}>
        <div className="font-black text-lg mb-2" style={{ fontFamily: 'serif' }}>Any amount</div>
        {pickedCategory === 'sqft' && (
          <div className="text-xs mb-3 opacity-70">Rate: £{SQFT_RATE} per ft² · we work out the size</div>
        )}
        <div className="flex items-center gap-3 mb-2">
          <span className="text-3xl font-black" style={{ color: accent, fontFamily: 'serif' }}>£</span>
          <input
            inputMode="decimal" autoFocus
            value={custom} onChange={e => setCustom(e.target.value)}
            placeholder="51.00"
            className="flex-1 bg-black/30 rounded-xl px-4 py-3 text-2xl font-black text-right text-white outline-none"
          />
          <button onClick={pickCustom}
                  disabled={!(parseFloat(custom) > 0)}
                  className="px-5 py-3 rounded-xl font-black disabled:opacity-40"
                  style={{ background: accent, color: '#180324' }}>
            Continue →
          </button>
        </div>
        {sqftReadout && <div className="text-xs mt-1" style={{ color: accent }}>→ {sqftReadout}</div>}
      </div>
    </div>
  )
}
