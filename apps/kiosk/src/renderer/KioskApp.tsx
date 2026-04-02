import React, { useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useKioskStore } from './store/kiosk.store'
import { IdleScreen } from './pages/IdleScreen'
import { LanguageScreen } from './pages/LanguageScreen'
import { HomeScreen } from './pages/HomeScreen'
import { ServicesScreen } from './pages/ServicesScreen'
import { DonateScreen } from './pages/DonateScreen'
import { BasketScreen } from './pages/BasketScreen'
import { CheckoutScreen } from './pages/CheckoutScreen'
import { PaymentScreen } from './pages/PaymentScreen'
import { ConfirmationScreen } from './pages/ConfirmationScreen'

const IDLE_TIMEOUT_MS = 120_000 // 2 minutes of no touch → reset to idle

export function KioskApp() {
  const { screen, setScreen, resetKiosk } = useKioskStore()
  let idleTimeout: ReturnType<typeof setTimeout>

  const resetIdle = useCallback(() => {
    clearTimeout(idleTimeout)
    if (screen !== 'idle' && screen !== 'language') {
      idleTimeout = setTimeout(() => {
        resetKiosk()
      }, IDLE_TIMEOUT_MS)
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
    initial: { opacity: 0, scale: 0.97, y: 20 },
    animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, scale: 1.02, y: -20, transition: { duration: 0.2 } },
  }

  const renderScreen = () => {
    switch (screen) {
      case 'idle':         return <IdleScreen key="idle" />
      case 'language':     return <LanguageScreen key="language" />
      case 'home':         return <HomeScreen key="home" />
      case 'services':     return <ServicesScreen key="services" />
      case 'donate':       return <DonateScreen key="donate" />
      case 'basket':       return <BasketScreen key="basket" />
      case 'checkout':     return <CheckoutScreen key="checkout" />
      case 'payment':      return <PaymentScreen key="payment" />
      case 'confirmation': return <ConfirmationScreen key="confirmation" />
      default:             return <HomeScreen key="home" />
    }
  }

  return (
    <div className="w-screen h-screen overflow-hidden bg-temple-gradient mandala-bg relative">
      {/* Decorative orbs */}
      <div className="absolute top-0 left-0 w-96 h-96 rounded-full bg-saffron-400/5 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-80 h-80 rounded-full bg-temple-gold/5 blur-3xl pointer-events-none" />

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
