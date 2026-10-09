'use client'
/**
 * Software Downloads — a staff-facing page that lists installable apps for
 * Shital. The anchor entry is the Admin Portal itself, which Android Chrome
 * can install from the Shital App manifest (apps/admin/public/manifest.json).
 * iOS has no API to trigger install — those users get instructions.
 *
 * A full native APK (Play Store listing) is a later deliverable; the entry
 * for it is parked here with placeholder links the operator can wire in
 * once the APK/listing exists.
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

// `beforeinstallprompt` is a non-standard Chromium-only event. Declare the
// shape locally so the component can hold the prompt and surface Install.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function DownloadsPage() {
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null)
  const [alreadyInstalled, setAlreadyInstalled] = useState(false)
  const [platform, setPlatform] = useState<'android' | 'ios' | 'desktop' | 'unknown'>('unknown')

  useEffect(() => {
    // Detect the browser platform so we can render the right instructions.
    const ua = navigator.userAgent
    if (/android/i.test(ua)) setPlatform('android')
    else if (/iphone|ipad|ipod/i.test(ua)) setPlatform('ios')
    else setPlatform('desktop')

    // display-mode: standalone === the page is running INSIDE the installed PWA
    // (either the user already installed it, or they're launching it from the
    // home screen). Hide the install button in that case.
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      // iOS Safari exposes a non-standard navigator.standalone flag
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
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-3xl font-black text-white">Software Downloads</h1>
        <p className="text-white/40 mt-1 text-sm">
          Install Shital apps on your phone or desktop. All apps use the same login as the web portal.
        </p>
      </div>

      {/* ── Shital App (PWA) ────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-saffron-500/30 bg-gradient-to-br from-saffron-500/10 to-transparent p-6">
        <div className="flex items-start gap-4 flex-wrap">
          <img src="/icons/shital-192.svg" alt="Shital App" width={96} height={96}
            className="rounded-2xl shadow-lg shrink-0" />
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h2 className="text-white font-black text-xl">Shital App</h2>
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

            {/* Install actions — vary by platform & install state */}
            {alreadyInstalled ? (
              <p className="text-white/50 text-sm italic">You're already running inside the installed app. 🎉</p>
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
                    If the option isn't there, Chrome hasn't registered the install prompt yet — refresh this page and try again.
                  </p>
                </div>
              )
            ) : platform === 'ios' ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
                <p className="mb-2 font-semibold text-white/90">Install on iPhone / iPad</p>
                <p className="mb-1">1. Open this page in <strong>Safari</strong> (not Chrome — iOS limitation).</p>
                <p className="mb-1">2. Tap the <strong>Share</strong> button (square with up arrow).</p>
                <p className="mb-1">3. Scroll down → <strong>Add to Home Screen</strong>.</p>
                <p className="mb-1">4. Confirm the name ("Shital App") → <strong>Add</strong>.</p>
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

      {/* ── Native Android APK (parked) ─────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 opacity-70">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-24 h-24 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-4xl shrink-0">
            🤖
          </div>
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h2 className="text-white font-black text-xl">Shital App for Android (Play Store)</h2>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                Coming soon
              </span>
            </div>
            <p className="text-white/50 text-sm mb-4 max-w-prose">
              A native Android app on Google Play — same features, with push notifications and a verified Play Store listing.
              Use the PWA above in the meantime; it's the same portal.
            </p>
            <div className="flex gap-2 flex-wrap">
              <button disabled className="px-5 py-2.5 rounded-xl border border-white/10 text-white/40 text-sm font-bold cursor-not-allowed">
                Open on Google Play
              </button>
              <button disabled className="px-5 py-2.5 rounded-xl border border-white/10 text-white/40 text-sm font-bold cursor-not-allowed">
                Direct APK download
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      <p className="text-white/30 text-xs">
        Having trouble installing? Email admin@shirdisai.org.uk with your device model and browser.
      </p>
    </div>
  )
}
