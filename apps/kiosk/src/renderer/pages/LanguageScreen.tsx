import React from 'react'
import { motion } from 'framer-motion'
import { useKioskStore, Language } from '../store/kiosk.store'

const LANGUAGES: { code: Language; label: string; native: string; flag: string }[] = [
  { code: 'en', label: 'English', native: 'English', flag: '🇬🇧' },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી', flag: '🇮🇳' },
  { code: 'hi', label: 'Hindi', native: 'हिंदी', flag: '🇮🇳' },
]

export function LanguageScreen() {
  const { setLanguage, setScreen } = useKioskStore()

  const handleSelect = (lang: Language) => {
    setLanguage(lang)
    setScreen('home')
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-12">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-16"
      >
        <div className="text-6xl mb-4">🌐</div>
        <h1 className="text-4xl font-black text-white mb-2">Choose Your Language</h1>
        <p className="text-saffron-400/70 text-xl">ભાષા પસંદ કરો · भाषा चुनें</p>
      </motion.div>

      <div className="grid grid-cols-3 gap-6 w-full max-w-3xl">
        {LANGUAGES.map((lang, i) => (
          <motion.button
            key={lang.code}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 + 0.2 }}
            onClick={() => handleSelect(lang.code)}
            className="glass-card rounded-4xl p-10 flex flex-col items-center gap-4 service-card ripple hover:border-saffron-400/50 active:scale-95 transition-all"
          >
            <span className="text-6xl">{lang.flag}</span>
            <div className="text-center">
              <p className="text-white font-black text-2xl">{lang.native}</p>
              {lang.native !== lang.label && (
                <p className="text-saffron-400/60 text-base mt-1">{lang.label}</p>
              )}
            </div>
          </motion.button>
        ))}
      </div>

      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        onClick={() => setScreen('idle')}
        className="mt-12 text-saffron-400/50 text-lg underline"
      >
        ← Back
      </motion.button>
    </div>
  )
}
