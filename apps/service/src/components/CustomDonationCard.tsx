import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, t } from '../store'

// Always-visible "any-amount" donation card. Renders ONLY the card content
// (no max-w/px-* wrapper) so a parent can place it in whatever layout it
// wants — currently a 3-column responsive grid in BrowsePage alongside
// Monthly Giving and Volunteer CTAs.
//
// Quick-amount chips for the common ranges, plus a free-text £ input for
// anything else (locked to 2 decimal places). On tap of "Donate £X →" we
// add a single DONATION line item to the basket — gift-aid-eligible
// because all unrestricted cash donations to the temple qualify — and
// route straight to the basket screen so the donor can review/checkout.
const PRESET_AMOUNTS = [5, 10, 25, 50, 100]

export function CustomDonationCard() {
  const addItem   = useStore(s => s.addItem)
  const setScreen = useStore(s => s.setScreen)
  const language  = useStore(s => s.language)

  const [selected, setSelected] = useState<number | null>(null)
  const [custom,   setCustom]   = useState<string>('')

  const amount = selected ?? (parseFloat(custom) || 0)
  const valid  = amount >= 1

  function handleDonate() {
    if (!valid) return
    addItem({
      type: 'DONATION',
      name: 'Donation',
      quantity: 1,
      unitPrice: amount,
      totalPrice: amount,
      // Unique reference so each custom-amount donation lands as its own
      // line item in the basket (adding £10 then £25 must stay as two
      // rows, not one merged £35 row — `addItem` dedupes on referenceId+type).
      referenceId: `custom-${Date.now()}`,
      giftAidEligible: true,
      category: 'CUSTOM',
    })
    setScreen('basket')
  }

  return (
    <div className="rounded-2xl p-4 h-full flex flex-col cta-card cta-amber"
      style={{
        background: 'linear-gradient(180deg, rgba(18,10,2,0.78), rgba(26,15,2,0.88))',
        border: '2px solid rgba(251,191,36,0.80)',
        boxShadow: '0 0 24px rgba(251,191,36,0.42), 0 0 48px rgba(251,191,36,0.16), inset 0 1px 0 rgba(253,230,138,0.24), 0 8px 24px rgba(0,0,0,0.55)',
        backdropFilter: 'blur(10px) saturate(140%)',
        WebkitBackdropFilter: 'blur(10px) saturate(140%)',
      }}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
          style={{ background: 'rgba(251,191,36,0.22)', border: '1.5px solid rgba(251,191,36,0.6)', boxShadow: '0 0 12px rgba(251,191,36,0.4), inset 0 0 8px rgba(251,191,36,0.25)' }}>
          💛
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.22em]"
            style={{ color: '#FBBF24', textShadow: '0 0 8px rgba(251,191,36,0.5)' }}>
            {t('custom_eyebrow', language)}
          </p>
          <p className="font-black text-sm leading-tight mt-0.5" style={{ color: '#FFFBEB' }}>
            {t('donate_any_amount', language)}
          </p>
        </div>
      </div>

      {/* Quick amount chips */}
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {PRESET_AMOUNTS.map(a => (
          <button
            key={a}
            onClick={() => { setSelected(a); setCustom('') }}
            className="px-2.5 py-1.5 rounded-lg font-black text-xs transition-all active:scale-95"
            style={selected === a ? {
              background: 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)',
              color: '#6B0000',
              boxShadow: '0 4px 12px rgba(212,175,55,0.4)',
            } : {
              background: 'rgba(0,0,0,0.30)',
              color: '#FFD980',
              border: '1.5px solid rgba(212,175,55,0.55)',
            }}
          >
            £{a}
          </button>
        ))}
      </div>

      {/* Free-text custom £ input */}
      <div className="relative mb-2.5">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 font-black text-gold-400 text-sm pointer-events-none">£</span>
        <input
          type="number"
          inputMode="decimal"
          min="1"
          step="0.01"
          placeholder={t('enter_amount', language)}
          value={custom}
          onChange={e => { setCustom(e.target.value); setSelected(null) }}
          className="w-full pl-8 pr-3 py-2.5 rounded-xl text-sm font-bold outline-none"
          style={{
            background: 'rgba(0,0,0,0.30)',
            border: '1.5px solid rgba(212,175,55,0.30)',
            color: '#f5f0dc',
          }}
        />
      </div>

      <button
        onClick={handleDonate}
        disabled={!valid}
        className="w-full mt-auto py-3 rounded-xl font-black text-sm transition-all active:scale-95 disabled:cursor-not-allowed"
        style={{
          background: valid
            ? 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)'
            : 'rgba(0,0,0,0.32)',
          color: valid ? '#6B0000' : '#FFD980',
          border: valid ? 'none' : '1.5px solid rgba(212,175,55,0.45)',
          boxShadow: valid ? '0 4px 12px rgba(212,175,55,0.35)' : 'none',
        }}
      >
        {valid ? `${t('donate_action', language)} £${amount.toFixed(2)} →` : t('donate_action', language)}
      </button>

      <AnimatePresence>
        {valid && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-[10px] mt-2 text-center"
            style={{ color: 'rgba(74,222,128,0.7)' }}
          >
            ✓ Gift Aid eligible
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
