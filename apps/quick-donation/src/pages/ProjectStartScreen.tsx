import { useDonationStore } from '../store/donation.store'
import { CategoryGrid } from '@shital/donation-blocks'

// Shared catalog of all tile types. The admin picks which ones show per
// device (via kiosk_devices.enabled_tiles); empty means render the whole
// list in this order. The anonymous Gupt Daan tile is gated separately by
// kiosk_devices.gupt_daan_enabled.
export interface TileDef {
  id: string
  name: string
  emoji: string
  caption: string
  bg: string
  accent: string
  anon?: boolean
  any?: boolean
}

export const TILE_CATALOG: TileDef[] = [
  { id: 'brick',    name: 'Brick',                 emoji: '🧱', caption: 'Red to Founder · as you wish',    bg: '#D45030', accent: '#FFB899' },
  { id: 'sqft',     name: 'Square Feet',           emoji: '📏', caption: 'Any size · as you can afford',   bg: '#2E86AB', accent: '#A0D8F1' },
  { id: 'material', name: 'Materials',             emoji: '🗿', caption: 'Help supply the build',          bg: '#C06C00', accent: '#FFD28B' },
  { id: 'volunt',   name: 'Volunteering',          emoji: '🤝', caption: 'Help supply the build',          bg: '#14B8A6', accent: '#A7F3D0' },
  { id: 'services', name: 'Professional Services', emoji: '🛠️', caption: 'Share your skill or sponsor it',  bg: '#7B2CBF', accent: '#D8B4FE' },
  { id: 'business', name: 'Business Sponsorship',  emoji: '💼', caption: 'A lasting partnership',          bg: '#2E7D32', accent: '#A6E0A9' },
  { id: 'general',  name: 'General Donation',      emoji: '🪔', caption: 'Where it\'s needed most',         bg: '#E63E7F', accent: '#FFC3DA' },
  { id: 'any',      name: 'Any Amount',            emoji: '£',  caption: 'Give what you wish',             bg: '#FF9933', accent: '#FFE0B2', any: true },
]

export const GUPT_DAAN_TILE: TileDef = {
  id: 'gupt', name: 'Gupt Daan', emoji: 'ॐ',
  caption: 'Anonymous · no name, no record',
  bg: '#5B2A99', accent: '#CDA4DF', anon: true,
}

// Default logo if the device hasn't been configured with one. Points at
// the same asset the service portal + email templates already use, so
// there's one Shital mark across every surface.
const DEFAULT_LOGO_URL = 'https://shirdisai.org.uk/Cnt/img/shital-logo-new.png'

export function ProjectStartScreen() {
  const {
    enabledTiles, guptDaanEnabled, linkedProjects, branchId,
    setPickedCategory, setScreen, orgLogoUrl,
  } = useDonationStore()
  const logoUrl = (orgLogoUrl || '').trim() || DEFAULT_LOGO_URL

  // Resolve the ordered list of tiles the admin picked. Empty config
  // means render every project-type tile in catalog order.
  const picked = enabledTiles.length
    ? enabledTiles.map(id => TILE_CATALOG.find(t => t.id === id)).filter(Boolean) as TileDef[]
    : TILE_CATALOG
  const tiles: TileDef[] = [
    ...picked,
    ...(guptDaanEnabled ? [GUPT_DAAN_TILE] : []),
  ]

  function tapTile(t: TileDef) {
    setPickedCategory(t.id)
    // Per-category routing. The flow a tile takes depends on whether it's
    // a payment flow (brick, sqft, general, any) → tier picker + contact
    // form + tap, a non-payment pledge (services, volunt, material,
    // business) → checklist that saves to project_pledges with no card,
    // or the anonymous Gupt Daan path → amount keypad → tap (no contact).
    if (t.anon) {
      setScreen('project-gupt')
    } else if (['services', 'volunt', 'material', 'business'].includes(t.id)) {
      setScreen('project-pledge')
    } else {
      setScreen('project-tiers')
    }
  }

  // Compact header line matches the live Tap & Donate layout but appends
  // the admin-linked project name(s) so the donor knows what they're
  // supporting without a separate ribbon. One project → its title;
  // multiple → "N projects"; none → branch alone.
  //
  // Prefer `display_title` (donor-facing marketing title, e.g.
  // "Future Legacy Appeal") over `name` (internal admin lookup, e.g.
  // "wembley"). Falls back to `name` for legacy projects where
  // display_title hasn't been filled in yet.
  const titleOf = (p: { name: string; display_title?: string }) =>
    p.display_title?.trim() || p.name
  const projectSuffix = linkedProjects.length === 1
    ? ` · ${titleOf(linkedProjects[0])}`
    : linkedProjects.length > 1
      ? ` · ${linkedProjects.length} projects`
      : ''

  // Target vs raised totals aggregated across every linked project.
  // Shown as a small line under the header so the donor can see where
  // the campaign is at a glance, and (visually) how much a tap of theirs
  // would move the needle.
  const goalTotal   = linkedProjects.reduce((s, p) => s + Number(p.goal_amount   ?? 0), 0)
  const raisedTotal = linkedProjects.reduce((s, p) => s + Number(p.raised_amount ?? 0), 0)
  const showProgress = linkedProjects.length > 0 && goalTotal > 0
  const pct = showProgress ? Math.min(100, (raisedTotal / goalTotal) * 100) : 0
  const fmt = (n: number) =>
    n >= 1000 ? `£${(n/1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })}k`
              : `£${Math.round(n).toLocaleString('en-GB')}`

  return (
    <div className="min-h-screen flex flex-col px-4 py-5"
         style={{ background: 'var(--qd-bg, #140606)', color: 'var(--qd-text-primary, #FFF8EC)' }}>
      <header className="flex items-center justify-between gap-3 mb-2">
        {/* Shital logo + title. Logo loads device-configured URL first
            (orgLogoUrl from the admin profile), falling back to the
            canonical Shital mark served from shirdisai.org.uk. onError
            hides the img so a broken config never leaves a torn icon
            in the header. */}
        <div className="flex items-center gap-3 min-w-0">
          <img
            src={logoUrl}
            alt="Shital"
            className="w-12 h-12 rounded-xl shrink-0 object-contain"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              padding: '4px',
            }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
          <h1 className="font-black text-4xl leading-none min-w-0"
              style={{ color: 'var(--qd-accent, #F6C454)', fontFamily: 'serif', letterSpacing: '-0.02em' }}>
            Tap &amp; Donate
            <span className="ml-2 font-medium text-sm align-middle"
                  style={{ color: 'var(--qd-text-muted, #E7C796)' }}>
              · Shital {branchId || ''}{projectSuffix}
            </span>
          </h1>
        </div>
        <button onClick={() => setScreen('admin')}
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
          ⚙
        </button>
      </header>

      {/* Project progress — small, unobtrusive line + sliver bar.
          Only renders when there's a linked project with a goal set in
          admin → projects. The donor sees it reinforce the "we're
          building something" message without a loud progress banner. */}
      {showProgress && (
        <div className="mb-3" aria-live="polite">
          <div className="flex items-baseline justify-between text-xs"
               style={{ color: 'var(--qd-text-muted, #E7C796)' }}>
            <span>
              <b style={{ color: 'var(--qd-accent, #F6C454)' }}>{fmt(raisedTotal)}</b>
              {' '}raised of <b>{fmt(goalTotal)}</b> target
            </span>
            <span>{Math.round(pct)}%</span>
          </div>
          <div className="h-1.5 mt-1 rounded-full overflow-hidden"
               style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div className="h-full rounded-full transition-all"
                 style={{
                   width: `${pct}%`,
                   background: 'var(--qd-accent, #F6C454)',
                 }} />
          </div>
        </div>
      )}

      {/* Global LEGO — <CategoryGrid> from @shital/donation-blocks. Same
          markup/animation as before, imported instead of inlined so the
          service portal and any campaign page can mount the exact grid. */}
      <CategoryGrid tiles={tiles} onPick={tapTile} cols={3} />
    </div>
  )
}
