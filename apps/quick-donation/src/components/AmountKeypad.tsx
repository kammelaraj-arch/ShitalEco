import { useState } from 'react'
import { motion } from 'framer-motion'

// Shared on-screen numeric amount keypad for Quick Donation kiosks.
//
// Used by both ProjectGuptScreen (full screen, anonymous donation) and
// ProjectTiersScreen (modal overlay for the Any Amount tile). Having one
// component means the look + feel is identical across the app and
// operators learn one control.
//
// Props:
//   mode: 'full'   — fills the parent (used in a dedicated screen)
//         'modal'  — renders inside a dimmed modal overlay (used from a tile)
//   accent + bg are the theme colours (hex); readout + Continue button inherit.
//   presets are optional quick-pick chips shown above the keypad.
//   hint is a single line of help text under the big readout (e.g. the
//        "£351 per ft²" rate on the Square-Feet Any-Amount flow).
//
// The keypad itself is deliberately compact — buttons are sized with
// aspect-square against a max-width container so even on the biggest
// kiosks we never render finger-sized numerals the size of the readout.
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

  const body = (
    <div className="flex flex-col items-center w-full max-w-sm mx-auto">
      {/* Big readout */}
      <div className="text-center mb-4">
        {title && (
          <div className="text-xs uppercase tracking-widest" style={{ color: accent }}>
            {title}
          </div>
        )}
        <div className="font-black text-6xl mt-1" style={{ fontFamily: 'serif', color: accent }}>
          £{value || '0'}
        </div>
        {subtitle && (
          <div className="text-xs mt-1 opacity-70">{subtitle}</div>
        )}
        {hint && (
          <div className="text-[11px] mt-1 opacity-70">{hint}</div>
        )}
      </div>

      {/* Preset chips (optional) */}
      {presets.length > 0 && (
        <div className="grid grid-cols-3 gap-2 w-full mb-3">
          {presets.map(p => (
            <motion.button
              key={p}
              whileTap={{ scale: 0.95 }}
              onClick={() => onConfirm(p)}
              className="py-2.5 rounded-xl font-black text-base"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid ${accent}50`,
                color: accent,
              }}>
              £{p}
            </motion.button>
          ))}
        </div>
      )}

      {/* Keypad — 3 × 4 grid of aspect-square buttons, max-w-sm container
          keeps them finger-friendly without filling the whole screen. */}
      <div className="grid grid-cols-3 gap-2 w-full">
        {KEYS.map(k => (
          <motion.button
            key={k}
            whileTap={{ scale: 0.9 }}
            onClick={() => press(k)}
            className="aspect-square rounded-xl text-2xl font-black bg-white/10 hover:bg-white/15">
            {k}
          </motion.button>
        ))}
      </div>

      {/* Action row */}
      <div className="flex gap-2 w-full mt-3">
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
    </div>
  )

  if (mode === 'modal') {
    return (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-6"
        style={{ background: 'rgba(0,0,0,0.85)' }}>
        <motion.div
          initial={{ scale: 0.92, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }}
          className="w-full max-w-sm rounded-3xl p-5 text-white"
          style={{ background: bg, border: `2px solid ${accent}` }}>
          {body}
        </motion.div>
      </motion.div>
    )
  }
  return <div className="w-full text-white">{body}</div>
}
