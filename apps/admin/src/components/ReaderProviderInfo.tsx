'use client'
/**
 * Provider reference card used by both the terminal-devices and devices
 * wizards. One source of truth for:
 *   - the SVG illustration (safe to use everywhere — no third-party rights)
 *   - the brand accent colour
 *   - the human-readable "where do I find the ID?" copy
 *   - the shape of the ID that the backend validates (shown as a hint under
 *     the input so the volunteer doesn't paste the wrong field)
 *
 * The <img> tag first tries `/readers/<provider>.png` so an operator can
 * drop a real product photo into `apps/admin/public/readers/` later with
 * no code change; if that file doesn't exist the SVG renders instead.
 */
import { useState, type CSSProperties, type ReactElement, type SVGProps } from 'react'

export type ProviderId = 'stripe_terminal' | 'sumup' | 'clover' | 'square' | 'cash'

export interface ProviderMeta {
  id: ProviderId
  label: string
  tagline: string
  accent: string           // single accent colour for borders/pills
  bg: string               // card background tint (rgba)
  idFieldLabel: string     // e.g. "Stripe Reader ID"
  idFieldName:
    | 'stripe_reader_id'
    | 'sumup_reader_serial'
    | 'clover_device_id'
    | 'square_device_id'
    | ''
  idPlaceholder: string
  idShapeHint: string      // short "must look like …" shown under the input
  whereToFindId: string[]  // text steps — one <li> each
  idPattern?: RegExp       // optional client-side quick check (mirrors backend)
  // Deep link to the provider's own support/onboarding doc for finding the
  // ID. Opens in a new tab so the operator can see the real screenshots on
  // the provider's site — rights-clean, always up to date.
  docUrl: string
  docLabel: string         // human label for the link button
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'stripe_terminal',
    label: 'Stripe Terminal',
    tagline: 'BBPOS WisePOS E, Stripe Reader M2 / S700 — card readers paired via Stripe.',
    accent: '#6366F1',
    bg: 'rgba(99,102,241,0.08)',
    idFieldLabel: 'Stripe Reader ID',
    idFieldName: 'stripe_reader_id',
    idPlaceholder: 'tmr_FdT1aB2CdE3fGh',
    idShapeHint: 'Starts with "tmr_" followed by letters/digits.',
    whereToFindId: [
      'Open admin.stripe.com and sign in with the temple\'s Stripe account.',
      'Go to More → Terminal → Readers (left-hand menu).',
      'Click the reader that\'s in front of you to open its detail panel.',
      'The ID at the top of the panel starts with "tmr_" — copy that whole string.',
    ],
    idPattern: /^tmr_[A-Za-z0-9]+$/,
    docUrl: 'https://docs.stripe.com/terminal/readers/bbpos-wisepos-e',
    docLabel: 'Open Stripe\'s WisePOS E guide ↗',
  },
  {
    id: 'sumup',
    label: 'SumUp Solo',
    tagline: 'SumUp Solo / Solo Lite — standalone Wi-Fi card reader with its own screen.',
    accent: '#06B6D4',
    bg: 'rgba(6,182,212,0.08)',
    idFieldLabel: 'SumUp Reader Pair-Code',
    idFieldName: 'sumup_reader_serial',
    idPlaceholder: 'yellow-river-stone',
    idShapeHint: 'Three lowercase words joined by hyphens, e.g. "yellow-river-stone".',
    whereToFindId: [
      'On the SumUp Solo, swipe down from the top and tap Settings → Device info.',
      'Look for "Pair-code" or "Reader code" — it reads as three words joined by hyphens.',
      'Type it exactly as shown (all lowercase, hyphens between each word).',
      'If the device is already paired, you can also read the code off the sticker on its back.',
    ],
    idPattern: /^[a-z]+-[a-z]+-[a-z]+$/,
    docUrl: 'https://help.sumup.com/hc/en-gb/articles/13944787898524-Setting-up-your-SumUp-Solo',
    docLabel: 'Open SumUp\'s Solo setup guide ↗',
  },
  {
    id: 'clover',
    label: 'Clover Flex',
    tagline: 'Clover Flex / Flex 3 — handheld terminal with built-in printer.',
    accent: '#F97316',
    bg: 'rgba(249,115,22,0.08)',
    idFieldLabel: 'Clover Device ID',
    idFieldName: 'clover_device_id',
    idPlaceholder: 'C050UQ12345678',
    idShapeHint: 'Prefix "C0" followed by letters and digits.',
    whereToFindId: [
      'On the Clover Flex home screen, tap the Settings cog icon.',
      'Open About → Device info.',
      'Copy the "Device ID" (sometimes shown as "Serial Number").',
      'It usually begins with "C0" — paste the whole value exactly.',
    ],
    docUrl: 'https://help.clover.com/help/en-us/categories/clover-flex/',
    docLabel: 'Open Clover\'s Flex help centre ↗',
  },
  {
    id: 'square',
    label: 'Square',
    tagline: 'Square Terminal / Reader — not the primary flow at the temple; included for completeness.',
    accent: '#3B82F6',
    bg: 'rgba(59,130,246,0.08)',
    idFieldLabel: 'Square Device ID',
    idFieldName: 'square_device_id',
    idPlaceholder: 'XXXXXXXX',
    idShapeHint: 'The device code shown in Square Dashboard → Devices.',
    whereToFindId: [
      'Sign in to squareup.com/dashboard.',
      'Open Account & Settings → Devices (or Devices & Equipment).',
      'Click the device you want to register — the Device Code is at the top.',
      'Copy and paste it exactly into the Device ID field.',
    ],
    docUrl: 'https://squareup.com/help/us/en/article/5833-manage-devices-with-square',
    docLabel: 'Open Square\'s devices guide ↗',
  },
  {
    id: 'cash',
    label: 'Cash',
    tagline: 'No physical reader — logs manual cash receipts against this branch.',
    accent: '#22C55E',
    bg: 'rgba(34,197,94,0.08)',
    idFieldLabel: '',
    idFieldName: '',
    idPlaceholder: '',
    idShapeHint: 'No ID is required for a cash tile.',
    whereToFindId: [
      'A "Cash" provider does not need a reader ID.',
      'Give it a friendly name (e.g. "Front Desk Cash Box") and continue.',
    ],
    docUrl: '',
    docLabel: '',
  },
]

export function getProvider(id: string): ProviderMeta | undefined {
  return PROVIDERS.find(p => p.id === id)
}

/** Inline SVG illustrations. Rough but recognisable silhouettes — no brand
 *  logos, no copyrighted artwork, scale cleanly and look right in dark mode. */
function StripeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 120" fill="none" {...props}>
      <rect x="20" y="10" width="80" height="100" rx="10" stroke="currentColor" strokeWidth="3" fill="rgba(99,102,241,0.08)" />
      <rect x="28" y="22" width="64" height="40" rx="3" fill="rgba(99,102,241,0.25)" />
      <text x="60" y="47" textAnchor="middle" fill="currentColor" fontSize="13" fontWeight="700" fontFamily="system-ui">Stripe</text>
      <rect x="30" y="72" width="16" height="12" rx="2" fill="currentColor" opacity="0.5" />
      <rect x="52" y="72" width="16" height="12" rx="2" fill="currentColor" opacity="0.5" />
      <rect x="74" y="72" width="16" height="12" rx="2" fill="currentColor" opacity="0.5" />
      <rect x="30" y="88" width="16" height="12" rx="2" fill="currentColor" opacity="0.5" />
      <rect x="52" y="88" width="16" height="12" rx="2" fill="currentColor" opacity="0.5" />
      <rect x="74" y="88" width="16" height="12" rx="2" fill="currentColor" opacity="0.5" />
    </svg>
  )
}

function SumUpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 120" fill="none" {...props}>
      <rect x="28" y="6" width="64" height="108" rx="12" stroke="currentColor" strokeWidth="3" fill="rgba(6,182,212,0.08)" />
      <rect x="36" y="16" width="48" height="56" rx="4" fill="rgba(6,182,212,0.25)" />
      <text x="60" y="47" textAnchor="middle" fill="currentColor" fontSize="12" fontWeight="700" fontFamily="system-ui">SumUp</text>
      <circle cx="46" cy="90" r="5" fill="currentColor" opacity="0.5" />
      <circle cx="60" cy="90" r="5" fill="currentColor" opacity="0.5" />
      <circle cx="74" cy="90" r="5" fill="currentColor" opacity="0.5" />
      <rect x="46" y="100" width="28" height="6" rx="3" fill="currentColor" opacity="0.4" />
    </svg>
  )
}

function CloverIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 120" fill="none" {...props}>
      <rect x="22" y="10" width="76" height="100" rx="14" stroke="currentColor" strokeWidth="3" fill="rgba(249,115,22,0.08)" />
      <rect x="30" y="20" width="60" height="42" rx="4" fill="rgba(249,115,22,0.25)" />
      <text x="60" y="47" textAnchor="middle" fill="currentColor" fontSize="12" fontWeight="700" fontFamily="system-ui">Clover</text>
      <rect x="30" y="68" width="60" height="4" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="30" y="78" width="60" height="4" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="30" y="88" width="60" height="4" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="30" y="98" width="60" height="6" rx="2" fill="currentColor" opacity="0.5" />
    </svg>
  )
}

function SquareIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 120" fill="none" {...props}>
      <rect x="15" y="25" width="90" height="70" rx="10" stroke="currentColor" strokeWidth="3" fill="rgba(59,130,246,0.08)" />
      <rect x="22" y="32" width="76" height="40" rx="3" fill="rgba(59,130,246,0.25)" />
      <text x="60" y="56" textAnchor="middle" fill="currentColor" fontSize="12" fontWeight="700" fontFamily="system-ui">Square</text>
      <rect x="22" y="78" width="76" height="12" rx="3" fill="currentColor" opacity="0.4" />
    </svg>
  )
}

function CashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 120" fill="none" {...props}>
      <rect x="10" y="30" width="100" height="60" rx="6" stroke="currentColor" strokeWidth="3" fill="rgba(34,197,94,0.08)" />
      <circle cx="60" cy="60" r="18" stroke="currentColor" strokeWidth="2.5" fill="rgba(34,197,94,0.15)" />
      <text x="60" y="68" textAnchor="middle" fill="currentColor" fontSize="24" fontWeight="700" fontFamily="system-ui">£</text>
      <circle cx="22" cy="42" r="3" fill="currentColor" opacity="0.4" />
      <circle cx="98" cy="42" r="3" fill="currentColor" opacity="0.4" />
      <circle cx="22" cy="78" r="3" fill="currentColor" opacity="0.4" />
      <circle cx="98" cy="78" r="3" fill="currentColor" opacity="0.4" />
    </svg>
  )
}

const ICONS: Record<ProviderId, (props: SVGProps<SVGSVGElement>) => ReactElement> = {
  stripe_terminal: StripeIcon,
  sumup: SumUpIcon,
  clover: CloverIcon,
  square: SquareIcon,
  cash: CashIcon,
}

/**
 * Tries to load `/readers/<provider>.png` first; on 404/error falls back to
 * the inline SVG. Operators can drop real photos in without any code change.
 */
export function ReaderIllustration({ provider, size = 120, className, style }: {
  provider: ProviderId
  size?: number
  className?: string
  style?: CSSProperties
}) {
  const [imgOk, setImgOk] = useState(true)
  const meta = getProvider(provider)
  const Icon = ICONS[provider] ?? ICONS.cash
  return (
    <div
      className={className}
      style={{
        width: size, height: size,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: meta?.accent ?? '#9CA3AF',
        ...style,
      }}
    >
      {imgOk ? (
        <img
          src={`/readers/${provider}.png`}
          alt={meta?.label || provider}
          width={size}
          height={size}
          style={{ objectFit: 'contain', width: '100%', height: '100%' }}
          onError={() => setImgOk(false)}
        />
      ) : (
        <Icon width={size} height={size} />
      )}
    </div>
  )
}
