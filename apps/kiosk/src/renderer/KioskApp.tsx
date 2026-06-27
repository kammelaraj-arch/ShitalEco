import React, { useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useKioskStore } from './store/kiosk.store'
import { scheduleDailyCatalogRefresh } from './utils/cachedFetch'
import { SetupScreen } from './pages/SetupScreen'
import { IdleScreen } from './pages/IdleScreen'
import { HomeScreen } from './pages/HomeScreen'
import { ServicesScreen } from './pages/ServicesScreen'
import { DonateScreen } from './pages/DonateScreen'
import { SoftDonationScreen } from './pages/SoftDonationScreen'
import { ProjectDonationScreen } from './pages/ProjectDonationScreen'
import { GiftAidScreen } from './pages/GiftAidScreen'
import { BasketScreen } from './pages/BasketScreen'
import { PaymentMethodScreen } from './pages/PaymentMethodScreen'
import { CheckoutScreen } from './pages/CheckoutScreen'
import { PaymentScreen } from './pages/PaymentScreen'
import { ConfirmationScreen } from './pages/ConfirmationScreen'
import { ShopScreen } from './pages/ShopScreen'
import { AdminScreen } from './pages/AdminScreen'
import { MonthlyGivingScreen } from './pages/MonthlyGivingScreen'

const IDLE_TIMEOUT_MS = 120_000
const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

export function KioskApp() {
  const { screen, resetKiosk, deviceConfigured, setScreen, kioskDeviceId } = useKioskStore()
  let idleTimeout: ReturnType<typeof setTimeout>

  // On startup: if not logged in yet, show login/setup screen
  useEffect(() => {
    if (!deviceConfigured) setScreen('setup')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Heartbeat — every 30 s. Two jobs in one round-trip:
  //   (1) Bump kiosk_devices.last_seen_at (admin Kiosks panel ONLINE state)
  //   (2) Pick up any remote command an admin queued (refresh / restart)
  //       — the backend clears the command atomically on read, so each
  //       admin click fires at most once.
  // Returns 410 Gone if the device row has been deleted/rotated — kiosk
  // resets to the setup screen instead of heartbeating into the void.
  useEffect(() => {
    if (!kioskDeviceId) return
    const beat = async () => {
      try {
        const res = await fetch(`${API_BASE}/kiosk-devices/${kioskDeviceId}/heartbeat`, {
          method: 'POST', cache: 'no-store',
        })
        if (res.status === 410) {
          // Device no longer exists — force back to login
          resetKiosk()
          setScreen('setup')
          return
        }
        if (!res.ok) return
        const data = await res.json().catch(() => null)
        const cmd = (data?.command || '').toLowerCase()
        if (cmd === 'refresh' || cmd === 'restart') {
          // Hard reload — picks up new bundles, re-runs login,
          // re-reads card-reader config from /quick-donation/login.
          window.location.reload()
        } else if (cmd === 'logout' || cmd === 'reset') {
          resetKiosk()
          setScreen('setup')
        }
      } catch { /* offline — try next tick */ }
    }
    beat()
    const id = setInterval(beat, 30_000)
    return () => clearInterval(id)
  }, [kioskDeviceId, resetKiosk, setScreen])

  // Daily catalog cache invalidation at local midnight — even if no one
  // touches the kiosk overnight, the next morning's first read gets fresh data.
  useEffect(() => {
    return scheduleDailyCatalogRefresh()
  }, [])

  const resetIdle = useCallback(() => {
    clearTimeout(idleTimeout)
    if (screen !== 'idle') {
      idleTimeout = setTimeout(() => resetKiosk(), IDLE_TIMEOUT_MS)
    }
  }, [screen, resetKiosk])

  useEffect(() => {
    window.addEventListener('touchstart', resetIdle)
    window.addEventListener('mousedown', resetIdle)
    resetIdle()
    return () => {
      window.removeEventListener('touchstart', resetIdle)
      window.removeEventListener('mousedown', resetIdle)
      clearTimeout(idleTimeout)
    }
  }, [resetIdle])

  const pageVariants = {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, x: -20, transition: { duration: 0.15 } },
  }

  const renderScreen = () => {
    switch (screen) {
      case 'setup':            return <SetupScreen key="setup" />
      case 'idle':             return <IdleScreen key="idle" />
      case 'home':             return <HomeScreen key="home" />
      case 'services':         return <ServicesScreen key="services" />
      case 'donate':           return <DonateScreen key="donate" />
      case 'soft-donation':    return <SoftDonationScreen key="soft-donation" />
      case 'project-donation': return <ProjectDonationScreen key="project-donation" />
      case 'gift-aid':         return <GiftAidScreen key="gift-aid" />
      case 'shop':             return <ShopScreen key="shop" />
      case 'basket':           return <BasketScreen key="basket" />
      case 'payment-method':   return <PaymentMethodScreen key="payment-method" />
      case 'checkout':         return <CheckoutScreen key="checkout" />
      case 'payment':          return <PaymentScreen key="payment" />
      case 'confirmation':     return <ConfirmationScreen key="confirmation" />
      case 'admin':            return <AdminScreen key="admin" />
      case 'monthly-giving':   return <MonthlyGivingScreen key="monthly-giving" />
      default:                 return <HomeScreen key="home" />
    }
  }

  return (
    <div className="w-screen overflow-hidden" style={{ background: '#FAFAFA', height: '100dvh' }}>
      <AnimatePresence mode="wait">
        <motion.div key={screen} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="w-full h-full">
          {renderScreen()}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
