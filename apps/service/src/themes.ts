export type ThemeId = 'dark' | 'crimson' | 'travertine' | 'rose' | 'mehndi'

export interface ThemeVars {
  '--bg': string
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
    id: 'mehndi' as ThemeId,
    name: 'Mehndi Green',
    swatch: '#8BA020',
    light: false,
    vars: {
      '--bg':             '#8BA020',
      '--bg-deep':        '#6B7A10',
      '--bg-header':      'rgba(100,115,15,0.96)',
      '--bg-sticky':      'rgba(95,110,14,0.99)',
      '--bg-footer':      'rgba(70,80,10,0.7)',
      '--bg-card':        'rgba(255,255,255,0.09)',
      '--bg-card-image':  'rgba(212,175,55,0.1)',
      '--border-card':    'rgba(212,175,55,0.3)',
      '--text':           '#FFF8DC',
      '--text-muted':     'rgba(255,248,220,0.55)',
      '--text-faint':     'rgba(255,248,220,0.28)',
      '--select-bg':      '#6B7A10',
      '--btn-dark':       '#3D4A00',
      '--input-bg':       'rgba(255,255,255,0.1)',
      '--input-border':   'rgba(212,175,55,0.3)',
      '--input-text':     '#FFF8DC',
      '--input-focus':    'rgba(212,175,55,0.6)',
    },
  },
  {
    id: 'dark',
    name: 'Sanctum Dark',
    swatch: '#1A0606',
    light: false,
    vars: {
      '--bg':             '#060100',
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
    id: 'travertine',
    name: 'Travertine Stone',
    swatch: '#C8A870',
    light: true,
    vars: {
      '--bg':             '#C8A870',
      '--bg-deep':        '#A8845A',
      '--bg-header':      'rgba(180,140,90,0.96)',
      '--bg-sticky':      'rgba(175,135,88,0.99)',
      '--bg-footer':      'rgba(140,105,60,0.8)',
      '--bg-card':        'rgba(255,245,220,0.45)',
      '--bg-card-image':  'rgba(212,175,55,0.12)',
      '--border-card':    'rgba(120,80,20,0.22)',
      '--text':           '#3D1A00',
      '--text-muted':     'rgba(61,26,0,0.6)',
      '--text-faint':     'rgba(61,26,0,0.35)',
      '--select-bg':      '#C0965C',
      '--btn-dark':       '#3D1A00',
      '--input-bg':       'rgba(255,245,220,0.5)',
      '--input-border':   'rgba(120,80,20,0.35)',
      '--input-text':     '#3D1A00',
      '--input-focus':    'rgba(180,130,40,0.7)',
    },
  },
  {
    id: 'rose',
    name: 'Rose Blush',
    swatch: '#F0B5C0',
    light: true,
    vars: {
      '--bg':             '#F0B5C0',
      '--bg-deep':        '#D890A0',
      '--bg-header':      'rgba(220,160,178,0.96)',
      '--bg-sticky':      'rgba(215,155,173,0.99)',
      '--bg-footer':      'rgba(180,110,130,0.7)',
      '--bg-card':        'rgba(255,240,245,0.5)',
      '--bg-card-image':  'rgba(212,175,55,0.1)',
      '--border-card':    'rgba(160,80,100,0.22)',
      '--text':           '#4A0020',
      '--text-muted':     'rgba(74,0,32,0.6)',
      '--text-faint':     'rgba(74,0,32,0.35)',
      '--select-bg':      '#E0A0B5',
      '--btn-dark':       '#4A0020',
      '--input-bg':       'rgba(255,240,245,0.55)',
      '--input-border':   'rgba(160,80,100,0.35)',
      '--input-text':     '#4A0020',
      '--input-focus':    'rgba(200,100,130,0.6)',
    },
  },
]

export const DEFAULT_THEME: ThemeId = 'crimson'

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
  return THEMES.find((t) => t.id === id) ?? THEMES[1]
}
