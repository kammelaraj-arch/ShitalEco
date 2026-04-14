import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'
import { BRICK_TIERS, CatalogItem, filterActiveItems } from '../data/catalog'
import { KioskKeyboard } from '../components/KioskKeyboard'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

// ── Types ──────────────────────────────────────────────────────────────────────
interface ApiProject {
  id: string
  project_id: string
  name: string
  description: string
  goal_amount: number
  image_url: string
  sort_order: number
  is_active: boolean
}

interface ApiItem {
  id: string
  name: string
  name_gu: string
  name_hi: string
  description: string
  category: string
  price: number
  emoji: string
  gift_aid_eligible: boolean
  is_active: boolean
  sort_order: number
}

interface BrickStyle {
  gradient: string
  textColor: string
  badgeBg: string
  glow: string
  ring: string
  size?: 'normal' | 'large'
}

// ── Sidebar nav ────────────────────────────────────────────────────────────────
const SIDEBAR_ITEMS = [
  { id: 'donations',        label: 'Donations',        icon: '🪔' },
  { id: 'soft_donation',    label: 'Soft Donations',   icon: '🎁' },
  { id: 'sponsorship',      label: 'Sponsorship',      icon: '📖' },
  { id: 'project_donation', label: 'Project Donation', icon: '🏗️' },
  { id: 'services',         label: 'Services',         icon: '✨' },
  { id: 'shop',             label: 'Shop',             icon: '🛍️' },
]

const BRICK_STYLES: Record<string, BrickStyle> = {
  tier0: { gradient: 'linear-gradient(135deg,#EF4444,#DC2626)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#EF444450', ring: '#EF4444' },
  tier1: { gradient: 'linear-gradient(135deg,#D97706,#B45309)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#D9770650', ring: '#D97706' },
  tier2: { gradient: 'linear-gradient(135deg,#9CA3AF,#6B7280)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#9CA3AF50', ring: '#9CA3AF' },
  tier3: { gradient: 'linear-gradient(135deg,#F59E0B,#D97706)', textColor: '#1C0000', badgeBg: 'rgba(255,255,255,0.3)', glow: '#F59E0B70', ring: '#F59E0B', size: 'large' },
  tier4: { gradient: 'linear-gradient(135deg,#06B6D4,#0891B2)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#06B6D450', ring: '#06B6D4', size: 'large' },
  tier5: { gradient: 'linear-gradient(135deg,#8B5CF6,#7C3AED)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#8B5CF670', ring: '#8B5CF6', size: 'large' },
  tier6: { gradient: 'linear-gradient(135deg,#EC4899,#8B5CF6,#06B6D4)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#EC489970', ring: '#EC4899', size: 'large' },
  brick_red:      { gradient: 'linear-gradient(135deg,#EF4444,#DC2626)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#EF444450', ring: '#EF4444' },
  brick_bronze:   { gradient: 'linear-gradient(135deg,#D97706,#B45309)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#D9770650', ring: '#D97706' },
  brick_silver:   { gradient: 'linear-gradient(135deg,#9CA3AF,#6B7280)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#9CA3AF50', ring: '#9CA3AF' },
  brick_gold:     { gradient: 'linear-gradient(135deg,#F59E0B,#D97706)', textColor: '#1C0000', badgeBg: 'rgba(255,255,255,0.3)', glow: '#F59E0B70', ring: '#F59E0B', size: 'large' },
  brick_platinum: { gradient: 'linear-gradient(135deg,#06B6D4,#0891B2)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#06B6D450', ring: '#06B6D4', size: 'large' },
  brick_diamond:  { gradient: 'linear-gradient(135deg,#8B5CF6,#7C3AED)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#8B5CF670', ring: '#8B5CF6', size: 'large' },
  brick_shree:    { gradient: 'linear-gradient(135deg,#EC4899,#8B5CF6,#06B6D4)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#EC489970', ring: '#EC4899', size: 'large' },
}

const TIER_KEYS = ['tier0','tier1','tier2','tier3','tier4','tier5','tier6']

function getBrickStyle(item: CatalogItem, index: number): BrickStyle {
  if (BRICK_STYLES[item.id]) return BRICK_STYLES[item.id]
  return BRICK_STYLES[TIER_KEYS[index % TIER_KEYS.length]] ?? BRICK_STYLES.tier0
}

function apiItemToDisplay(item: ApiItem): CatalogItem {
  return {
    id: item.id,
    name: item.name,
    nameGu: item.name_gu || item.name,
    nameHi: item.name_hi || item.name,
    icon: item.emoji || '🧱',
    emoji: item.emoji || '🧱',
    price: Number(item.price),
    category: item.category,
    giftAidEligible: item.gift_aid_eligible,
    description: item.description,
    imageColor: '#EF4444',
  }
}

function getGiftAidTotal(price: number) { return (price * 1.25).toFixed(2) }

function getBrickName(item: CatalogItem, lang: string) {
  if (lang === 'gu') return item.nameGu
  if (lang === 'hi') return item.nameHi
  return item.name
}

// ── Component ──────────────────────────────────────────────────────────────────
export function ProjectDonationScreen() {
  const { language, setScreen, addItem, items, updateQuantity, resetKiosk, theme, setHomeActiveNav, branchId } = useKioskStore()
  const th = THEMES[theme]

  const [projects, setProjects] = useState<ApiProject[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectItems, setProjectItems] = useState<CatalogItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [addedBrick, setAddedBrick] = useState<string | null>(null)

  // Custom amount state
  const [customAmount, setCustomAmount] = useState('')
  const [customAdded, setCustomAdded] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  const basketCount = items.reduce((s, i) => s + i.quantity, 0)
  const basketTotal = items.reduce((s, i) => s + i.totalPrice, 0)

  // ── Default project used when API returns nothing ──────────────────────────
  const DEFAULT_PROJECT: ApiProject = {
    id: '__default__',
    project_id: '__default__',
    name: 'Brick Sponsorship',
    description: 'Support the temple construction project',
    goal_amount: 0,
    image_url: '',
    sort_order: 0,
    is_active: true,
  }

  // ── Load projects on mount ────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoadingProjects(true)
      try {
        const res = await fetch(`${API_BASE}/projects?branch_id=${branchId}`)
        const data = await res.json()
        const projs: ApiProject[] = data.projects || []
        if (projs.length > 0) {
          setProjects(projs)
          setSelectedProjectId(projs[0].project_id)
        } else {
          setProjects([DEFAULT_PROJECT])
          setSelectedProjectId(DEFAULT_PROJECT.project_id)
        }
      } catch {
        setProjects([DEFAULT_PROJECT])
        setSelectedProjectId(DEFAULT_PROJECT.project_id)
      }
      setLoadingProjects(false)
    }
    load()
  }, [branchId])

  // ── Load items when project changes ──────────────────────────────────────
  useEffect(() => {
    if (!selectedProjectId || selectedProjectId === '__default__') {
      setProjectItems(filterActiveItems(BRICK_TIERS))
      return
    }
    async function loadItems() {
      setLoadingItems(true)
      try {
        const res = await fetch(`${API_BASE}/projects/${selectedProjectId}/items?branch_id=${branchId}`)
        const data = await res.json()
        const apiItems: ApiItem[] = (data.items || []).filter((i: ApiItem) => i.is_active)
        if (apiItems.length > 0) {
          setProjectItems(apiItems.map(apiItemToDisplay))
        } else {
          setProjectItems(filterActiveItems(BRICK_TIERS))
        }
      } catch {
        setProjectItems(filterActiveItems(BRICK_TIERS))
      }
      setLoadingItems(false)
    }
    loadItems()
  }, [selectedProjectId])

  // ── Handle add brick to basket ────────────────────────────────────────────
  const handleBrickTap = (brick: CatalogItem) => {
    if (!selectedProjectId) return
    const projectName = projects.find(p => p.project_id === selectedProjectId)?.name || selectedProjectId
    const existing = items.find(i => i.referenceId === `${selectedProjectId}_${brick.id}`)
    if (existing) {
      updateQuantity(existing.id, existing.quantity + 1)
    } else {
      addItem({
        type: 'DONATION',
        name: `${brick.name} — ${projectName}`,
        nameGu: `${brick.nameGu} — ${projectName}`,
        quantity: 1,
        unitPrice: brick.price,
        totalPrice: brick.price,
        referenceId: `${selectedProjectId}_${brick.id}`,
        giftAidEligible: true,
      })
    }
    setAddedBrick(brick.id)
    setTimeout(() => setAddedBrick(null), 900)
  }

  // ── Handle custom amount ──────────────────────────────────────────────────
  const handleAddCustom = () => {
    const amt = parseFloat(customAmount)
    if (isNaN(amt) || amt <= 0) return
    const projectName = selectedProjectId
      ? (projects.find(p => p.project_id === selectedProjectId)?.name || selectedProjectId)
      : 'Project Donation'
    addItem({
      type: 'DONATION',
      name: `Custom Donation — ${projectName} £${amt.toFixed(2)}`,
      quantity: 1,
      unitPrice: amt,
      totalPrice: amt,
      giftAidEligible: true,
      category: 'PROJECT_DONATION',
    })
    setCustomAmount('')
    setCustomAdded(true)
    setTimeout(() => setCustomAdded(false), 1400)
  }

  // ── Sidebar nav handler ───────────────────────────────────────────────────
  const handleSidebarNav = (id: string) => {
    if (id === 'project_donation') return // already here
    if (id === 'soft_donation') { setScreen('soft-donation'); return }
    setHomeActiveNav(id)
    setScreen('home')
  }

  return (
    <div className="w-full h-full flex flex-col" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ══ HEADER ═════════════════════════════════════════════════════════════ */}
      <header
        className="flex items-center h-16 px-4 gap-3 flex-shrink-0 z-20"
        style={{ background: th.headerBg, borderBottom: '2px solid rgba(0,0,0,0.08)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
      >
        {/* Logo / back */}
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl font-black flex-shrink-0 shadow border-2 border-white/30"
          style={{ background: th.logoBg, color: th.logoText }}
        >
          🕉
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-black text-base leading-tight" style={{ color: th.headerText }}>
            {language === 'gu' ? 'પ્રોજેક્ટ દાન' : language === 'hi' ? 'प्रोजेक्ट दान' : 'Project Donations'}
          </h1>
          <p className="text-xs font-semibold leading-none" style={{ color: th.headerSub ?? 'rgba(255,255,255,0.65)' }}>🏗️ Build Something Lasting</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20">
          <span className="text-white font-black text-xs">✓</span>
          <span className="text-white font-bold text-xs">Gift Aid</span>
        </div>
        {basketCount > 0 && (
          <button
            onClick={() => setScreen('basket')}
            className="relative flex items-center gap-1.5 text-white font-bold px-3 py-2 rounded-xl active:scale-95 shadow-lg text-sm"
            style={{ background: 'rgba(255,255,255,0.22)', border: '1.5px solid rgba(255,255,255,0.35)' }}
          >
            🛒
            <span className="text-white font-black">£{basketTotal.toFixed(2)}</span>
            <span className="absolute -top-1.5 -right-1.5 bg-yellow-400 text-gray-900 text-xs font-black w-5 h-5 rounded-full flex items-center justify-center">
              {basketCount}
            </span>
          </button>
        )}
      </header>

      {/* ══ BODY (sidebar + main) ═══════════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
        <aside
          className="flex-shrink-0 flex flex-col overflow-y-auto"
          style={{ width: 140, background: '#fff', borderRight: '1px solid #e5e7eb' }}
        >
          <nav className="flex-1">
            {SIDEBAR_ITEMS.map(item => {
              const isActive = item.id === 'project_donation'
              return (
                <button
                  key={item.id}
                  onClick={() => handleSidebarNav(item.id)}
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
                    {item.label}
                  </span>
                </button>
              )
            })}
          </nav>

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
        <main className="flex-1 flex flex-col overflow-hidden" style={{ background: '#f7f3ee' }}>

          {/* ── PROJECT SELECTOR (fixed, above scroll) ───────────────────────── */}
          <div className="flex-shrink-0 px-4 pt-3 pb-3" style={{ background: '#fff', borderBottom: `3px solid ${th.langActive}` }}>
            <p className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: th.langActive }}>
              {language === 'gu' ? 'પ્રોજેક્ટ પસંદ કરો' : language === 'hi' ? 'प्रोजेक्ट चुनें' : '— Choose a Project —'}
            </p>
            {loadingProjects ? (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {[1, 2, 3].map(i => <div key={i} className="rounded-2xl animate-pulse" style={{ height: 110, background: '#f3f4f6' }} />)}
              </div>
            ) : (
              <div
                className={projects.length <= 4 ? 'grid gap-3' : 'flex gap-3 overflow-x-auto pb-1'}
                style={projects.length <= 4 ? { gridTemplateColumns: `repeat(${Math.min(projects.length, 4)}, 1fr)` } : { scrollbarWidth: 'none' }}
              >
                {projects.map(p => {
                  const active = selectedProjectId === p.project_id
                  return (
                    <motion.button key={p.project_id} whileTap={{ scale: 0.97 }}
                      onClick={() => setSelectedProjectId(p.project_id)}
                      className="relative overflow-hidden rounded-2xl text-left flex-shrink-0"
                      style={{ border: active ? `3px solid ${th.langActive}` : '3px solid #e5e7eb', boxShadow: active ? `0 6px 20px ${th.langActive}40` : '0 2px 8px rgba(0,0,0,0.08)', minWidth: projects.length > 4 ? 160 : undefined }}
                    >
                      <div className="relative w-full overflow-hidden flex items-center justify-center" style={{ height: 90, background: active ? `${th.langActive}18` : '#f3f4f6' }}>
                        {p.image_url ? <img src={p.image_url} alt={p.name} className="absolute inset-0 w-full h-full object-cover" /> : <span className="text-4xl">🏗️</span>}
                        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 55%)' }} />
                        {active && <div className="absolute bottom-2 right-2"><span className="text-[10px] font-black px-2 py-0.5 rounded-full text-white" style={{ background: th.langActive }}>✓ Selected</span></div>}
                      </div>
                      <div className="px-3 py-2" style={{ background: active ? `${th.langActive}08` : '#fff' }}>
                        <p className="font-black text-sm leading-snug text-gray-900 truncate">{p.name}</p>
                        {p.goal_amount > 0 && <p className="text-xs mt-0.5 font-bold truncate" style={{ color: active ? th.langActive : '#9ca3af' }}>Goal: £{Number(p.goal_amount).toLocaleString()}</p>}
                      </div>
                    </motion.button>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Scrollable body ──────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: 'thin', scrollbarColor: '#d1d5db transparent' }}>
            <div>

              {/* Hero tile for selected project */}
              {(() => {
                const proj = projects.find(p => p.project_id === selectedProjectId)
                if (!proj) return null
                return (
                  <div className="w-full rounded-2xl overflow-hidden mb-4" style={{ border: `3px solid ${th.langActive}`, boxShadow: `0 4px 24px ${th.langActive}50` }}>
                    <div className="relative w-full flex items-end" style={{ height: 140, background: proj.image_url ? undefined : `linear-gradient(135deg, ${th.langActive} 0%, #7f1010 100%)` }}>
                      {proj.image_url && <img src={proj.image_url} alt={proj.name} className="absolute inset-0 w-full h-full object-cover" />}
                      <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)' }} />
                      <div className="relative z-10 px-4 pb-3 w-full">
                        <p className="text-white font-black text-xl leading-tight drop-shadow-lg">{proj.name}</p>
                        {proj.description && <p className="text-white/80 text-xs mt-0.5 leading-snug line-clamp-1">{proj.description}</p>}
                      </div>
                      {proj.goal_amount > 0 && <div className="absolute top-3 right-3 px-2.5 py-1 rounded-xl text-xs font-black text-white" style={{ background: th.langActive }}>Goal: £{Number(proj.goal_amount).toLocaleString()}</div>}
                    </div>
                  </div>
                )
              })()}

              <p className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: th.langActive }}>
                — Choose Donation Amount —
              </p>

              {loadingItems ? (
                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="h-32 rounded-2xl animate-pulse" style={{ background: 'rgba(0,0,0,0.08)' }} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {projectItems.map((brick, i) => {
                    const style = getBrickStyle(brick, i)
                    const isAdded = addedBrick === brick.id
                    const inBasket = items.find(it => it.referenceId === `${selectedProjectId}_${brick.id}`)
                    const isLarge = style.size === 'large'
                    return (
                      <motion.button
                        key={brick.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        onClick={() => handleBrickTap(brick)}
                        className="relative overflow-hidden rounded-2xl p-3 text-left transition-all active:scale-95"
                        style={{
                          background: style.gradient,
                          boxShadow: `0 3px 10px ${style.glow}`,
                        }}
                      >
                        {/* Shine */}
                        <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none rounded-2xl" />

                        {/* Shimmer for premium tiers */}
                        {isLarge && (
                          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
                            <motion.div
                              animate={{ x: ['-100%', '200%'] }}
                              transition={{ duration: 2.5, repeat: Infinity, ease: 'linear', repeatDelay: 1 }}
                              className="absolute inset-y-0 w-12 bg-gradient-to-r from-transparent via-white/25 to-transparent -skew-x-12"
                            />
                          </div>
                        )}

                        {/* Added flash */}
                        <AnimatePresence>
                          {isAdded && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="absolute inset-0 rounded-2xl flex items-center justify-center z-20 pointer-events-none"
                              style={{ background: 'rgba(0,0,0,0.45)' }}
                            >
                              <span className="text-white font-black text-lg">✓ Added!</span>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div className="relative z-10">
                          <div className="flex items-start justify-between mb-1.5">
                            <span className="text-xl">{brick.emoji}</span>
                            {brick.giftAidEligible && (
                              <span
                                className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                                style={{ background: 'rgba(34,197,94,0.25)', color: '#15803D' }}
                              >✓ GA</span>
                            )}
                          </div>
                          <p className="font-black text-sm leading-tight mb-0.5" style={{ color: style.textColor }}>
                            {getBrickName(brick, language)}
                          </p>
                          <p className="font-black text-xl leading-tight" style={{ color: style.textColor }}>
                            £{brick.price}
                          </p>
                          {brick.giftAidEligible && (
                            <div
                              className="mt-1.5 rounded-lg px-1.5 py-1 text-[10px]"
                              style={{ background: style.badgeBg }}
                            >
                              <p className="font-black" style={{ color: style.textColor }}>
                                +GA: £{getGiftAidTotal(brick.price)}
                              </p>
                            </div>
                          )}
                          {inBasket && !isAdded && (
                            <p className="mt-1 text-[10px] font-bold opacity-80" style={{ color: style.textColor }}>
                              In basket: {inBasket.quantity}×
                            </p>
                          )}
                        </div>
                      </motion.button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* ══ CUSTOM DONATION STRIP — always visible ═══════════════════════════════ */}
      <div
        className="flex-shrink-0 px-3 py-2 flex items-center gap-2"
        style={{ background: '#FFF3E0', borderTop: '2px solid #FF9933' }}
      >
        <span className="text-xs font-bold text-amber-700 flex-shrink-0">🙏 Custom:</span>
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
          className="px-5 py-2 rounded-xl text-white font-black text-sm transition-all active:scale-95 disabled:opacity-40 flex-shrink-0 shadow-xl"
          style={{ background: customAdded ? '#22C55E' : th.langActive }}
        >
          {customAdded ? '✓ Added' : '+ Add'}
        </button>
      </div>

      {/* ══ BOTTOM BAR ═══════════════════════════════════════════════════════════ */}
      <div
        className="flex-shrink-0"
        style={{ background: '#fff', borderTop: '1px solid #e5e7eb', boxShadow: '0 -2px 12px rgba(0,0,0,0.08)' }}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2 flex-1">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center relative flex-shrink-0"
              style={{ background: `${th.langActive}15` }}
            >
              <span className="text-xl">🛒</span>
              {basketCount > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center text-white shadow"
                  style={{ background: th.langActive }}
                >
                  {basketCount}
                </span>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-400 leading-none">{basketCount} item{basketCount !== 1 ? 's' : ''}</p>
              <p className="font-black text-lg text-gray-900 leading-tight">£{basketTotal.toFixed(2)}</p>
            </div>
          </div>

          <button
            onClick={() => { if (window.confirm('Start a new order?')) resetKiosk() }}
            className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-semibold active:scale-95 transition-all flex-shrink-0"
          >
            Start Again
          </button>

          <button
            onClick={() => setScreen('basket')}
            disabled={basketCount === 0}
            className="px-6 py-2.5 rounded-xl text-white font-black text-sm shadow-md active:scale-95 transition-all flex-shrink-0 disabled:opacity-40"
            style={{ background: basketCount > 0 ? th.langActive : '#9ca3af', minWidth: 140 }}
          >
            View My Order →
          </button>
        </div>
      </div>

      {/* ══ ON-SCREEN KEYBOARD ════════════════════════════════════════════════════ */}
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
