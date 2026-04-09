import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, t, THEMES, KioskTheme, Language, LANGUAGE_META } from '../store/kiosk.store'
import { KioskKeyboard } from '../components/KioskKeyboard'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

// ─── DB Item interface ────────────────────────────────────────────────────────
interface DbItem {
  id: string
  name: string
  name_gu?: string | null
  name_hi?: string | null
  name_te?: string | null
  emoji?: string | null
  price: number
  unit?: string | null
  gift_aid_eligible: boolean
  image_url?: string | null
  description?: string | null
  category: string
  sort_order?: number
}

// ─── Nav structure ────────────────────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    items: [
      { id: 'donations',        label: 'Donations',          labelGu: 'દાન',         labelHi: 'दान',          labelTe: 'విరాళాలు',       labelTa: 'நன்கொடைகள்',      labelPa: 'ਦਾਨ',              labelMr: 'देणग्या',         labelBn: 'দান',              labelKn: 'ದೇಣಿಗೆಗಳು',      icon: '🪔' },
      { id: 'soft_donation',    label: 'Soft Item Donation', labelGu: 'વસ્તુ દાન',   labelHi: 'वस्तु दान',    labelTe: 'వస్తు దానం',     labelTa: 'பொருள் நன்கொடை', labelPa: 'ਵਸਤੂ ਦਾਨ',        labelMr: 'वस्तू दान',       labelBn: 'বস্তু দান',        labelKn: 'ವಸ್ತು ದೇಣಿಗೆ',   icon: '🎁' },
      { id: 'sponsorship',      label: 'Sponsorship',        labelGu: 'પ્રાયોજન',    labelHi: 'प्रायोजन',     labelTe: 'స్పాన్సర్‌షిప్', labelTa: 'நிதியுதவி',       labelPa: 'ਸਪਾਂਸਰਸ਼ਿਪ',      labelMr: 'प्रायोजकत्व',    labelBn: 'স্পনসরশিপ',       labelKn: 'ಪ್ರಾಯೋಜಕತ್ವ',    icon: '📖' },
      { id: 'project_donation', label: 'Project Donation',   labelGu: 'પ્રોજેક્ટ',  labelHi: 'प्रोजेक्ट',   labelTe: 'ప్రాజెక్ట్ దానం',labelTa: 'திட்ட நன்கொடை', labelPa: 'ਪ੍ਰੋਜੈਕਟ ਦਾਨ',   labelMr: 'प्रकल्प दान',    labelBn: 'প্রকল্প দান',     labelKn: 'ಯೋಜನಾ ದೇಣಿಗೆ',  icon: '🏗️' },
      { id: 'services',         label: 'Services',           labelGu: 'સેવાઓ',       labelHi: 'सेवाएं',       labelTe: 'సేవలు',           labelTa: 'சேவைகள்',         labelPa: 'ਸੇਵਾਵਾਂ',         labelMr: 'सेवा',            labelBn: 'সেবা',             labelKn: 'ಸೇವೆಗಳು',        icon: '✨' },
      { id: 'shop',             label: 'Shop',               labelGu: 'દુકાન',       labelHi: 'दुकान',        labelTe: 'దుకాణం',          labelTa: 'கடை',             labelPa: 'ਦੁਕਾਨ',           labelMr: 'दुकान',           labelBn: 'দোকান',            labelKn: 'ಅಂಗಡಿ',          icon: '🛍️' },
    ],
  },
  {
    items: [
      { id: 'information',  label: 'Information',  labelGu: 'માહિતી', labelHi: 'जानकारी', labelTe: 'సమాచారం', labelTa: 'தகவல்',  labelPa: 'ਜਾਣਕਾਰੀ',      labelMr: 'माहिती',  labelBn: 'তথ্য',       labelKn: 'ಮಾಹಿತಿ',    icon: 'ℹ️' },
      { id: 'registration', label: 'Registration', labelGu: 'નોંધણી', labelHi: 'पंजीकरण', labelTe: 'నమోదు',   labelTa: 'பதிவு',  labelPa: 'ਰਜਿਸਟ੍ਰੇਸ਼ਨ', labelMr: 'नोंदणी',  labelBn: 'নিবন্ধন',  labelKn: 'ನೋಂದಣಿ',   icon: '📝' },
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

// ─── Category image URLs (stable Unsplash photo IDs) ─────────────────────────
const CATEGORY_IMAGES: Record<string, string> = {
  // Service categories
  PUJA:             'https://images.unsplash.com/photo-1604431696980-07b4a3e01379?w=400&h=250&fit=crop&q=80', // oil lamp / diya
  HAVAN:            'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=250&fit=crop&q=80', // fire / flames
  CLASS:            'https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=400&h=250&fit=crop&q=80', // yoga / meditation
  HALL_HIRE:        'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=400&h=250&fit=crop&q=80', // banquet hall
  FESTIVAL:         'https://images.unsplash.com/photo-1605196560547-b2f7281b7355?w=400&h=250&fit=crop&q=80', // diwali lights
  DONATION:         'https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=400&h=250&fit=crop&q=80', // giving / hands
  // Catalog categories
  GRAINS:           'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400&h=250&fit=crop&q=80', // rice grains
  OIL_ESSENTIALS:   'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&h=250&fit=crop&q=80', // cooking oil bottles
  PULSES:           'https://images.unsplash.com/photo-1515543904379-3d757afe72e4?w=400&h=250&fit=crop&q=80', // lentils / dal
  PROJECT_DONATION: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80', // construction / building
  PUJA_ITEMS:       'https://images.unsplash.com/photo-1601315377985-f4e2a08bf4a0?w=400&h=250&fit=crop&q=80', // incense sticks
  PRASAD:           'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400&h=250&fit=crop&q=80', // Indian sweets
  BOOKS:            'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&h=250&fit=crop&q=80', // books / scripture
  MURTIS:           'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=250&fit=crop&q=80', // statue / murti
  MALAS:            'https://images.unsplash.com/photo-1627308595229-7830a5c91f9f?w=400&h=250&fit=crop&q=80', // prayer beads / mala
  PUJA_ACCESSORIES: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=400&h=250&fit=crop&q=80', // brass items / thali
  GENERAL_DONATION: 'https://images.unsplash.com/photo-1567363421635-a35ed38eba9e?w=400&h=250&fit=crop&q=80', // marigold flowers / temple
  SPONSORSHIP:      'https://images.unsplash.com/photo-1582845512747-e42001c95638?w=400&h=250&fit=crop&q=80', // flower garland / marigold
}

function getCategoryImage(category: string): string {
  return CATEGORY_IMAGES[category] || CATEGORY_IMAGES.DONATION
}

function getDbItemName(item: DbItem | Service, lang: string): string {
  if (lang === 'gu' && item.name_gu) return item.name_gu
  if (lang === 'hi' && item.name_hi) return item.name_hi
  if (lang === 'te' && (item as DbItem).name_te) return (item as DbItem).name_te!
  return item.name
}

function getNavLabel(item: typeof NAV_SECTIONS[0]['items'][0], lang: string) {
  if (lang === 'gu') return item.labelGu
  if (lang === 'hi') return item.labelHi
  if (lang === 'te') return item.labelTe ?? item.label
  if (lang === 'ta') return item.labelTa ?? item.label
  if (lang === 'pa') return item.labelPa ?? item.label
  if (lang === 'mr') return item.labelMr ?? item.label
  if (lang === 'bn') return item.labelBn ?? item.label
  if (lang === 'kn') return item.labelKn ?? item.label
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

// ─── Language Picker ──────────────────────────────────────────────────────────
function LanguagePicker({ onClose }: { onClose: () => void }) {
  const { language, setLanguage } = useKioskStore()
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
          <h2 className="text-lg font-black text-gray-900">🌐 Choose Language</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-bold">×</button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(Object.entries(LANGUAGE_META) as [Language, typeof LANGUAGE_META[Language]][]).map(([id, meta]) => {
            const isActive = language === id
            return (
              <button
                key={id}
                onClick={() => { setLanguage(id); onClose() }}
                className={`flex flex-col items-center gap-1 p-3 rounded-2xl border-2 transition-all active:scale-95 ${
                  isActive ? 'border-orange-400 bg-orange-50' : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                <span className="text-xl font-bold" style={{ color: isActive ? '#FF9933' : '#374151' }}>{meta.label}</span>
                <span className="text-[10px] text-gray-400">{meta.name}</span>
                {isActive && <span className="text-orange-500 text-xs font-black">✓</span>}
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
  const { language, setScreen, addItem, items, theme, resetKiosk, branchId } = useKioskStore()
  const th = THEMES[theme]
  const [activeNav, setActiveNav] = useState('donations')
  const [services, setServices] = useState<Service[]>([])
  const [softDonations, setSoftDonations] = useState<DbItem[]>([])
  const [brickTiers, setBrickTiers] = useState<DbItem[]>([])
  const [shopItems, setShopItems] = useState<DbItem[]>([])
  const [generalDonations, setGeneralDonations] = useState<DbItem[]>([])
  const [sponsorships, setSponsorships] = useState<DbItem[]>([])
  const [loading, setLoading] = useState(true)
  const [added, setAdded] = useState<string | null>(null)
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [showLanguagePicker, setShowLanguagePicker] = useState(false)
  const [customAmount, setCustomAmount] = useState('')
  const [customAdded, setCustomAdded] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  // Debounce guard — prevents double-fire from pointerdown + click on touch devices
  const lastTap = React.useRef<Record<string, number>>({})

  const itemCount = items.reduce((s, i) => s + i.quantity, 0)
  const total = items.reduce((s, i) => s + i.totalPrice, 0)

  useEffect(() => {
    const bid = branchId || 'main'
    setLoading(true)
    Promise.all([
      fetch(`${API_BASE}/items/kiosk/soft-donations?branch_id=${bid}`).then(r => r.json()).catch(() => ({ items: [] })),
      fetch(`${API_BASE}/items/kiosk/projects?branch_id=${bid}`).then(r => r.json()).catch(() => ({ items: [] })),
      fetch(`${API_BASE}/items/kiosk/shop?branch_id=${bid}`).then(r => r.json()).catch(() => ({ items: [] })),
      fetch(`${API_BASE}/items/kiosk/general-donations`).then(r => r.json()).catch(() => ({ items: [] })),
      fetch(`${API_BASE}/items/kiosk/sponsorship?branch_id=${bid}`).then(r => r.json()).catch(() => ({ items: [] })),
      fetch(`${API_BASE}/kiosk/services`).then(r => r.json()).catch(() => ({ services: [] })),
    ]).then(([sd, proj, shop, gd, spon, svcs]) => {
      setSoftDonations(sd.items ?? [])
      setBrickTiers(proj.items ?? [])
      setShopItems(shop.items ?? [])
      setGeneralDonations(gd.items ?? [])
      setSponsorships(spon.items ?? [])
      setServices(svcs.services ?? [])
    }).finally(() => setLoading(false))
  }, [branchId])

  const activeNavItem = NAV_SECTIONS.flatMap(s => s.items).find(i => i.id === activeNav)

  const catalogItems: DbItem[] = (() => {
    if (activeNav === 'soft_donation')    return softDonations
    if (activeNav === 'project_donation') return brickTiers
    if (activeNav === 'shop')             return shopItems
    if (activeNav === 'donations')        return generalDonations
    if (activeNav === 'sponsorship')      return sponsorships
    return []
  })()

  const filteredServices = services.filter(s => {
    if (activeNav === 'services') return ['PUJA', 'HAVAN', 'CLASS', 'HALL_HIRE'].includes(s.category)
    return ['PUJA', 'HAVAN', 'CLASS', 'HALL_HIRE', 'FESTIVAL'].includes(s.category)
  })

  const handleAddCatalog = (item: DbItem) => {
    // Debounce: ignore if this item was tapped within the last 600ms (pointerdown + click guard)
    const now = Date.now()
    if (lastTap.current[item.id] && now - lastTap.current[item.id] < 600) return
    lastTap.current[item.id] = now

    addItem({
      type: item.category === 'SHOP' ? 'SERVICE' : 'DONATION',
      name: item.name,
      nameGu: item.name_gu ?? '',
      nameHi: item.name_hi ?? '',
      nameTe: item.name_te ?? '',
      quantity: 1,
      unitPrice: item.price,
      totalPrice: item.price,
      referenceId: item.id,
      giftAidEligible: item.gift_aid_eligible,
      category: item.category,
    })
    setAdded(item.id)
    setTimeout(() => setAdded(null), 1400)
  }

  const handleAdd = (svc: Service) => {
    const now = Date.now()
    if (lastTap.current[svc.id] && now - lastTap.current[svc.id] < 600) return
    lastTap.current[svc.id] = now

    const giftAidEligible = ['DONATION', 'GENERAL_DONATION', 'PROJECT_DONATION'].includes(svc.category)
    addItem({ type: svc.category.includes('DONATION') ? 'DONATION' : 'SERVICE', name: svc.name, quantity: 1, unitPrice: svc.price, totalPrice: svc.price, referenceId: svc.id, giftAidEligible, category: svc.category })
    setAdded(svc.id)
    setTimeout(() => setAdded(null), 1400)
  }

  const handleAddCustom = () => {
    const amt = parseFloat(customAmount)
    if (isNaN(amt) || amt <= 0) return
    addItem({ type: 'DONATION', name: `Custom Donation £${amt.toFixed(2)}`, quantity: 1, unitPrice: amt, totalPrice: amt, giftAidEligible: true, category: 'GENERAL_DONATION' })
    setCustomAmount('')
    setCustomAdded(true)
    setTimeout(() => setCustomAdded(false), 1400)
  }

  const useDbCatalog = activeNav !== 'services'
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
          <h1 className="font-black text-base leading-tight" style={{ color: th.headerText }}>Shital</h1>
        </div>

        {/* Language picker button */}
        <button
          onClick={() => setShowLanguagePicker(true)}
          className="px-2.5 py-1.5 rounded-lg flex items-center gap-1 active:scale-95 transition-all"
          style={{ background: 'rgba(255,255,255,0.15)' }}
          title="Change language"
        >
          <span className="text-sm font-black" style={{ color: th.headerText }}>{LANGUAGE_META[language].label}</span>
          <span className="text-[10px]" style={{ color: th.headerSub }}>▾</span>
        </button>

        {/* Basket icon with count */}
        <button
          onClick={() => itemCount > 0 ? setScreen('basket') : undefined}
          className="relative w-9 h-9 rounded-xl flex items-center justify-center active:scale-95 transition-all"
          style={{ background: itemCount > 0 ? `${th.langActive}25` : 'rgba(255,255,255,0.10)' }}
          title="View basket"
        >
          <span className="text-lg">🛒</span>
          {itemCount > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center text-white shadow"
              style={{ background: th.langActive }}
            >
              {itemCount}
            </span>
          )}
        </button>

        {/* Theme picker button */}
        <button
          onClick={() => setShowThemePicker(true)}
          className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95"
          style={{ background: 'rgba(255,255,255,0.15)' }}
          title="Change theme"
        >
          <span className="text-base">🎨</span>
        </button>

        {/* Admin settings button */}
        <button
          onClick={() => setScreen('admin')}
          className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95"
          style={{ background: 'rgba(255,255,255,0.15)' }}
          title="Admin settings"
        >
          <span className="text-base">⚙️</span>
        </button>
      </header>

      {/* ══ MOBILE NAV (portrait phones) ══════════════════════════════════════ */}
      <div
        className="sm:hidden flex-shrink-0 flex overflow-x-auto bg-white"
        style={{ borderBottom: '2px solid #e5e7eb', WebkitOverflowScrolling: 'touch' }}
      >
        {NAV_SECTIONS.flatMap(s => s.items).map(item => {
          const isActive = activeNav === item.id
          return (
            <button
              key={item.id}
              onClick={() => item.id === 'project_donation' ? setScreen('project-donation') : setActiveNav(item.id)}
              className="flex-shrink-0 flex flex-col items-center gap-0.5 px-3 py-2.5 transition-all active:scale-95 relative"
              style={{ borderBottom: isActive ? `3px solid ${th.langActive}` : '3px solid transparent' }}
            >
              <span className="text-xl leading-none">{item.icon}</span>
              <span
                className="text-[10px] leading-tight font-semibold whitespace-nowrap"
                style={{ color: isActive ? th.langActive : '#6b7280' }}
              >
                {getNavLabel(item, language)}
              </span>
            </button>
          )
        })}
        <button
          onClick={() => setScreen('idle')}
          className="flex-shrink-0 flex flex-col items-center gap-0.5 px-3 py-2.5 ml-auto transition-all active:scale-95"
          style={{ borderBottom: '3px solid transparent' }}
        >
          <span className="text-xl leading-none">🚪</span>
          <span className="text-[10px] font-semibold text-gray-400 whitespace-nowrap">Exit</span>
        </button>
      </div>

      {/* ══ BODY ═══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── SIDEBAR — hidden on mobile, shown on sm+ ─────────────────────── */}
        <aside
          className="hidden sm:flex flex-shrink-0 flex-col overflow-y-auto"
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
                    onClick={() => item.id === 'project_donation' ? setScreen('project-donation') : setActiveNav(item.id)}
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
          <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: 'thin', scrollbarColor: '#d1d5db transparent', touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-60">
                <span className="text-4xl animate-spin">⏳</span>
                <p className="text-sm font-medium text-gray-500">Loading...</p>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                {useDbCatalog ? (
                  catalogItems.length === 0 ? (
                    <div key="empty-db" className="flex flex-col items-center justify-center py-16 gap-3 opacity-40">
                      <span className="text-5xl">🛕</span>
                      <p className="text-sm font-medium text-gray-500">No items in this category</p>
                    </div>
                  ) : (
                    <div key={`grid-${activeNav}`} className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {catalogItems.map((item, i) => {
                        const isAdded = added === item.id
                        return (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.025 }}
                            className="relative"
                          >
                            <button
                              type="button"
                              onPointerDown={() => handleAddCatalog(item)}
                              className="w-full relative overflow-hidden rounded-2xl text-left bg-white border border-gray-100 shadow-md active:scale-95 hover:shadow-lg transition-all flex flex-col"
                              style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                            >
                              {/* Image area — per-item photo with emoji fallback */}
                              <div
                                className="relative overflow-hidden flex-shrink-0 pointer-events-none"
                                style={{ height: 100, background: `${(CATEGORY_META[item.category] ?? CATEGORY_META.OTHER).color}22` }}
                              >
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span style={{ fontSize: 52, lineHeight: 1 }}>{item.emoji ?? '🙏'}</span>
                                </div>
                                <img
                                  src={item.image_url || getCategoryImage(item.category)}
                                  alt=""
                                  className="absolute inset-0 w-full h-full object-cover"
                                  onError={e => (e.currentTarget.style.display = 'none')}
                                  loading="lazy"
                                />
                                {item.gift_aid_eligible && (
                                  <span className="absolute top-2 right-2 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-green-500 text-white shadow-sm z-10">GA</span>
                                )}
                              </div>

                              {/* Details */}
                              <div className="p-3 flex-1 flex flex-col justify-between pointer-events-none">
                                <div>
                                  <p className="font-bold text-gray-900 text-sm leading-snug line-clamp-2">
                                    {getDbItemName(item, language)}
                                  </p>
                                  {item.unit && <p className="text-gray-400 text-xs mt-0.5">{item.unit}</p>}
                                </div>
                                <div className="flex items-center justify-between mt-2.5">
                                  <p className="font-black text-lg text-gray-900">£{item.price}</p>
                                  <span className="text-xs px-2.5 py-1 rounded-lg text-white font-black" style={{ background: isAdded ? '#22C55E' : th.langActive }}>
                                    {isAdded ? '✓' : '+ Add'}
                                  </span>
                                </div>
                              </div>

                              {/* Added overlay */}
                              {isAdded && (
                                <div className="absolute inset-0 bg-green-50/95 flex items-center justify-center rounded-2xl pointer-events-none">
                                  <div className="text-center">
                                    <span className="text-4xl block">✓</span>
                                    <span className="text-sm font-bold text-green-700">Added!</span>
                                  </div>
                                </div>
                              )}
                            </button>
                          </motion.div>
                        )
                      })}
                    </div>
                  )
                ) : (
                  filteredServices.length === 0 ? (
                    <div key="empty-svc" className="flex flex-col items-center justify-center py-16 gap-3 opacity-40">
                      <span className="text-5xl">🛕</span>
                      <p className="text-sm font-medium text-gray-500">No items in this category</p>
                    </div>
                  ) : (
                    <div key="grid-services" className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {filteredServices.map((svc, i) => {
                        const m = CATEGORY_META[svc.category] ?? CATEGORY_META.OTHER
                        const isAdded = added === svc.id
                        return (
                          <motion.div
                            key={svc.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.03 }}
                            className="relative"
                          >
                            <button
                              type="button"
                              onPointerDown={() => handleAdd(svc)}
                              className="w-full relative overflow-hidden rounded-2xl text-left bg-white border border-gray-100 shadow-md active:scale-95 hover:shadow-lg transition-all flex flex-col"
                              style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                            >
                              <div
                                className="relative overflow-hidden flex-shrink-0 pointer-events-none"
                                style={{ height: 100, background: `${m.color}20` }}
                              >
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span style={{ fontSize: 52, lineHeight: 1 }}>{m.icon}</span>
                                </div>
                                <img
                                  src={getCategoryImage(svc.category)}
                                  alt=""
                                  className="absolute inset-0 w-full h-full object-cover"
                                  onError={e => (e.currentTarget.style.display = 'none')}
                                  loading="lazy"
                                />
                              </div>

                              <div className="p-3 flex-1 flex flex-col justify-between pointer-events-none">
                                <p className="font-bold text-gray-900 text-sm leading-snug line-clamp-2">{getDbItemName(svc, language)}</p>
                                <div className="flex items-center justify-between mt-2.5">
                                  <p className="font-black text-lg text-gray-900">£{svc.price}</p>
                                  <span className="text-xs px-2.5 py-1 rounded-lg text-white font-black" style={{ background: isAdded ? '#22C55E' : th.langActive }}>
                                    {isAdded ? '✓' : '+ Add'}
                                  </span>
                                </div>
                              </div>

                              {isAdded && (
                                <div className="absolute inset-0 bg-green-50/95 flex items-center justify-center rounded-2xl pointer-events-none">
                                  <div className="text-center">
                                    <span className="text-4xl block">✓</span>
                                    <span className="text-sm font-bold text-green-700">Added!</span>
                                  </div>
                                </div>
                              )}
                            </button>
                          </motion.div>
                        )
                      })}
                    </div>
                  )
                )}
              </AnimatePresence>
            )}
          </div>

        </main>
      </div>

      {/* ══ CUSTOM DONATION STRIP — always visible ═════════════════════════════ */}
      <div
        className="flex-shrink-0 px-4 py-3 flex items-center gap-3"
        style={{ background: '#FFF3E0', borderTop: '2px solid #FF9933' }}
      >
        <span className="text-sm font-bold text-amber-700 flex-shrink-0">🙏 Custom:</span>
        <div
          className="flex items-center gap-1 flex-1 rounded-2xl border-2 bg-white cursor-pointer"
          style={{ borderColor: customAmount && parseFloat(customAmount) > 0 ? '#FF9933' : '#FDE68A' }}
          onClick={() => setKeyboardOpen(true)}
        >
          <span className="text-xl font-black text-amber-600 px-3">£</span>
          <span className={`flex-1 py-3 pr-3 text-xl font-black ${customAmount ? 'text-gray-800' : 'text-gray-400'}`}>
            {customAmount || 'Tap to enter'}
          </span>
        </div>
        <button
          onClick={handleAddCustom}
          disabled={!customAmount || parseFloat(customAmount) <= 0}
          className="px-20 py-2.5 rounded-2xl text-white font-black text-2xl transition-all active:scale-95 disabled:opacity-40 flex-shrink-0 shadow-xl"
          style={{ background: customAdded ? '#22C55E' : th.langActive, minWidth: 200, letterSpacing: '-0.5px' }}
        >
          {customAdded ? '✓ Added' : '+ Add'}
        </button>
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

      {/* Language picker overlay */}
      <AnimatePresence>
        {showLanguagePicker && <LanguagePicker onClose={() => setShowLanguagePicker(false)} />}
      </AnimatePresence>

      {/* On-screen numeric keyboard for custom donation amount */}
      <KioskKeyboard
        value={customAmount}
        onChange={v => { setCustomAmount(v); setCustomAdded(false) }}
        mode="numeric"
        visible={keyboardOpen}
        onDone={() => setKeyboardOpen(false)}
        accent={th.langActive}
        actionLabel={customAdded ? '✓ Added' : '+ Add to Basket'}
        onAction={() => { handleAddCustom(); setKeyboardOpen(false) }}
        actionDisabled={!customAmount || parseFloat(customAmount) <= 0}
      />
    </div>
  )
}
