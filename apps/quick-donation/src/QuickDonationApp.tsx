import React, { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useDonationStore } from './store/donation.store'
import { DonationScreen } from './pages/DonationScreen'
import { ProcessingScreen } from './pages/ProcessingScreen'
import { TapScreen } from './pages/TapScreen'
import { ConfirmationScreen } from './pages/ConfirmationScreen'
import { AdminScreen } from './pages/AdminScreen'

export function QuickDonationApp() {
  const { screen, setScreen, isDeviceLoggedIn, _hasHydrated } = useDonationStore()

  // Wait for persisted state to load before deciding whether to show admin setup.
  // Without this check, isDeviceLoggedIn is always false on first render (before
  // Zustand rehydrates from localStorage), causing the admin screen to flash every load.
  useEffect(() => {
    if (!_hasHydrated) return
    if (!isDeviceLoggedIn) setScreen('admin')
  }, [_hasHydrated]) // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="w-screen h-screen overflow-hidden bg-temple-gradient">
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
