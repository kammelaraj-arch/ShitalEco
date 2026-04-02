import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, t, THEMES, KioskTheme } from '../store/kiosk.store'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

// ─── Nav structure ───────────────────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    items: [
      { id: 'donations',        label: 'Donations',          labelGu: 'દાન',         labelHi: 'दान',          icon: '🪔', screen: 'donate' as const },
      { id: 'soft_donation',    label: 'Soft Item Donation', labelGu: 'વસ્તુ દાન',   labelHi: 'वस्तु दान',    icon: '🎁', screen: 'soft-donation' as const },
      { id: 'project_donation', label: 'Project Donation',   labelGu: 'પ્રોજેક્ટ',  labelHi: 'प्रोजेक्ट',   icon: '🏗️', screen: 'project-donation' as const },
      { id: 'services',         label: 'Services',           labelGu: 'સેવાઓ',       labelHi: 'सेवाएं',       icon: '✨', screen: 'services' as const },
      { id: 'shop',             label: 'Shop',               labelGu: 'દુકાન',       labelHi: 'दुकान',        icon: '🛍️', screen: 'shop' as const },
    ],
  },
  {
    items: [
      { id: 'information',  label: 'Information',  labelGu: 'માહિતી', labelHi: 'जानकारी', icon: 'ℹ️', screen: 'home' as const },
      { id: 'registration', label: 'Registration', labelGu: 'નોંધણી', labelHi: 'पंजीकरण', icon: '📝', screen: 'home' as const },
    ],
  },
]

interface Service {
  id: string; name: string; name_gu?: string | null; name_hi?: string | null
  description?: string | null; category: string; price: number
}

const CATEGORY_META: Record<string, { gradient: string; shadow: string; icon: string; light: string }> = {
  PUJA:      { gradient: 'from-orange-500 to-amber-400',    shadow: 'shadow-orange-300', icon: '🪔', light: '#FFF3E0' },
  HAVAN:     { gradient: 'from-red-500 to-orange-400',      shadow: 'shadow-red-300',    icon: '🔥', light: '#FFEBEE' },
  CLASS:     { gradient: 'from-green-500 to-emerald-400',   shadow: 'shadow-green-300',  icon: '📚', light: '#E8F5E9' },
  HALL_HIRE: { gradient: 'from-violet-500 to-purple-400',   shadow: 'shadow-purple-300', icon: '🏛️', light: '#EDE7F6' },
  FESTIVAL:  { gradient: 'from-pink-500 to-rose-400',       shadow: 'shadow-pink-300',   icon: '🎉', light: '#FCE4EC' },
  OTHER:     { gradient: 'from-blue-500 to-cyan-400',       shadow: 'shadow-blue-300',   icon: '✨', light: '#E3F2FD' },
  DONATION:  { gradient: 'from-yellow-500 to-amber-400',    shadow: 'shadow-yellow-300', icon: '🙏', light: '#FFFDE7' },
}

const MOCK_ITEMS: Service[] = [
  { id: '1',  name: 'Ganesh Puja',         name_gu: 'ગણેશ પૂજા',       name_hi: 'गणेश पूजा',      category: 'PUJA',      price: 51  },
  { id: '2',  name: 'Satyanarayan Katha',  name_gu: 'સત્યનારાયણ',      name_hi: 'सत्यनारायण',     category: 'PUJA',      price: 101 },
  { id: '3',  name: 'Lakshmi Puja',        name_gu: 'લક્ષ્મી પૂજા',    name_hi: 'लक्ष्मी पूजा',   category: 'PUJA',      price: 75  },
  { id: '4',  name: 'Havan Ceremony',      name_gu: 'હવન',              name_hi: 'हवन',             category: 'HAVAN',     price: 151 },
  { id: '5',  name: 'Yoga Class',          name_gu: 'યોગ વર્ગ',        name_hi: 'योग कक्षा',      category: 'CLASS',     price: 10  },
  { id: '6',  name: 'Sanskrit Class',      name_gu: 'સંસ્કૃત',         name_hi: 'संस्कृत',        category: 'CLASS',     price: 15  },
  { id: '7',  name: 'Hall Hire (Half Day)', name_gu: 'હૉલ ભાડે',       name_hi: 'हॉल किराया',     category: 'HALL_HIRE', price: 150 },
  { id: '8',  name: 'Hall Hire (Full Day)', name_gu: 'સંપૂર્ણ દિવસ',   name_hi: 'पूरा दिन',      category: 'HALL_HIRE', price: 280 },
  { id: '9',  name: 'Diwali Ticket',        name_gu: 'દિવાળી',         name_hi: 'दिवाली',         category: 'FESTIVAL',  price: 5   },
  { id: '10', name: 'General Donation',     name_gu: 'સામાન્ય દાન',    name_hi: 'सामान्य दान',    category: 'DONATION',  price: 11  },
  { id: '11', name: 'Food Donation',        name_gu: 'ભોજન દાન',       name_hi: 'भोजन दान',       category: 'DONATION',  price: 21  },
]

const PROMOTED: Service[] = [
  { id: 'p1', name: 'Navratri Puja',       name_gu: 'નવરાત્રી',        name_hi: 'नवरात्री',       category: 'FESTIVAL',  price: 21 },
  { id: 'p2', name: 'Annual Donation',      name_gu: 'વાર્ષિક દાન',    name_hi: 'वार्षिक दान',    category: 'DONATION',  price: 51 },
  { id: 'p3', name: 'Gau Seva',             name_gu: 'ગૌ સેવા',        name_hi: 'गौ सेवा',        category: 'DONATION',  price: 11 },
  { id: 'p4', name: 'Bal Vihar Class',      name_gu: 'બાળ વિહાર',      name_hi: 'बाल विहार',      category: 'CLASS',     price: 10 },
]

function getName(s: Service, lang: string) {
  if (lang === 'gu' && s.name_gu) return s.name_gu
  if (lang === 'hi' && s.name_hi) return s.name_hi
  return s.name
}

function getNavLabel(item: typeof NAV_SECTIONS[0]['items'][0], lang: string) {
  if (lang === 'gu') return item.labelGu
  if (lang === 'hi') return item.labelHi
  return item.label
}

// ─── Theme Picker Modal ───────────────────────────────────────────────────────
function ThemePicker({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = useKioskStore()
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.85, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.85, y: 30 }}
        className="bg-white rounded-3xl shadow-2xl p-7 w-full max-w-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-black text-gray-900">Choose Style & Colour</h2>
            <p className="text-gray-400 text-sm mt-0.5">Pick a theme that resonates with you</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-lg transition-colors">×</button>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {(Object.entries(THEMES) as [KioskTheme, typeof THEMES[KioskTheme]][]).map(([id, th]) => {
            const isActive = theme === id
            return (
              <button
                key={id}
                onClick={() => { setTheme(id); onClose() }}
                className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left ${
                  isActive ? 'border-orange-400 bg-orange-50 shadow-md' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                }`}
              >
                {/* Swatch */}
                <div
                  className="w-12 h-12 rounded-xl flex-shrink-0 shadow-md flex items-center justify-center text-2xl"
                  style={{ background: th.logoBg }}
                >
                  {th.emoji}
                </div>

                {/* Preview strip */}
                <div className="flex gap-1.5 flex-shrink-0">
                  {[th.headerBg, th.sidebarFrom, th.sidebarTo, th.mainBg].map((c, i) => (
                    <div key={i} className="w-5 h-8 rounded-md shadow-sm border border-black/5" style={{ background: c }} />
                  ))}
                </div>

                {/* Label */}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-sm">{th.name}</p>
                  <p className="text-gray-400 text-xs">{th.desc}</p>
                </div>

                {isActive && (
                  <span className="text-orange-500 font-black text-lg flex-shrink-0">✓</span>
                )}
              </button>
            )
          })}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Main HomeScreen ──────────────────────────────────────────────────────────
export function HomeScreen() {
  const { language, setScreen, addItem, items, theme } = useKioskStore()
  const th = THEMES[theme]
  const [activeNav, setActiveNav] = useState('donations')
  const [services, setServices] = useState<Service[]>(MOCK_ITEMS)
  const [added, setAdded] = useState<string | null>(null)
  const [showThemePicker, setShowThemePicker] = useState(false)

  const itemCount = items.reduce((s, i) => s + i.quantity, 0)
  const total = items.reduce((s, i) => s + i.totalPrice, 0)

  useEffect(() => {
    fetch(`${API_BASE}/kiosk/services`)
      .then(r => r.json())
      .then(d => { if (d.services?.length) setServices(d.services) })
      .catch(() => {})
  }, [])

  const activeNavItem = NAV_SECTIONS.flatMap(s => s.items).find(i => i.id === activeNav)

  const filteredServices = services.filter(s => {
    if (['donations', 'soft_donation', 'project_donation'].includes(activeNav))
      return ['DONATION', 'PUJA', 'HAVAN'].includes(s.category)
    if (activeNav === 'services') return ['PUJA', 'HAVAN', 'CLASS', 'HALL_HIRE'].includes(s.category)
    if (activeNav === 'shop')     return s.category === 'OTHER'
    return true
  })

  const handleAdd = (svc: Service) => {
    addItem({ type: 'SERVICE', name: svc.name, quantity: 1, unitPrice: svc.price, totalPrice: svc.price, referenceId: svc.id })
    setAdded(svc.id)
    setTimeout(() => setAdded(null), 1400)
  }

  const meta = (cat: string) => CATEGORY_META[cat] ?? CATEGORY_META.OTHER

  return (
    <div className="w-full h-full flex flex-col" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
      <header
        className="flex items-center h-16 px-4 gap-3 relative z-20 flex-shrink-0"
        style={{
          background: th.headerBg,
          borderBottom: `2px solid rgba(255,153,51,0.25)`,
          boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
        }}
      >
        {/* Logo */}
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-xl font-black shadow-lg border-2 border-white/30 flex-shrink-0"
          style={{ background: th.logoBg, color: th.logoText }}
        >
          🕉
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <h1 className="font-black text-xl leading-tight" style={{ color: th.headerText }}>Shital</h1>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: th.headerSub }}>Wembley</p>
        </div>

        {/* Language pills */}
        <div className="flex gap-1">
          {(['en', 'gu', 'hi'] as const).map(lang => (
            <button
              key={lang}
              onClick={() => useKioskStore.getState().setLanguage(lang)}
              className="px-2.5 py-1 rounded-full text-xs font-bold uppercase transition-all"
              style={{
                background: language === lang ? th.langActive : 'transparent',
                color: language === lang ? '#fff' : th.headerSub,
                border: `1.5px solid ${language === lang ? th.langActive : 'transparent'}`,
              }}
            >
              {lang === 'en' ? 'EN' : lang === 'gu' ? 'ગુ' : 'हि'}
            </button>
          ))}
        </div>

        {/* Theme picker button */}
        <button
          onClick={() => setShowThemePicker(true)}
          className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-105 active:scale-95"
          style={{ background: `${th.langActive}20` }}
          title="Change theme"
        >
          <span className="text-lg">🎨</span>
        </button>

        {/* Basket */}
        <button
          onClick={() => setScreen('basket')}
          className="relative flex items-center gap-2 text-white font-bold px-4 py-2 rounded-xl transition-all shadow-md active:scale-95"
          style={{ background: th.basketBtn }}
        >
          <span className="text-lg">🛒</span>
          <span className="hidden sm:inline text-sm">Basket</span>
          {itemCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-yellow-400 text-gray-900 text-xs font-black w-5 h-5 rounded-full flex items-center justify-center shadow-md">
              {itemCount}
            </span>
          )}
        </button>
      </header>

      {/* ══ BODY ════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
        <aside
          className="w-52 flex-shrink-0 flex flex-col relative z-10 overflow-y-auto"
          style={{
            background: `linear-gradient(180deg, ${th.sidebarFrom} 0%, ${th.sidebarTo} 100%)`,
            borderRight: `2px solid rgba(255,153,51,0.20)`,
            boxShadow: '2px 0 16px rgba(0,0,0,0.08)',
          }}
        >
          {/* Decorative top border */}
          <div className="h-1 w-full" style={{ background: 'linear-gradient(to right,#FFD700,#FF9933,#C41E3A,#FF9933,#FFD700)' }} />

          {NAV_SECTIONS.map((section, si) => (
            <nav key={si} className={si > 0 ? 'mt-auto border-t pt-2 pb-2' : 'py-2'} style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
              {section.items.map(item => {
                const isActive = activeNav === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      // Navigate to dedicated screen if one exists for this nav item
                      const dedicatedScreens: Record<string, Parameters<typeof setScreen>[0]> = {
                        soft_donation:    'soft-donation',
                        project_donation: 'project-donation',
                        shop:             'shop',
                        services:         'services',
                        donations:        'donate',
                      }
                      if (dedicatedScreens[item.id]) {
                        setScreen(dedicatedScreens[item.id])
                      } else {
                        setActiveNav(item.id)
                      }
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all relative"
                    style={{
                      background: isActive ? th.sidebarActiveBg : 'transparent',
                      color: isActive ? th.sidebarActiveText : th.sidebarText,
                    }}
                  >
                    {/* Active bar */}
                    {isActive && (
                      <span
                        className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full"
                        style={{ background: th.sidebarIndicator }}
                      />
                    )}
                    <span className="text-base">{item.icon}</span>
                    <span className={`text-sm leading-tight ${isActive ? 'font-bold' : 'font-medium'}`}>
                      {getNavLabel(item, language)}
                    </span>
                  </button>
                )
              })}
            </nav>
          ))}

          {/* Exit */}
          <button
            onClick={() => setScreen('idle')}
            className="mx-3 mb-4 mt-2 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-all"
            style={{
              color: th.sidebarText,
              border: `1px solid ${th.sidebarBorder}`,
              background: 'rgba(0,0,0,0.04)',
            }}
          >
            ← Exit
          </button>
        </aside>

        {/* ── MAIN ────────────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden" style={{ background: th.mainBg }}>

          {/* Selected category items */}
          <section className="flex-1 flex flex-col overflow-hidden" style={{ borderBottom: `2px solid rgba(0,0,0,0.06)` }}>
            {/* Section header */}
            <div
              className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
              style={{
                background: th.sectionHeaderBg,
                borderBottom: `1px solid rgba(0,0,0,0.06)`,
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              }}
            >
              <span className="text-xl">{activeNavItem?.icon ?? '✨'}</span>
              <h2 className="font-black text-base tracking-wide" style={{ color: th.sectionTitleColor }}>
                {getNavLabel(activeNavItem ?? NAV_SECTIONS[0].items[0], language)}
              </h2>
              <span className="ml-auto text-xs font-semibold" style={{ color: th.sectionCountColor }}>
                {filteredServices.length} items
              </span>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: 'none' }}>
              <AnimatePresence mode="popLayout">
                {filteredServices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
                    <span className="text-5xl">🛕</span>
                    <p className="text-sm font-medium" style={{ color: th.sectionTitleColor }}>No items in this category</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {filteredServices.map((svc, i) => {
                      const m = meta(svc.category)
                      const isAdded = added === svc.id
                      return (
                        <motion.button
                          key={svc.id}
                          layout
                          initial={{ opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.035 }}
                          onClick={() => handleAdd(svc)}
                          className={`
                            relative overflow-hidden rounded-2xl text-left shadow-md
                            bg-gradient-to-br ${m.gradient}
                            transition-all active:scale-95 hover:shadow-lg hover:-translate-y-0.5
                            p-3.5
                          `}
                        >
                          {/* Shine */}
                          <div className="absolute inset-0 bg-gradient-to-br from-white/25 to-transparent rounded-2xl pointer-events-none" />
                          {/* Bottom fade */}
                          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/20 to-transparent rounded-b-2xl pointer-events-none" />

                          <div className="relative z-10">
                            <div className="flex items-start justify-between mb-1.5">
                              <span className="text-3xl">{m.icon}</span>
                              {/* GA badge */}
                              {svc.category === 'DONATION' ? (
                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-green-400/30 text-green-100 flex items-center gap-0.5">
                                  ✓ GA
                                </span>
                              ) : (
                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-red-400/30 text-red-100">
                                  ✗ GA
                                </span>
                              )}
                            </div>
                            <p className="text-white font-bold text-sm leading-snug line-clamp-2 drop-shadow-sm">
                              {getName(svc, language)}
                            </p>
                            <div className="flex items-center justify-between mt-2">
                              <p className="text-white font-black text-lg drop-shadow-sm">£{svc.price}</p>
                              <span className="text-white/80 text-xs bg-white/20 px-2 py-0.5 rounded-full">+ Add</span>
                            </div>
                          </div>

                          <AnimatePresence>
                            {isAdded && (
                              <motion.div
                                initial={{ scale: 0, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0, opacity: 0 }}
                                className="absolute inset-0 flex items-center justify-center rounded-2xl"
                                style={{ background: m.light }}
                              >
                                <div className="flex flex-col items-center gap-1">
                                  <span className="text-3xl">✓</span>
                                  <span className="text-xs font-bold text-gray-700">Added!</span>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.button>
                      )
                    })}
                  </div>
                )}
              </AnimatePresence>
            </div>
          </section>

          {/* Promoted Items strip */}
          <section className="flex-shrink-0" style={{ background: th.promotedBg, borderTop: `2px solid rgba(0,0,0,0.06)` }}>
            <div className="flex items-center gap-2 px-5 py-2" style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <span className="text-base">⭐</span>
              <h3 className="font-black text-sm tracking-wide" style={{ color: th.promotedTitleColor }}>
                Promoted Items
              </h3>
              <span className="ml-1 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-semibold">Featured</span>
            </div>

            <div className="flex gap-3 px-4 py-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {PROMOTED.map((p, i) => {
                const m = meta(p.category)
                return (
                  <motion.button
                    key={p.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.07 + 0.15 }}
                    onClick={() => handleAdd(p)}
                    className={`
                      flex-shrink-0 w-40 rounded-xl overflow-hidden shadow-md
                      bg-gradient-to-br ${m.gradient}
                      text-left p-3 active:scale-95 hover:shadow-lg transition-all relative
                    `}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent rounded-xl" />
                    <span className="absolute top-1.5 right-1.5 bg-yellow-300 text-yellow-900 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase z-10 shadow-sm">
                      Offer
                    </span>
                    <span className="text-2xl block mb-1 relative z-10">{m.icon}</span>
                    <p className="text-white font-bold text-xs leading-snug line-clamp-2 relative z-10 drop-shadow-sm">
                      {getName(p, language)}
                    </p>
                    <p className="text-white font-black text-sm mt-1 relative z-10">£{p.price}</p>
                  </motion.button>
                )
              })}
            </div>
          </section>

          {/* Basket bar */}
          <AnimatePresence>
            {itemCount > 0 && (
              <motion.div
                initial={{ y: 80, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 80, opacity: 0 }}
                className="flex-shrink-0 flex items-center justify-between px-5 py-3"
                style={{
                  background: th.basketBarBg,
                  borderTop: `2px solid rgba(255,153,51,0.30)`,
                  boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🛒</span>
                  <div>
                    <p className="text-xs font-medium opacity-70" style={{ color: th.basketBarText }}>
                      {itemCount} item{itemCount !== 1 ? 's' : ''}
                    </p>
                    <p className="font-black text-lg" style={{ color: th.basketBarSubText }}>
                      £{total.toFixed(2)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setScreen('basket')}
                  className="text-white font-black px-6 py-2.5 rounded-xl text-sm transition-all shadow-lg active:scale-95 hover:opacity-90"
                  style={{ background: th.basketBtn }}
                >
                  View Basket →
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Theme picker overlay */}
      <AnimatePresence>
        {showThemePicker && <ThemePicker onClose={() => setShowThemePicker(false)} />}
      </AnimatePresence>
    </div>
  )
}
