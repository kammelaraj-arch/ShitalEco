import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, useTotal, useItemCount, t } from '../store'
import { ItemCard } from '../components/ItemCard'
import { CustomDonationCard } from '../components/CustomDonationCard'
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

// Small Ganesh badge for the hero. Tries /public/ganesh.png first; on
// error swaps in an inline gold Om disc so the corner is always visible,
// even before anyone uploads a real Ganesh image.
function GaneshBadge() {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div
        className="w-12 h-12 sm:w-14 sm:h-14 rounded-full flex-shrink-0 flex items-center justify-center"
        title="Jai Ganesh"
        style={{
          background: 'radial-gradient(circle at 35% 35%, #FFF2BE 0%, #E8C65F 35%, #B8892C 100%)',
          border: '2px solid rgba(80,40,10,0.45)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3), inset 0 0 8px rgba(255,220,130,0.4)',
          color: '#3D1A00',
          fontWeight: 900,
          fontSize: '1.9rem',
          lineHeight: 1,
          fontFamily: 'serif',
        }}
      >
        🕉
      </div>
    )
  }
  return (
    <img
      src="https://admin.shital.org.uk/api/v1/media/library/b7b94b72-2523-4b8e-b450-6456ecedeaf6"
      alt="Shri Ganesh"
      onError={() => setFailed(true)}
      className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover flex-shrink-0"
      style={{ border: '2px solid rgba(212,175,55,0.75)', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}
    />
  )
}

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
    <div className="min-h-screen pb-32" style={{ background: 'transparent' }}>

      {/* Hero Banner — travertine stone. Deliberately the same warm
          sandstone band on every theme (dark, crimson, custom) so the
          donor sees Baba framed the same way from any device. */}
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
        <div className="max-w-screen-2xl mx-auto relative z-10 flex items-center justify-between gap-4">
          {/* Small Ganesh (left) — tradition is to open any auspicious work
              with Ganesha's blessing. Tries /ganesh.png first; if the asset
              isn't there yet, the onError swap shows a gold Om disc so the
              corner never looks empty. */}
          <GaneshBadge />

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-xs font-semibold tracking-widest uppercase mb-1"
              style={{ color: 'rgba(100,60,10,0.7)' }}>🕉 Jai Ganesh · Jai Sai Baba</p>
            <h1 className="font-display font-bold text-2xl sm:text-3xl lg:text-4xl tracking-wide mb-1"
              style={{ color: '#3D1A00', textShadow: '0 1px 0 rgba(255,240,180,0.6)' }}>
              Donate &amp; Support
            </h1>
            <p className="text-sm sm:text-base" style={{ color: 'rgba(80,40,5,0.65)' }}>
              Make a donation, book services &amp; support our temple
            </p>
          </div>
          {/* Baba (right) — same slot, scaled up a touch on larger viewports. */}
          <img src="https://admin.shital.org.uk/api/v1/media/library/00a4a66d-d25b-4195-8d33-57b1f2853f63" alt="Shri Shirdi Sai Baba"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
            className="w-20 h-20 sm:w-24 sm:h-24 lg:w-28 lg:h-28 rounded-full object-cover flex-shrink-0"
            style={{ border: '3px solid rgba(212,175,55,0.8)', boxShadow: '0 6px 18px rgba(0,0,0,0.35)' }} />
        </div>
      </div>

      {/* ── 3-column CTA grid: Volunteer Seva · Monthly Giving · Custom ──
          Side-by-side at md+, stacked on mobile. All three cards target
          roughly the same vertical height — `h-full` + `flex-col` on each
          inner card lets the grid stretch them. */}
      <div className="max-w-screen-2xl mx-auto px-4 mt-5">

        {/* All CTA cards below share the same twilight-glass base (dark backdrop,
            gold hairline). The accent colour (saffron / green / blue / gold)
            only dresses the icon box, eyebrow and CTA pill — this keeps the
            crimson paisley from fighting five competing coloured cards. */}

        {/* Future Legacy Appeal — Sponsor a Square Foot */}
        <button onClick={() => setScreen('sqft')}
          className="w-full rounded-2xl p-4 mb-3 text-left flex items-center gap-4 transition-all active:scale-[0.99] hover:brightness-110"
          style={{
            background: 'linear-gradient(180deg, rgba(10,5,8,0.62), rgba(14,3,3,0.72))',
            border: '1px solid rgba(246,196,84,0.45)',
            boxShadow: '0 6px 22px rgba(0,0,0,0.5), inset 0 1px 0 rgba(246,196,84,0.14)',
            backdropFilter: 'blur(10px) saturate(130%)',
            WebkitBackdropFilter: 'blur(10px) saturate(130%)',
          }}
        >
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl"
            style={{ background: 'rgba(246,196,84,0.14)', border: '1px solid rgba(246,196,84,0.35)' }}>🏛</div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: '#F6C454' }}>
              Future Legacy Appeal
            </p>
            <p className="font-black text-sm sm:text-base leading-tight mt-0.5" style={{ color: 'var(--text)' }}>
              Leave your mark — sponsor the build (from £51)
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Sponsor a brick, a square foot &amp; more. Your name on our donor wall. Gift Aid +25%.
            </p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-black text-xs flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)', color: '#4a0e18' }}>
            Sponsor →
          </span>
        </button>

        {/* Donor Wall — public gratitude page */}
        <button onClick={() => setScreen('donor-wall')}
          className="w-full rounded-2xl p-3.5 mb-3 text-left flex items-center gap-3 transition-all active:scale-[0.99] hover:brightness-110"
          style={{
            background: 'linear-gradient(180deg, rgba(10,5,8,0.55), rgba(14,3,3,0.65))',
            border: '1px solid rgba(246,196,84,0.28)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.42)',
            backdropFilter: 'blur(10px) saturate(130%)',
            WebkitBackdropFilter: 'blur(10px) saturate(130%)',
          }}
        >
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-lg"
            style={{ background: 'rgba(246,196,84,0.12)', border: '1px solid rgba(246,196,84,0.22)' }}>🙏</div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm leading-tight" style={{ color: 'var(--text)' }}>
              Digital Donor Wall
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              See the names of those who have given — grouped by tier.
            </p>
          </div>
          <span className="text-xs font-black px-2.5 py-1.5 rounded-md whitespace-nowrap"
            style={{ background: 'rgba(246,196,84,0.14)', color: '#F6C454', border: '1px solid rgba(246,196,84,0.3)' }}>
            View wall →
          </span>
        </button>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

          {/* Volunteer Seva */}
          <button onClick={() => setScreen('volunteer')}
            className="rounded-2xl p-4 text-left flex flex-col h-full transition-all active:scale-[0.99] hover:brightness-110"
            style={{
              background: 'linear-gradient(180deg, rgba(10,5,8,0.55), rgba(14,3,3,0.65))',
              border: '1px solid rgba(101,198,152,0.35)',
              boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
              backdropFilter: 'blur(10px) saturate(130%)',
              WebkitBackdropFilter: 'blur(10px) saturate(130%)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
                style={{ background: 'rgba(101,198,152,0.15)', border: '1px solid rgba(101,198,152,0.3)' }}>🤝</div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: '#65C698' }}>
                  1 hr / week Seva
                </p>
                <p className="font-black text-sm leading-tight mt-0.5" style={{ color: 'var(--text)' }}>
                  Volunteer with SHITAL
                </p>
              </div>
            </div>
            <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--text-muted)' }}>
              Give one hour a week. Help with seva, langar, events. Register online — trustees review.
            </p>
            <div className="mt-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-xs self-start"
              style={{ background: 'rgba(101,198,152,0.14)', color: '#65C698', border: '1px solid rgba(101,198,152,0.35)' }}>
              Register →
            </div>
          </button>

          {/* Monthly Giving */}
          <button onClick={() => setScreen('monthly-giving')}
            className="rounded-2xl p-4 text-left flex flex-col h-full transition-all active:scale-[0.99] hover:brightness-110"
            style={{
              background: 'linear-gradient(180deg, rgba(10,5,8,0.55), rgba(14,3,3,0.65))',
              border: '1px solid rgba(147,197,253,0.35)',
              boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
              backdropFilter: 'blur(10px) saturate(130%)',
              WebkitBackdropFilter: 'blur(10px) saturate(130%)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
                style={{ background: 'rgba(147,197,253,0.14)', border: '1px solid rgba(147,197,253,0.3)' }}>🔁</div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: '#93C5FD' }}>
                  Monthly Giving
                </p>
                <p className="font-black text-sm leading-tight mt-0.5" style={{ color: 'var(--text)' }}>
                  From just £5 / month
                </p>
              </div>
            </div>
            <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--text-muted)' }}>
              Set up regular giving via PayPal. Cancel anytime. Gift Aid boosts your impact by 25%.
            </p>
            <div className="mt-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-xs self-start"
              style={{ background: 'rgba(147,197,253,0.14)', color: '#93C5FD', border: '1px solid rgba(147,197,253,0.35)' }}>
              Set up →
            </div>
          </button>

          {/* Custom Donation (any-amount instant donate) */}
          <CustomDonationCard />

        </div>
      </div>

      {/* Category Tabs — centered floating strip (not a full-width bar) */}
      <div className="sticky top-16 z-30 px-3 py-2">
        <div
          ref={tabsRef}
          className="max-w-screen-2xl mx-auto flex overflow-x-auto scrollbar-hide px-2 gap-1.5 py-2 rounded-2xl"
          style={{ background: 'var(--bg-sticky)', border: '1px solid rgba(212,175,55,0.22)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}
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
        <div className="max-w-screen-2xl mx-auto px-4 pt-4">
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
      <div className="max-w-screen-2xl mx-auto px-4 pt-5">
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
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3"
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
            <div className="max-w-screen-2xl mx-auto px-4 pb-4 pt-2">
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
