// Public surface of @shital/donation-blocks.
//
//   <DonationPicker>  — the global Level 0 → Level 1 flow. The one
//                       control the operator asked for.
//
//   <CategoryGrid>    — Level 0 only, for hosts that don't want the
//                       wizard (e.g. a static landing page grid).
//   <TierGrid>        — Level 1 only, same reasoning.
//
//   CategoryTile / TierCard types — share these across the host app
//                                   so kiosk / portal catalogs speak
//                                   the same shape.

export { DonationPicker } from './DonationPicker'
export type { DonationPickerProps } from './DonationPicker'
export { CategoryGrid } from './CategoryGrid'
export type { CategoryGridProps } from './CategoryGrid'
export { TierGrid } from './TierGrid'
export type { TierGridProps } from './TierGrid'
export type { CategoryTile, TierCard } from './types'
