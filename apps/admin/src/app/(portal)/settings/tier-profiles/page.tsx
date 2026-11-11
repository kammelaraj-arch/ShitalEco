'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

// ─ Types ────────────────────────────────────────────────────────────────────
interface Tier {
  label: string
  price: number
  sub?: string
  image_url?: string
  featured?: boolean
  order?: number
}

type Config = Record<string, Tier[]>

interface Profile {
  id: string
  name: string
  description: string
  branch_id: string | null
  config: Config
  device_count: number
}

// Categories mirror ProjectStartScreen.tsx TILE_CATALOG ids. The admin can
// override tiers for any subset — leaving a category empty tells the kiosk
// to use its hardcoded defaults for that category only.
const CATEGORIES: Array<{ id: string; label: string; icon: string }> = [
  { id: 'brick',    label: 'Brick',                  icon: '🧱' },
  { id: 'sqft',     label: 'Square Feet',            icon: '📐' },
  { id: 'material', label: 'Materials',              icon: '🏗️' },
  { id: 'volunt',   label: 'Volunteering',           icon: '🙌' },
  { id: 'services', label: 'Professional Services',  icon: '💼' },
  { id: 'business', label: 'Business Sponsorship',   icon: '🏢' },
  { id: 'general',  label: 'General Donation',       icon: '🪔' },
]

const EMPTY_PROFILE: Omit<Profile, 'id' | 'device_count'> = {
  name: '',
  description: '',
  branch_id: null,
  config: {},
}

// ─ Page ─────────────────────────────────────────────────────────────────────
export default function TierProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState<Omit<Profile, 'id' | 'device_count'> & { id?: string } | null>(null)
  const [openCat, setOpenCat]   = useState<string>('brick')
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await apiFetch<{ profiles: Profile[] }>(
        '/settings/tier-profiles', { method: 'GET' })
      setProfiles(d.profiles ?? [])
    } catch (e) {
      setErr(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!editing?.name.trim()) {
      setErr('Name is required')
      return
    }
    setSaving(true)
    setErr('')
    try {
      const body = {
        name: editing.name,
        description: editing.description,
        branch_id: editing.branch_id,
        config: editing.config,
      }
      if (editing.id) {
        await apiFetch(`/settings/tier-profiles/${editing.id}`, {
          method: 'PUT', body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        })
      } else {
        await apiFetch('/settings/tier-profiles', {
          method: 'POST', body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        })
      }
      setEditing(null)
      await load()
    } catch (e) {
      setErr(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this tier profile? Devices currently using it will fall back to defaults.')) return
    try {
      await apiFetch(`/settings/tier-profiles/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) { setErr(String(e)) }
  }

  // ── Tier editing helpers (within the current editing profile) ────────────
  function tiersFor(cat: string): Tier[] {
    return editing?.config?.[cat] ?? []
  }
  function setTiersFor(cat: string, tiers: Tier[]) {
    if (!editing) return
    setEditing({ ...editing, config: { ...editing.config, [cat]: tiers } })
  }
  function addTier(cat: string) {
    const curr = tiersFor(cat)
    setTiersFor(cat, [...curr, {
      label: 'New Tier', price: 0, sub: '', image_url: '',
      featured: false, order: curr.length,
    }])
  }
  function updateTier(cat: string, i: number, patch: Partial<Tier>) {
    const next = tiersFor(cat).slice()
    next[i] = { ...next[i], ...patch }
    setTiersFor(cat, next)
  }
  function removeTier(cat: string, i: number) {
    const next = tiersFor(cat).slice()
    next.splice(i, 1)
    setTiersFor(cat, next.map((t, idx) => ({ ...t, order: idx })))
  }
  function moveTier(cat: string, i: number, dir: -1 | 1) {
    const next = tiersFor(cat).slice()
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setTiersFor(cat, next.map((t, idx) => ({ ...t, order: idx })))
  }

  if (editing) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <button onClick={() => setEditing(null)}
                    className="text-sm text-saffron-400 hover:underline">
              ← Back to profiles
            </button>
            <h1 className="text-2xl font-black mt-1">
              {editing.id ? 'Edit Tier Profile' : 'New Tier Profile'}
            </h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditing(null)}
                    className="px-4 py-2 rounded-lg bg-white/5 border border-white/10">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
                    className="px-4 py-2 rounded-lg bg-saffron-400 text-black font-bold disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {err && <div className="mb-3 text-sm p-3 rounded-lg bg-red-500/15 border border-red-500/40 text-red-200">{err}</div>}

        <div className="grid grid-cols-2 gap-3 mb-5 p-4 rounded-xl bg-white/5 border border-white/10">
          <TextRow label="Profile name *" value={editing.name}
                   onChange={v => setEditing({ ...editing, name: v })} />
          <TextRow label="Branch (empty = global)"
                   value={editing.branch_id ?? ''}
                   onChange={v => setEditing({ ...editing, branch_id: v || null })} />
          <div className="col-span-2">
            <div className="text-xs uppercase tracking-widest opacity-60 mb-1">Description</div>
            <textarea rows={2} value={editing.description}
                      onChange={e => setEditing({ ...editing, description: e.target.value })}
                      className="w-full bg-black/30 rounded-xl px-4 py-2 outline-none" />
          </div>
        </div>

        <div className="rounded-xl bg-white/5 border border-white/10">
          {CATEGORIES.map(c => {
            const tiers = tiersFor(c.id)
            const open = openCat === c.id
            return (
              <div key={c.id} className="border-b border-white/10 last:border-0">
                <button
                  onClick={() => setOpenCat(open ? '' : c.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{c.icon}</span>
                    <span className="font-bold">{c.label}</span>
                    <span className="text-xs opacity-60">
                      {tiers.length} tier{tiers.length === 1 ? '' : 's'}
                      {tiers.length === 0 && ' · defaults'}
                    </span>
                  </div>
                  <span className="opacity-60">{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <div className="px-4 pb-4 space-y-3">
                    {tiers.map((t, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-end p-3 rounded-lg bg-black/25 border border-white/5">
                        <div className="col-span-3">
                          <Lbl>Label</Lbl>
                          <Inp value={t.label} onChange={v => updateTier(c.id, i, { label: v })} />
                        </div>
                        <div className="col-span-2">
                          <Lbl>Price (£)</Lbl>
                          <Inp type="number" value={String(t.price)}
                               onChange={v => updateTier(c.id, i, { price: Number(v) || 0 })} />
                        </div>
                        <div className="col-span-3">
                          <Lbl>Sub-text</Lbl>
                          <Inp value={t.sub ?? ''} onChange={v => updateTier(c.id, i, { sub: v })} />
                        </div>
                        <div className="col-span-3">
                          <Lbl>Image URL</Lbl>
                          <Inp value={t.image_url ?? ''}
                               onChange={v => updateTier(c.id, i, { image_url: v })}
                               placeholder="https://… (blank = SVG default)" />
                        </div>
                        <div className="col-span-1 flex flex-col items-end gap-1">
                          <label className="flex items-center gap-1 text-xs cursor-pointer">
                            <input type="checkbox" checked={!!t.featured}
                                   onChange={e => updateTier(c.id, i, { featured: e.target.checked })} />
                            ⭐
                          </label>
                          <div className="flex gap-1">
                            <button onClick={() => moveTier(c.id, i, -1)}
                                    disabled={i === 0}
                                    className="px-1 text-xs opacity-60 hover:opacity-100 disabled:opacity-20">▲</button>
                            <button onClick={() => moveTier(c.id, i,  1)}
                                    disabled={i === tiers.length - 1}
                                    className="px-1 text-xs opacity-60 hover:opacity-100 disabled:opacity-20">▼</button>
                            <button onClick={() => removeTier(c.id, i)}
                                    className="px-1 text-xs text-red-300 hover:text-red-100">✕</button>
                          </div>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => addTier(c.id)}
                            className="text-sm px-3 py-2 rounded-lg bg-white/5 border border-dashed border-white/15 hover:bg-white/10">
                      + Add tier to {c.label}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-black">Tier Profiles</h1>
          <p className="text-sm opacity-60 mt-1">
            Editable Project Donation tier catalog (Brick, Square Feet, etc.).
            One profile can be assigned to many kiosk devices.
          </p>
        </div>
        <button onClick={() => { setEditing({ ...EMPTY_PROFILE }); setOpenCat('brick') }}
                className="px-4 py-2 rounded-lg bg-saffron-400 text-black font-bold">
          + New profile
        </button>
      </div>

      {err && <div className="mb-3 text-sm p-3 rounded-lg bg-red-500/15 border border-red-500/40 text-red-200">{err}</div>}

      {loading ? (
        <div className="opacity-60">Loading…</div>
      ) : profiles.length === 0 ? (
        <div className="p-6 rounded-xl bg-white/5 border border-dashed border-white/10 opacity-70">
          No tier profiles yet. Devices are using the hardcoded defaults.
        </div>
      ) : (
        <div className="grid gap-3">
          {profiles.map(p => (
            <div key={p.id}
                 className="p-4 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-bold text-lg">{p.name}</div>
                <div className="text-xs opacity-60">
                  {p.branch_id ? `Branch: ${p.branch_id}` : 'Global'} ·
                  {' '}{p.device_count} device{p.device_count === 1 ? '' : 's'} attached ·
                  {' '}{Object.keys(p.config).length} categor{Object.keys(p.config).length === 1 ? 'y' : 'ies'} overridden
                </div>
                {p.description && <div className="text-sm opacity-70 mt-1">{p.description}</div>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setEditing({ ...p }); setOpenCat('brick') }}
                        className="px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                  Edit
                </button>
                <button onClick={() => remove(p.id)}
                        className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─ Tiny inline primitives ───────────────────────────────────────────────────
function TextRow({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest opacity-60 mb-1">{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)}
             className="w-full bg-black/30 rounded-xl px-4 py-2 outline-none" />
    </div>
  )
}
function Lbl({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-widest opacity-50 mb-1">{children}</div>
}
function Inp({ value, onChange, type = 'text', placeholder = '' }: {
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)}
           placeholder={placeholder}
           className="w-full bg-black/30 rounded-lg px-3 py-2 text-sm outline-none" />
  )
}
