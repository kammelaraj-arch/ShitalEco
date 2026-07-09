export type ThemeId = 'dark' | 'crimson' | 'legacy'

export interface ThemeVars {
  '--bg': string
  '--bg-image': string   // full-page background image layer (crimson paisley) or 'none'
  '--bg-deep': string
  '--bg-header': string
  '--bg-sticky': string
  '--bg-footer': string
  '--bg-card': string
  '--bg-card-image': string
  '--border-card': string
  '--text': string
  '--text-muted': string
  '--text-faint': string
  '--select-bg': string
  '--btn-dark': string   // text on gold buttons
  '--input-bg': string
  '--input-border': string
  '--input-text': string
  '--input-focus': string
}

export interface Theme {
  id: ThemeId
  name: string
  swatch: string
  light: boolean
  vars: ThemeVars
}

export const THEMES: Theme[] = [
  {
    id: 'dark',
    name: 'Sanctum Dark',
    swatch: '#1A0606',
    light: false,
    vars: {
      '--bg':             '#060100',
      '--bg-image':       'none',
      '--bg-deep':        '#0E0303',
      '--bg-header':      'rgba(6,1,0,0.94)',
      '--bg-sticky':      'rgba(6,1,0,0.99)',
      '--bg-footer':      'rgba(14,3,3,0.85)',
      '--bg-card':        'rgba(255,255,255,0.055)',
      '--bg-card-image':  'rgba(212,175,55,0.07)',
      '--border-card':    'rgba(212,175,55,0.2)',
      '--text':           '#FFF8DC',
      '--text-muted':     'rgba(255,248,220,0.5)',
      '--text-faint':     'rgba(255,248,220,0.25)',
      '--select-bg':      '#0E0303',
      '--btn-dark':       '#1A0606',
      '--input-bg':       'rgba(255,255,255,0.06)',
      '--input-border':   'rgba(212,175,55,0.25)',
      '--input-text':     '#FFF8DC',
      '--input-focus':    'rgba(212,175,55,0.6)',
    },
  },
  {
    id: 'crimson',
    name: 'Temple Crimson',
    swatch: '#B80000',
    light: false,
    vars: {
      '--bg':             '#B80000',
      '--bg-image':       "url('/bg-temple.png')",
      '--bg-deep':        '#8B0000',
      '--bg-header':      'rgba(140,0,0,0.94)',
      '--bg-sticky':      'rgba(140,0,0,0.99)',
      '--bg-footer':      'rgba(90,0,0,0.6)',
      '--bg-card':        'rgba(255,255,255,0.09)',
      '--bg-card-image':  'rgba(212,175,55,0.08)',
      '--border-card':    'rgba(212,175,55,0.22)',
      '--text':           '#FFF8DC',
      '--text-muted':     'rgba(255,248,220,0.55)',
      '--text-faint':     'rgba(255,248,220,0.28)',
      '--select-bg':      '#8B0000',
      '--btn-dark':       '#6B0000',
      '--input-bg':       'rgba(255,255,255,0.09)',
      '--input-border':   'rgba(212,175,55,0.28)',
      '--input-text':     '#FFF8DC',
      '--input-focus':    'rgba(212,175,55,0.6)',
    },
  },
  {
    id: 'legacy',
    name: 'Legacy Maroon',
    swatch: '#48101C',
    light: false,
    vars: {
      '--bg':             '#48101C',
      // Appeal-page look: a warm maroon radial lift at the top over the deep
      // maroon base. Layers over the ambient gold glow. Matches /appeal.
      '--bg-image':       'radial-gradient(120% 80% at 50% -8%, #6A1A2C 0%, transparent 55%)',
      '--bg-deep':        '#340A15',
      '--bg-header':      'rgba(52,10,21,0.94)',
      '--bg-sticky':      'rgba(52,10,21,0.99)',
      '--bg-footer':      'rgba(40,8,16,0.72)',
      '--bg-card':        'rgba(92,22,38,0.5)',
      '--bg-card-image':  'rgba(212,175,55,0.1)',
      '--border-card':    'rgba(212,175,55,0.28)',
      '--text':           '#FFF8DC',
      '--text-muted':     'rgba(255,248,220,0.6)',
      '--text-faint':     'rgba(255,248,220,0.3)',
      '--select-bg':      '#340A15',
      '--btn-dark':       '#340A15',
      '--input-bg':       'rgba(255,255,255,0.06)',
      '--input-border':   'rgba(212,175,55,0.3)',
      '--input-text':     '#FFF8DC',
      '--input-focus':    'rgba(212,175,55,0.6)',
    },
  },
]

// Old colours are the default; the crimson paisley is opt-in via the theme
// picker (Temple Crimson). Users can switch anytime.
export const DEFAULT_THEME: ThemeId = 'dark'

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v))
  if (theme.light) {
    root.setAttribute('data-theme', 'light')
  } else {
    root.setAttribute('data-theme', 'dark')
  }
}

export function getTheme(id: ThemeId): Theme {
  // Fall back to Sanctum Dark for any old/removed themeId persisted in a
  // returning visitor's storage (e.g. mehndi/travertine/rose).
  return THEMES.find((t) => t.id === id)
    ?? THEMES.find((t) => t.id === 'dark')
    ?? THEMES[0]
}
