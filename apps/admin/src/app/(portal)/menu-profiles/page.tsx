'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface Menu {
  id: string
  app_id: string
  code: string
  label: string
  parent_id: string | null
  icon: string
  display_order: number
  is_active: boolean
}

interface MenuProfile {
  id: string
  app_id: string
  name: string
  description: string
  is_default: boolean
  item_count: number
}

interface MenuProfileDetail extends Omit<MenuProfile, 'item_count'> {
  menus: Menu[]
}

const APP_ID = 'kiosk'

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-amber-500/50 transition-colors'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

export default function MenuProfilesPage() {
  const [menus, setMenus]         = useState<Menu[]>([])
  const [profiles, setProfiles]   = useState<MenuProfile[]>([])
  const [loading, setLoading]     = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '', description: '', is_default: false, menu_ids: [] as string[],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [m, p] = await Promise.all([
        apiFetch<{ menus: Menu[] }>(`/admin/menus?app_id=${APP_ID}`),
        apiFetch<{ profiles: MenuProfile[] }>(`/admin/menu-profiles?app_id=${APP_ID}`),
      ])
      setMenus(m.menus || [])
      setProfiles(p.profiles || [])
    } catch (e) { setError(String(e)) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditingId(null)
    setForm({ name: '', description: '', is_default: false, menu_ids: menus.map(m => m.id) })
    setError(''); setDrawerOpen(true)
  }

  const openEdit = async (id: string) => {
    setEditingId(id); setError(''); setDrawerOpen(true)
    try {
      const detail = await apiFetch<MenuProfileDetail>(`/admin/menu-profiles/${id}`)
      setForm({
        name: detail.name, description: detail.description, is_default: detail.is_default,
        menu_ids: detail.menus.map(m => m.id),
      })
    } catch (e) { setError(String(e)) }
  }

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Profile name is required'); return }
    setSaving(true); setError('')
    try {
      const body = {
        app_id: APP_ID,
        name: form.name.trim(),
        description: form.description.trim(),
        is_default: form.is_default,
        menu_ids: form.menu_ids,
      }
      if (editingId) {
        await apiFetch(`/admin/menu-profiles/${editingId}`, { method: 'PUT', body: JSON.stringify(body) })
      } else {
        await apiFetch('/admin/menu-profiles', { method: 'POST', body: JSON.stringify(body) })
      }
      await load(); setDrawerOpen(false)
    } catch (e) { setError(String(e)) }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this profile? Devices using it will fall back to the default.')) return
    await apiFetch(`/admin/menu-profiles/${id}`, { method: 'DELETE' }).catch(() => {})
    await load()
  }

  const toggleMenu = (mid: string) => {
    setForm(f => ({
      ...f,
      menu_ids: f.menu_ids.includes(mid) ? f.menu_ids.filter(x => x !== mid) : [...f.menu_ids, mid],
    }))
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Menu Profiles</h1>
          <p className="text-white/50 text-sm mt-1">Reusable menu bundles assigned to kiosk devices.</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2.5 rounded-xl text-white text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}
        >+ New Profile</button>
      </div>

      {loading ? (
        <p className="text-white/50">Loading…</p>
      ) : profiles.length === 0 ? (
        <div className="rounded-2xl border border-white/10 p-8 text-center text-white/50">
          No profiles yet. Create one to control which menus a kiosk shows.
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map(p => (
            <div key={p.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-white font-bold">{p.name}</p>
                  {p.is_default && <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">Default</span>}
                </div>
                {p.description && <p className="text-white/50 text-xs mt-1">{p.description}</p>}
                <p className="text-white/30 text-[11px] mt-2">{p.item_count} menu item{p.item_count === 1 ? '' : 's'}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => openEdit(p.id)} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-xs">Edit</button>
                <button onClick={() => handleDelete(p.id)} className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setDrawerOpen(false)}>
          <div className="w-full max-w-2xl bg-[#1a0a0a] border border-white/10 rounded-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-white text-lg font-bold mb-4">{editingId ? 'Edit Profile' : 'New Profile'}</h2>

            <div className="space-y-4">
              <div>
                <p className={lbl}>Name</p>
                <input className={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Donation Kiosk" autoFocus />
              </div>
              <div>
                <p className={lbl}>Description</p>
                <input className={inp} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional — what this profile is for" />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_default}
                  onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} />
                <span className="text-white/80 text-sm">Use as default for unassigned devices</span>
              </label>

              <div>
                <p className={lbl}>Menus to include</p>
                <div className="grid grid-cols-2 gap-2">
                  {menus.map(m => {
                    const on = form.menu_ids.includes(m.id)
                    return (
                      <button key={m.id} type="button" onClick={() => toggleMenu(m.id)}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-colors text-sm"
                        style={{
                          background: on ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.03)',
                          border: `1.5px solid ${on ? '#F59E0B' : 'rgba(255,255,255,0.08)'}`,
                          color: on ? '#fff' : 'rgba(255,255,255,0.7)',
                        }}>
                        <span className="text-lg">{m.icon || '•'}</span>
                        <span className="flex-1">{m.label}</span>
                        {on && <span className="text-amber-400">✓</span>}
                      </button>
                    )
                  })}
                </div>
                <p className="text-white/30 text-[11px] mt-2">{form.menu_ids.length} of {menus.length} selected</p>
              </div>

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setDrawerOpen(false)} className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 text-sm font-bold">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-bold">
                  {saving ? 'Saving…' : 'Save Profile'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
