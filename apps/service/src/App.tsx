import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from './store'
import { Header } from './components/Header'
import { BrowsePage } from './pages/BrowsePage'
import { BasketPage } from './pages/BasketPage'
import { ContactPage } from './pages/ContactPage'
import { GiftAidPage } from './pages/GiftAidPage'
import { PaymentPage } from './pages/PaymentPage'
import { ConfirmationPage } from './pages/ConfirmationPage'

const PAGE_ORDER = ['browse', 'basket', 'contact', 'gift-aid', 'payment', 'confirmation']

// Progress bar steps shown in header area during checkout
const CHECKOUT_STEPS = ['basket', 'contact', 'gift-aid', 'payment', 'confirmation']

function ProgressBar({ screen }: { screen: string }) {
  const idx = CHECKOUT_STEPS.indexOf(screen)
  if (idx < 0) return null
  return (
    <div className="bg-white border-b border-gray-100">
      <div className="max-w-5xl mx-auto px-4 py-2">
        <div className="flex items-center gap-1">
          {CHECKOUT_STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-1 flex-1">
              <div
                className={`flex-1 h-1 rounded-full transition-colors duration-300 ${
                  i <= idx ? 'bg-orange-400' : 'bg-gray-200'
                }`}
              />
              {i < CHECKOUT_STEPS.length - 1 && (
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${i < idx ? 'bg-orange-400' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1 text-right capitalize">
          {screen.replace('-', ' ')}
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const screen = useStore((s) => s.screen)

  const pageVariants = {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
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

      {/* Footer */}
      {screen === 'browse' && (
        <footer className="bg-maroon-900 text-white py-6 px-4 mt-8">
          <div className="max-w-5xl mx-auto text-center">
            <p className="text-orange-200 text-xs">
              🕉 Shital Shirdi Sai Baba Temple · Registered Charity · London, UK
            </p>
            <p className="text-white/40 text-xs mt-1">
              Secure payments powered by PayPal · All donations subject to our charity terms
            </p>
          </div>
        </footer>
      )}
    </div>
  )
}
