import { useState } from 'react'
import { motion } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'
import { TILE_CATALOG } from './ProjectStartScreen'

// Non-payment pledge flow — Professional Services, Volunteering, Materials,
// Business Sponsorship. The donor ticks what they can offer and leaves
// contact details; no card is tapped. Saved to the project_pledges table
// so the admin can follow up.
//
// Catalog is hardcoded per category for now with per-item emoji + label.
// Admin-editable catalog will reuse the tier_profiles infra in a later PR.

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

export function ProjectPledgeScreen() {
  const {
    pickedCategory, setScreen,
    branchId, kioskDeviceId,
  } = useDonationStore()

  const tile = TILE_CATALOG.find(t => t.id === pickedCategory)
  const catalog = PLEDGE_CATALOG[pickedCategory]
  const accent = tile?.accent || '#D8B4FE'
  const bg     = tile?.bg     || '#7B2CBF'

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [name, setName]   = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone]   = useState(false)
  const [err, setErr]     = useState('')

  function toggle(id: string) {
    setSelected(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canSubmit =
    selected.size > 0 &&
    name.trim().length > 0 &&
    (email.trim().length > 3 || phone.trim().length > 3)

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    setErr('')
    try {
      const items = catalog.items.filter(i => selected.has(i.id)).map(i => i.label)
      const r = await fetch('/api/v1/kiosk/project-pledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category:        pickedCategory,
          selected_items:  items,
          donor_name:      name.trim(),
          donor_email:     email.trim().toLowerCase(),
          donor_phone:     phone.trim(),
          notes:           notes.trim(),
          branch_id:       branchId || null,
          kiosk_device_id: kioskDeviceId || null,
        }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        setErr(d?.detail || 'Could not save — try again')
        return
      }
      setDone(true)
    } catch {
      setErr('Save failed — try again')
    } finally {
      setSaving(false)
    }
  }

  // Confirmation state (3-second auto-return)
  if (done) {
    setTimeout(() => setScreen('donate'), 3500)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-white"
           style={{ background: `linear-gradient(170deg, ${bg} 0%, #140606 100%)` }}>
        <div className="text-7xl mb-4">🙏</div>
        <h1 className="text-4xl font-black mb-3" style={{ fontFamily: 'serif' }}>Dhanyavaad!</h1>
        <p className="text-lg opacity-80 text-center max-w-md">
          Thank you for offering {catalog.title.toLowerCase()}. Someone from the temple will be in touch soon.
        </p>
      </div>
    )
  }

  if (!catalog) {
    setScreen('donate')
    return null
  }

  return (
    <div className="min-h-screen px-4 py-4 text-white flex flex-col"
         style={{ background: `linear-gradient(170deg, ${bg} 0%, #140606 100%)` }}>

      <header className="flex items-center mb-4 shrink-0">
        <button onClick={() => setScreen('donate')}
                className="px-3 py-2 rounded-xl text-white/85 hover:bg-white/10 text-sm">
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

      {/* Contact details — minimal: name + email or phone + optional notes */}
      <div className="mt-3 shrink-0 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name *"
                 className="col-span-3 sm:col-span-1 bg-black/30 rounded-xl px-4 py-3 text-base text-white outline-none" />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email"
                 className="col-span-3 sm:col-span-1 bg-black/30 rounded-xl px-4 py-3 text-base text-white outline-none" />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" type="tel"
                 className="col-span-3 sm:col-span-1 bg-black/30 rounded-xl px-4 py-3 text-base text-white outline-none" />
        </div>
        <input value={notes} onChange={e => setNotes(e.target.value)}
               placeholder="Anything else you'd like us to know (optional)"
               className="w-full bg-black/30 rounded-xl px-4 py-2 text-sm text-white outline-none" />

        {err && <div className="text-sm" style={{ color: '#FF9B9B' }}>{err}</div>}

        <button
          disabled={!canSubmit || saving}
          onClick={submit}
          className="w-full py-4 rounded-2xl font-black text-xl disabled:opacity-40"
          style={{ background: accent, color: '#180324' }}>
          {saving ? 'Saving…' : `Submit pledge (${selected.size})`}
        </button>
      </div>
    </div>
  )
}
