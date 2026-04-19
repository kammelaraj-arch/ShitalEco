import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, useTotal, useItemCount, t } from '../store'
import { ItemCard } from '../components/ItemCard'
import { api } from '../api'

type Tab = 'donate' | 'soft_donation' | 'project' | 'shop' | 'sponsorship' | 'services'

const TABS: { id: Tab; emoji: string }[] = [
  { id: 'donate',        emoji: '🙏' },
  { id: 'soft_donation', emoji: '🌾' },
  { id: 'project',       emoji: '🧱' },
  { id: 'shop',          emoji: '🛍️' },
  { id: 'sponsorship',   emoji: '💛' },
  { id: 'services',      emoji: '🛕' },
]

interface CatalogItem {
  id: string; name: string; name_gu?: string; name_hi?: string; name_te?: string
  price: number; emoji?: string; image_url?: string; description?: string
  gift_aid_eligible?: boolean; unit?: string; stock_qty?: number | null; category?: string
}

interface Project { id: string; name: string }

export function BrowsePage() {
  const { language, branchId, setScreen } = useStore()
  const total = useTotal()
  const itemCount = useItemCount()
  const [activeTab, setActiveTab] = useState<Tab>('donate')
  const [items, setItems] = useState<CatalogItem[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const tabsRef = useRef<HTMLDivElement>(null)

  useEffect(() => { load(activeTab) }, [activeTab, branchId])

  async function load(tab: Tab) {
    setLoading(true)
    setItems([])
    try {
      if (tab === 'donate') {
        setItems(await api.getGeneralDonations())
      } else if (tab === 'soft_donation') {
        setItems(await api.getSoftDonations(branchId))
      } else if (tab === 'project') {
        const d = await api.getProjects(branchId)
        setItems(d.items ?? [])
        setProjects(d.projects ?? [])
        setSelectedProject('')
      } else if (tab === 'shop') {
        setItems(await api.getShop(branchId))
      } else if (tab === 'sponsorship') {
        setItems(await api.getSponsorship(branchId))
      } else if (tab === 'services') {
        const svcs = await api.getServices(branchId)
        setItems(svcs.map((s: CatalogItem & { duration?: number }) => ({ ...s, category: 'SERVICE' })))
      }
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }

  const filteredItems = selectedProject
    ? items.filter((i: CatalogItem & { metadata_json?: { project_id?: string } }) =>
        (i.metadata_json as { project_id?: string } | undefined)?.project_id === selectedProject)
    : items

  function scrollToTab(id: Tab) {
    setActiveTab(id)
    const el = tabsRef.current?.querySelector(`[data-tab="${id}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }

  return (
    <div className="min-h-screen pb-32" style={{ background: 'var(--bg)' }}>

      {/* Hero Banner — travertine stone */}
      <div className="relative overflow-hidden px-4 py-8"
        style={{
          background: 'linear-gradient(160deg, #D8BC90 0%, #C8A870 40%, #B89858 100%)',
          borderBottom: '2px solid rgba(212,175,55,0.5)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        }}>
        {/* Stone texture overlay */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'radial-gradient(ellipse 60% 40% at 20% 30%, rgba(255,245,210,0.35) 0%, transparent 60%), radial-gradient(ellipse 50% 60% at 80% 70%, rgba(160,110,40,0.25) 0%, transparent 55%)',
        }} />
        {/* Gold shimmer bottom edge */}
        <div className="absolute bottom-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, #D4AF37, #FFD700, #D4AF37, transparent)' }} />
        <div className="max-w-5xl mx-auto relative z-10">
          <p className="text-xs font-semibold tracking-widest uppercase mb-1"
            style={{ color: 'rgba(100,60,10,0.7)' }}>🕉 Jai Sai Baba</p>
          <h1 className="font-display font-bold text-2xl tracking-wide mb-1"
            style={{ color: '#3D1A00', textShadow: '0 1px 0 rgba(255,240,180,0.6)' }}>
            Donate &amp; Support
          </h1>
          <p className="text-sm" style={{ color: 'rgba(80,40,5,0.65)' }}>
            Make a donation, book services &amp; support our temple
          </p>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="sticky top-16 z-30"
        style={{ background: 'var(--bg-sticky)', borderBottom: '1px solid rgba(212,175,55,0.18)' }}>
        <div
          ref={tabsRef}
          className="max-w-5xl mx-auto flex overflow-x-auto scrollbar-hide px-2 gap-1.5 py-2.5"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              data-tab={tab.id}
              onClick={() => scrollToTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm whitespace-nowrap transition-all flex-shrink-0"
              style={activeTab === tab.id ? {
                background: 'linear-gradient(135deg,#D4AF37,#C5A028)',
                color: '#6B0000',
              } : {
                background: 'rgba(255,255,255,0.04)',
                color: 'rgba(255,248,220,0.55)',
                border: '1px solid rgba(212,175,55,0.12)',
              }}
            >
              <span>{tab.emoji}</span>
              <span>{t(tab.id, language)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Project filter */}
      {activeTab === 'project' && projects.length > 0 && (
        <div className="max-w-5xl mx-auto px-4 pt-4">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            <button
              onClick={() => setSelectedProject('')}
              className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex-shrink-0"
              style={!selectedProject
                ? { background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#6B0000' }
                : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,248,220,0.55)', border: '1px solid rgba(212,175,55,0.2)' }}
            >All Projects</button>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProject(p.id === selectedProject ? '' : p.id)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex-shrink-0"
                style={selectedProject === p.id
                  ? { background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#6B0000' }
                  : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,248,220,0.55)', border: '1px solid rgba(212,175,55,0.2)' }}
              >{p.name}</button>
            ))}
          </div>
        </div>
      )}

      {/* Items Grid */}
      <div className="max-w-5xl mx-auto px-4 pt-5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="text-5xl"
            >🕉</motion.div>
            <p className="text-xs tracking-widest uppercase font-semibold"
              style={{ color: 'rgba(212,175,55,0.5)' }}>Loading…</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-3">🙏</div>
            <p className="font-medium text-sm" style={{ color: 'rgba(255,248,220,0.35)' }}>Nothing here yet</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            <motion.div
              key={activeTab + selectedProject}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
            >
              {filteredItems.map((item) => (
                <ItemCard key={item.id} item={item} category={item.category || activeTab.toUpperCase()} />
              ))}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Sticky Checkout Bar */}
      <AnimatePresence>
        {itemCount > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 z-50 safe-bottom"
          >
            <div className="max-w-5xl mx-auto px-4 pb-4 pt-2">
              <button
                onClick={() => setScreen('basket')}
                className="w-full py-4 rounded-2xl font-black text-base flex items-center justify-between px-5 shadow-2xl active:scale-[0.99] transition-transform"
                style={{
                  background: 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)',
                  color: '#6B0000',
                  boxShadow: '0 8px 32px rgba(212,175,55,0.4)',
                }}
              >
                <span className="rounded-xl px-3 py-1 text-sm font-bold"
                  style={{ background: 'rgba(90,0,0,0.3)' }}>
                  {itemCount} {t('items', language)}
                </span>
                <span className="font-black">{t('basket', language)} →</span>
                <span className="font-black price-display">£{total.toFixed(2)}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
