import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'
import { BRICK_TIERS, PROJECTS, CatalogItem, ProjectInfo, filterActiveItems } from '../data/catalog'

interface BrickStyle {
  gradient: string
  textColor: string
  badgeBg: string
  glow: string
  ring: string
  size?: 'normal' | 'large'
}

const BRICK_STYLES: Record<string, BrickStyle> = {
  brick_red:      { gradient: 'linear-gradient(135deg,#EF4444,#DC2626)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#EF444450', ring: '#EF4444' },
  brick_bronze:   { gradient: 'linear-gradient(135deg,#D97706,#B45309)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#D9770650', ring: '#D97706' },
  brick_silver:   { gradient: 'linear-gradient(135deg,#9CA3AF,#6B7280)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#9CA3AF50', ring: '#9CA3AF' },
  brick_gold:     { gradient: 'linear-gradient(135deg,#F59E0B,#D97706)', textColor: '#1C0000', badgeBg: 'rgba(255,255,255,0.3)', glow: '#F59E0B70', ring: '#F59E0B', size: 'large' },
  brick_platinum: { gradient: 'linear-gradient(135deg,#06B6D4,#0891B2)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#06B6D450', ring: '#06B6D4', size: 'large' },
  brick_diamond:  { gradient: 'linear-gradient(135deg,#8B5CF6,#7C3AED)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#8B5CF670', ring: '#8B5CF6', size: 'large' },
  brick_shree:    { gradient: 'linear-gradient(135deg,#EC4899,#8B5CF6,#06B6D4)', textColor: '#fff', badgeBg: 'rgba(255,255,255,0.2)', glow: '#EC489970', ring: '#EC4899', size: 'large' },
}

function getGiftAidValue(price: number) {
  return (price * 0.25).toFixed(2)
}

function getGiftAidTotal(price: number) {
  return (price * 1.25).toFixed(2)
}

function getBrickName(item: CatalogItem, lang: string) {
  if (lang === 'gu') return item.nameGu
  if (lang === 'hi') return item.nameHi
  return item.name
}

function getProjectName(p: ProjectInfo, lang: string) {
  if (lang === 'gu') return p.nameGu
  return p.name
}

export function ProjectDonationScreen() {
  const { language, setScreen, addItem, items, updateQuantity, removeItem, theme } = useKioskStore()
  const th = THEMES[theme]
  const [selectedProject, setSelectedProject] = useState<string>(PROJECTS[0].id)
  const [selectedBrick, setSelectedBrick] = useState<string | null>(null)
  const [qty, setQty] = useState(1)

  const basketCount = items.reduce((s, i) => s + i.quantity, 0)
  const basketTotal = items.reduce((s, i) => s + i.totalPrice, 0)
  const project = PROJECTS.find(p => p.id === selectedProject)!
  const progress = Math.round((project.raised / project.goal) * 100)

  const activeBrickTiers = filterActiveItems(BRICK_TIERS)
  const selectedTier = activeBrickTiers.find(b => b.id === selectedBrick)

  const handleAddToBasket = () => {
    if (!selectedTier) return
    const existing = items.find(i => i.referenceId === `${selectedProject}_${selectedTier.id}`)
    if (existing) {
      updateQuantity(existing.id, existing.quantity + qty)
    } else {
      addItem({
        type: 'DONATION',
        name: `${selectedTier.name} — ${project.name}`,
        nameGu: `${selectedTier.nameGu} — ${project.nameGu}`,
        quantity: qty,
        unitPrice: selectedTier.price,
        totalPrice: selectedTier.price * qty,
        referenceId: `${selectedProject}_${selectedTier.id}`,
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
        className="flex items-center h-16 px-4 gap-3 flex-shrink-0 z-20"
        style={{ background: th.headerBg, borderBottom: `2px solid rgba(255,153,51,0.25)`, boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}
      >
        <button
          onClick={() => setScreen('home')}
          className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg active:scale-95"
          style={{ background: `${th.langActive}20`, color: th.headerText }}
        >
          ←
        </button>
        <div className="flex-1">
          <h1 className="font-black text-lg" style={{ color: th.headerText }}>
            {language === 'gu' ? 'પ્રોજેક્ટ દાન' : language === 'hi' ? 'प्रोजेक्ट दान' : 'Project Donations'}
          </h1>
          <p className="text-xs" style={{ color: th.headerSub }}>🏗️ Build Something Lasting</p>
        </div>
        {/* Gift Aid eligible badge */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: '#DCFCE7', border: '1.5px solid #86EFAC' }}>
          <span className="text-green-600 font-black text-sm">✓</span>
          <span className="text-green-700 font-bold text-xs">Gift Aid</span>
        </div>
        {basketCount > 0 && (
          <button
            onClick={() => setScreen('basket')}
            className="relative flex items-center gap-2 text-white font-bold px-3 py-2 rounded-xl active:scale-95 shadow-md text-sm"
            style={{ background: th.basketBtn }}
          >
            🛒
            <span className="absolute -top-2 -right-2 bg-yellow-400 text-gray-900 text-xs font-black w-5 h-5 rounded-full flex items-center justify-center">
              {basketCount}
            </span>
          </button>
        )}
      </header>

      {/* Project tabs */}
      <div
        className="flex-shrink-0 px-3 py-2"
        style={{ background: th.sectionHeaderBg, borderBottom: '1px solid rgba(0,0,0,0.06)' }}
      >
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {PROJECTS.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedProject(p.id)}
              className="flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-left transition-all active:scale-95 min-w-[90px]"
              style={{
                background: selectedProject === p.id ? th.langActive : `${th.langActive}12`,
                color: selectedProject === p.id ? '#fff' : th.sectionTitleColor,
                boxShadow: selectedProject === p.id ? `0 2px 8px ${th.langActive}40` : 'none',
              }}
            >
              <span className="text-xl">{p.emoji}</span>
              <span className="text-xs font-bold leading-tight text-center line-clamp-2">{getProjectName(p, language)}</span>
              {/* Mini progress */}
              <div className="w-full h-1 rounded-full bg-black/20 mt-0.5">
                <div
                  className="h-1 rounded-full"
                  style={{
                    width: `${Math.round((p.raised / p.goal) * 100)}%`,
                    background: selectedProject === p.id ? '#fff' : th.langActive,
                  }}
                />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Selected project info */}
      <div
        className="flex-shrink-0 px-4 py-3"
        style={{ background: `${th.langActive}10`, borderBottom: '1px solid rgba(0,0,0,0.06)' }}
      >
        <div className="flex items-center gap-3 mb-2">
          <span className="text-3xl">{project.emoji}</span>
          <div className="flex-1">
            <h2 className="font-black text-base" style={{ color: th.sectionTitleColor }}>{getProjectName(project, language)}</h2>
            <p className="text-xs text-gray-500">{project.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
          <span className="font-bold text-green-700">£{project.raised.toLocaleString()} raised</span>
          <span>of</span>
          <span className="font-bold">£{project.goal.toLocaleString()} goal</span>
          <span className="ml-auto font-black" style={{ color: th.langActive }}>{progress}%</span>
        </div>
        <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="h-3 rounded-full"
            style={{ background: `linear-gradient(to right, ${th.basketBtn}, ${th.langActive})` }}
          />
        </div>
      </div>

      {/* Brick tier grid */}
      <div className="flex-1 overflow-y-auto p-4" style={{ background: th.mainBg, scrollbarWidth: 'none' }}>
        <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Choose Your Brick Tier</p>
        <div className="grid grid-cols-2 gap-3">
          {activeBrickTiers.map((brick, i) => {
            const style = BRICK_STYLES[brick.id] ?? BRICK_STYLES.brick_red
            const isSelected = selectedBrick === brick.id
            const isLarge = style.size === 'large'
            return (
              <motion.button
                key={brick.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => setSelectedBrick(isSelected ? null : brick.id)}
                className={`relative overflow-hidden rounded-2xl p-4 text-left transition-all active:scale-95 ${isLarge ? 'col-span-1' : ''}`}
                style={{
                  background: style.gradient,
                  boxShadow: isSelected ? `0 0 0 3px ${style.ring}, 0 8px 24px ${style.glow}` : `0 4px 12px ${style.glow}`,
                  border: isSelected ? `3px solid ${style.ring}` : '3px solid transparent',
                }}
              >
                {/* Shine overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none rounded-2xl" />

                {/* Shimmer for gold+ */}
                {isLarge && (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
                    <motion.div
                      animate={{ x: ['−100%', '200%'] }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: 'linear', repeatDelay: 1 }}
                      className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12"
                    />
                  </div>
                )}

                {/* Content */}
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl">{brick.emoji}</span>
                    {/* Gift Aid check */}
                    <span
                      className="text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1"
                      style={{ background: 'rgba(34,197,94,0.25)', color: '#15803D' }}
                    >
                      ✓ Gift Aid
                    </span>
                  </div>
                  <p className="font-black text-base mb-0.5" style={{ color: style.textColor }}>
                    {getBrickName(brick, language)}
                  </p>
                  <p className="font-black text-2xl" style={{ color: style.textColor }}>£{brick.price}</p>

                  {/* Gift Aid value */}
                  <div
                    className="mt-2 rounded-xl px-2 py-1.5 text-xs"
                    style={{ background: style.badgeBg }}
                  >
                    <p style={{ color: style.textColor }} className="opacity-80">Worth with Gift Aid:</p>
                    <p className="font-black text-sm" style={{ color: style.textColor }}>
                      £{getGiftAidTotal(brick.price)} (+£{getGiftAidValue(brick.price)})
                    </p>
                  </div>

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
      </div>

      {/* Quantity & Add to basket panel */}
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
              {/* Qty stepper */}
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
