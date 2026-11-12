// Public surface of @shital/appeal-ui. Consumers:
//   - apps/service       (Future Legacy Appeal page)
//   - apps/quick-donation (Wembley kiosk Appeal mode)
//   - future apps/campaign (social-media deep-link pages)
//
// Keep this file tiny — every re-export is a public API promise.

export * from './data/products'
export { AppealTile } from './components/AppealTile'
export type { AppealTileProps } from './components/AppealTile'
export { AppealGrid } from './components/AppealGrid'
export type { AppealGridProps } from './components/AppealGrid'
export { BasketBadge } from './components/BasketBadge'
export type { BasketBadgeProps } from './components/BasketBadge'
export { QtyStepper } from './components/QtyStepper'
export type { QtyStepperProps } from './components/QtyStepper'
