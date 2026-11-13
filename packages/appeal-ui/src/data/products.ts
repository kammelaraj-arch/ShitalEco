// Single source of truth for Future Legacy Appeal products. Copied once
// from apps/service/src/pages/SqFtPage.tsx and now the canonical copy —
// the service portal, Wembley kiosk, and any social-media deep-link page
// all read from here. Edit prices / blurbs / colors in ONE place.
//
// Order matters: `featured` (Square Foot) rises to the top of grids; the
// rest fall in in display_order. Business Sponsorship stays last so it
// doesn't confuse individual donors scanning the grid.

export type ProductKey =
  | 'sqft'
  | 'red'
  | 'bronze'
  | 'gold'
  | 'founder'
  | 'business'

export interface AppealProduct {
  /** Stable key — used in URLs, basket keys, analytics. Never changes. */
  key: ProductKey
  /** Display name — "Square Foot", "Red Brick", … */
  tier: string
  /** Optional emoji that sits above the name on kiosk tiles. */
  emoji?: string
  /** Primary hex colour — tile accent, donor-wall badge, progress bar. */
  color: string
  /** GBP price per unit. Change here, change everywhere. */
  price: number
  /** Ticks the "featured" treatment on the grid (Square Foot in v1). */
  featured?: boolean
  /** One-line tagline shown under the price on grids. */
  blurb: string
  /** Donor-wall recognition one-liner. */
  wall: string
}

export const APPEAL_PRODUCTS: AppealProduct[] = [
  {
    key: 'sqft',
    tier: 'Square Foot',
    emoji: '🏛',
    color: '#d4af37',
    price: 351,
    featured: true,
    blurb: 'Secures a square foot of the sacred ground — this clears the mortgage.',
    wall: 'Your name on the digital donor wall',
  },
  {
    key: 'red',
    tier: 'Red Brick',
    emoji: '🧱',
    color: '#c0392b',
    price: 51,
    blurb: 'A brick to build our future — for every devotee, child and family.',
    wall: 'Your name on the donor wall',
  },
  {
    key: 'bronze',
    tier: 'Bronze Brick',
    emoji: '🧱',
    color: '#cd7f32',
    price: 151,
    blurb: 'A lasting mark of your seva.',
    wall: 'A bronze plaque on the donor wall',
  },
  {
    key: 'gold',
    tier: 'Gold Brick',
    emoji: '🧱',
    color: '#d4af37',
    price: 1008,
    blurb: 'A generous gift that builds the future.',
    wall: 'A prominent gold plaque',
  },
  {
    key: 'founder',
    tier: 'Founder Brick',
    emoji: '🧱',
    color: '#e5e4e2',
    price: 5100,
    blurb: 'Help shape a whole space in the new build.',
    wall: 'A premium Founder panel — our largest recognition',
  },
  {
    key: 'business',
    tier: 'Business Sponsorship',
    emoji: '🏢',
    color: '#4a90e2',
    price: 2501,
    blurb: 'For local businesses — invoice provided, Gift Aid where eligible, logo displayed on request.',
    wall: 'Business name on a dedicated panel',
  },
]

/** Lookup by key — safe for URLs and basket operations. */
export function findProduct(key: string): AppealProduct | undefined {
  return APPEAL_PRODUCTS.find(p => p.key === (key as ProductKey))
}

/** Pretty GBP, always with thousands separators. */
export const gbp = (n: number): string => '£' + n.toLocaleString('en-GB')
