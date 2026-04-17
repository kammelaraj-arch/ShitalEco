import React, { useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useKioskStore, KioskTheme } from './store/kiosk.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'
import { IdleScreen } from './pages/IdleScreen'
import { HomeScreen } from './pages/HomeScreen'
import { ServicesScreen } from './pages/ServicesScreen'
import { DonateScreen } from './pages/DonateScreen'
import { SoftDonationScreen } from './pages/SoftDonationScreen'
import { ProjectDonationScreen } from './pages/ProjectDonationScreen'
import { GiftAidScreen } from './pages/GiftAidScreen'
import { BasketScreen } from './pages/BasketScreen'
import { CheckoutScreen } from './pages/CheckoutScreen'
import { PaymentScreen } from './pages/PaymentScreen'
import { ConfirmationScreen } from './pages/ConfirmationScreen'
import { ShopScreen } from './pages/ShopScreen'
import { AdminScreen } from './pages/AdminScreen'

const IDLE_TIMEOUT_MS = 120_000

export function KioskApp() {
  const { screen, resetKiosk, setTheme, setBranchId, setOrgName, setOrgLogoUrl } = useKioskStore()
  let idleTimeout: ReturnType<typeof setTimeout>

  // On startup, read ?token= from URL and fetch device config
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (!token) return
    fetch(`${API_BASE}/kiosk-devices/by-token/${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : null)
      .then(cfg => {
        if (!cfg) return
        if (cfg.branch_id) setBranchId(cfg.branch_id)
        if (cfg.kiosk_theme) setTheme(cfg.kiosk_theme as KioskTheme)
        if (cfg.org_name)   setOrgName(cfg.org_name)
        if (cfg.org_logo_url) setOrgLogoUrl(cfg.org_logo_url)
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      case 'idle':             return <IdleScreen key="idle" />
      case 'home':             return <HomeScreen key="home" />
      case 'services':         return <ServicesScreen key="services" />
      case 'donate':           return <DonateScreen key="donate" />
      case 'soft-donation':    return <SoftDonationScreen key="soft-donation" />
      case 'project-donation': return <ProjectDonationScreen key="project-donation" />
      case 'gift-aid':         return <GiftAidScreen key="gift-aid" />
      case 'shop':             return <ShopScreen key="shop" />
      case 'basket':           return <BasketScreen key="basket" />
      case 'checkout':         return <CheckoutScreen key="checkout" />
      case 'payment':          return <PaymentScreen key="payment" />
      case 'confirmation':     return <ConfirmationScreen key="confirmation" />
      case 'admin':            return <AdminScreen key="admin" />
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
