'use client'

// Software Downloads — tiles for every installable app + every web app
// the trust runs. The top section is the Shital App (installable PWA built
// from this very portal — one-tap install on Android/desktop, "Add to
// Home Screen" on iOS). Below that: Kiosk installers from the
// `kiosk-latest` GitHub Release, and links to every browser-based app.

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

// `beforeinstallprompt` is a non-standard Chromium-only event. Declare the
// shape locally so the component can hold the prompt and surface Install.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

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

function ShitalAppSection() {
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null)
  const [alreadyInstalled, setAlreadyInstalled] = useState(false)
  const [platform, setPlatform] = useState<'android' | 'ios' | 'desktop' | 'unknown'>('unknown')

  useEffect(() => {
    const ua = navigator.userAgent
    if (/android/i.test(ua)) setPlatform('android')
    else if (/iphone|ipad|ipod/i.test(ua)) setPlatform('ios')
    else setPlatform('desktop')

    // display-mode: standalone === the page is running INSIDE the installed PWA.
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    setAlreadyInstalled(!!isStandalone)

    // Chrome fires `beforeinstallprompt` when the PWA meets installability
    // criteria. Stash the event so our button can `.prompt()` on click.
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallEvt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function install() {
    if (!installEvt) return
    await installEvt.prompt()
    const choice = await installEvt.userChoice
    if (choice.outcome === 'accepted') setAlreadyInstalled(true)
    setInstallEvt(null)
  }

  return (
    <section className="space-y-3">
      <h2 className="text-white/70 font-bold text-sm uppercase tracking-wider">⭐ Shital App — install on your phone or desktop</h2>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-saffron-500/30 bg-gradient-to-br from-saffron-500/10 to-transparent p-6">
        <div className="flex items-start gap-4 flex-wrap">
          <img src="/admin/icons/shital-192.svg" alt="Shital App" width={96} height={96}
            className="rounded-2xl shadow-lg shrink-0" />
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="text-white font-black text-xl">Shital App</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
                Available now
              </span>
              {alreadyInstalled && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                  ✓ Installed
                </span>
              )}
            </div>
            <p className="text-white/60 text-sm mb-4 max-w-prose">
              The full business portal as an installable app. Opens full-screen (no browser bar), gets its own
              icon on your home screen, and starts up on your branded dashboard. Works offline for pages you
              recently viewed.
            </p>

            {alreadyInstalled ? (
              <p className="text-white/50 text-sm italic">You&apos;re already running inside the installed app. 🎉</p>
            ) : platform === 'android' ? (
              installEvt ? (
                <button onClick={install}
                  className="px-6 py-3 rounded-xl text-white font-black text-sm hover:brightness-110 transition"
                  style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
                  📲 Install Shital App
                </button>
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
                  <p className="mb-2 font-semibold text-white/90">Install on Android</p>
                  <p className="mb-1">1. Tap the <strong>⋮</strong> menu in Chrome (top-right).</p>
                  <p className="mb-1">2. Choose <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</p>
                  <p className="text-white/40 text-xs mt-2">
                    If the option isn&apos;t there, Chrome hasn&apos;t registered the install prompt yet — refresh this page and try again.
                  </p>
                </div>
              )
            ) : platform === 'ios' ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
                <p className="mb-2 font-semibold text-white/90">Install on iPhone / iPad</p>
                <p className="mb-1">1. Open this page in <strong>Safari</strong> (not Chrome — iOS limitation).</p>
                <p className="mb-1">2. Tap the <strong>Share</strong> button (square with up arrow).</p>
                <p className="mb-1">3. Scroll down → <strong>Add to Home Screen</strong>.</p>
                <p className="mb-1">4. Confirm the name (&quot;Shital App&quot;) → <strong>Add</strong>.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
                <p className="mb-2 font-semibold text-white/90">Install on Desktop</p>
                <p className="mb-1">In Chrome / Edge: click the <strong>install icon</strong> (⊕) at the right end of the address bar.</p>
                <p className="text-white/40 text-xs mt-2">
                  Or use the browser menu: <em>Install Shital App…</em>
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-white/5 grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px] text-white/40">
          <div><span className="text-white/60 font-semibold">Platform</span><br/>Android · iOS · Desktop</div>
          <div><span className="text-white/60 font-semibold">Size</span><br/>&lt; 1 MB (installed shell)</div>
          <div><span className="text-white/60 font-semibold">Updates</span><br/>Automatic on every page load</div>
          <div><span className="text-white/60 font-semibold">Account</span><br/>Same login as web portal</div>
        </div>
      </motion.div>

      {/* Parked native APK — Play Store listing is a later deliverable */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 opacity-70">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl shrink-0">
            🤖
          </div>
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="text-white font-black text-lg">Shital App for Android (Play Store)</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                Coming soon
              </span>
            </div>
            <p className="text-white/50 text-sm max-w-prose">
              A native Android app on Google Play — same features, with push notifications and a verified Play Store listing.
              Use the installable PWA above in the meantime; it&apos;s the same portal.
            </p>
          </div>
        </div>
      </motion.div>
    </section>
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
          Shital App (installable web app) + Kiosk installers + links to every browser-based app the trust runs.
          Installers come from <code className="bg-white/5 px-1 rounded text-xs">kiosk-latest</code> GitHub Release —
          rebuilt by CI on every change. Bookmark these URLs and re-download to update.
        </p>
      </div>

      <ShitalAppSection />

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

      <p className="text-white/30 text-xs">
        Having trouble installing? Email <a className="text-saffron-300 hover:underline" href="mailto:admin@shirdisai.org.uk">admin@shirdisai.org.uk</a> with your device model and browser.
      </p>
    </div>
  )
}
