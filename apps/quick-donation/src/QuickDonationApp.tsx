import React, { useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useDonationStore } from './store/donation.store'
import { IdleScreen } from './pages/IdleScreen'
import { DonationScreen } from './pages/DonationScreen'
import { ProcessingScreen } from './pages/ProcessingScreen'
import { TapScreen } from './pages/TapScreen'
import { ConfirmationScreen } from './pages/ConfirmationScreen'
import { AdminScreen } from './pages/AdminScreen'

const IDLE_TIMEOUT_MS = 90_000

export function QuickDonationApp() {
  const { screen, reset } = useDonationStore()
  let idleTimeout: ReturnType<typeof setTimeout>

  const resetIdle = useCallback(() => {
    clearTimeout(idleTimeout)
    if (screen !== 'idle') {
      idleTimeout = setTimeout(() => reset(), IDLE_TIMEOUT_MS)
    }
  }, [screen, reset])

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
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, scale: 1.02, transition: { duration: 0.2 } },
  }

  const renderScreen = () => {
    switch (screen) {
      case 'idle':          return <IdleScreen key="idle" />
      case 'donate':        return <DonationScreen key="donate" />
      case 'processing':    return <ProcessingScreen key="processing" />
      case 'tap':           return <TapScreen key="tap" />
      case 'confirmation':  return <ConfirmationScreen key="confirmation" />
      case 'admin':         return <AdminScreen key="admin" />
      default:              return <IdleScreen key="idle" />
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
