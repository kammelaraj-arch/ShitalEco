import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore, detectBranchFromHostname } from './store'
import { applyTheme, getTheme } from './themes'
import { Header } from './components/Header'
import { BranchPicker } from './components/BranchPicker'
import { BrowsePage } from './pages/BrowsePage'
import { BasketPage } from './pages/BasketPage'
import { ContactPage } from './pages/ContactPage'
import { GiftAidPage } from './pages/GiftAidPage'
import { PaymentPage } from './pages/PaymentPage'
import { ConfirmationPage } from './pages/ConfirmationPage'

const CHECKOUT_STEPS = ['basket', 'contact', 'gift-aid', 'payment', 'confirmation']

function ProgressBar({ screen }: { screen: string }) {
  const idx = CHECKOUT_STEPS.indexOf(screen)
  if (idx < 0) return null

  const stepLabels: Record<string, string> = {
    basket: 'Basket', contact: 'Details', 'gift-aid': 'Gift Aid',
    payment: 'Payment', confirmation: 'Complete',
  }

  return (
    <div style={{ background: 'var(--bg-header)', borderBottom: '1px solid rgba(212,175,55,0.15)' }}>
      <div className="max-w-5xl mx-auto px-4 py-2.5">
        <div className="flex items-center gap-1">
          {CHECKOUT_STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-1 flex-1">
              <div className={`flex-1 h-0.5 rounded-full transition-all duration-500 ${
                i <= idx
                  ? 'bg-gradient-to-r from-gold-400 to-gold-glow'
                  : 'bg-white/10'
              }`} />
              {i < CHECKOUT_STEPS.length - 1 && (
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors duration-500 ${
                  i < idx ? 'bg-gold-400' : 'bg-white/10'
                }`} />
              )}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-right mt-1 font-semibold tracking-widest uppercase"
          style={{ color: 'rgba(212,175,55,0.6)' }}>
          {stepLabels[screen] || screen}
        </p>
      </div>
    </div>
  )
}

const API = (import.meta.env.VITE_API_URL as string) || '/api/v1'

export default function App() {
  const screen = useStore((s) => s.screen)
  const branchName = useStore((s) => s.branchName)
  const branchLocked = useStore((s) => s.branchLocked)
  const deviceToken = useStore((s) => s.deviceToken)
  const setBranch = useStore((s) => s.setBranch)
  const setDeviceToken = useStore((s) => s.setDeviceToken)
  const themeId = useStore((s) => s.themeId)

  useEffect(() => {
    applyTheme(getTheme(themeId))
  }, [themeId])

  useEffect(() => {
    // 1. Hostname subdomain takes highest priority
    const sub = detectBranchFromHostname()
    if (sub) { setBranch(sub, sub, true); return }

    // 2. URL token param — store it for this device permanently
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    const token = urlToken || deviceToken
    if (!token) return

    fetch(`${API}/kiosk-devices/by-token/${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : null)
      .then(cfg => {
        if (!cfg) return
        if (urlToken) setDeviceToken(urlToken)
        setBranch(cfg.branch_id || 'main', cfg.org_name || cfg.branch_id || 'Temple', true)
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pageVariants = {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
    exit:    { opacity: 0, x: -20 },
  }

  const renderPage = () => {
    switch (screen) {
      case 'browse':       return <BrowsePage />
      case 'basket':       return <BasketPage />
      case 'contact':      return <ContactPage />
      case 'gift-aid':     return <GiftAidPage />
      case 'payment':      return <PaymentPage />
      case 'confirmation': return <ConfirmationPage />
      default:             return <BrowsePage />
    }
  }

  if (!branchName && !branchLocked && !deviceToken) {
    return <BranchPicker />
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      <Header />
      <ProgressBar screen={screen} />

      <main className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={screen}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {renderPage()}
          </motion.div>
        </AnimatePresence>
      </main>

      {screen === 'browse' && (
        <footer className="py-8 px-4 mt-8"
          style={{ borderTop: '1px solid rgba(212,175,55,0.15)', background: 'rgba(90,0,0,0.6)' }}>
          <div className="max-w-5xl mx-auto text-center space-y-1">
            <p className="font-display text-gold-500 text-xs tracking-widest uppercase">
              🕉 SHITAL · Shri Shirdi Saibaba Temple Association
            </p>
            <p className="text-xs" style={{ color: 'rgba(255,248,220,0.3)' }}>
              UK Registered Charity No. 1138530
            </p>
            <p className="text-xs" style={{ color: 'rgba(255,248,220,0.2)' }}>
              Secure payments powered by PayPal · All donations subject to our charity terms
            </p>
          </div>
        </footer>
      )}
    </div>
  )
}
