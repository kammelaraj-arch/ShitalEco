import { useState } from 'react'
import { motion } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'
import { TILE_CATALOG } from './ProjectStartScreen'

// Non-payment pledge flow — Professional Services, Volunteering, Materials,
// Business Sponsorship. The donor ticks what they can offer; this screen
// hands the selections to ProjectContactScreen (which already captures
// Name / Email / Phone / Postcode + address lookup). We do NOT duplicate
// the contact form here — ContactScreen submits the pledge directly to
// /kiosk/project-pledge for these categories (bypassing card tap).
//
// Gift Aid block is hidden on the contact screen in pledge context because
// there's no payment to Gift-Aid.
//
// Catalog is hardcoded per category for now. A later PR will reuse the
// tier_profiles infra so admins can edit it per branch.

const PLEDGE_CATALOG: Record<string, { title: string; items: Array<{ id: string; label: string; icon: string }> }> = {
  services: {
    title: 'Professional Services',
    items: [
      { id: 'architecture',   label: 'Architecture & Design',        icon: '📐' },
      { id: 'structural',     label: 'Structural Engineering',       icon: '🏗️' },
      { id: 'surveying',      label: 'Quantity Surveying',           icon: '📊' },
      { id: 'legal',          label: 'Legal / Conveyancing',         icon: '⚖️' },
      { id: 'accounting',     label: 'Accounting / Audit',           icon: '🧾' },
      { id: 'planning',       label: 'Planning Consultancy',         icon: '🗺️' },
      { id: 'project_mgmt',   label: 'Project Management',           icon: '📋' },
      { id: 'health_safety',  label: 'Health & Safety',              icon: '🦺' },
      { id: 'it',             label: 'IT / Web / A-V',               icon: '💻' },
      { id: 'marketing',      label: 'Marketing / Comms',            icon: '📢' },
      { id: 'photography',    label: 'Photography / Videography',    icon: '📷' },
      { id: 'translation',    label: 'Translation (Hindi/Gujarati)', icon: '🌐' },
    ],
  },
  volunt: {
    title: 'Volunteering',
    items: [
      { id: 'carpentry',      label: 'Carpentry / Joinery',          icon: '🔨' },
      { id: 'electrical',     label: 'Electrical',                   icon: '💡' },
      { id: 'plumbing',       label: 'Plumbing',                     icon: '🚰' },
      { id: 'painting',       label: 'Painting & Finishes',          icon: '🎨' },
      { id: 'gardening',      label: 'Landscaping / Gardening',      icon: '🌳' },
      { id: 'cleaning',       label: 'Cleaning / Housekeeping',      icon: '🧹' },
      { id: 'catering',       label: 'Catering (Prasad / Events)',   icon: '🍛' },
      { id: 'security',       label: 'Security / Stewarding',        icon: '🛡️' },
      { id: 'driving',        label: 'Driving / Collection',         icon: '🚐' },
      { id: 'teaching',       label: 'Teaching (classes / youth)',   icon: '📚' },
      { id: 'music',          label: 'Bhajan / Music',               icon: '🎵' },
      { id: 'reception',      label: 'Reception / Front-of-house',   icon: '🙏' },
    ],
  },
  material: {
    title: 'Materials',
    items: [
      { id: 'bricks',         label: 'Bricks',                       icon: '🧱' },
      { id: 'cement',         label: 'Cement / Mortar',              icon: '🪣' },
      { id: 'sand',           label: 'Sand / Aggregate',             icon: '⛏️' },
      { id: 'timber',         label: 'Timber',                       icon: '🪵' },
      { id: 'steel',          label: 'Steel / Rebar',                icon: '🏗️' },
      { id: 'tiles',          label: 'Tiles / Marble',               icon: '🔲' },
      { id: 'glass',          label: 'Glass / Doors',                icon: '🚪' },
      { id: 'roofing',        label: 'Roofing',                      icon: '🏠' },
      { id: 'lighting',       label: 'Lighting / Fixtures',          icon: '💡' },
      { id: 'av',             label: 'AV / Speakers',                icon: '🔊' },
      { id: 'furniture',      label: 'Furniture',                    icon: '🪑' },
      { id: 'kitchen',        label: 'Kitchen equipment',            icon: '🍳' },
    ],
  },
  business: {
    title: 'Business Sponsorship',
    items: [
      { id: 'named_room',     label: 'Named Room / Hall',            icon: '🏛️' },
      { id: 'named_pillar',   label: 'Named Pillar / Arch',          icon: '🧱' },
      { id: 'event_sponsor',  label: 'Event Sponsorship',            icon: '🎊' },
      { id: 'festival',       label: 'Festival Sponsor',             icon: '🪔' },
      { id: 'kitchen_week',   label: 'Prasad Kitchen (1 week)',      icon: '🍛' },
      { id: 'kitchen_month',  label: 'Prasad Kitchen (1 month)',     icon: '🍚' },
      { id: 'logo_wall',      label: 'Logo on Donor Wall',           icon: '🏷️' },
      { id: 'logo_banner',    label: 'Logo on Event Banner',         icon: '🏁' },
      { id: 'website',        label: 'Website Sponsor',              icon: '🌐' },
      { id: 'newsletter',     label: 'Newsletter Sponsor',           icon: '📰' },
      { id: 'cultural',       label: 'Cultural Programme Sponsor',   icon: '🎭' },
      { id: 'youth',          label: 'Youth Programme Sponsor',      icon: '👦' },
    ],
  },
}

export const PLEDGE_CATEGORIES = new Set(['services', 'volunt', 'material', 'business'])

export function ProjectPledgeScreen() {
  const { pickedCategory, setScreen, setSelectedPledgeItems } = useDonationStore()
  const tile = TILE_CATALOG.find(t => t.id === pickedCategory)
  const catalog = PLEDGE_CATALOG[pickedCategory]
  const accent = tile?.accent || '#D8B4FE'
  const bg     = tile?.bg     || '#7B2CBF'

  const [selected, setSelected] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setSelected(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!catalog) {
    setScreen('donate')
    return null
  }

  const canContinue = selected.size > 0

  function next() {
    if (!canContinue) return
    const items = catalog.items.filter(i => selected.has(i.id)).map(i => i.label)
    setSelectedPledgeItems(items)
    setScreen('project-contact')
  }

  return (
    <div className="min-h-screen px-4 py-4 text-white flex flex-col"
         style={{ background: `linear-gradient(170deg, ${bg} 0%, #140606 100%)` }}>

      <header className="flex items-center mb-4 shrink-0">
        <button onClick={() => setScreen('donate')}
                className="px-4 py-2 rounded-xl text-white font-bold text-sm hover:bg-white/15 border border-white/25"
                style={{ background: 'rgba(255,255,255,0.08)' }}>
          ← Back
        </button>
        <div className="ml-3 flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest" style={{ color: accent }}>Select what you can offer</div>
          <div className="font-black text-2xl" style={{ fontFamily: 'serif' }}>
            {tile?.emoji} {catalog.title}
          </div>
        </div>
      </header>

      {/* Checkbox grid of offerings — 3 columns, scrolls if long */}
      <div className="grid grid-cols-3 gap-2 flex-1 content-start overflow-y-auto pr-1">
        {catalog.items.map(it => {
          const on = selected.has(it.id)
          return (
            <motion.button
              key={it.id}
              whileTap={{ scale: 0.97 }}
              onClick={() => toggle(it.id)}
              className="rounded-2xl p-3 text-left relative"
              style={{
                background: on ? `${accent}30` : 'rgba(255,255,255,0.04)',
                border: on ? `2px solid ${accent}` : '1.5px solid rgba(255,255,255,0.1)',
              }}>
              <div className="flex items-center gap-2">
                <div className="text-2xl">{it.icon}</div>
                {on && (
                  <div className="ml-auto w-5 h-5 rounded-full flex items-center justify-center text-xs font-black"
                       style={{ background: accent, color: '#180324' }}>✓</div>
                )}
              </div>
              <div className="font-bold text-sm mt-2 leading-tight">{it.label}</div>
            </motion.button>
          )
        })}
      </div>

      {/* Just a Continue button — contact details are captured on the next
          screen (ProjectContactScreen), same postcode-lookup flow we use
          for every other project donation. */}
      <button
        disabled={!canContinue}
        onClick={next}
        className="w-full mt-4 py-5 rounded-2xl font-black text-xl disabled:opacity-40 shrink-0 border-2 border-white/40 hover:brightness-110"
        style={{
          background: '#F6C454',
          color: '#180324',
          boxShadow: '0 8px 28px rgba(246,196,84,0.45)',
        }}>
        Continue ({selected.size}) →
      </button>
    </div>
  )
}
