/**
 * KioskKeyboard — on-screen keyboard for the kiosk (no physical keyboard needed).
 *
 * Two modes:
 *   numeric  — 0-9 keys + decimal + backspace + clear. Used for donation amounts.
 *   text     — QWERTY full keyboard + numbers row + space + backspace. Used for
 *              name / postcode / email inputs.
 *
 * Usage:
 *   import { KioskKeyboard, useKeyboard } from '../components/KioskKeyboard'
 *
 *   const { value, setValue, keyboardProps } = useKeyboard('', 'numeric')
 *   <input value={value} readOnly className="..." />
 *   <KioskKeyboard {...keyboardProps} />
 *
 * Or use <KioskKeyboard> directly with value/onChange props for controlled inputs.
 */
import React, { useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ── Types ──────────────────────────────────────────────────────────────────────

export type KeyboardMode = 'numeric' | 'text' | 'postcode'

export interface KioskKeyboardProps {
  value: string
  onChange: (v: string) => void
  mode?: KeyboardMode
  maxLength?: number
  visible?: boolean
  onDone?: () => void
  /** accent colour for the Done key and active states */
  accent?: string
  /** If set, an action button (e.g. "+ Add") is shown above the keys */
  actionLabel?: string
  onAction?: () => void
  actionDisabled?: boolean
}

// ── Layout maps ────────────────────────────────────────────────────────────────

const NUMERIC_ROWS = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['.', '0', '⌫'],
]

const QWERTY_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫'],
  ['SPACE', '.', '@', 'CLEAR'],
]

// For postcode: uppercase letters + numbers
const POSTCODE_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫'],
  ['SPACE', 'CLEAR'],
]

// ── Key button component ───────────────────────────────────────────────────────

interface KeyProps {
  label: string
  onPress: (label: string) => void
  wide?: boolean
  accent?: string
  numeric?: boolean
}

function Key({ label, onPress, wide, accent, numeric }: KeyProps) {
  const isSpecial = ['⌫', 'SPACE', 'CLEAR', 'DONE'].includes(label)
  const isBackspace = label === '⌫'
  const isSpace = label === 'SPACE'
  const isClear = label === 'CLEAR'
  const isDone = label === 'DONE'

  let bg = '#F3F4F6'
  let color = '#111827'
  let borderColor = '#D1D5DB'

  if (isBackspace) { bg = '#FEE2E2'; color = '#DC2626'; borderColor = '#FCA5A5' }
  if (isClear)     { bg = '#FEF3C7'; color = '#D97706'; borderColor = '#FDE68A' }
  if (isDone)      { bg = accent || '#FF9933'; color = '#fff'; borderColor = 'transparent' }
  if (numeric)     { bg = '#fff'; borderColor = '#E5E7EB' }

  const displayLabel = isSpace ? 'SPACE' : label

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.88 }}
      onPointerDown={() => onPress(label)}
      className="rounded-xl font-black flex items-center justify-center select-none"
      style={{
        background: bg,
        color,
        border: `1.5px solid ${borderColor}`,
        flex: wide ? 2 : 1,
        minWidth: wide ? 80 : 36,
        height: numeric ? 64 : 52,
        fontSize: isSpecial ? 13 : numeric ? 24 : 18,
        boxShadow: isDone ? `0 4px 12px ${accent || '#FF9933'}55` : '0 1px 3px rgba(0,0,0,0.08)',
        transition: 'background 0.1s',
      }}
    >
      {displayLabel}
    </motion.button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function KioskKeyboard({
  value,
  onChange,
  mode = 'numeric',
  maxLength,
  visible = true,
  onDone,
  accent = '#FF9933',
  actionLabel,
  onAction,
  actionDisabled,
}: KioskKeyboardProps) {
  const handleKey = useCallback((key: string) => {
    switch (key) {
      case '⌫':
        onChange(value.slice(0, -1))
        break
      case 'CLEAR':
        onChange('')
        break
      case 'SPACE':
        if (!maxLength || value.length < maxLength) onChange(value + ' ')
        break
      default:
        if (!maxLength || value.length < maxLength) onChange(value + key)
    }
  }, [value, onChange, maxLength])

  const rows = mode === 'numeric' ? NUMERIC_ROWS
             : mode === 'postcode' ? POSTCODE_ROWS
             : QWERTY_ROWS
  const isNumeric = mode === 'numeric'

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 32, stiffness: 380 }}
          className="flex-shrink-0 w-full"
          style={{
            background: '#F9FAFB',
            borderTop: `3px solid ${accent}`,
            boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
            paddingBottom: 'env(safe-area-inset-bottom, 0)',
          }}
        >
          <div className={`mx-auto px-3 py-3 flex flex-col gap-2 ${isNumeric ? 'max-w-xs' : 'max-w-2xl'}`}>
            {/* Action button row above the keys */}
            {actionLabel && onAction && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onPointerDown={onAction}
                disabled={actionDisabled}
                className="w-full rounded-2xl font-black text-white text-2xl py-4 disabled:opacity-40 shadow-lg"
                style={{ background: actionDisabled ? '#9ca3af' : accent, letterSpacing: '-0.5px', boxShadow: actionDisabled ? 'none' : `0 4px 20px ${accent}66` }}
              >
                {actionLabel}
              </motion.button>
            )}
            {rows.map((row, ri) => (
              <div key={ri} className="flex gap-2">
                {row.map(key => (
                  <Key
                    key={key}
                    label={key}
                    onPress={handleKey}
                    wide={key === 'SPACE' || key === 'CLEAR'}
                    accent={accent}
                    numeric={isNumeric}
                  />
                ))}
                {/* Done button on last row */}
                {ri === rows.length - 1 && onDone && (
                  <Key label="DONE" onPress={() => onDone()} wide accent={accent} numeric={isNumeric} />
                )}
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── useKeyboard hook — manages value + visibility for a single input ───────────

export function useKeyboard(initial: string, mode: KeyboardMode = 'numeric') {
  const [value, setValue] = React.useState(initial)
  const [visible, setVisible] = React.useState(false)

  const open  = useCallback(() => setVisible(true),  [])
  const close = useCallback(() => setVisible(false), [])
  const reset = useCallback((v = '') => setValue(v), [])

  const keyboardProps: KioskKeyboardProps = {
    value,
    onChange: setValue,
    mode,
    visible,
    onDone: close,
  }

  return { value, setValue, visible, open, close, reset, keyboardProps }
}
