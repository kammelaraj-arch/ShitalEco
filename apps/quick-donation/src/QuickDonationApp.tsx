import React, { useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useDonationStore } from './store/donation.store'
import { IdleScreen } from './pages/IdleScreen'
import { DonationScreen } from './pages/DonationScreen'
import { ProcessingScreen } from './pages/ProcessingScreen'
import { TapScreen } from './pages/TapScreen'
import { ConfirmationScreen } from './pages/ConfirmationScreen'
import { AdminScreen } from './pages/AdminScreen'

// Show screensaver after 2 min of idle on the donate screen only
const SCREENSAVER_TIMEOUT_MS = 120_000
const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'
const TOKEN_STORAGE_KEY = 'shital-device-token'

export function QuickDonationApp() {
  const { screen, setScreen, reset, setBranchId, setReader } = useDonationStore()
  const idleTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Device token auto-config ───────────────────────────────────────────────
  // Accepts ?token=xxx in URL. Stores in localStorage so subsequent loads
  // (without the query param) still use the same config.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    if (urlToken) {
      localStorage.setItem(TOKEN_STORAGE_KEY, urlToken)
      // Clean the token from the URL bar without reloading
      const clean = window.location.pathname + window.location.hash
      window.history.replaceState({}, '', clean)
    }

    const token = urlToken || localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) return

    fetch(`${API_BASE}/kiosk-devices/by-token/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.branch_id) setBranchId(d.branch_id)
        if (d.stripe_reader_id) setReader(d.stripe_reader_id, d.reader_label || d.stripe_reader_id)
      })
      .catch(() => {/* network error — use stored values */})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetIdle = useCallback(() => {
    if (idleTimeout.current) clearTimeout(idleTimeout.current)
    // Only start screensaver timer when on donate screen (not during active payment)
    if (screen === 'donate') {
      idleTimeout.current = setTimeout(() => setScreen('idle'), SCREENSAVER_TIMEOUT_MS)
    }
  }, [screen, setScreen])

  useEffect(() => {
    window.addEventListener('touchstart', resetIdle)
    window.addEventListener('mousedown', resetIdle)
    resetIdle()
    return () => {
      window.removeEventListener('touchstart', resetIdle)
      window.removeEventListener('mousedown', resetIdle)
      if (idleTimeout.current) clearTimeout(idleTimeout.current)
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
