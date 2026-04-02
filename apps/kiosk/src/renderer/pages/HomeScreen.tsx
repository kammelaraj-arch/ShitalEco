import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, t } from '../store/kiosk.store'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

// ──────────────────────────────────────────────
// Navigation structure (matches wireframe sidebar)
// ──────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    items: [
      { id: 'donations',        label: 'Donations',          labelGu: 'દાન',          labelHi: 'दान',           icon: '🪔', screen: 'donate'   as const },
      { id: 'soft_donation',    label: 'Soft Item Donation', labelGu: 'વસ્તુ દાન',    labelHi: 'वस्तु दान',     icon: '🎁', screen: 'donate'   as const },
      { id: 'project_donation', label: 'Project Donation',   labelGu: 'પ્રોજેક્ટ',   labelHi: 'प्रोजेक्ट',    icon: '🏗️', screen: 'donate'   as const },
      { id: 'services',         label: 'Services',           labelGu: 'સેવાઓ',        labelHi: 'सेवाएं',        icon: '✨', screen: 'services' as const },
      { id: 'shop',             label: 'Shop',               labelGu: 'દુકાન',        labelHi: 'दुकान',         icon: '🛍️', screen: 'services' as const },
    ],
  },
  {
    items: [
      { id: 'information',   label: 'Information',   labelGu: 'માહિતી', labelHi: 'जानकारी', icon: 'ℹ️', screen: 'home' as const },
      { id: 'registration',  label: 'Registration',  labelGu: 'નોંધણી', labelHi: 'पंजीकरण', icon: '📝', screen: 'home' as const },
    ],
  },
]

interface Service {
  id: string; name: string; name_gu?: string | null; name_hi?: string | null
  description?: string | null; category: string; price: number; currency: string
}

const CATEGORY_META: Record<string, { gradient: string; shadow: string; icon: string }> = {
  PUJA:      { gradient: 'from-orange-600 via-amber-500 to-yellow-400',   shadow: 'shadow-orange-500/50', icon: '🪔' },
  HAVAN:     { gradient: 'from-red-700 via-red-500 to-orange-400',        shadow: 'shadow-red-600/50',    icon: '🔥' },
  CLASS:     { gradient: 'from-green-700 via-emerald-500 to-teal-400',    shadow: 'shadow-green-600/50',  icon: '📚' },
  HALL_HIRE: { gradient: 'from-purple-700 via-violet-500 to-indigo-400',  shadow: 'shadow-purple-600/50', icon: '🏛️' },
  FESTIVAL:  { gradient: 'from-pink-600 via-rose-500 to-fuchsia-400',     shadow: 'shadow-pink-600/50',   icon: '🎉' },
  OTHER:     { gradient: 'from-blue-600 via-cyan-500 to-sky-400',         shadow: 'shadow-blue-500/50',   icon: '✨' },
  DONATION:  { gradient: 'from-yellow-500 via-amber-400 to-orange-300',   shadow: 'shadow-yellow-500/50', icon: '🙏' },
}

const MOCK_ITEMS: Service[] = [
  { id: '1', name: 'Ganesh Puja',      name_gu: 'ગણેશ પૂજા',   name_hi: 'गणेश पूजा',   category: 'PUJA',     price: 51 },
  { id: '2', name: 'Satyanarayan Katha', name_gu: 'સત્યનારાયણ', name_hi: 'सत्यनारायण',  category: 'PUJA',     price: 101 },
  { id: '3', name: 'Havan Ceremony',   name_gu: 'હવન',          name_hi: 'हवन',          category: 'HAVAN',    price: 151 },
  { id: '4', name: 'Yoga Class',       name_gu: 'યોગ વર્ગ',    name_hi: 'योग कक्षा',   category: 'CLASS',    price: 10 },
  { id: '5', name: 'Hall Hire',        name_gu: 'હૉલ ભાડે',    name_hi: 'हॉल किराया',  category: 'HALL_HIRE', price: 200 },
  { id: '6', name: 'Diwali Festival',  name_gu: 'દિવાળી',      name_hi: 'दिवाली',       category: 'FESTIVAL', price: 5 },
]

const PROMOTED: Service[] = [
  { id: 'p1', name: 'Navratri Special Puja', name_gu: 'નવરાત્રી પૂજા', name_hi: 'नवरात्री पूजा', category: 'FESTIVAL', price: 21 },
  { id: 'p2', name: 'Annual Charity Donation', name_gu: 'વાર્ષિક દાન', name_hi: 'वार्षिक दान',   category: 'DONATION', price: 51 },
  { id: 'p3', name: 'Sanskrit Classes',        name_gu: 'સંસ્કૃત',      name_hi: 'संस्कृत कक्षा',  category: 'CLASS',    price: 15 },
]

const OM = '🕉'

function getName(s: Service, lang: string) {
  if (lang === 'gu' && s.name_gu) return s.name_gu
  if (lang === 'hi' && s.name_hi) return s.name_hi
  return s.name
}

export function HomeScreen() {
  const { language, setScreen, addItem, items } = useKioskStore()
  const [activeNav, setActiveNav] = useState('donations')
  const [services, setServices] = useState<Service[]>(MOCK_ITEMS)
  const [added, setAdded] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const itemCount = items.reduce((s, i) => s + i.quantity, 0)
  const total = items.reduce((s, i) => s + i.totalPrice, 0)

  useEffect(() => {
    fetch(`${API_BASE}/kiosk/services`)
      .then(r => r.json())
      .then(d => { if (d.services?.length) setServices(d.services) })
      .catch(() => {})
  }, [])

  const activeItem = NAV_SECTIONS.flatMap(s => s.items).find(i => i.id === activeNav)

  const filteredServices = services.filter(s => {
    if (activeNav === 'donations' || activeNav === 'soft_donation' || activeNav === 'project_donation') {
      return ['DONATION', 'PUJA', 'HAVAN'].includes(s.category)
    }
    if (activeNav === 'services') return ['PUJA', 'HAVAN', 'CLASS', 'HALL_HIRE'].includes(s.category)
    if (activeNav === 'shop')     return s.category === 'OTHER'
    return true
  })

  const handleAdd = (svc: Service) => {
    addItem({ type: 'SERVICE', name: svc.name, quantity: 1, unitPrice: svc.price, totalPrice: svc.price, referenceId: svc.id })
    setAdded(svc.id)
    setTimeout(() => setAdded(null), 1400)
  }

  const handleNavClick = (item: typeof NAV_SECTIONS[0]['items'][0]) => {
    setActiveNav(item.id)
    if (item.screen === 'donate') {/* stay on home, filter changes */}
  }

  const meta = (cat: string) => CATEGORY_META[cat] ?? CATEGORY_META.OTHER

  return (
    <div className="w-full h-full flex flex-col bg-[#F5EDD6]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ══════════════════════════════════════════
          HEADER BAR  —  deep maroon temple style
      ══════════════════════════════════════════ */}
      <header className="flex items-center h-16 px-4 gap-3 bg-[#1C0000] shadow-2xl relative z-20 border-b-2 border-[#FF9933]/40">
        {/* Hamburger */}
        <button
          onClick={() => setMenuOpen(v => !v)}
          className="w-12 h-12 flex flex-col items-center justify-center gap-1.5 rounded-xl hover:bg-white/10 transition-colors"
        >
          <span className="w-6 h-0.5 bg-[#FF9933] rounded-full block" />
          <span className="w-6 h-0.5 bg-[#FF9933] rounded-full block" />
          <span className="w-6 h-0.5 bg-[#FF9933] rounded-full block" />
        </button>

        {/* Logo circle */}
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#FF9933] to-[#FF6600] flex items-center justify-center text-white font-black text-lg shadow-lg border border-[#FFD700]/40">
          {OM}
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <h1 className="text-[#FFD700] font-black text-xl leading-tight tracking-wide">Shital</h1>
          <p className="text-[#FF9933]/70 text-xs font-medium leading-none tracking-widest uppercase">Wembley</p>
        </div>

        {/* Language pills */}
        <div className="hidden sm:flex gap-1 mr-2">
          {(['en','gu','hi'] as const).map(lang => (
            <button
              key={lang}
              onClick={() => useKioskStore.getState().setLanguage(lang)}
              className={`px-3 py-1 rounded-full text-xs font-bold uppercase transition-all ${
                language === lang
                  ? 'bg-[#FF9933] text-white'
                  : 'text-[#FF9933]/60 hover:text-[#FF9933]'
              }`}
            >
              {lang === 'en' ? 'EN' : lang === 'gu' ? 'ગુ' : 'हि'}
            </button>
          ))}
        </div>

        {/* Basket */}
        <button
          onClick={() => setScreen('basket')}
          className="relative flex items-center gap-2 bg-[#FF9933] hover:bg-[#FF7700] active:scale-95 text-white font-bold px-4 py-2 rounded-xl transition-all shadow-lg"
        >
          <span className="text-lg">🛒</span>
          <span className="hidden sm:inline text-sm">Basket</span>
          {itemCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-[#FFD700] text-[#1C0000] text-xs font-black w-5 h-5 rounded-full flex items-center justify-center">
              {itemCount}
            </span>
          )}
        </button>
      </header>

      {/* ══════════════════════════════════════════
          BODY  —  sidebar + content
      ══════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT SIDEBAR ── */}
        <aside className="w-52 flex-shrink-0 flex flex-col bg-gradient-to-b from-[#FF9933] to-[#E55C00] shadow-2xl relative z-10 overflow-y-auto border-r-2 border-[#FFD700]/30">
          {/* Temple pattern top bar */}
          <div className="h-1.5 bg-gradient-to-r from-[#FFD700] via-[#FF9933] to-[#C41E3A]" />

          {/* Om decoration */}
          <div className="flex justify-center py-3 border-b border-white/20">
            <span className="text-white/30 text-3xl select-none">{OM}</span>
          </div>

          {NAV_SECTIONS.map((section, si) => (
            <nav key={si} className={si > 0 ? 'mt-auto border-t border-white/20 pt-2 pb-2' : 'py-2'}>
              {section.items.map(item => {
                const isActive = activeNav === item.id
                const label = language === 'gu' ? item.labelGu : language === 'hi' ? item.labelHi : item.label
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all relative group ${
                      isActive
                        ? 'bg-[#1C0000]/30 text-[#FFD700]'
                        : 'text-white/90 hover:bg-white/15 hover:text-white'
                    }`}
                  >
                    {/* Active indicator */}
                    {isActive && (
                      <span className="absolute left-0 top-0 bottom-0 w-1 bg-[#FFD700] rounded-r-full" />
                    )}
                    <span className="text-base">{item.icon}</span>
                    <span className={`text-sm font-${isActive ? 'bold' : 'medium'} leading-tight`}>{label}</span>
                  </button>
                )
              })}
            </nav>
          ))}

          {/* Back button */}
          <button
            onClick={() => setScreen('idle')}
            className="mt-auto mx-3 mb-3 py-2.5 rounded-xl text-white/60 hover:text-white hover:bg-white/15 text-xs font-medium flex items-center justify-center gap-2 transition-all border border-white/20"
          >
            ← Exit
          </button>
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#FFF8EC]">

          {/* ── Selected Category Items (top ~60%) ── */}
          <section className="flex-1 overflow-hidden flex flex-col border-b-2 border-[#FF9933]/20">
            {/* Section header */}
            <div className="flex items-center gap-3 px-5 py-3 bg-white/60 border-b border-[#FF9933]/20">
              <span className="text-xl">{activeItem?.icon ?? '✨'}</span>
              <h2 className="font-black text-[#1C0000] text-base tracking-wide">
                {language === 'gu' ? activeItem?.labelGu : language === 'hi' ? activeItem?.labelHi : activeItem?.label}
              </h2>
              <span className="ml-auto text-xs text-[#FF9933] font-semibold">
                {filteredServices.length} items
              </span>
            </div>

            {/* Items grid */}
            <div className="flex-1 overflow-y-auto p-4">
              <AnimatePresence mode="popLayout">
                {filteredServices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-[#FF9933]/50 gap-2">
                    <span className="text-5xl">🛕</span>
                    <p className="font-medium text-sm">No items in this category</p>
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
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.04 }}
                          onClick={() => handleAdd(svc)}
                          className={`
                            relative overflow-hidden rounded-2xl text-left p-3.5 shadow-lg
                            bg-gradient-to-br ${m.gradient} ${m.shadow}
                            transition-all active:scale-95 hover:shadow-xl
                          `}
                        >
                          {/* Shine */}
                          <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none rounded-2xl" />

                          <div className="relative z-10">
                            <span className="text-3xl block mb-2">{m.icon}</span>
                            <p className="text-white font-bold text-sm leading-snug line-clamp-2">{getName(svc, language)}</p>
                            <p className="text-white/80 font-black text-lg mt-1">£{svc.price}</p>
                          </div>

                          {/* Added tick */}
                          <AnimatePresence>
                            {isAdded && (
                              <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                exit={{ scale: 0 }}
                                className="absolute inset-0 bg-white/90 rounded-2xl flex items-center justify-center"
                              >
                                <span className="text-4xl">✓</span>
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

          {/* ── Promoted Items (bottom strip) ── */}
          <section className="flex-shrink-0 bg-gradient-to-r from-[#4B0082]/8 to-[#C41E3A]/8 border-t-2 border-[#C41E3A]/20">
            {/* Header */}
            <div className="flex items-center gap-2 px-5 py-2 border-b border-[#C41E3A]/15">
              <span className="text-base">⭐</span>
              <h3 className="text-[#4B0082] font-black text-sm tracking-wide">Promoted Items</h3>
            </div>

            {/* Horizontal scroll row */}
            <div className="flex gap-3 px-4 py-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {PROMOTED.map((p, i) => {
                const m = meta(p.category)
                return (
                  <motion.button
                    key={p.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.08 + 0.2 }}
                    onClick={() => handleAdd(p)}
                    className={`
                      flex-shrink-0 w-40 rounded-xl overflow-hidden shadow-md
                      bg-gradient-to-br ${m.gradient}
                      text-left p-3 active:scale-95 transition-all relative
                    `}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/15 to-transparent" />
                    <span className="text-2xl block mb-1 relative z-10">{m.icon}</span>
                    <p className="text-white font-bold text-xs leading-snug line-clamp-2 relative z-10">{getName(p, language)}</p>
                    <p className="text-white/90 font-black text-sm mt-1 relative z-10">£{p.price}</p>
                    <span className="absolute top-1.5 right-1.5 bg-[#FFD700] text-[#1C0000] text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase z-10">
                      Featured
                    </span>
                  </motion.button>
                )
              })}
            </div>
          </section>

          {/* ── Basket bar (appears when items in basket) ── */}
          <AnimatePresence>
            {itemCount > 0 && (
              <motion.div
                initial={{ y: 80, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 80, opacity: 0 }}
                className="flex-shrink-0 flex items-center justify-between px-5 py-3 bg-[#1C0000] border-t-2 border-[#FF9933]/40"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🛒</span>
                  <div>
                    <p className="text-white/70 text-xs font-medium">{itemCount} item{itemCount !== 1 ? 's' : ''}</p>
                    <p className="text-[#FFD700] font-black text-lg">£{total.toFixed(2)}</p>
                  </div>
                </div>
                <button
                  onClick={() => setScreen('basket')}
                  className="bg-[#FF9933] hover:bg-[#FF7700] active:scale-95 text-white font-black px-6 py-2.5 rounded-xl text-sm transition-all shadow-lg"
                >
                  View Basket →
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
