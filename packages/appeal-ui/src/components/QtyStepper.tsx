// LEGO: numeric stepper with – / + buttons. Used on every Appeal tile
// and inside the basket drawer. Kept framework-agnostic — pure props,
// no store knowledge — so a social-media landing page can mount it
// standalone just as easily as the kiosk.

import { CSSProperties } from 'react'

export interface QtyStepperProps {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  /** px size of each round button; readout scales with it. */
  size?: number
  /** Accent used for button backgrounds. */
  color?: string
  /** aria-label stem — "Red Brick" → "Decrease Red Brick quantity". */
  label?: string
  disabled?: boolean
}

export function QtyStepper({
  value,
  onChange,
  min = 0,
  max = 99,
  size = 36,
  color = '#F6C454',
  label = 'item',
  disabled,
}: QtyStepperProps) {
  const dec = () => onChange(Math.max(min, value - 1))
  const inc = () => onChange(Math.min(max, value + 1))
  const btn = (bg: string): CSSProperties => ({
    width: size,
    height: size,
    borderRadius: size / 2,
    background: bg,
    color: '#180324',
    fontSize: size * 0.55,
    fontWeight: 900,
    border: '1.5px solid rgba(255,255,255,0.35)',
    boxShadow: `0 3px 10px ${color}55`,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
  })
  return (
    <div className="inline-flex items-center gap-2" aria-label={label} role="group">
      <button
        type="button"
        onClick={dec}
        disabled={disabled || value <= min}
        aria-label={`Decrease ${label} quantity`}
        style={btn(color)}
      >
        –
      </button>
      <span
        className="font-black text-white tabular-nums"
        style={{ minWidth: size * 1.2, fontSize: size * 0.6, textAlign: 'center' }}
        aria-live="polite"
      >
        {value}
      </span>
      <button
        type="button"
        onClick={inc}
        disabled={disabled || value >= max}
        aria-label={`Increase ${label} quantity`}
        style={btn(color)}
      >
        +
      </button>
    </div>
  )
}
