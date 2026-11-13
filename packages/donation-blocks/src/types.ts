// Shared data shapes for @shital/donation-blocks. Consumers (the kiosk,
// service portal, campaign pages) construct these objects from their own
// catalog + admin config. The components stay framework-agnostic.

import type { ReactNode } from 'react'

/**
 * One tile in the Level 0 category grid.
 * Matches the kiosk's TILE_CATALOG entries one-for-one so the kiosk
 * can pass its own array through with no mapping.
 */
export interface CategoryTile {
  /** Stable id — used as the `tiersByCategory` lookup key and emitted
   *  back on the onChoose / onAnyAmount callbacks. */
  id: string
  /** Display name — "Brick", "Square Feet". */
  name: string
  /** Emoji / glyph shown large on the tile. */
  emoji: string
  /** Short caption under the name — "Red to Founder · as you wish". */
  caption: string
  /** Base tile colour. */
  bg: string
  /** Accent for inner glow + caption + border. */
  accent: string
}

/**
 * One card in the Level 1 tier grid.
 * `render` is a render-prop for the visual that fills the card body
 * (brick SVG, sqft tile, image, nothing). The host stays free to pick
 * its own illustration style without the LEGO growing dependencies.
 */
export interface TierCard {
  /** Stable, unique within its category — used as the React key. */
  label: string
  price: number
  /** Short line under the label — "Patron plaque · lifetime pass". */
  sub?: string
  render?: () => ReactNode
  /** Marks the card with the gold outline + "Most chosen" chip. */
  featured?: boolean
}
