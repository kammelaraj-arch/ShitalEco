'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, useTotal, useItemCount, LANGUAGE_META, type Language, t } from '../store'
import { THEMES } from '../themes'

export function Header() {
  const { language, setLanguage, setScreen, screen } = useStore()
  const branchName   = useStore((s) => s.branchName)
  const branchLocked = useStore((s) => s.branchLocked)
  const setBranch    = useStore((s) => s.setBranch)
  const total        = useTotal()
  const itemCount    = useItemCount()
  const themeId      = useStore((s) => s.themeId)
  const setTheme     = useStore((s) => s.setTheme)
  const [showLang, setShowLang] = useState(false)
  const [showTheme, setShowTheme] = useState(false)

  const handleChangeBranch = () => { setBranch('main', '', false); setScreen('browse') }

  return (
    <header className="sticky top-0 z-40 backdrop-blur-md"
      style={{ background: 'var(--bg-header)', borderBottom: '1px solid rgba(212,175,55,0.2)' }}>
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-3">

        {/* Logo */}
        <button onClick={() => setScreen('browse')} className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 animate-diya-pulse"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)', color: 'var(--btn-dark)' }}>
            🛕
          </div>
          <div className="hidden sm:block min-w-0">
            <p className="font-display font-bold text-gold-400 text-sm leading-tight truncate tracking-wide">
              Shri Shirdi Saibaba Temple
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--text-muted)' }}>
                {branchName && branchName !== 'All Temples' ? branchName : 'SHITAL'}
              </p>
              {!branchLocked && branchName && (
                <button onClick={handleChangeBranch}
                  className="text-[10px] text-gold-500 hover:text-gold-300 font-semibold flex-shrink-0">
                  change
                </button>
              )}
            </div>
          </div>
        </button>

        {/* Right actions */}
        <div className="flex items-center gap-2">

          {/* Theme Picker */}
          <div className="relative">
            <button
              onClick={() => { setShowTheme(v => !v); setShowLang(false) }}
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
              style={{ background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.25)' }}
              title="Change theme"
            >
              <span className="text-base">🎨</span>
            </button>
            <AnimatePresence>
              {showTheme && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-52 rounded-2xl overflow-hidden z-50 shadow-2xl p-2"
                  style={{ background: 'var(--bg-header)', border: '1px solid rgba(212,175,55,0.25)' }}>
                  <p className="text-[10px] font-bold tracking-widest uppercase px-2 pb-1.5 pt-0.5"
                    style={{ color: 'rgba(212,175,55,0.5)' }}>Colour Theme</p>
                  {THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => { setTheme(theme.id); setShowTheme(false) }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors text-left"
                      style={{
                        background: theme.id === themeId ? 'rgba(212,175,55,0.12)' : 'transparent',
                        color: theme.id === themeId ? '#D4AF37' : 'var(--text-muted)',
                      }}
                    >
                      <span
                        className="w-5 h-5 rounded-full flex-shrink-0 border-2"
                        style={{
                          background: theme.swatch,
                          borderColor: theme.id === themeId ? '#D4AF37' : 'rgba(212,175,55,0.3)',
                          boxShadow: theme.id === themeId ? `0 0 8px ${theme.swatch}` : 'none',
                        }}
                      />
                      <span className="font-semibold text-xs">{theme.name}</span>
                      {theme.id === themeId && (
                        <svg className="w-3.5 h-3.5 ml-auto text-gold-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                        </svg>
                      )}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            {showTheme && <div className="fixed inset-0 z-40" onClick={() => setShowTheme(false)} />}
          </div>

          {/* Language */}
          <div className="relative">
            <button onClick={() => { setShowLang(v => !v); setShowTheme(false) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold transition-all"
              style={{ background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.25)', color: '#D4AF37' }}>
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
                  className="absolute right-0 top-full mt-2 w-44 rounded-2xl overflow-hidden z-50 shadow-2xl"
                  style={{ background: 'var(--bg-header)', border: '1px solid rgba(212,175,55,0.25)' }}>
                  {(Object.keys(LANGUAGE_META) as Language[]).map((lang) => (
                    <button key={lang} onClick={() => { setLanguage(lang); setShowLang(false) }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left"
                      style={{
                        background: lang === language ? 'rgba(212,175,55,0.12)' : 'transparent',
                        color: lang === language ? '#D4AF37' : 'var(--text-muted)',
                      }}>
                      <span className="text-base font-bold w-8 text-center">{LANGUAGE_META[lang].label}</span>
                      <span>{LANGUAGE_META[lang].script}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            {showLang && <div className="fixed inset-0 z-40" onClick={() => setShowLang(false)} />}
          </div>

          {/* Basket */}
          {screen !== 'confirmation' && (
            <button onClick={() => setScreen('basket')}
              className="relative flex items-center gap-2 px-3 py-2 rounded-xl font-bold text-sm transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: 'var(--btn-dark)' }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span className="hidden sm:inline font-black">{t('basket', language)}</span>
              {itemCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="font-black">{itemCount}</span>
                  <span className="hidden sm:inline opacity-70">· £{total.toFixed(2)}</span>
                </span>
              )}
              {itemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-crimson-500 rounded-full text-white text-xs font-black flex items-center justify-center sm:hidden">
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
