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
  const { screen, setScreen, isDeviceLoggedIn, _hasHydrated, kioskTheme, bgColor, loggedInUsername, setDeviceFlags, setBranchId, setReader } = useDonationStore()

  // Wait for persisted state to load before deciding whether to show admin setup.
  // Without this check, isDeviceLoggedIn is always false on first render (before
  // Zustand rehydrates from localStorage), causing the admin screen to flash every load.
  useEffect(() => {
    if (!_hasHydrated) return
    if (!isDeviceLoggedIn) { setScreen('admin'); return }

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
  }, [_hasHydrated]) // eslint-disable-line react-hooks/exhaustive-deps

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
