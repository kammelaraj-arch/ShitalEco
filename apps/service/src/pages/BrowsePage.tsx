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

      {/* Hero Banner — a brushed-gold bar. The gradient is three bright
          gold stops (champagne → sovereign → antique) so the band reads
          unambiguously as GOLD on every theme (dark, crimson, custom),
          not a tan travertine. Dark serif text sits on it for contrast. */}
      <div className="relative overflow-hidden px-4 py-8"
        style={{
          background: 'linear-gradient(160deg, #F5D678 0%, #E6B84A 35%, #C9961F 72%, #A87A14 100%)',
          borderBottom: '2px solid rgba(212,175,55,0.65)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        }}>
        {/* Soft specular highlight to give the bar a brushed-metal sheen. */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'radial-gradient(ellipse 65% 45% at 22% 28%, rgba(255,250,215,0.55) 0%, transparent 62%), radial-gradient(ellipse 55% 60% at 82% 72%, rgba(120,70,10,0.28) 0%, transparent 58%)',
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
              {t('services', language)}
            </h1>
            <p className="text-sm sm:text-base" style={{ color: 'rgba(80,40,5,0.75)' }}>
              {t('hero_subtitle', language)}
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

        {/* Digital-twin CTA grid. Each card has its OWN neon accent colour
            and a soft outer bloom so they read like holographic plates
            floating over the sanctum paisley — not five identical dark
            tiles. Shared recipe:
              border: 2px solid <accent>CC   (strong, vivid)
              box-shadow:
                0 0 24px <accent>55          outer bloom
                0 0 48px <accent>22          far halo
                inset 0 1px 0 <accent>33     top edge highlight
                0 8px 24px rgba(0,0,0,0.55)  depth */}

        {/* Live Darshan — RED neon. Pulsing dot + outer crimson glow. */}
        <button onClick={() => setScreen('darshan')}
          className="w-full rounded-2xl p-4 mb-3 text-left flex items-center gap-4 transition-all active:scale-[0.99] hover:brightness-125 cta-card cta-red"
          style={{
            background: 'linear-gradient(180deg, rgba(14,4,6,0.78), rgba(22,4,6,0.88))',
            border: '2px solid rgba(239,68,68,0.80)',
            boxShadow: '0 0 24px rgba(239,68,68,0.45), 0 0 48px rgba(239,68,68,0.18), inset 0 1px 0 rgba(254,202,202,0.22), 0 8px 24px rgba(0,0,0,0.55)',
            backdropFilter: 'blur(10px) saturate(140%)',
            WebkitBackdropFilter: 'blur(10px) saturate(140%)',
          }}
        >
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl relative"
            style={{ background: 'rgba(239,68,68,0.22)', border: '1.5px solid rgba(239,68,68,0.6)', boxShadow: '0 0 14px rgba(239,68,68,0.45), inset 0 0 10px rgba(239,68,68,0.25)' }}>
            🕉
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full"
              style={{ background: '#EF4444', boxShadow: '0 0 10px #EF4444, 0 0 20px rgba(239,68,68,0.6)', animation: 'cta-pulse 1.6s ease-in-out infinite' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em]"
              style={{ color: '#FCA5A5', textShadow: '0 0 8px rgba(239,68,68,0.5)' }}>
              {t('live_darshan_eyebrow', language)}
            </p>
            <p className="font-black text-sm sm:text-base leading-tight mt-0.5" style={{ color: '#FFF1F2' }}>
              {t('live_darshan_title', language)}
            </p>
            <p className="text-xs mt-1" style={{ color: 'rgba(254,202,202,0.72)' }}>
              {t('live_darshan_sub', language)}
            </p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-black text-xs flex-shrink-0"
            style={{ background: 'rgba(239,68,68,0.22)', color: '#FCA5A5', border: '1.5px solid rgba(239,68,68,0.75)', boxShadow: '0 0 10px rgba(239,68,68,0.35)' }}>
            {t('watch', language)} →
          </span>
        </button>

        {/* Future Legacy Appeal — GOLD neon. */}
        <button onClick={() => setScreen('sqft')}
          className="w-full rounded-2xl p-4 mb-3 text-left flex items-center gap-4 transition-all active:scale-[0.99] hover:brightness-125 cta-card cta-gold"
          style={{
            background: 'linear-gradient(180deg, rgba(14,8,2,0.78), rgba(22,13,2,0.88))',
            border: '2px solid rgba(246,196,84,0.85)',
            boxShadow: '0 0 24px rgba(246,196,84,0.45), 0 0 48px rgba(246,196,84,0.18), inset 0 1px 0 rgba(254,240,180,0.28), 0 8px 24px rgba(0,0,0,0.55)',
            backdropFilter: 'blur(10px) saturate(140%)',
            WebkitBackdropFilter: 'blur(10px) saturate(140%)',
          }}
        >
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl"
            style={{ background: 'rgba(246,196,84,0.22)', border: '1.5px solid rgba(246,196,84,0.6)', boxShadow: '0 0 14px rgba(246,196,84,0.45), inset 0 0 10px rgba(246,196,84,0.3)' }}>🏛</div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em]"
              style={{ color: '#F6C454', textShadow: '0 0 8px rgba(246,196,84,0.55)' }}>
              {t('future_legacy_eyebrow', language)}
            </p>
            <p className="font-black text-sm sm:text-base leading-tight mt-0.5" style={{ color: '#FFF8E7' }}>
              {t('future_legacy_title', language)}
            </p>
            <p className="text-xs mt-1" style={{ color: 'rgba(254,240,180,0.75)' }}>
              {t('future_legacy_sub', language)}
            </p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-black text-xs flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)', color: '#4a0e18', boxShadow: '0 0 14px rgba(255,215,0,0.45)' }}>
            {t('sponsor', language)} →
          </span>
        </button>

        {/* Donor Wall — VIOLET neon. */}
        <button onClick={() => setScreen('donor-wall')}
          className="w-full rounded-2xl p-3.5 mb-3 text-left flex items-center gap-3 transition-all active:scale-[0.99] hover:brightness-125 cta-card cta-violet"
          style={{
            background: 'linear-gradient(180deg, rgba(10,4,16,0.78), rgba(18,8,28,0.88))',
            border: '2px solid rgba(192,132,252,0.78)',
            boxShadow: '0 0 22px rgba(192,132,252,0.42), 0 0 44px rgba(192,132,252,0.16), inset 0 1px 0 rgba(216,180,254,0.22), 0 6px 20px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(10px) saturate(140%)',
            WebkitBackdropFilter: 'blur(10px) saturate(140%)',
          }}
        >
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-lg"
            style={{ background: 'rgba(192,132,252,0.22)', border: '1.5px solid rgba(192,132,252,0.55)', boxShadow: '0 0 12px rgba(192,132,252,0.4), inset 0 0 8px rgba(192,132,252,0.25)' }}>🙏</div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm leading-tight" style={{ color: '#F3E8FF' }}>
              {t('donor_wall_title', language)}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(216,180,254,0.72)' }}>
              {t('donor_wall_sub', language)}
            </p>
          </div>
          <span className="text-xs font-black px-2.5 py-1.5 rounded-md whitespace-nowrap"
            style={{ background: 'rgba(192,132,252,0.22)', color: '#E9D5FF', border: '1.5px solid rgba(192,132,252,0.65)', boxShadow: '0 0 10px rgba(192,132,252,0.35)' }}>
            {t('view_wall', language)} →
          </span>
        </button>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

          {/* Volunteer Seva — EMERALD neon. */}
          <button onClick={() => setScreen('volunteer')}
            className="rounded-2xl p-4 text-left flex flex-col h-full transition-all active:scale-[0.99] hover:brightness-125 cta-card cta-emerald"
            style={{
              background: 'linear-gradient(180deg, rgba(3,14,10,0.78), rgba(4,22,16,0.88))',
              border: '2px solid rgba(52,211,153,0.80)',
              boxShadow: '0 0 24px rgba(52,211,153,0.42), 0 0 48px rgba(52,211,153,0.18), inset 0 1px 0 rgba(167,243,208,0.22), 0 8px 24px rgba(0,0,0,0.55)',
              backdropFilter: 'blur(10px) saturate(140%)',
              WebkitBackdropFilter: 'blur(10px) saturate(140%)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
                style={{ background: 'rgba(52,211,153,0.22)', border: '1.5px solid rgba(52,211,153,0.6)', boxShadow: '0 0 12px rgba(52,211,153,0.4), inset 0 0 8px rgba(52,211,153,0.25)' }}>🤝</div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.22em]"
                  style={{ color: '#6EE7B7', textShadow: '0 0 8px rgba(52,211,153,0.5)' }}>
                  {t('week_seva', language)}
                </p>
                <p className="font-black text-sm leading-tight mt-0.5" style={{ color: '#ECFDF5' }}>
                  {t('volunteer_title', language)}
                </p>
              </div>
            </div>
            <p className="text-xs leading-relaxed mb-3" style={{ color: 'rgba(167,243,208,0.72)' }}>
              {t('volunteer_sub', language)}
            </p>
            <div className="mt-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-xs self-start"
              style={{ background: 'rgba(52,211,153,0.22)', color: '#6EE7B7', border: '1.5px solid rgba(52,211,153,0.7)', boxShadow: '0 0 10px rgba(52,211,153,0.35)' }}>
              {t('register', language)} →
            </div>
          </button>

          {/* Monthly Giving — SKY BLUE neon. */}
          <button onClick={() => setScreen('monthly-giving')}
            className="rounded-2xl p-4 text-left flex flex-col h-full transition-all active:scale-[0.99] hover:brightness-125 cta-card cta-sky"
            style={{
              background: 'linear-gradient(180deg, rgba(3,10,20,0.78), rgba(5,16,30,0.88))',
              border: '2px solid rgba(96,165,250,0.80)',
              boxShadow: '0 0 24px rgba(96,165,250,0.42), 0 0 48px rgba(96,165,250,0.18), inset 0 1px 0 rgba(191,219,254,0.22), 0 8px 24px rgba(0,0,0,0.55)',
              backdropFilter: 'blur(10px) saturate(140%)',
              WebkitBackdropFilter: 'blur(10px) saturate(140%)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
                style={{ background: 'rgba(96,165,250,0.22)', border: '1.5px solid rgba(96,165,250,0.6)', boxShadow: '0 0 12px rgba(96,165,250,0.4), inset 0 0 8px rgba(96,165,250,0.25)' }}>🔁</div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.22em]"
                  style={{ color: '#93C5FD', textShadow: '0 0 8px rgba(96,165,250,0.5)' }}>
                  {t('monthly_eyebrow', language)}
                </p>
                <p className="font-black text-sm leading-tight mt-0.5" style={{ color: '#EFF6FF' }}>
                  {t('monthly_title', language)}
                </p>
              </div>
            </div>
            <p className="text-xs leading-relaxed mb-3" style={{ color: 'rgba(191,219,254,0.75)' }}>
              {t('monthly_sub', language)}
            </p>
            <div className="mt-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-xs self-start"
              style={{ background: 'rgba(96,165,250,0.22)', color: '#93C5FD', border: '1.5px solid rgba(96,165,250,0.7)', boxShadow: '0 0 10px rgba(96,165,250,0.35)' }}>
              {t('setup', language)} →
            </div>
          </button>

          {/* Custom Donation — AMBER neon (inside CustomDonationCard). */}
          <CustomDonationCard />

        </div>
      </div>

      {/* One keyframe for the pulsing bits (Live-Darshan dot + any future
          accents). Also a slow rotate for the outer glow so the whole grid
          feels alive — "digital twin breathing". */}
      <style>{`
        @keyframes cta-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(1.4); }
        }
        .cta-card { position: relative; overflow: hidden; }
        .cta-card::after {
          content: '';
          position: absolute;
          inset: -2px;
          border-radius: inherit;
          pointer-events: none;
          opacity: 0.35;
          background: conic-gradient(from 0deg, transparent 0%, currentColor 10%, transparent 20%, transparent 100%);
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          -webkit-mask-composite: xor;
          padding: 2px;
          animation: cta-rotate 6s linear infinite;
        }
        .cta-red::after     { color: #EF4444; }
        .cta-gold::after    { color: #F6C454; }
        .cta-violet::after  { color: #C084FC; }
        .cta-emerald::after { color: #34D399; }
        .cta-sky::after     { color: #60A5FA; }
        .cta-amber::after   { color: #FBBF24; }
        @keyframes cta-rotate { to { transform: rotate(360deg); } }
      `}</style>

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
