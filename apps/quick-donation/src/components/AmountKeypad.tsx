import { useState } from 'react'
import { motion } from 'framer-motion'

// Shared on-screen numeric amount keypad for Quick Donation kiosks.
//
// Used by both ProjectGuptScreen (full screen, anonymous donation) and
// ProjectTiersScreen (modal overlay for the Any Amount tile). Having one
// component means the look + feel is identical across the app and
// operators learn one control.
//
// Layout
// ------
// mode='full'  (dedicated screen like Gupt Daan) uses a LANDSCAPE 2-col
//              layout: readout + presets on the left, keypad + actions
//              on the right. The whole thing fits in a tablet viewport
//              without scrolling — operator feedback: "it should fit in
//              tablet, no scrolling".
//
// mode='modal' (overlay from a tile) stays as a compact single-column
//              card centred on a dimmed backdrop.
//
// Both modes size the keypad with grid rows that use the available
// height (not aspect-square — that blew up the buttons on wide screens).
export interface AmountKeypadProps {
  title?: string
  subtitle?: string
  initial?: string
  accent: string
  bg?: string
  presets?: number[]
  hint?: string
  confirmLabel?: string
  onCancel?: () => void
  onConfirm: (amount: number) => void
  mode?: 'full' | 'modal'
}

export function AmountKeypad({
  title, subtitle, initial = '', accent, bg = '#140606',
  presets = [], hint, confirmLabel = 'Continue →',
  onCancel, onConfirm, mode = 'full',
}: AmountKeypadProps) {
  const [value, setValue] = useState(initial)

  function press(k: string) {
    setValue(v => {
      if (k === '←') return v.slice(0, -1)
      if (k === '.' && v.includes('.')) return v
      if (v.length >= 10) return v
      return (v + k).replace(/^0+(?=\d)/, '')
    })
  }

  const amt = parseFloat(value)
  const canConfirm = isFinite(amt) && amt > 0
  const KEYS = ['1','2','3','4','5','6','7','8','9','.','0','←']

  // Shared readout block (title + big £).
  const Readout = (
    <div className="text-center">
      {title && (
        <div className="text-[11px] uppercase tracking-widest" style={{ color: accent }}>
          {title}
        </div>
      )}
      <div className="font-black leading-none mt-1"
           style={{ fontFamily: 'serif', color: accent, fontSize: 'clamp(2.5rem, 7vw, 4.5rem)' }}>
        £{value || '0'}
      </div>
      {subtitle && (
        <div className="text-xs mt-1 opacity-70">{subtitle}</div>
      )}
      {hint && (
        <div className="text-[11px] mt-1 opacity-70">{hint}</div>
      )}
    </div>
  )

  // Preset chips. Compact so they don't eat keypad height.
  const Presets = presets.length > 0 && (
    <div className="grid grid-cols-3 gap-2 w-full">
      {presets.map(p => (
        <motion.button
          key={p}
          whileTap={{ scale: 0.95 }}
          onClick={() => onConfirm(p)}
          className="py-2 rounded-xl font-black text-sm"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: `1px solid ${accent}50`,
            color: accent,
          }}>
          £{p}
        </motion.button>
      ))}
    </div>
  )

  // Keypad grid — grid-rows-4 so each row fills 1/4 of the available
  // height. No aspect-square, so buttons stay in bounds on wide tablets.
  const Keypad = (
    <div className="grid grid-cols-3 grid-rows-4 gap-2 w-full h-full min-h-0">
      {KEYS.map(k => (
        <motion.button
          key={k}
          whileTap={{ scale: 0.9 }}
          onClick={() => press(k)}
          className="rounded-xl text-xl font-black bg-white/10 hover:bg-white/15 flex items-center justify-center min-h-0">
          {k}
        </motion.button>
      ))}
    </div>
  )

  const Actions = (
    <div className="flex gap-2 w-full">
      {onCancel && (
        <button
          onClick={onCancel}
          className="flex-1 py-3 rounded-xl font-black text-base bg-white/10 hover:bg-white/15">
          Cancel
        </button>
      )}
      <button
        onClick={() => canConfirm && onConfirm(amt)}
        disabled={!canConfirm}
        className="flex-1 py-3 rounded-xl font-black text-base disabled:opacity-40"
        style={{ background: accent, color: '#180324' }}>
        {confirmLabel}
      </button>
    </div>
  )

  // ── Modal mode — compact centred card, single column ────────────────────
  if (mode === 'modal') {
    return (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.85)' }}>
        <motion.div
          initial={{ scale: 0.92, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }}
          className="w-full max-w-sm max-h-[92vh] rounded-3xl p-5 text-white flex flex-col gap-3"
          style={{ background: bg, border: `2px solid ${accent}` }}>
          {Readout}
          <div className="flex-1 min-h-0" style={{ minHeight: 220 }}>
            {Keypad}
          </div>
          {Actions}
        </motion.div>
      </motion.div>
    )
  }

  // ── Full mode — landscape 2-col, fits a tablet viewport, no scroll ──────
  return (
    <div className="w-full h-full text-white flex flex-col gap-3 min-h-0">
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-0">
        {/* Left: readout + presets */}
        <div className="flex flex-col items-center justify-center gap-4 min-h-0">
          {Readout}
          {Presets}
        </div>
        {/* Right: keypad fills this column top-to-bottom */}
        <div className="flex flex-col min-h-0">
          <div className="flex-1 min-h-0">
            {Keypad}
          </div>
        </div>
      </div>
      {Actions}
    </div>
  )
}
