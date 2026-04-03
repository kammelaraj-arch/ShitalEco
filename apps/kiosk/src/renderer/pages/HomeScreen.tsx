import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, t, THEMES, KioskTheme } from '../store/kiosk.store'
import {
  SOFT_DONATION_ITEMS, SHOP_ITEMS, BRICK_TIERS, GENERAL_DONATIONS, PROJECTS,
  SPONSORSHIP_ITEMS,
  type CatalogItem,
} from '../data/catalog'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

// ─── Nav structure ────────────────────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    items: [
      { id: 'donations',        label: 'Donations',          labelGu: 'દાન',         labelHi: 'दान',          icon: '🪔' },
      { id: 'soft_donation',    label: 'Soft Item Donation', labelGu: 'વસ્તુ દાન',   labelHi: 'वस्तु दान',    icon: '🎁' },
      { id: 'sponsorship',      label: 'Sponsorship',        labelGu: 'પ્રાયોજન',    labelHi: 'प्रायोजन',     icon: '📖' },
      { id: 'project_donation', label: 'Project Donation',   labelGu: 'પ્રોજેક્ટ',  labelHi: 'प्रोजेक्ट',   icon: '🏗️' },
      { id: 'services',         label: 'Services',           labelGu: 'સેવાઓ',       labelHi: 'सेवाएं',       icon: '✨' },
      { id: 'shop',             label: 'Shop',               labelGu: 'દુકાન',       labelHi: 'दुकान',        icon: '🛍️' },
    ],
  },
  {
    items: [
      { id: 'information',  label: 'Information',  labelGu: 'માહિતી', labelHi: 'जानकारी', icon: 'ℹ️' },
      { id: 'registration', label: 'Registration', labelGu: 'નોંધણી', labelHi: 'पंजीकरण', icon: '📝' },
    ],
  },
]

interface Service {
  id: string; name: string; name_gu?: string | null; name_hi?: string | null
  description?: string | null; category: string; price: number
}

const CATEGORY_META: Record<string, { color: string; icon: string }> = {
  PUJA:      { color: '#FF9933', icon: '🪔' },
  HAVAN:     { color: '#e53e3e', icon: '🔥' },
  CLASS:     { color: '#38a169', icon: '📚' },
  HALL_HIRE: { color: '#805ad5', icon: '🏛️' },
  FESTIVAL:  { color: '#d53f8c', icon: '🎉' },
  OTHER:     { color: '#3182ce', icon: '✨' },
  DONATION:  { color: '#d69e2e', icon: '🙏' },
}

// ─── Category image URLs (Unsplash) — emoji shows if image fails to load ──────
const CATEGORY_IMAGES: Record<string, string> = {
  // Service categories
  PUJA:             'https://source.unsplash.com/featured/400x240/?indian,diya,puja,lamp&sig=1',
  HAVAN:            'https://source.unsplash.com/featured/400x240/?fire,sacred,ceremony&sig=2',
  CLASS:            'https://source.unsplash.com/featured/400x240/?yoga,meditation&sig=3',
  HALL_HIRE:        'https://source.unsplash.com/featured/400x240/?banquet,hall,event&sig=4',
  FESTIVAL:         'https://source.unsplash.com/featured/400x240/?diwali,festival,lights&sig=5',
  DONATION:         'https://source.unsplash.com/featured/400x240/?temple,donation,giving&sig=6',
  // Catalog categories
  GRAINS:           'https://source.unsplash.com/featured/400x240/?rice,grain,wheat&sig=7',
  OIL_ESSENTIALS:   'https://source.unsplash.com/featured/400x240/?cooking,oil,kitchen&sig=8',
  PULSES:           'https://source.unsplash.com/featured/400x240/?lentils,dal,pulses&sig=9',
  PROJECT_DONATION: 'https://source.unsplash.com/featured/400x240/?temple,construction&sig=10',
  PUJA_ITEMS:       'https://source.unsplash.com/featured/400x240/?incense,coconut,ritual&sig=11',
  PRASAD:           'https://source.unsplash.com/featured/400x240/?indian,sweets,modak&sig=12',
  BOOKS:            'https://source.unsplash.com/featured/400x240/?scripture,books,holy&sig=13',
  MURTIS:           'https://source.unsplash.com/featured/400x240/?ganesh,statue,murti&sig=14',
  MALAS:            'https://source.unsplash.com/featured/400x240/?prayer,beads,mala&sig=15',
  PUJA_ACCESSORIES: 'https://source.unsplash.com/featured/400x240/?brass,puja,thali&sig=16',
  GENERAL_DONATION: 'https://source.unsplash.com/featured/400x240/?temple,prayer,flowers&sig=17',
  SPONSORSHIP:      'https://source.unsplash.com/featured/400x240/?flower,garland,marigold&sig=18',
}

function getCategoryImage(category: string): string {
  return CATEGORY_IMAGES[category] || CATEGORY_IMAGES.DONATION
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

// ─── Theme Picker ─────────────────────────────────────────────────────────────
function ThemePicker({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = useKioskStore()
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.88, y: 24 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.88, y: 24 }}
        className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-gray-900">Choose Style</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-bold">×</button>
        </div>
        <div className="grid grid-cols-1 gap-2">
          {(Object.entries(THEMES) as [KioskTheme, typeof THEMES[KioskTheme]][]).map(([id, th]) => {
            const isActive = theme === id
            return (
              <button
                key={id}
                onClick={() => { setTheme(id); onClose() }}
                className={`flex items-center gap-3 p-3 rounded-2xl border-2 text-left transition-all ${
                  isActive ? 'border-orange-400 bg-orange-50' : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-xl" style={{ background: th.logoBg }}>{th.emoji}</div>
                <div className="flex-1">
                  <p className="font-bold text-gray-900 text-sm">{th.name}</p>
                  <p className="text-gray-400 text-xs">{th.desc}</p>
                </div>
                {isActive && <span className="text-orange-500 font-black">✓</span>}
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
  const { language, setScreen, addItem, items, theme, resetKiosk } = useKioskStore()
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

  const catalogItems: CatalogItem[] = (() => {
    if (activeNav === 'soft_donation')    return SOFT_DONATION_ITEMS
    if (activeNav === 'project_donation') return BRICK_TIERS
    if (activeNav === 'shop')             return SHOP_ITEMS
    if (activeNav === 'donations')        return GENERAL_DONATIONS
    if (activeNav === 'sponsorship')      return SPONSORSHIP_ITEMS
    return []
  })()

  const useCatalog = catalogItems.length > 0

  const filteredServices = services.filter(s => {
    if (activeNav === 'services') return ['PUJA', 'HAVAN', 'CLASS', 'HALL_HIRE'].includes(s.category)
    return ['PUJA', 'HAVAN', 'CLASS', 'HALL_HIRE', 'FESTIVAL'].includes(s.category)
  })

  const handleAddCatalog = (item: CatalogItem) => {
    addItem({
      type: item.category === 'SHOP' ? 'SERVICE' : 'DONATION',
      name: item.name,
      nameGu: item.nameGu,
      nameHi: item.nameHi,
      quantity: 1,
      unitPrice: item.price,
      totalPrice: item.price,
      referenceId: item.id,
      giftAidEligible: item.giftAidEligible,
    })
    setAdded(item.id)
    setTimeout(() => setAdded(null), 1400)
  }

  const handleAdd = (svc: Service) => {
    const giftAidEligible = ['DONATION', 'GENERAL_DONATION', 'PROJECT_DONATION'].includes(svc.category)
    addItem({ type: svc.category.includes('DONATION') ? 'DONATION' : 'SERVICE', name: svc.name, quantity: 1, unitPrice: svc.price, totalPrice: svc.price, referenceId: svc.id, giftAidEligible })
    setAdded(svc.id)
    setTimeout(() => setAdded(null), 1400)
  }

  const displayItems = useCatalog ? catalogItems : filteredServices
  const navLabel = getNavLabel(activeNavItem ?? NAV_SECTIONS[0].items[0], language)
  const isGiftAidSection = activeNav === 'donations' || activeNav === 'project_donation'

  return (
    <div className="w-full h-full flex flex-col" style={{ fontFamily: 'Inter, system-ui, sans-serif', background: '#f7f3ee' }}>

      {/* ══ TOP BAR ════════════════════════════════════════════════════════════ */}
      <header
        className="flex items-center gap-3 px-4 flex-shrink-0"
        style={{ height: 60, background: th.headerBg, borderBottom: '2px solid rgba(0,0,0,0.08)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
      >
        {/* Logo */}
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl font-black flex-shrink-0 shadow border-2 border-white/30"
          style={{ background: th.logoBg, color: th.logoText }}
        >
          🕉
        </div>

        {/* Temple name */}
        <div className="flex-1 min-w-0">
          <h1 className="font-black text-base leading-tight" style={{ color: th.headerText }}>Shital Temple</h1>
          <p className="text-xs opacity-70" style={{ color: th.headerSub }}>Wembley, London</p>
        </div>

        {/* Language */}
        <div className="flex gap-1">
          {(['en', 'gu', 'hi'] as const).map(lang => (
            <button
              key={lang}
              onClick={() => useKioskStore.getState().setLanguage(lang)}
              className="px-2 py-1 rounded-lg text-xs font-bold uppercase transition-all"
              style={{
                background: language === lang ? th.langActive : 'rgba(255,255,255,0.15)',
                color: language === lang ? '#fff' : th.headerSub,
              }}
            >
              {lang === 'en' ? 'EN' : lang === 'gu' ? 'ગુ' : 'हि'}
            </button>
          ))}
        </div>

        {/* Theme picker button */}
        <button
          onClick={() => setShowThemePicker(true)}
          className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95"
          style={{ background: 'rgba(255,255,255,0.15)' }}
          title="Change theme"
        >
          <span className="text-base">🎨</span>
        </button>
      </header>

      {/* ══ BODY ═══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
        <aside
          className="flex-shrink-0 flex flex-col overflow-y-auto"
          style={{
            width: 160,
            background: '#fff',
            borderRight: '1px solid #e5e7eb',
          }}
        >
          {NAV_SECTIONS.map((section, si) => (
            <nav key={si} className={si > 0 ? 'border-t border-gray-100 mt-auto' : ''}>
              {section.items.map(item => {
                const isActive = activeNav === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveNav(item.id)}
                    className="w-full flex flex-col items-center gap-1 py-3 px-2 text-center transition-all relative active:scale-95"
                    style={{
                      background: isActive ? `${th.langActive}15` : 'transparent',
                      borderLeft: isActive ? `3px solid ${th.langActive}` : '3px solid transparent',
                    }}
                  >
                    <span className="text-2xl leading-none">{item.icon}</span>
                    <span
                      className="text-[11px] leading-tight font-semibold"
                      style={{ color: isActive ? th.langActive : '#6b7280' }}
                    >
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
            className="mx-2 mb-3 mt-2 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1 text-gray-400 hover:text-gray-600 transition-colors"
            style={{ border: '1px solid #e5e7eb' }}
          >
            ← Exit
          </button>
        </aside>

        {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden bg-white">

          {/* Category title header */}
          <div
            className="flex items-center justify-between px-5 py-3 flex-shrink-0"
            style={{ borderBottom: '1px solid #e5e7eb' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl">{activeNavItem?.icon ?? '✨'}</span>
              <h2 className="font-black text-xl text-gray-900">{navLabel}</h2>
            </div>
            {isGiftAidSection && (
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-green-100 text-green-700 border border-green-200">
                ✓ Gift Aid Eligible
              </span>
            )}
          </div>

          {/* Items grid — scrollable */}
          <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: 'thin', scrollbarColor: '#d1d5db transparent' }}>
            <AnimatePresence mode="popLayout">
              {displayItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-40">
                  <span className="text-5xl">🛕</span>
                  <p className="text-sm font-medium text-gray-500">No items in this category</p>
                </div>
              ) : useCatalog ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {(catalogItems as CatalogItem[]).map((item, i) => {
                    const isAdded = added === item.id
                    return (
                      <motion.button
                        key={item.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.025 }}
                        onClick={() => handleAddCatalog(item)}
                        className="relative overflow-hidden rounded-2xl text-left bg-white border border-gray-200 shadow-sm active:scale-95 hover:shadow-md transition-all flex flex-col"
                      >
                        {/* Image area — real photo with emoji fallback */}
                        <div
                          className="relative overflow-hidden flex-shrink-0"
                          style={{ height: 100, background: item.imageColor }}
                        >
                          {/* Emoji always present as fallback */}
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span style={{ fontSize: 52, lineHeight: 1, opacity: 0.55 }}>{item.emoji}</span>
                          </div>
                          {/* Real image on top — disappears on error */}
                          <img
                            src={getCategoryImage(item.category)}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover"
                            onError={e => (e.currentTarget.style.display = 'none')}
                            loading="lazy"
                          />
                          {/* Gift Aid badge */}
                          {item.giftAidEligible && (
                            <span className="absolute top-2 right-2 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-green-500 text-white shadow-sm z-10">GA</span>
                          )}
                        </div>

                        {/* Details */}
                        <div className="p-3 flex-1 flex flex-col justify-between">
                          <div>
                            <p className="font-bold text-gray-900 text-sm leading-snug line-clamp-2">
                              {language === 'gu' ? item.nameGu || item.name : language === 'hi' ? item.nameHi || item.name : item.name}
                            </p>
                            {item.unit && <p className="text-gray-400 text-xs mt-0.5">{item.unit}</p>}
                          </div>
                          <div className="flex items-center justify-between mt-2.5">
                            <p className="font-black text-lg text-gray-900">£{item.price}</p>
                            <span className="text-xs px-2.5 py-1 rounded-lg text-white font-black" style={{ background: th.langActive }}>+ Add</span>
                          </div>
                        </div>

                        <AnimatePresence>
                          {isAdded && (
                            <motion.div
                              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                              className="absolute inset-0 bg-green-50/95 flex items-center justify-center rounded-2xl"
                            >
                              <div className="text-center">
                                <span className="text-4xl block">✓</span>
                                <span className="text-sm font-bold text-green-700">Added!</span>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.button>
                    )
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {filteredServices.map((svc, i) => {
                    const m = CATEGORY_META[svc.category] ?? CATEGORY_META.OTHER
                    const isAdded = added === svc.id
                    return (
                      <motion.button
                        key={svc.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        onClick={() => handleAdd(svc)}
                        className="relative overflow-hidden rounded-2xl text-left bg-white border border-gray-200 shadow-sm active:scale-95 hover:shadow-md transition-all flex flex-col"
                      >
                        {/* Image area */}
                        <div
                          className="relative overflow-hidden flex-shrink-0"
                          style={{ height: 100, background: `${m.color}25` }}
                        >
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span style={{ fontSize: 52, lineHeight: 1, opacity: 0.6 }}>{m.icon}</span>
                          </div>
                          <img
                            src={getCategoryImage(svc.category)}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover"
                            onError={e => (e.currentTarget.style.display = 'none')}
                            loading="lazy"
                          />
                        </div>

                        {/* Details */}
                        <div className="p-3 flex-1 flex flex-col justify-between">
                          <p className="font-bold text-gray-900 text-sm leading-snug line-clamp-2">{getName(svc, language)}</p>
                          <div className="flex items-center justify-between mt-2.5">
                            <p className="font-black text-lg text-gray-900">£{svc.price}</p>
                            <span className="text-xs px-2.5 py-1 rounded-lg text-white font-black" style={{ background: th.langActive }}>+ Add</span>
                          </div>
                        </div>

                        <AnimatePresence>
                          {isAdded && (
                            <motion.div
                              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                              className="absolute inset-0 bg-green-50/95 flex items-center justify-center rounded-2xl"
                            >
                              <div className="text-center">
                                <span className="text-4xl block">✓</span>
                                <span className="text-sm font-bold text-green-700">Added!</span>
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

        </main>
      </div>

      {/* ══ BOTTOM BAR — always visible, McDonald's style ══════════════════════ */}
      <div
        className="flex-shrink-0"
        style={{ background: '#fff', borderTop: '1px solid #e5e7eb', boxShadow: '0 -2px 12px rgba(0,0,0,0.08)' }}
      >
        {/* Main row: basket info + View My Order */}
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Basket summary */}
          <div className="flex items-center gap-2 flex-1">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center relative flex-shrink-0"
              style={{ background: `${th.langActive}15` }}
            >
              <span className="text-xl">🛒</span>
              {itemCount > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center text-white shadow"
                  style={{ background: th.langActive }}
                >
                  {itemCount}
                </span>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-400 leading-none">{itemCount} item{itemCount !== 1 ? 's' : ''}</p>
              <p className="font-black text-lg text-gray-900 leading-tight">£{total.toFixed(2)}</p>
            </div>
          </div>

          {/* Start Again */}
          <button
            onClick={() => { if (window.confirm('Start a new order?')) resetKiosk() }}
            className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-semibold active:scale-95 transition-all flex-shrink-0"
          >
            Start Again
          </button>

          {/* View My Order */}
          <button
            onClick={() => setScreen('basket')}
            disabled={itemCount === 0}
            className="px-6 py-2.5 rounded-xl text-white font-black text-sm shadow-md active:scale-95 transition-all flex-shrink-0 disabled:opacity-40"
            style={{ background: itemCount > 0 ? th.langActive : '#9ca3af', minWidth: 140 }}
          >
            View My Order →
          </button>
        </div>
      </div>

      {/* Theme picker overlay */}
      <AnimatePresence>
        {showThemePicker && <ThemePicker onClose={() => setShowThemePicker(false)} />}
      </AnimatePresence>
    </div>
  )
}
