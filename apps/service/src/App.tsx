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
import { MonthlyGivingPage } from './pages/MonthlyGivingPage'
import { DonorLoginPage } from './pages/DonorLoginPage'
import { MyGivingPage } from './pages/MyGivingPage'
import { VolunteerRegistrationPage } from './pages/VolunteerRegistrationPage'
import { ReferenceResponsePage } from './pages/ReferenceResponsePage'
import { scheduleDailyCatalogRefresh, clearServiceCache } from './utils/cachedFetch'

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
  const setScreen = useStore((s) => s.setScreen)
  const themeId = useStore((s) => s.themeId)

  useEffect(() => {
    applyTheme(getTheme(themeId))
  }, [themeId])

  // Donor login returns with #donor_token=… (or #donor_error=…) in the URL
  // fragment. Capture it, store the session, land on My Giving, and clean the URL.
  useEffect(() => {
    const hash = window.location.hash || ''
    if (hash.includes('donor_token=')) {
      const tok = new URLSearchParams(hash.slice(1)).get('donor_token') || ''
      if (tok) {
        useStore.getState().setDonor(tok)
        fetch(`${API}/auth/donor/me`, { headers: { Authorization: `Bearer ${tok}` } })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) useStore.getState().setDonor(tok, d.name || '', d.email || '') })
          .catch(() => {})
        setScreen('my-giving')
      }
      history.replaceState(null, '', window.location.pathname + window.location.search)
    } else if (hash.includes('donor_error=')) {
      setScreen('donor-login')
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Daily catalog cache invalidation at local midnight. Also bust the cache
  // immediately if the server-side catalog version is newer than what we've
  // seen (admin can bump it via Force Refresh from the admin panel).
  useEffect(() => {
    const teardown = scheduleDailyCatalogRefresh()
    fetch(`${API}/items/catalog/version`).then(r => r.ok ? r.json() : null).then(d => {
      if (!d?.version) return
      const seen = localStorage.getItem('service:catalog-version-seen')
      if (seen !== String(d.version)) {
        clearServiceCache()
        localStorage.setItem('service:catalog-version-seen', String(d.version))
      }
    }).catch(() => {})
    return teardown
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    // Quick-link to PayPal: /?amount=11&branch=wembley_main
    // Creates the PayPal subscription server-side and redirects the browser
    // straight to PayPal's hosted approval form — donor sees the card-entry
    // page in 1 click, no in-app amount picker / details step. Used for QR
    // codes / email-blast links / hub buttons. Skipped if 'status' param is
    // also present (donor is coming BACK from PayPal — don't loop).
    const amountParam = params.get('amount')
    const status = params.get('status')
    if (amountParam && !status) {
      const amount = Number(amountParam)
      if (Number.isFinite(amount) && amount >= 1 && amount <= 1000) {
        const branch = params.get('branch') || ''
        const API = (import.meta.env.VITE_API_URL as string | undefined) || '/api/v1'
        fetch(`${API}/service/giving/quick-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, branch_id: branch || 'main' }),
        })
          .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
          .then(d => {
            if (d?.approval_url) {
              window.location.href = d.approval_url
            } else {
              // Backend up but couldn't reach PayPal — fall back to the picker.
              setScreen('monthly-giving')
            }
          })
          .catch(() => setScreen('monthly-giving'))
        return  // Don't run the rest of the boot — we're redirecting anyway.
      }
    }

    // Deep-link screen param (e.g. ?screen=monthly-giving from kiosk)
    const urlScreen = params.get('screen')
    if (
      urlScreen === 'monthly-giving' || urlScreen === 'browse' ||
      urlScreen === 'volunteer'      || urlScreen === 'reference'
    ) {
      setScreen(urlScreen)
    }

    // 1. Hostname subdomain takes highest priority
    const sub = detectBranchFromHostname()
    if (sub) { setBranch(sub, sub, true); return }

    // 2. Explicit branch query param (used when kiosk launches us with a pre-selected branch)
    const urlBranch = params.get('branch')
    if (urlBranch) {
      setBranch(urlBranch, urlBranch, true)
      return
    }

    // 3. URL token param — store it for this device permanently
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
      case 'confirmation':   return <ConfirmationPage />
      case 'monthly-giving': return <MonthlyGivingPage />
      case 'donor-login':    return <DonorLoginPage />
      case 'my-giving':      return <MyGivingPage />
      case 'volunteer': return <VolunteerRegistrationPage />
      case 'reference': return <ReferenceResponsePage />
      default:               return <BrowsePage />
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
