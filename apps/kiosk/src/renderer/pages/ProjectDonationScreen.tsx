import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'
import { BRICK_TIERS, CatalogItem, filterActiveItems } from '../data/catalog'

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

const BRICK_STYLES: Record<string, BrickStyle> = {
  tier0: { gradient: 'linear-gradient(135deg,#EF4444,#DC2626)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#EF444450', ring: '#EF4444' },
  tier1: { gradient: 'linear-gradient(135deg,#D97706,#B45309)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#D9770650', ring: '#D97706' },
  tier2: { gradient: 'linear-gradient(135deg,#9CA3AF,#6B7280)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#9CA3AF50', ring: '#9CA3AF' },
  tier3: { gradient: 'linear-gradient(135deg,#F59E0B,#D97706)', textColor: '#1C0000', badgeBg: 'rgba(255,255,255,0.3)', glow: '#F59E0B70', ring: '#F59E0B', size: 'large' },
  tier4: { gradient: 'linear-gradient(135deg,#06B6D4,#0891B2)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#06B6D450', ring: '#06B6D4', size: 'large' },
  tier5: { gradient: 'linear-gradient(135deg,#8B5CF6,#7C3AED)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#8B5CF670', ring: '#8B5CF6', size: 'large' },
  tier6: { gradient: 'linear-gradient(135deg,#EC4899,#8B5CF6,#06B6D4)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#EC489970', ring: '#EC4899', size: 'large' },
  // Legacy ids from hardcoded BRICK_TIERS
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

function getGiftAidValue(price: number) { return (price * 0.25).toFixed(2) }
function getGiftAidTotal(price: number) { return (price * 1.25).toFixed(2) }

function getBrickName(item: CatalogItem, lang: string) {
  if (lang === 'gu') return item.nameGu
  if (lang === 'hi') return item.nameHi
  return item.name
}

// ── Component ──────────────────────────────────────────────────────────────────
export function ProjectDonationScreen() {
  const { language, setScreen, addItem, items, updateQuantity, resetKiosk, theme } = useKioskStore()
  const th = THEMES[theme]

  const [projects, setProjects] = useState<ApiProject[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectItems, setProjectItems] = useState<CatalogItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [addedBrick, setAddedBrick] = useState<string | null>(null)

  const basketCount = items.reduce((s, i) => s + i.quantity, 0)
  const basketTotal = items.reduce((s, i) => s + i.totalPrice, 0)

  // ── Load projects on mount ────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoadingProjects(true)
      try {
        const res = await fetch(`${API_BASE}/projects`)
        const data = await res.json()
        const projs: ApiProject[] = data.projects || []
        setProjects(projs)
        if (projs.length > 0) {
          setSelectedProjectId(projs[0].project_id)
        }
      } catch {
        setProjects([])
      }
      setLoadingProjects(false)
    }
    load()
  }, [])

  // ── Load items when project changes ──────────────────────────────────────
  useEffect(() => {
    if (!selectedProjectId) {
      setProjectItems(filterActiveItems(BRICK_TIERS))
      return
    }
    async function loadItems() {
      setLoadingItems(true)
      try {
        const res = await fetch(`${API_BASE}/projects/${selectedProjectId}/items`)
        const data = await res.json()
        const apiItems: ApiItem[] = (data.items || []).filter((i: ApiItem) => i.is_active)
        if (apiItems.length > 0) {
          setProjectItems(apiItems.map(apiItemToDisplay))
        } else {
          // No items in DB — fallback to brick tiers
          setProjectItems(filterActiveItems(BRICK_TIERS))
        }
      } catch {
        setProjectItems(filterActiveItems(BRICK_TIERS))
      }
      setLoadingItems(false)
    }
    loadItems()
  }, [selectedProjectId])

  // ── Handle add to basket — called directly on brick tap ──────────────────
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

  return (
    <div className="w-full h-full flex flex-col" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Header */}
      <header
        className="flex items-center h-20 px-5 gap-4 flex-shrink-0 z-20"
        style={{ background: th.langActive, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}
      >
        <button
          onClick={() => setScreen('home')}
          className="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-2xl active:scale-95 flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.22)', color: '#fff' }}
        >
          ←
        </button>
        <div className="flex-1">
          <h1 className="font-black text-2xl text-white leading-tight">
            {language === 'gu' ? 'પ્રોજેક્ટ દાન' : language === 'hi' ? 'प्रोजेक्ट दान' : 'Project Donations'}
          </h1>
          <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>🏗️ Build Something Lasting</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/20">
          <span className="text-white font-black text-sm">✓</span>
          <span className="text-white font-bold text-xs">Gift Aid</span>
        </div>
        {basketCount > 0 && (
          <button
            onClick={() => setScreen('basket')}
            className="relative flex items-center gap-2 text-white font-bold px-4 py-2.5 rounded-xl active:scale-95 shadow-lg text-base"
            style={{ background: 'rgba(255,255,255,0.22)', border: '1.5px solid rgba(255,255,255,0.35)' }}
          >
            🛒
            <span className="text-white font-black">£{basketTotal.toFixed(2)}</span>
            <span className="absolute -top-2 -right-2 bg-yellow-400 text-gray-900 text-xs font-black w-5 h-5 rounded-full flex items-center justify-center">
              {basketCount}
            </span>
          </button>
        )}
      </header>

      {/* ── Scrollable body — max-width centred ─────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" style={{ background: th.mainBg, scrollbarWidth: 'none' }}>
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-5">

          {/* Project selector ─────────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-black uppercase tracking-widest mb-2.5" style={{ color: th.langActive }}>
              {language === 'gu' ? 'પ્રોજેક્ટ પસંદ કરો' : language === 'hi' ? 'प्रोजेक्ट चुनें' : '— Choose a Project —'}
            </p>

            {loadingProjects ? (
              <div className="flex gap-2">
                {[1, 2].map(i => (
                  <div key={i} className="h-14 flex-1 rounded-2xl animate-pulse" style={{ background: 'rgba(0,0,0,0.08)' }} />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">No projects available — contact admin.</p>
            ) : (
              /* Horizontal chip row — each project is a fixed-width pill card */
              <div className="flex gap-2 flex-wrap">
                {projects.map(p => {
                  const active = selectedProjectId === p.project_id
                  return (
                    <motion.button
                      key={p.project_id}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setSelectedProjectId(p.project_id)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-2xl transition-all text-left"
                      style={{
                        border: active ? `2.5px solid ${th.langActive}` : '2.5px solid #e5e7eb',
                        background: active ? `${th.langActive}12` : '#fff',
                        boxShadow: active ? `0 3px 12px ${th.langActive}35` : '0 1px 3px rgba(0,0,0,0.06)',
                        maxWidth: 260,
                      }}
                    >
                      {/* Thumbnail */}
                      <div
                        className="w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center"
                        style={{ background: '#f3f4f6' }}
                      >
                        {p.image_url
                          ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                          : <span className="text-xl">🏗️</span>}
                      </div>
                      {/* Text */}
                      <div className="min-w-0">
                        <p className="font-black text-sm leading-snug text-gray-900 truncate">{p.name}</p>
                        {p.goal_amount > 0 && (
                          <p className="text-xs font-bold truncate" style={{ color: active ? th.langActive : '#9ca3af' }}>
                            Goal: £{Number(p.goal_amount).toLocaleString()}
                          </p>
                        )}
                      </div>
                      {active && (
                        <span
                          className="text-[10px] font-black px-2 py-0.5 rounded-full text-white flex-shrink-0"
                          style={{ background: th.langActive }}
                        >✓</span>
                      )}
                    </motion.button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Brick tier grid ────────────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-black uppercase tracking-widest mb-2.5" style={{ color: th.langActive }}>
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
      </div>

      {/* ══ BOTTOM BAR — always visible, matches HomeScreen ══════════════════════ */}
      <div
        className="flex-shrink-0"
        style={{ background: '#fff', borderTop: '1px solid #e5e7eb', boxShadow: '0 -2px 12px rgba(0,0,0,0.08)' }}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Basket summary */}
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
            disabled={basketCount === 0}
            className="px-6 py-2.5 rounded-xl text-white font-black text-sm shadow-md active:scale-95 transition-all flex-shrink-0 disabled:opacity-40"
            style={{ background: basketCount > 0 ? th.langActive : '#9ca3af', minWidth: 140 }}
          >
            View My Order →
          </button>
        </div>
      </div>
    </div>
  )
}
