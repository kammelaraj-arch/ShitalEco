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
  const { language, setScreen, addItem, items, updateQuantity, theme } = useKioskStore()
  const th = THEMES[theme]

  const [projects, setProjects] = useState<ApiProject[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectItems, setProjectItems] = useState<CatalogItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [selectedBrick, setSelectedBrick] = useState<string | null>(null)
  const [qty, setQty] = useState(1)

  const basketCount = items.reduce((s, i) => s + i.quantity, 0)
  const basketTotal = items.reduce((s, i) => s + i.totalPrice, 0)
  const selectedTier = projectItems.find(b => b.id === selectedBrick)

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
      setSelectedBrick(null)
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

  // ── Handle add to basket ──────────────────────────────────────────────────
  const handleAddToBasket = () => {
    if (!selectedTier || !selectedProjectId) return
    const projectName = projects.find(p => p.project_id === selectedProjectId)?.name || selectedProjectId
    const existing = items.find(i => i.referenceId === `${selectedProjectId}_${selectedTier.id}`)
    if (existing) {
      updateQuantity(existing.id, existing.quantity + qty)
    } else {
      addItem({
        type: 'DONATION',
        name: `${selectedTier.name} — ${projectName}`,
        nameGu: `${selectedTier.nameGu} — ${projectName}`,
        quantity: qty,
        unitPrice: selectedTier.price,
        totalPrice: selectedTier.price * qty,
        referenceId: `${selectedProjectId}_${selectedTier.id}`,
        giftAidEligible: true,
      })
    }
    setSelectedBrick(null)
    setQty(1)
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

      {/* Project blocks ──────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 px-4 pt-4 pb-3"
        style={{ background: '#fff', borderBottom: `3px solid ${th.langActive}` }}
      >
        <p className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: th.langActive }}>
          {language === 'gu' ? 'પ્રોજેક્ટ પસંદ કરો' : language === 'hi' ? 'प्रोजेक्ट चुनें' : '— Choose a Project —'}
        </p>

        {loadingProjects ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2].map(i => (
              <div key={i} className="h-32 rounded-2xl animate-pulse" style={{ background: '#f3f4f6' }} />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">No projects available — contact admin.</p>
        ) : (
          <div
            className={projects.length <= 3 ? 'grid gap-3' : 'flex gap-3 overflow-x-auto pb-1'}
            style={projects.length <= 3
              ? { gridTemplateColumns: `repeat(${Math.min(projects.length, 3)}, 1fr)` }
              : { scrollbarWidth: 'none' }}
          >
            {projects.map(p => {
              const active = selectedProjectId === p.project_id
              return (
                <motion.button
                  key={p.project_id}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setSelectedProjectId(p.project_id)}
                  className="relative overflow-hidden rounded-2xl text-left transition-all flex-shrink-0"
                  style={{
                    minWidth: projects.length > 3 ? 200 : undefined,
                    border: active ? `3px solid ${th.langActive}` : '3px solid #e5e7eb',
                    boxShadow: active ? `0 6px 20px ${th.langActive}40` : '0 2px 8px rgba(0,0,0,0.08)',
                  }}
                >
                  {/* Image / colour block */}
                  <div
                    className="relative w-full overflow-hidden flex items-center justify-center"
                    style={{ height: 110, background: active ? `${th.langActive}18` : '#f3f4f6' }}
                  >
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <span className="text-5xl">🏗️</span>
                    )}
                    {active && (
                      <div
                        className="absolute inset-0 flex items-end justify-end p-2"
                        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.45) 0%, transparent 60%)' }}
                      >
                        <span
                          className="text-[10px] font-black px-2 py-0.5 rounded-full text-white"
                          style={{ background: th.langActive }}
                        >✓ Selected</span>
                      </div>
                    )}
                  </div>

                  {/* Text */}
                  <div className="px-3 py-2.5" style={{ background: active ? `${th.langActive}08` : '#fff' }}>
                    <p className="font-black text-sm leading-snug text-gray-900">{p.name}</p>
                    {p.goal_amount > 0 && (
                      <p className="text-xs mt-0.5 font-bold" style={{ color: active ? th.langActive : '#9ca3af' }}>
                        Goal: £{Number(p.goal_amount).toLocaleString()}
                      </p>
                    )}
                  </div>
                </motion.button>
              )
            })}
          </div>
        )}
      </div>

      {/* Brick tier grid ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4" style={{ background: th.mainBg, scrollbarWidth: 'none' }}>
        {loadingItems ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-40 rounded-2xl animate-pulse" style={{ background: 'rgba(0,0,0,0.08)' }} />
            ))}
          </div>
        ) : (
          <>
            <p className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: th.langActive }}>— Choose Donation Amount —</p>
            <div className="grid grid-cols-2 gap-3">
              {projectItems.map((brick, i) => {
                const style = getBrickStyle(brick, i)
                const isSelected = selectedBrick === brick.id
                const isLarge = style.size === 'large'
                return (
                  <motion.button
                    key={brick.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => setSelectedBrick(isSelected ? null : brick.id)}
                    className="relative overflow-hidden rounded-2xl p-4 text-left transition-all active:scale-95"
                    style={{
                      background: style.gradient,
                      boxShadow: isSelected ? `0 0 0 3px ${style.ring}, 0 8px 24px ${style.glow}` : `0 4px 12px ${style.glow}`,
                      border: isSelected ? `3px solid ${style.ring}` : '3px solid transparent',
                    }}
                  >
                    {/* Shine */}
                    <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none rounded-2xl" />

                    {/* Shimmer for large tiers */}
                    {isLarge && (
                      <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
                        <motion.div
                          animate={{ x: ['−100%', '200%'] }}
                          transition={{ duration: 2.5, repeat: Infinity, ease: 'linear', repeatDelay: 1 }}
                          className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12"
                        />
                      </div>
                    )}

                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-2xl">{brick.emoji}</span>
                        {brick.giftAidEligible && (
                          <span
                            className="text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1"
                            style={{ background: 'rgba(34,197,94,0.25)', color: '#15803D' }}
                          >
                            ✓ Gift Aid
                          </span>
                        )}
                      </div>
                      <p className="font-black text-base mb-0.5" style={{ color: style.textColor }}>
                        {getBrickName(brick, language)}
                      </p>
                      <p className="font-black text-2xl" style={{ color: style.textColor }}>£{brick.price}</p>

                      {brick.giftAidEligible && (
                        <div
                          className="mt-2 rounded-xl px-2 py-1.5 text-xs"
                          style={{ background: style.badgeBg }}
                        >
                          <p style={{ color: style.textColor }} className="opacity-80">Worth with Gift Aid:</p>
                          <p className="font-black text-sm" style={{ color: style.textColor }}>
                            £{getGiftAidTotal(brick.price)} (+£{getGiftAidValue(brick.price)})
                          </p>
                        </div>
                      )}

                      {isSelected && (
                        <div className="mt-2 flex items-center justify-center gap-1 text-xs font-bold" style={{ color: style.textColor }}>
                          ✓ Selected
                        </div>
                      )}
                    </div>
                  </motion.button>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Quantity & Add to basket ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedBrick && selectedTier && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="flex-shrink-0 px-4 pt-3 pb-5 border-t"
            style={{ background: th.headerBg, borderColor: 'rgba(255,153,51,0.2)' }}
          >
            <div className="flex items-center gap-4 mb-3">
              <div className="flex-1">
                <p className="text-xs text-gray-400 font-medium">Selected:</p>
                <p className="font-black" style={{ color: th.headerText }}>{selectedTier.name} — £{selectedTier.price}</p>
                <p className="text-xs" style={{ color: '#22C55E' }}>
                  HMRC adds £{getGiftAidValue(selectedTier.price * qty)} with Gift Aid
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-xl overflow-hidden border" style={{ borderColor: `${th.langActive}40` }}>
                <button
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  className="w-11 h-11 font-black text-lg flex items-center justify-center transition-all active:scale-95 hover:bg-black/10"
                  style={{ color: th.headerText }}
                >−</button>
                <span className="w-10 text-center font-black text-base" style={{ color: th.headerText }}>{qty}</span>
                <button
                  onClick={() => setQty(qty + 1)}
                  className="w-11 h-11 font-black text-lg flex items-center justify-center transition-all active:scale-95 hover:bg-black/10"
                  style={{ color: th.headerText }}
                >+</button>
              </div>
            </div>

            <button
              onClick={handleAddToBasket}
              className="w-full py-4 rounded-2xl text-white font-black text-lg transition-all active:scale-[0.98] shadow-lg"
              style={{ background: `linear-gradient(135deg,${th.basketBtn},${th.basketBtnHover})`, boxShadow: `0 6px 20px ${th.basketBtn}50` }}
            >
              Add £{(selectedTier.price * qty).toFixed(2)} to Basket →
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Running total bar when no brick selected */}
      <AnimatePresence>
        {!selectedBrick && basketCount > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="flex-shrink-0 flex items-center justify-between px-5 py-3"
            style={{ background: th.basketBarBg, borderTop: `2px solid rgba(255,153,51,0.30)`, boxShadow: '0 -4px 20px rgba(0,0,0,0.15)' }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🏗️</span>
              <div>
                <p className="text-xs font-medium opacity-70" style={{ color: th.basketBarText }}>
                  {basketCount} item{basketCount !== 1 ? 's' : ''}
                </p>
                <p className="font-black text-lg" style={{ color: th.basketBarSubText }}>
                  £{basketTotal.toFixed(2)}
                </p>
              </div>
            </div>
            <button
              onClick={() => setScreen('basket')}
              className="text-white font-black px-6 py-2.5 rounded-xl text-sm transition-all shadow-lg active:scale-95"
              style={{ background: th.basketBtn }}
            >
              View Basket →
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
