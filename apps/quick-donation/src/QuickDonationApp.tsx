import React, { useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useDonationStore } from './store/donation.store'
import { DonationScreen } from './pages/DonationScreen'
import { ProcessingScreen } from './pages/ProcessingScreen'
import { TapScreen } from './pages/TapScreen'
import { ConfirmationScreen } from './pages/ConfirmationScreen'
import { AdminScreen } from './pages/AdminScreen'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1'

const THEME_BG: Record<string, string> = {
  lotus:   'linear-gradient(160deg, #FFF3E0 0%, #FFE0B2 40%, #FFF3E0 100%)',
  saffron: 'linear-gradient(160deg, #1a0a00 0%, #2d1200 40%, #1a0a00 100%)',
  royal:   'linear-gradient(160deg, #0D0D2B 0%, #1a1a4e 40%, #0D0D2B 100%)',
  peacock: 'linear-gradient(160deg, #003333 0%, #004d4d 40%, #003333 100%)',
  jasmine: 'linear-gradient(160deg, #FFF8E1 0%, #FFF3CD 40%, #FFF8E1 100%)',
  crimson: 'linear-gradient(160deg, #5C0000 0%, #8B0000 40%, #5C0000 100%)',
}

export function QuickDonationApp() {
  const { screen, setScreen, isDeviceLoggedIn, _hasHydrated, stripeReaderId, sumupReaderId, cloverDeviceId, kioskTheme, bgColor, loggedInUsername, kioskDeviceId, setDeviceFlags, setBranchId, setReader, setKioskDeviceId } = useDonationStore()

  // Any of stripe terminal / sumup / clover counts as "a reader is set up".
  // Without this guard, staff land on the tile screen, tap an amount, and
  // only THEN see the "no card reader configured" dead-end on Processing.
  const hasAnyReader = !!(stripeReaderId.trim() || sumupReaderId.trim() || cloverDeviceId.trim())

  // Heartbeat — every 30s while the app is open and a kioskDeviceId is set.
  // Mirrors apps/kiosk/src/renderer/KioskApp.tsx. Without this the device
  // shows OFFLINE in Admin → Kiosks even when fully online (the only thing
  // bumping kiosk_devices.last_seen_at was the initial /quick-donation/login
  // call, so the device went stale ~6 min after the staff member walked
  // away). Fire-and-forget POST to the public /heartbeat endpoint — no
  // auth/token plumbing needed.
  //
  // Auto-heal on 410 Gone: backend returns 410 when our stored kioskDeviceId
  // no longer matches a row (device was re-paired / soft-deleted in admin).
  // Re-fetch the current device id via /refresh-config using the cached
  // username — no staff re-login required. Next beat then matches.
  useEffect(() => {
    if (!kioskDeviceId) return
    const beat = async () => {
      try {
        const r = await fetch(`${API_BASE}/kiosk-devices/${kioskDeviceId}/heartbeat`, {
          method: 'POST', cache: 'no-store',
        })
        if (r.status === 410 && loggedInUsername) {
          const cfg = await fetch(
            `${API_BASE}/kiosk/quick-donation/refresh-config?username=${encodeURIComponent(loggedInUsername)}`,
            { cache: 'no-store' },
          ).then(x => x.json()).catch(() => null)
          if (cfg && cfg.ok && cfg.kiosk_device_id) {
            setKioskDeviceId(cfg.kiosk_device_id)  // next tick beats against the live id
          }
        }
      } catch { /* offline — try next tick */ }
    }
    beat()
    const id = setInterval(beat, 30_000)
    return () => clearInterval(id)
  }, [kioskDeviceId, loggedInUsername])

  // Wait for persisted state to load before deciding whether to show admin setup.
  // Without this check, isDeviceLoggedIn is always false on first render (before
  // Zustand rehydrates from localStorage), causing the admin screen to flash every load.
  useEffect(() => {
    if (!_hasHydrated) return
    if (!isDeviceLoggedIn || !hasAnyReader) { setScreen('admin'); return }

    // Auto-refresh device config on power-on without requiring password
    if (!loggedInUsername) return
    fetch(`${API_BASE}/kiosk/quick-donation/refresh-config?username=${encodeURIComponent(loggedInUsername)}`)
      .then(r => r.json())
      .then(data => {
        if (!data.ok) return
        setBranchId(data.branch.id)
        const sumupSerial = data.sumup_reader_serial || ''
        const cloverId = data.clover_device_id || ''
        const provider = (sumupSerial ? 'sumup' : cloverId ? 'clover' : (data.reader_provider || 'stripe_terminal')) as import('./store/donation.store').ReaderProvider
        setReader(data.stripe_reader_id || '', data.reader_label || data.stripe_reader_id || sumupSerial || cloverId, provider, sumupSerial, '', cloverId)
        setKioskDeviceId(data.kiosk_device_id || '')
        setDeviceFlags({
          showMonthlyGiving: data.show_monthly_giving ?? false,
          enableGiftAid: data.enable_gift_aid ?? false,
          tapAndGo: data.tap_and_go ?? true,
          donateTitle: data.donate_title ?? 'Tap & Donate',
          monthlyGivingText: data.monthly_giving_text ?? 'Make a big impact from just £5/month',
          monthlyGivingAmount: data.monthly_giving_amount ?? 5,
          confirmationText: data.confirmation_text ?? '',
          kioskTheme: data.kiosk_theme ?? 'saffron',
          orgLogoUrl: data.org_logo_url ?? '',
          orgName: data.org_name ?? '',
          bgColor: data.bg_color ?? '',
        })
      })
      .catch(() => {})
    // React to changes in login or any reader id — the original effect was
    // mount-only, so a logout / reader-cleared mid-session left staff stuck.
  }, [_hasHydrated, isDeviceLoggedIn, hasAnyReader, loggedInUsername]) // eslint-disable-line react-hooks/exhaustive-deps

  // Remote-command poll. Admin queues a command via the System Ops panel;
  // we poll every 30 s, act on it, then ack so it's cleared. Allowlist
  // matches the backend: refresh = full reload, reload-config = re-pull
  // device flags only, theme-cycle = sanity blink (used to identify a
  // device from afar).
  useEffect(() => {
    if (!_hasHydrated || !loggedInUsername) return
    const ack = async (id: string, cmd: string) => {
      try {
        await fetch(`${API_BASE}/kiosk/quick-donation/ack-command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: id, command: cmd }),
        })
      } catch { /* non-fatal — next poll will re-act if not cleared */ }
    }
    const tick = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/kiosk/quick-donation/check-command?username=${encodeURIComponent(loggedInUsername)}`,
          { cache: 'no-store' },
        )
        if (!res.ok) return
        const data = await res.json()
        if (!data.command || !data.device_id) return
        if (data.command === 'refresh') {
          await ack(data.device_id, data.command)
          // Short delay so the ack flushes before the page reloads.
          setTimeout(() => window.location.reload(), 250)
        } else if (data.command === 'reload-config') {
          // Re-pull device flags; ack first so a queued newer command isn't
          // overwritten by our own write.
          await ack(data.device_id, data.command)
          fetch(`${API_BASE}/kiosk/quick-donation/refresh-config?username=${encodeURIComponent(loggedInUsername)}`)
            .then(r => r.json()).then(d => { if (d.ok && d.branch) setBranchId(d.branch.id) }).catch(() => {})
        } else if (data.command === 'theme-cycle') {
          // Brief visual blink so an operator can identify the device.
          document.body.style.filter = 'invert(1)'
          setTimeout(() => { document.body.style.filter = '' }, 700)
          await ack(data.device_id, data.command)
        }
      } catch { /* offline — try again next tick */ }
    }
    const id = setInterval(tick, 30_000)
    tick()  // also fire immediately on mount
    return () => clearInterval(id)
  }, [_hasHydrated, loggedInUsername, setBranchId])

  const background = useMemo(() => {
    if (bgColor) return bgColor
    return THEME_BG[kioskTheme] ?? THEME_BG.saffron
  }, [kioskTheme, bgColor])

  const pageVariants = {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, scale: 1.02, transition: { duration: 0.2 } },
  }

  const renderScreen = () => {
    switch (screen) {
      case 'donate':        return <DonationScreen key="donate" />
      case 'processing':    return <ProcessingScreen key="processing" />
      case 'tap':           return <TapScreen key="tap" />
      case 'confirmation':  return <ConfirmationScreen key="confirmation" />
      case 'admin':         return <AdminScreen key="admin" />
      default:              return <DonationScreen key="donate" />
    }
  }

  return (
    <div className="w-screen h-screen overflow-hidden" style={{ background }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={screen}
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="w-full h-full"
        >
          {renderScreen()}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
