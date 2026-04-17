import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, LANGUAGE_META, type Language, t } from '../store'

export function Header() {
  const { language, setLanguage, itemCount, setScreen, screen } = useStore()
  const branchName = useStore((s) => s.branchName)
  const branchLocked = useStore((s) => s.branchLocked)
  const setBranch = useStore((s) => s.setBranch)
  const [showLang, setShowLang] = useState(false)

  const total = useStore((s) => s.total)

  const handleChangeBranch = () => {
    setBranch('main', '', false)
    setScreen('browse')
  }

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-orange-100 shadow-sm">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
        {/* Logo / Back */}
        <button
          onClick={() => setScreen('browse')}
          className="flex items-center gap-2.5 min-w-0"
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
               style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)' }}>
            🕉
          </div>
          <div className="hidden sm:block min-w-0">
            <p className="font-black text-maroon-900 text-sm leading-tight tracking-tight truncate">Shital Temple</p>
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-saffron-500 font-medium truncate">
                {branchName && branchName !== 'All Temples' ? branchName : 'Service Portal'}
              </p>
              {!branchLocked && (
                <button
                  onClick={handleChangeBranch}
                  className="text-xs text-orange-400 hover:text-orange-600 font-semibold flex-shrink-0"
                >
                  change
                </button>
              )}
            </div>
          </div>
        </button>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {/* Language picker */}
          <div className="relative">
            <button
              onClick={() => setShowLang(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-50 hover:bg-orange-100 transition-colors text-sm font-semibold text-orange-700"
            >
              <span>{LANGUAGE_META[language].label}</span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <AnimatePresence>
              {showLang && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-44 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50"
                >
                  {(Object.keys(LANGUAGE_META) as Language[]).map((lang) => (
                    <button
                      key={lang}
                      onClick={() => { setLanguage(lang); setShowLang(false) }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-orange-50 transition-colors ${lang === language ? 'bg-orange-50 text-orange-700 font-bold' : 'text-gray-700'}`}
                    >
                      <span className="text-base font-bold w-8 text-center">{LANGUAGE_META[lang].label}</span>
                      <span>{LANGUAGE_META[lang].script}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            {showLang && <div className="fixed inset-0 z-40" onClick={() => setShowLang(false)} />}
          </div>

          {/* Basket button */}
          {screen !== 'confirmation' && (
            <button
              onClick={() => setScreen('basket')}
              className="relative flex items-center gap-2 px-3 py-2 rounded-xl font-bold text-sm text-white transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)' }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span className="hidden sm:inline">{t('basket', language)}</span>
              {itemCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="font-black">{itemCount}</span>
                  <span className="hidden sm:inline text-white/80">· £{total.toFixed(2)}</span>
                </span>
              )}
              {itemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full text-white text-xs font-black flex items-center justify-center sm:hidden">
                  {itemCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
