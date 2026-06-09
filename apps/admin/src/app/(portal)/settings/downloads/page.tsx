'use client'

// Software Downloads — tiles for every installable app + every web app
// the trust runs. Kiosk installers point at the `kiosk-latest` GitHub
// Release, which build-kiosk.yml's publish-installers job refreshes on
// every successful build (stable URLs — bookmark and re-download to
// update). Web app tiles link to the live URLs.

interface DownloadTile {
  title: string
  subtitle: string
  icon: string
  href: string
  badge?: string
  category: 'installer' | 'web'
  accent: string  // tailwind class for the left border
}

const REPO = 'kammelaraj-arch/ShitalEco'
const KIOSK_RELEASE = `https://github.com/${REPO}/releases/download/kiosk-latest`

const TILES: DownloadTile[] = [
  // ── Installers ────────────────────────────────────────────────────────────
  {
    title:    'Kiosk for Windows',
    subtitle: 'x64 NSIS installer — touchscreens, tills, donation kiosks',
    icon:     '🪟',
    href:     `${KIOSK_RELEASE}/shital-kiosk-windows-setup.exe`,
    badge:    '.exe',
    category: 'installer',
    accent:   'border-l-blue-500/50',
  },
  {
    title:    'Kiosk for Android',
    subtitle: 'APK — sideload on locked-down tablets (see ANDROID_KIOSK.md)',
    icon:     '🤖',
    href:     `${KIOSK_RELEASE}/shital-kiosk-latest.apk`,
    badge:    '.apk',
    category: 'installer',
    accent:   'border-l-green-500/50',
  },
  {
    title:    'Quick Donation for Android',
    subtitle: 'APK — trustees take card / Google Pay donations on a phone',
    icon:     '📱',
    href:     `${KIOSK_RELEASE}/shital-quick-donation-latest.apk`,
    badge:    '.apk',
    category: 'installer',
    accent:   'border-l-saffron-500/50',
  },
  {
    title:    'Kiosk for Linux (portable)',
    subtitle: 'AppImage — runs without install on most x64 distros',
    icon:     '🐧',
    href:     `${KIOSK_RELEASE}/shital-kiosk-linux-x64.AppImage`,
    badge:    '.AppImage',
    category: 'installer',
    accent:   'border-l-amber-500/50',
  },
  {
    title:    'Kiosk for Linux (Debian / Ubuntu)',
    subtitle: 'apt-installable .deb for x64 Linux',
    icon:     '🐧',
    href:     `${KIOSK_RELEASE}/shital-kiosk-linux-x64.deb`,
    badge:    '.deb',
    category: 'installer',
    accent:   'border-l-amber-500/50',
  },
  {
    title:    'Kiosk for Raspberry Pi 4 / 5',
    subtitle: 'ARM64 .deb — for digital-signage screens',
    icon:     '🍓',
    href:     `${KIOSK_RELEASE}/shital-kiosk-raspberry-pi.deb`,
    badge:    '.deb',
    category: 'installer',
    accent:   'border-l-rose-500/50',
  },
  // ── Business web apps (in-browser, nothing to install) ────────────────────
  {
    title:    'Admin Portal',
    subtitle: 'This admin app — bookmark on every trustee laptop',
    icon:     '🛡️',
    href:     'https://admin.shital.org.uk/admin/',
    badge:    'Web',
    category: 'web',
    accent:   'border-l-saffron-500/50',
  },
  {
    title:    'Service Portal (donations)',
    subtitle: 'Public-facing donation + monthly-giving site',
    icon:     '🙏',
    href:     'https://shital.org.uk/',
    badge:    'Web',
    category: 'web',
    accent:   'border-l-saffron-500/50',
  },
  {
    title:    'Quick Donation Kiosk (web)',
    subtitle: 'Tap-and-go donation kiosk — browser fullscreen version',
    icon:     '💷',
    href:     'https://shital.org.uk/donate/',
    badge:    'Web',
    category: 'web',
    accent:   'border-l-saffron-500/50',
  },
  {
    title:    'Smart Screen (signage)',
    subtitle: 'In-temple digital signage with playlists + announcements',
    icon:     '📺',
    href:     'https://screen.shital.org.uk/',
    badge:    'Web',
    category: 'web',
    accent:   'border-l-purple-500/50',
  },
]

function Tile({ tile }: { tile: DownloadTile }) {
  const isInstaller = tile.category === 'installer'
  return (
    <a
      href={tile.href}
      target={isInstaller ? '_blank' : '_self'}
      rel={isInstaller ? 'noreferrer' : undefined}
      className={`glass rounded-2xl p-5 border-l-4 ${tile.accent} hover:bg-white/5 transition-colors flex items-start gap-4 group`}
    >
      <span className="text-3xl flex-shrink-0">{tile.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-white">{tile.title}</h3>
          {tile.badge && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-white/10 border border-white/10 text-white/60 font-mono">
              {tile.badge}
            </span>
          )}
        </div>
        <p className="text-white/50 text-xs mt-1">{tile.subtitle}</p>
        <p className="text-saffron-300 text-xs mt-2 font-mono truncate group-hover:underline">
          {isInstaller ? '↓ Download' : '↗ Open'} {tile.href.replace(/^https?:\/\//, '')}
        </p>
      </div>
    </a>
  )
}

export default function DownloadsPage() {
  const installers = TILES.filter(t => t.category === 'installer')
  const webApps    = TILES.filter(t => t.category === 'web')

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-white">📥 Software Downloads</h1>
        <p className="text-white/40 mt-1">
          Kiosk app installers + links to every browser-based app the trust runs.
          Installers come from <code className="bg-white/5 px-1 rounded text-xs">kiosk-latest</code> GitHub Release —
          rebuilt by CI on every change. Bookmark these URLs and re-download to update.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-white/70 font-bold text-sm uppercase tracking-wider">Kiosk app — installers</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {installers.map(t => <Tile key={t.href} tile={t} />)}
        </div>
        <p className="text-white/30 text-xs">
          Windows installers are <strong>unsigned</strong> — Windows SmartScreen will warn on first install.
          Click <em>More info → Run anyway</em>. For Android, enable <em>Install unknown apps</em> on the device
          (see <code className="bg-white/5 px-1 rounded">apps/kiosk/ANDROID_KIOSK.md</code> in the repo).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-white/70 font-bold text-sm uppercase tracking-wider">Business apps — open in browser</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {webApps.map(t => <Tile key={t.href} tile={t} />)}
        </div>
      </section>

      <section className="space-y-2 text-xs text-white/40">
        <h3 className="text-white/60 font-bold uppercase tracking-wider">Other reference URLs</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            All releases: <a className="text-saffron-300 hover:underline" href={`https://github.com/${REPO}/releases`} target="_blank" rel="noreferrer">github.com/{REPO}/releases</a>
          </li>
          <li>
            Source code: <a className="text-saffron-300 hover:underline" href={`https://github.com/${REPO}`} target="_blank" rel="noreferrer">github.com/{REPO}</a>
          </li>
          <li>Dev preview (always latest claude branch): <a className="text-saffron-300 hover:underline" href="https://dev.shital.org.uk" target="_blank" rel="noreferrer">dev.shital.org.uk</a></li>
        </ul>
      </section>
    </div>
  )
}
