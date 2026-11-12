import { useDonationStore } from '../store/donation.store'
import { GUPT_DAAN_TILE } from './ProjectStartScreen'
import { AmountKeypad } from '../components/AmountKeypad'

// Gupt Daan — anonymous amount entry.
//
// The donor enters the amount and goes straight to the card tap. No
// contact form, no Gift Aid prompt; the donation row saves with
// contact_id = NULL and is_anonymous = true via the existing
// /quick-donation/record path.
//
// Uses the shared AmountKeypad in landscape 2-col mode, inside an
// h-screen page (NOT min-h-screen) so the keypad's h-full actually
// resolves to a bounded height — fits any tablet without scrolling.
export function ProjectGuptScreen() {
  const { setAmount, setPendingGiftAid, setScreen } = useDonationStore()
  const accent = GUPT_DAAN_TILE.accent
  const bg     = GUPT_DAAN_TILE.bg

  function go(amount: number) {
    setPendingGiftAid(null)   // never Gift Aid on an anonymous donation
    setAmount(amount)
    setScreen('tap')
  }

  return (
    <div className="h-screen px-4 py-3 text-white flex flex-col overflow-hidden"
         style={{ background: `linear-gradient(170deg, ${bg} 0%, #140606 100%)` }}>

      <header className="flex items-center mb-3 shrink-0">
        <button onClick={() => setScreen('donate')}
                className="px-4 py-2 rounded-xl text-white font-bold text-sm hover:bg-white/15 border border-white/25"
                style={{ background: 'rgba(255,255,255,0.08)' }}>
          ← Back
        </button>
        <div className="ml-3 flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest" style={{ color: accent }}>
            Anonymous — no name, no record
          </div>
          <div className="font-black text-2xl" style={{ fontFamily: 'serif' }}>
            ॐ Gupt Daan
          </div>
        </div>
      </header>

      {/* flex-1 min-h-0 bounds the keypad so h-full inside it resolves
          correctly and the whole thing fits the viewport. */}
      <div className="flex-1 min-h-0">
        <AmountKeypad
          mode="full"
          accent={accent}
          bg={bg}
          title="Enter amount"
          presets={[11, 51, 108, 251, 501, 1008]}
          confirmLabel="Tap to pay →"
          onConfirm={go}
        />
      </div>
    </div>
  )
}
