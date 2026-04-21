import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

interface AmountTile {
  id: string
  price: number
  description?: string
  name?: string
}

const FALLBACK_TILES: AmountTile[] = [
  { id: 'f3',  price: 3,  name: 'Small Offering',  description: 'Provide prasad for a devotee' },
  { id: 'f5',  price: 5,  name: 'Daily Seva',      description: 'Support daily temple rituals' },
  { id: 'f8',  price: 8,  name: 'Lamp Offering',   description: 'Light a diya for your family' },
  { id: 'f11', price: 11, name: 'Food Donation',   description: 'Help feed those in need' },
  { id: 'f15', price: 15, name: 'Weekly Seva',     description: 'Support a week of worship' },
  { id: 'f21', price: 21, name: 'Festival Seva',   description: 'Contribute to festivals' },
  { id: 'f25', price: 25, name: 'Blessing Seva',   description: 'Special blessing ceremony' },
]

const NUM_ROWS = [['7','8','9'],['4','5','6'],['1','2','3'],['.','0','⌫']]

function NumKey({ k, onPress }: { k: string; onPress: (k: string) => void }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.88 }}
      onPointerDown={() => onPress(k)}
      className="rounded-2xl font-black flex items-center justify-center select-none"
      style={{ background: k === '⌫' ? '#FEE2E2' : '#fff', color: k === '⌫' ? '#DC2626' : '#111', border: '2px solid #F3F4F6', height: 70, fontSize: 26, flex: 1 }}
    >
      {k}
    </motion.button>
  )
}

// Simple Gift Aid overlay — shown after tile tap when enableGiftAid is true
function GiftAidOverlay({
  amount,
  onYes,
  onNo,
}: {
  amount: number
  onYes: () => void
  onNo: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 flex flex-col items-center justify-end z-20"
      style={{ background: 'rgba(0,0,0,0.72)' }}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        className="w-full rounded-t-3xl p-6 space-y-4"
        style={{ background: 'linear-gradient(160deg,#0d2a0a,#122a10)', border: '1px solid rgba(74,222,128,0.25)' }}
      >
        <div className="text-center">
          <p className="text-2xl mb-1">🇬🇧</p>
          <h2 className="font-black text-xl" style={{ color: '#4ade80' }}>Are you a UK taxpayer?</h2>
          <p className="text-sm mt-1" style={{ color: 'rgba(74,222,128,0.75)' }}>
            HMRC will add <strong style={{ color: '#4ade80' }}>£{(amount * 0.25).toFixed(2)}</strong> to your £{amount.toFixed(2)} donation — <strong>completely free</strong>.
          </p>
          <p className="text-xs mt-1" style={{ color: 'rgba(255,248,220,0.4)' }}>
            ✓ No extra payment &nbsp;·&nbsp; ✓ Takes 30 seconds &nbsp;·&nbsp; ✓ HMRC approved
          </p>
        </div>

        <div className="flex gap-3">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onYes}
            className="flex-1 py-4 rounded-2xl font-black text-base"
            style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', color: '#fff',
              boxShadow: '0 6px 20px rgba(22,163,74,0.4)' }}
          >
            Yes — Claim Gift Aid
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onNo}
            className="flex-[0.55] py-4 rounded-2xl font-bold text-sm"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.45)',
              border: '1px solid rgba(255,255,255,0.1)' }}
          >
            No thanks
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// Inline Gift Aid form — collect name + postcode
function GiftAidForm({
  amount,
  onSubmit,
  onSkip,
}: {
  amount: number
  onSubmit: (firstName: string, surname: string, postcode: string) => void
  onSkip: () => void
}) {
  const [firstName, setFirstName] = useState('')
  const [surname, setSurname]     = useState('')
  const [postcode, setPostcode]   = useState('')
  const valid = firstName.trim().length > 0 && surname.trim().length > 0 && postcode.trim().length >= 5

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      className="absolute inset-0 flex flex-col justify-end z-30"
      style={{ background: 'rgba(0,0,0,0.8)' }}
    >
      <div className="w-full rounded-t-3xl p-6 space-y-4"
        style={{ background: 'linear-gradient(160deg,#0d2a0a,#122a10)', border: '1px solid rgba(74,222,128,0.25)' }}>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: 'rgba(74,222,128,0.6)' }}>Gift Aid Declaration</p>
          <p className="text-sm font-bold" style={{ color: '#4ade80' }}>
            Temple will receive £{(amount * 1.25).toFixed(2)} (+£{(amount * 0.25).toFixed(2)} free)
          </p>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,248,220,0.45)' }}>First Name</label>
            <input
              value={firstName} onChange={e => setFirstName(e.target.value)}
              placeholder="First name"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,248,220,0.45)' }}>Surname</label>
            <input
              value={surname} onChange={e => setSurname(e.target.value)}
              placeholder="Surname"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,248,220,0.45)' }}>UK Postcode</label>
          <input
            value={postcode} onChange={e => setPostcode(e.target.value.toUpperCase())}
            placeholder="e.g. HA9 0BB"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none uppercase"
            style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          />
          <p className="text-xs mt-1" style={{ color: 'rgba(255,248,220,0.3)' }}>
            I confirm I am a UK taxpayer and understand that Gift Aid will be reclaimed on this donation.
          </p>
        </div>

        <div className="flex gap-3">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onSubmit(firstName.trim(), surname.trim(), postcode.trim())}
            disabled={!valid}
            className="flex-1 py-4 rounded-2xl font-black text-base disabled:opacity-40"
            style={{ background: valid ? 'linear-gradient(135deg,#16a34a,#15803d)' : 'rgba(255,255,255,0.06)', color: '#fff' }}
          >
            Confirm Gift Aid
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onSkip}
            className="flex-[0.55] py-4 rounded-2xl font-bold text-sm"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.4)',
              border: '1px solid rgba(255,255,255,0.1)' }}
          >
            Skip
          </motion.button>
        </div>
      </div>
    </motion.div>
  )
}

export function DonationScreen() {
  const { setScreen, setAmount, branchId, showMonthlyGiving, enableGiftAid } = useDonationStore()

  const [tiles, setTiles]         = useState<AmountTile[]>([])
  const [loading, setLoading]     = useState(true)
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherVal, setOtherVal]   = useState('')

  // Gift Aid overlay state
  const [pendingAmount, setPendingAmount]     = useState<number | null>(null)
  const [giftAidStep, setGiftAidStep]         = useState<'none' | 'ask' | 'form'>('none')
  const [giftAidInfo, setGiftAidInfo]         = useState<{ firstName: string; surname: string; postcode: string } | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const branch = branchId || 'main'
        const res  = await fetch(`${API_BASE}/items/?category=QUICK_DONATION&branch_id=${branch}`)
        const data = await res.json()
        const items: AmountTile[] = (data.items || [])
          .filter((i: { is_active?: boolean }) => i.is_active !== false)
          .map((i: { id: string; price: number; name?: string; description?: string }) => ({
            id: i.id, price: i.price, name: i.name, description: i.description,
          }))
        setTiles(items.length ? items : FALLBACK_TILES)
      } catch {
        setTiles(FALLBACK_TILES)
      }
      setLoading(false)
    }
    load()
  }, [branchId])

  const handleKey = (k: string) => {
    if (k === '⌫') { setOtherVal(v => v.slice(0, -1)); return }
    if (k === '.' && otherVal.includes('.')) return
    if (k === '.' && !otherVal) { setOtherVal('0.'); return }
    const next = otherVal + k
    if (parseFloat(next) > 9999) return
    const parts = next.split('.')
    if (parts[1] && parts[1].length > 2) return
    setOtherVal(next)
  }

  const proceedToPayment = (amount: number, gaInfo?: { firstName: string; surname: string; postcode: string } | null) => {
    setAmount(amount)
    // TODO: pass gaInfo to checkout if needed
    void gaInfo
    setGiftAidStep('none')
    setPendingAmount(null)
    setGiftAidInfo(null)
    setScreen('processing')
  }

  const handleTileTap = (price: number) => {
    if (enableGiftAid) {
      setPendingAmount(price)
      setGiftAidStep('ask')
    } else {
      setAmount(price)
      setScreen('processing')
    }
  }

  const handleOtherConfirm = () => {
    const amt = parseFloat(otherVal)
    if (!amt || amt <= 0) return
    if (enableGiftAid) {
      setPendingAmount(amt)
      setGiftAidStep('ask')
      setOtherOpen(false)
      setOtherVal('')
    } else {
      setAmount(amt)
      setScreen('processing')
    }
  }

  const otherAmount = parseFloat(otherVal) || 0

  return (
    <div className="w-full h-full flex flex-col bg-temple-gradient relative">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-3 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-black text-gold-gradient">Tap &amp; Donate</h1>
          <p className="text-saffron-400/60 text-base mt-0.5">Tap an amount to donate</p>
        </div>
        {enableGiftAid && (
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl glass-card">
            <span className="text-green-400 font-black text-sm">✓</span>
            <span className="text-white/70 font-bold text-xs">Gift Aid</span>
          </div>
        )}
      </div>

      {/* ── Monthly Giving banner (admin-configured) ────────────────────────── */}
      {showMonthlyGiving && (
        <div className="mx-5 mb-3 flex-shrink-0">
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: 'linear-gradient(135deg,rgba(22,163,74,0.18),rgba(15,107,50,0.12))',
              border: '1px solid rgba(74,222,128,0.3)' }}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(74,222,128,0.15)' }}>
              <span className="text-lg">💚</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'rgba(74,222,128,0.7)' }}>Monthly Giving</p>
              <p className="text-sm font-black leading-snug" style={{ color: '#4ade80' }}>Make a big impact from just £5/month</p>
              <p className="text-[10px]" style={{ color: 'rgba(74,222,128,0.55)' }}>Regular giving · Cancel anytime · Secure PayPal</p>
            </div>
            <span className="text-white/30 text-lg flex-shrink-0">›</span>
          </div>
        </div>
      )}

      {/* ── Amount grid ─────────────────────────────────────────────────────── */}
      <div className="flex-1 px-5 pb-5 overflow-hidden">
        {loading ? (
          <div className="grid grid-cols-3 gap-3 h-full">
            {[1,2,3,4,5,6].map(i => (
              <div key={i} className="rounded-3xl animate-pulse" style={{ background: 'rgba(255,255,255,0.07)' }} />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 h-full" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: '1fr' }}>
            {tiles.map(tile => (
              <motion.button
                key={tile.id}
                whileTap={{ scale: 0.92 }}
                onClick={() => handleTileTap(tile.price)}
                className="rounded-3xl flex flex-col items-center justify-center font-black transition-all active:brightness-110 px-3 py-3 text-center"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1.5px solid rgba(255,255,255,0.12)',
                  color: '#fff',
                }}
              >
                <div className="flex items-baseline gap-0.5 leading-none">
                  <span className="text-white/50 text-base font-semibold">£</span>
                  <span style={{ fontSize: tile.price >= 100 ? 32 : 38 }}>
                    {tile.price % 1 === 0 ? tile.price : tile.price.toFixed(2)}
                  </span>
                </div>
                {tile.name && (
                  <span className="text-white/75 text-[11px] font-bold mt-1.5 leading-tight line-clamp-1">
                    {tile.name}
                  </span>
                )}
                {tile.description && (
                  <span className="text-white/40 text-[10px] font-medium mt-0.5 leading-tight line-clamp-2 px-1">
                    {tile.description}
                  </span>
                )}
                {enableGiftAid && (
                  <span className="text-green-400/60 text-[10px] font-semibold mt-1.5">
                    +GA £{(tile.price * 0.25).toFixed(2)}
                  </span>
                )}
              </motion.button>
            ))}

            {/* "Other" — double-width */}
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={() => { setOtherOpen(true); setOtherVal('') }}
              className="rounded-3xl flex flex-col items-center justify-center font-black col-span-2 transition-all"
              style={{
                background: otherOpen ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
                border: otherOpen ? '2px solid rgba(255,255,255,0.30)' : '1.5px solid rgba(255,255,255,0.10)',
                color: '#fff',
              }}
            >
              <span className="text-2xl mb-1">✏️</span>
              <span className="text-xl">Other</span>
            </motion.button>
          </div>
        )}
      </div>

      {/* ── Numeric keypad (Other) ───────────────────────────────────────────── */}
      <AnimatePresence>
        {otherOpen && (
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 350 }}
            className="flex-shrink-0 px-5 pb-4"
            style={{ background: '#1a0800', borderTop: '2px solid rgba(255,153,51,0.3)' }}
          >
            <div className="flex items-center justify-between py-3 mb-2">
              <span className="text-white/50 text-sm font-semibold">Enter custom amount</span>
              <div className="text-3xl font-black text-gold-gradient">£{otherVal || '0'}</div>
            </div>
            <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
              {NUM_ROWS.map((row, ri) => (
                <React.Fragment key={ri}>
                  {row.map(k => <NumKey key={k} k={k} onPress={handleKey} />)}
                </React.Fragment>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => { setOtherOpen(false); setOtherVal('') }}
                className="flex-1 py-3 rounded-2xl text-white/50 font-bold text-sm"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                Cancel
              </button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleOtherConfirm}
                disabled={otherAmount <= 0}
                className="flex-[2] py-3 rounded-2xl font-black text-base text-white disabled:opacity-30"
                style={{
                  background: otherAmount > 0 ? 'linear-gradient(135deg,#FF9933,#FF6B00)' : 'rgba(255,255,255,0.08)',
                  boxShadow: otherAmount > 0 ? '0 6px 20px rgba(255,153,51,0.45)' : 'none',
                }}
              >
                {otherAmount > 0 ? `Donate £${otherAmount.toFixed(2)}` : 'Enter amount'}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Gift Aid overlays ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {giftAidStep === 'ask' && pendingAmount !== null && (
          <GiftAidOverlay
            amount={pendingAmount}
            onYes={() => setGiftAidStep('form')}
            onNo={() => proceedToPayment(pendingAmount, null)}
          />
        )}
        {giftAidStep === 'form' && pendingAmount !== null && (
          <GiftAidForm
            amount={pendingAmount}
            onSubmit={(fn, sn, pc) => {
              setGiftAidInfo({ firstName: fn, surname: sn, postcode: pc })
              proceedToPayment(pendingAmount, { firstName: fn, surname: sn, postcode: pc })
            }}
            onSkip={() => proceedToPayment(pendingAmount, null)}
          />
        )}
      </AnimatePresence>

      {/* suppress unused warning */}
      {giftAidInfo && null}
    </div>
  )
}
