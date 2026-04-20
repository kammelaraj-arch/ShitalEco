import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, t, THEMES, KioskTheme, Language, LANGUAGE_META } from '../store/kiosk.store'
import { KioskKeyboard } from '../components/KioskKeyboard'
import { cachedFetch } from '../utils/cachedFetch'

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
  const { language, setScreen, addItem, items, theme, resetKiosk, branchId, homeActiveNav, setHomeActiveNav, orgName, orgLogoUrl } = useKioskStore()
  const th = THEMES[theme]
  const [activeNav, setActiveNav] = useState(() => homeActiveNav || 'donations')
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
  // Project donation state
  interface ApiProject { id: string; project_id: string; name: string; description: string; goal_amount: number; image_url: string; sort_order: number; is_active: boolean }
  const [projects, setProjects] = useState<ApiProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectItems, setProjectItems] = useState<DbItem[]>([])
  // Clear the store's homeActiveNav after consuming it on mount
  useEffect(() => { if (homeActiveNav) setHomeActiveNav('') }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Debounce guard — prevents double-fire from pointerdown + click on touch devices
  const lastTap = React.useRef<Record<string, number>>({})

  const itemCount = items.reduce((s, i) => s + i.quantity, 0)
  const total = items.reduce((s, i) => s + i.totalPrice, 0)

  useEffect(() => {
    const bid = branchId || 'main'
    setLoading(true)
    const empty = { items: [] }
    Promise.all([
      cachedFetch<{ items: DbItem[] }>(`${API_BASE}/items/kiosk/soft-donations?branch_id=${bid}`).catch(() => empty),
      cachedFetch<{ items: DbItem[] }>(`${API_BASE}/items/kiosk/projects?branch_id=${bid}`).catch(() => empty),
      cachedFetch<{ items: DbItem[] }>(`${API_BASE}/items/kiosk/shop?branch_id=${bid}`).catch(() => empty),
      cachedFetch<{ items: DbItem[] }>(`${API_BASE}/items/kiosk/general-donations`).catch(() => empty),
      cachedFetch<{ items: DbItem[] }>(`${API_BASE}/items/kiosk/sponsorship?branch_id=${bid}`).catch(() => empty),
      cachedFetch<{ services: Service[] }>(`${API_BASE}/kiosk/services`).catch(() => ({ services: [] })),
    ]).then(([sd, proj, shop, gd, spon, svcs]) => {
      setSoftDonations(sd.items ?? [])
      setBrickTiers(proj.items ?? [])
      setShopItems(shop.items ?? [])
      setGeneralDonations(gd.items ?? [])
      setSponsorships(spon.items ?? [])
      setServices((svcs as { services: Service[] }).services ?? [])
    }).finally(() => setLoading(false))
  }, [branchId])

  // Fetch projects when on project_donation tab
  useEffect(() => {
    if (activeNav !== 'project_donation') return
    cachedFetch<{ projects: ApiProject[] }>(`${API_BASE}/projects?branch_id=${branchId || 'main'}`)
      .catch(() => ({ projects: [] }))
      .then(data => {
        const projs: ApiProject[] = data.projects ?? []
        setProjects(projs)
        if (projs.length > 0 && !selectedProjectId) setSelectedProjectId(projs[0].project_id)
      })
  }, [activeNav, branchId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch items for selected project
  useEffect(() => {
    if (!selectedProjectId) { setProjectItems(brickTiers); return }
    cachedFetch<{ items: DbItem[] }>(`${API_BASE}/projects/${selectedProjectId}/items?branch_id=${branchId || 'main'}`)
      .catch(() => ({ items: [] }))
      .then(data => { setProjectItems(data.items?.length ? data.items : brickTiers) })
  }, [selectedProjectId, brickTiers]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeNavItem = NAV_SECTIONS.flatMap(s => s.items).find(i => i.id === activeNav)

  const catalogItems: DbItem[] = (() => {
    if (activeNav === 'soft_donation')    return softDonations
    if (activeNav === 'project_donation') return projectItems
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
        {orgLogoUrl ? (
          <img
            src={orgLogoUrl}
            alt={orgName}
            className="w-11 h-11 rounded-xl object-contain flex-shrink-0 shadow border-2 border-white/30"
            style={{ background: 'rgba(255,255,255,0.1)' }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center text-xl font-black flex-shrink-0 shadow border-2 border-white/30"
            style={{ background: th.logoBg, color: th.logoText }}
          >
            🕉
          </div>
        )}

        {/* Org name */}
        <div className="flex-1 min-w-0">
          <h1 className="font-black text-base leading-tight" style={{ color: th.headerText }}>{orgName}</h1>
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
              onClick={() => setActiveNav(item.id)}
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
            width: 168,
            background: `linear-gradient(180deg, ${th.sidebarFrom} 0%, ${th.sidebarTo} 100%)`,
            borderRight: `1px solid ${th.sidebarBorder.replace('/30', '').replace('/40', '')}30`,
          }}
        >
          {NAV_SECTIONS.map((section, si) => (
            <nav key={si} className={si > 0 ? 'mt-auto' : ''}>
              {si > 0 && <div className="mx-3 my-1" style={{ height: 1, background: `${th.sidebarText}20` }} />}
              {section.items.map(item => {
                const isActive = activeNav === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveNav(item.id)}
                    className="w-full flex flex-col items-center gap-1.5 py-3.5 px-2 text-center transition-all relative active:scale-95"
                    style={{
                      background: isActive ? th.sidebarActiveBg : 'transparent',
                      borderLeft: isActive ? `3px solid ${th.sidebarIndicator}` : '3px solid transparent',
                    }}
                  >
                    <span className="text-2xl leading-none drop-shadow">{item.icon}</span>
                    <span
                      className="text-[11px] leading-tight font-bold"
                      style={{ color: isActive ? th.sidebarActiveText : th.sidebarText, opacity: isActive ? 1 : 0.8 }}
                    >
                      {getNavLabel(item, language)}
                    </span>
                    {isActive && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full" style={{ background: th.sidebarIndicator }} />
                    )}
                  </button>
                )
              })}
            </nav>
          ))}

          {/* Exit */}
          <button
            onClick={() => setScreen('idle')}
            className="mx-2 mb-3 mt-2 py-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 transition-all active:scale-95"
            style={{ background: 'rgba(0,0,0,0.12)', color: th.sidebarText, opacity: 0.7 }}
          >
            ← Exit
          </button>
        </aside>

        {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden bg-white">

          {/* Category title header */}
          <div
            className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
            style={{ background: `${th.langActive}10`, borderBottom: `2px solid ${th.langActive}25` }}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="w-9 h-9 rounded-xl flex items-center justify-center text-xl shadow-sm flex-shrink-0"
                style={{ background: `${th.langActive}20`, border: `1.5px solid ${th.langActive}30` }}
              >
                {activeNavItem?.icon ?? '✨'}
              </span>
              <div>
                <h2 className="font-black text-lg leading-tight" style={{ color: th.sectionTitleColor }}>{navLabel}</h2>
                {catalogItems.length > 0 && <p className="text-[11px] font-medium" style={{ color: th.sectionCountColor }}>{catalogItems.length} items</p>}
              </div>
            </div>
            {isGiftAidSection && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700 border border-green-200 flex items-center gap-1">
                🇬🇧 <span>Gift Aid</span>
              </span>
            )}
          </div>

          {/* Project selector — shown only on project_donation tab */}
          {activeNav === 'project_donation' && projects.length > 0 && (
            <div className="flex-shrink-0 px-4 pt-2 pb-2" style={{ borderBottom: `2px solid ${th.langActive}20`, background: '#fafafa' }}>
              <div
                className={projects.length <= 4 ? 'grid gap-2' : 'flex gap-2 overflow-x-auto pb-1'}
                style={projects.length <= 4 ? { gridTemplateColumns: `repeat(${Math.min(projects.length, 4)}, 1fr)` } : { scrollbarWidth: 'none' }}
              >
                {projects.map(p => {
                  const active = selectedProjectId === p.project_id
                  return (
                    <button key={p.project_id}
                      onClick={() => setSelectedProjectId(p.project_id)}
                      className="relative overflow-hidden rounded-xl text-left flex-shrink-0 transition-all active:scale-95"
                      style={{ border: active ? `2px solid ${th.langActive}` : '2px solid #e5e7eb', boxShadow: active ? `0 4px 12px ${th.langActive}40` : undefined, minWidth: projects.length > 4 ? 140 : undefined }}
                    >
                      <div className="relative overflow-hidden flex items-center justify-center" style={{ height: 70, background: active ? `${th.langActive}18` : '#f3f4f6' }}>
                        {p.image_url ? <img src={p.image_url} alt={p.name} className="absolute inset-0 w-full h-full object-cover" /> : <span className="text-3xl">🏗️</span>}
                        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.45) 0%, transparent 60%)' }} />
                        {active && <span className="absolute bottom-1.5 right-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full text-white" style={{ background: th.langActive }}>✓</span>}
                      </div>
                      <div className="px-2 py-1.5" style={{ background: active ? `${th.langActive}08` : '#fff' }}>
                        <p className="font-black text-xs leading-snug text-gray-900 truncate">{p.name}</p>
                        {p.goal_amount > 0 && <p className="text-[10px] font-bold truncate" style={{ color: active ? th.langActive : '#9ca3af' }}>£{Number(p.goal_amount).toLocaleString()}</p>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Monthly Giving banner — shown on donations tab */}
          {activeNav === 'donations' && (
            <div className="flex-shrink-0 px-3 pt-3 pb-1">
              <button
                onClick={() => setScreen('monthly-giving')}
                className="w-full rounded-xl p-3 flex items-center gap-3 transition-all active:scale-[0.99]"
                style={{ background: 'linear-gradient(135deg,rgba(22,163,74,0.12),rgba(21,128,61,0.08))', border: '1.5px solid rgba(34,197,94,0.3)' }}
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-xl"
                  style={{ background: 'rgba(22,163,74,0.15)' }}>🔁</div>
                <div className="flex-1 text-left">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-green-700">Monthly Giving</p>
                  <p className="font-black text-sm text-gray-800">Make a big impact — from £5/month</p>
                </div>
                <span className="text-green-500 font-bold text-lg">›</span>
              </button>
            </div>
          )}

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
                              className="w-full relative overflow-hidden rounded-2xl text-left shadow-md active:scale-95 transition-all flex flex-col"
                              style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', background: '#fff', border: `1.5px solid ${isAdded ? '#22C55E' : 'rgba(0,0,0,0.07)'}`, boxShadow: isAdded ? '0 4px 14px rgba(34,197,94,0.25)' : '0 2px 8px rgba(0,0,0,0.08)' }}
                            >
                              {/* Image area */}
                              <div
                                className="relative overflow-hidden flex-shrink-0 pointer-events-none"
                                style={{ height: 118, background: `linear-gradient(135deg, ${(CATEGORY_META[item.category] ?? CATEGORY_META.OTHER).color}30, ${(CATEGORY_META[item.category] ?? CATEGORY_META.OTHER).color}10)` }}
                              >
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span style={{ fontSize: 56, lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' }}>{item.emoji ?? '🙏'}</span>
                                </div>
                                <img
                                  src={item.image_url || getCategoryImage(item.category)}
                                  alt=""
                                  className="absolute inset-0 w-full h-full object-cover"
                                  onError={e => (e.currentTarget.style.display = 'none')}
                                  loading="lazy"
                                />
                                {/* Bottom gradient overlay */}
                                <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.28), transparent)' }} />
                                {item.gift_aid_eligible && (
                                  <span className="absolute bottom-1.5 left-2 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-green-500 text-white shadow-sm z-10">🇬🇧 GA</span>
                                )}
                              </div>

                              {/* Details */}
                              <div className="px-3 py-2.5 flex-1 flex flex-col justify-between pointer-events-none">
                                <p className="font-bold text-gray-900 text-sm leading-snug line-clamp-2">
                                  {getDbItemName(item, language)}
                                </p>
                                {item.unit && <p className="text-gray-400 text-[11px] mt-0.5">{item.unit}</p>}
                                <div className="flex items-center justify-between mt-2">
                                  <div>
                                    <p className="font-black text-xl leading-none" style={{ color: th.sectionTitleColor }}>£{item.price}</p>
                                    {item.gift_aid_eligible && <p className="text-[10px] text-green-600 font-semibold mt-0.5">+£{(item.price * 0.25).toFixed(2)} GA</p>}
                                  </div>
                                  <span className="text-[11px] px-3 py-1.5 rounded-xl text-white font-black shadow-sm" style={{ background: isAdded ? '#22C55E' : `linear-gradient(135deg, ${th.langActive}, ${th.basketBtn})` }}>
                                    {isAdded ? '✓ Added' : '+ Add'}
                                  </span>
                                </div>
                              </div>

                              {/* Added overlay */}
                              {isAdded && (
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  className="absolute inset-0 flex items-center justify-center rounded-2xl pointer-events-none"
                                  style={{ background: 'rgba(240,253,244,0.92)' }}
                                >
                                  <div className="text-center">
                                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400 }} className="text-5xl block">✅</motion.span>
                                    <span className="text-sm font-bold text-green-700 mt-1 block">Added!</span>
                                  </div>
                                </motion.div>
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
                              className="w-full relative overflow-hidden rounded-2xl text-left shadow-md active:scale-95 transition-all flex flex-col"
                              style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', background: '#fff', border: `1.5px solid ${isAdded ? '#22C55E' : 'rgba(0,0,0,0.07)'}`, boxShadow: isAdded ? '0 4px 14px rgba(34,197,94,0.25)' : '0 2px 8px rgba(0,0,0,0.08)' }}
                            >
                              <div
                                className="relative overflow-hidden flex-shrink-0 pointer-events-none"
                                style={{ height: 118, background: `linear-gradient(135deg, ${m.color}30, ${m.color}10)` }}
                              >
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span style={{ fontSize: 56, lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' }}>{m.icon}</span>
                                </div>
                                <img
                                  src={getCategoryImage(svc.category)}
                                  alt=""
                                  className="absolute inset-0 w-full h-full object-cover"
                                  onError={e => (e.currentTarget.style.display = 'none')}
                                  loading="lazy"
                                />
                                <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.28), transparent)' }} />
                                <span className="absolute bottom-1.5 left-2 text-[9px] font-black px-1.5 py-0.5 rounded-full text-white shadow-sm z-10" style={{ background: m.color }}>{svc.category.replace('_', ' ')}</span>
                              </div>

                              <div className="px-3 py-2.5 flex-1 flex flex-col justify-between pointer-events-none">
                                <p className="font-bold text-gray-900 text-sm leading-snug line-clamp-2">{getDbItemName(svc, language)}</p>
                                <div className="flex items-center justify-between mt-2">
                                  <p className="font-black text-xl leading-none" style={{ color: th.sectionTitleColor }}>£{svc.price}</p>
                                  <span className="text-[11px] px-3 py-1.5 rounded-xl text-white font-black shadow-sm" style={{ background: isAdded ? '#22C55E' : `linear-gradient(135deg, ${th.langActive}, ${th.basketBtn})` }}>
                                    {isAdded ? '✓ Added' : '+ Add'}
                                  </span>
                                </div>
                              </div>

                              {isAdded && (
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  className="absolute inset-0 flex items-center justify-center rounded-2xl pointer-events-none"
                                  style={{ background: 'rgba(240,253,244,0.92)' }}
                                >
                                  <div className="text-center">
                                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400 }} className="text-5xl block">✅</motion.span>
                                    <span className="text-sm font-bold text-green-700 mt-1 block">Added!</span>
                                  </div>
                                </motion.div>
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
        className="flex-shrink-0 px-3 py-2 flex items-center gap-2"
        style={{ background: '#FFF3E0', borderTop: '2px solid #FF9933' }}
      >
        <span className="text-xs font-bold text-amber-700 flex-shrink-0 hidden sm:inline">🙏 Custom:</span>
        <span className="text-xs font-bold text-amber-700 flex-shrink-0 sm:hidden">🙏</span>
        <div
          className="flex items-center gap-1 flex-1 rounded-xl border-2 bg-white cursor-pointer"
          style={{ borderColor: customAmount && parseFloat(customAmount) > 0 ? '#FF9933' : '#FDE68A' }}
          onClick={() => setKeyboardOpen(true)}
        >
          <span className="text-base font-black text-amber-600 px-2">£</span>
          <span className={`flex-1 py-2 pr-2 text-base font-black ${customAmount ? 'text-gray-800' : 'text-gray-400'}`}>
            {customAmount || 'Tap to enter'}
          </span>
        </div>
        <button
          onClick={handleAddCustom}
          disabled={!customAmount || parseFloat(customAmount) <= 0}
          className="px-5 py-2 sm:px-20 sm:py-2.5 rounded-xl text-white font-black text-sm sm:text-2xl transition-all active:scale-95 disabled:opacity-40 flex-shrink-0 shadow-xl"
          style={{ background: customAdded ? '#22C55E' : th.langActive, letterSpacing: '-0.5px' }}
        >
          {customAdded ? '✓ Added' : '+ Add'}
        </button>
      </div>

      {/* ══ BOTTOM BAR — always visible ════════════════════════════════════════ */}
      <div
        className="flex-shrink-0"
        style={{
          background: itemCount > 0 ? th.basketBarBg : '#fff',
          borderTop: itemCount > 0 ? `2px solid ${th.langActive}40` : '1px solid #e5e7eb',
          boxShadow: itemCount > 0 ? `0 -4px 20px ${th.langActive}30` : '0 -2px 12px rgba(0,0,0,0.06)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          transition: 'background 0.3s, box-shadow 0.3s',
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Basket summary */}
          <div className="flex items-center gap-2.5 flex-1">
            <motion.div
              animate={itemCount > 0 ? { scale: [1, 1.12, 1] } : { scale: 1 }}
              transition={{ duration: 1.8, repeat: itemCount > 0 ? Infinity : 0, ease: 'easeInOut' }}
              className="w-11 h-11 rounded-xl flex items-center justify-center relative flex-shrink-0"
              style={{ background: itemCount > 0 ? `${th.langActive}30` : `${th.langActive}12` }}
            >
              <span className="text-2xl">🛒</span>
              {itemCount > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center text-white shadow"
                  style={{ background: th.langActive }}
                >
                  {itemCount}
                </span>
              )}
            </motion.div>
            <div>
              <p className="text-xs leading-none font-medium" style={{ color: itemCount > 0 ? th.basketBarSubText : '#9ca3af' }}>{itemCount} item{itemCount !== 1 ? 's' : ''}</p>
              <p className="font-black text-xl leading-tight" style={{ color: itemCount > 0 ? th.basketBarText : '#1f2937' }}>£{total.toFixed(2)}</p>
            </div>
          </div>

          {/* Start Again */}
          {itemCount > 0 && (
            <button
              onClick={() => { if (window.confirm('Start a new order?')) resetKiosk() }}
              className="px-3 py-2.5 rounded-xl text-xs font-bold active:scale-95 transition-all flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.12)', color: th.basketBarSubText, border: `1px solid rgba(255,255,255,0.15)` }}
            >
              ✕ Clear
            </button>
          )}

          {/* View My Order */}
          <button
            onClick={() => setScreen('basket')}
            disabled={itemCount === 0}
            className="px-6 py-3 rounded-xl text-white font-black text-sm shadow-lg active:scale-95 transition-all flex-shrink-0 disabled:opacity-30"
            style={{
              background: itemCount > 0 ? `linear-gradient(135deg, ${th.langActive}, ${th.basketBtn})` : '#9ca3af',
              minWidth: 148,
              boxShadow: itemCount > 0 ? `0 4px 16px ${th.langActive}50` : 'none',
            }}
          >
            {itemCount > 0 ? `View Order →` : 'Select items'}
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
