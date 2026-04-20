'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

const ALL_ROLES = ['SUPER_ADMIN','TRUSTEE','ACCOUNTANT','HR_MANAGER','AUDITOR',
                   'BRANCH_MANAGER','STAFF','VOLUNTEER','DEVOTEE','KIOSK'] as const
type Role = typeof ALL_ROLES[number]

interface PlatformApp {
  slug: string
  name: string
  description: string
  url: string | null
  icon: string
  color: string
  coming_soon?: boolean
}

interface PermissionsData {
  apps: PlatformApp[]
  roles: Role[]
  permissions: Record<string, Role[]>
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN:   'bg-red-500/20 text-red-300 border-red-500/30',
  TRUSTEE:       'bg-purple-500/20 text-purple-300 border-purple-500/30',
  ACCOUNTANT:    'bg-blue-500/20 text-blue-300 border-blue-500/30',
  HR_MANAGER:    'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  AUDITOR:       'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  BRANCH_MANAGER:'bg-green-500/20 text-green-300 border-green-500/30',
  STAFF:         'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  VOLUNTEER:     'bg-orange-500/20 text-orange-300 border-orange-500/30',
  DEVOTEE:       'bg-pink-500/20 text-pink-300 border-pink-500/30',
  KIOSK:         'bg-amber-500/20 text-amber-300 border-amber-500/30',
}

export default function AppPermissionsPage() {
  const [data, setData] = useState<PermissionsData | null>(null)
  const [permissions, setPermissions] = useState<Record<string, Role[]>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<PermissionsData>('/settings/app-permissions')
      setData(res)
      setPermissions(res.permissions)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function toggle(slug: string, role: Role) {
    setPermissions(prev => {
      const current = prev[slug] ?? []
      const next = current.includes(role)
        ? current.filter(r => r !== role)
        : [...current, role]
      return { ...prev, [slug]: next }
    })
    setSaved(false)
  }

  function setPublic(slug: string, isPublic: boolean) {
    setPermissions(prev => ({ ...prev, [slug]: isPublic ? [] : ['SUPER_ADMIN'] }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      await apiFetch('/settings/app-permissions', {
        method: 'PUT',
        body: JSON.stringify({ permissions }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-white/40">Loading…</div>
  )

  const apps = data?.apps ?? []
  const activeApps = apps.filter(a => !a.coming_soon)
  const comingApps = apps.filter(a => a.coming_soon)

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-white">App Permissions</h1>
          <p className="text-white/40 text-sm mt-1">
            Control which user roles can access each platform app. Empty = public access.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold text-sm shadow disabled:opacity-50"
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
        </button>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Role legend */}
      <div className="glass-card rounded-2xl p-4">
        <p className="text-xs font-bold text-white/30 uppercase tracking-widest mb-3">Role Legend</p>
        <div className="flex flex-wrap gap-2">
          {ALL_ROLES.map(role => (
            <span key={role} className={`px-2.5 py-1 rounded-full text-xs font-bold border ${ROLE_COLORS[role]}`}>
              {role.replace('_', ' ')}
            </span>
          ))}
        </div>
      </div>

      {/* Live apps */}
      <div>
        <p className="text-xs font-bold text-white/30 uppercase tracking-widest mb-3">Live Apps</p>
        <div className="space-y-3">
          {activeApps.map(app => {
            const appPerms = permissions[app.slug] ?? []
            const isPublic = appPerms.length === 0
            return (
              <motion.div key={app.slug} layout
                className="glass-card rounded-2xl p-4"
                style={{ borderColor: `${app.color}22` }}>
                <div className="flex items-start gap-4 flex-wrap">
                  {/* App info */}
                  <div className="flex items-center gap-3 min-w-[200px]">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                      style={{ background: `${app.color}22` }}>
                      {app.icon}
                    </div>
                    <div>
                      <div className="font-bold text-white text-sm">{app.name}</div>
                      <div className="text-white/35 text-xs leading-snug max-w-[180px]">{app.description}</div>
                    </div>
                  </div>

                  {/* Public toggle */}
                  <div className="flex items-center gap-2 py-1">
                    <button
                      onClick={() => setPublic(app.slug, !isPublic)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${isPublic ? 'bg-green-500' : 'bg-white/10'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${isPublic ? 'left-5.5' : 'left-0.5'}`} />
                    </button>
                    <span className={`text-xs font-bold ${isPublic ? 'text-green-400' : 'text-white/30'}`}>
                      Public
                    </span>
                  </div>

                  {/* Role toggles */}
                  {!isPublic && (
                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {ALL_ROLES.map(role => {
                        const active = appPerms.includes(role)
                        return (
                          <button
                            key={role}
                            onClick={() => toggle(app.slug, role)}
                            className={`px-2.5 py-1 rounded-full text-xs font-bold border transition-all ${
                              active
                                ? ROLE_COLORS[role]
                                : 'bg-white/3 text-white/20 border-white/8 hover:border-white/20'
                            }`}
                          >
                            {role.replace('_', ' ')}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {isPublic && (
                    <span className="text-xs text-white/30 italic py-1">No restrictions — visible to everyone</span>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Coming soon apps */}
      <div>
        <p className="text-xs font-bold text-white/30 uppercase tracking-widest mb-3">Coming Soon — Pre-configure Access</p>
        <div className="space-y-3">
          {comingApps.map(app => {
            const appPerms = permissions[app.slug] ?? []
            const isPublic = appPerms.length === 0
            return (
              <motion.div key={app.slug} layout
                className="glass-card rounded-2xl p-4 opacity-70"
                style={{ borderColor: `${app.color}18` }}>
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-[200px]">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                      style={{ background: `${app.color}18` }}>
                      {app.icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-bold text-white/70 text-sm">{app.name}</div>
                        <span className="px-1.5 py-0.5 rounded-full bg-white/8 text-white/30 text-[10px] font-bold">SOON</span>
                      </div>
                      <div className="text-white/25 text-xs leading-snug max-w-[180px]">{app.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 py-1">
                    <button
                      onClick={() => setPublic(app.slug, !isPublic)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${isPublic ? 'bg-green-500/70' : 'bg-white/10'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${isPublic ? 'left-5.5' : 'left-0.5'}`} />
                    </button>
                    <span className={`text-xs font-bold ${isPublic ? 'text-green-400/70' : 'text-white/20'}`}>Public</span>
                  </div>
                  {!isPublic && (
                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {ALL_ROLES.map(role => {
                        const active = appPerms.includes(role)
                        return (
                          <button key={role} onClick={() => toggle(app.slug, role)}
                            className={`px-2.5 py-1 rounded-full text-xs font-bold border transition-all ${
                              active ? ROLE_COLORS[role] : 'bg-white/3 text-white/15 border-white/6 hover:border-white/15'
                            }`}>
                            {role.replace('_', ' ')}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {isPublic && <span className="text-xs text-white/20 italic py-1">Public access when launched</span>}
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Save footer */}
      <div className="flex justify-end">
        <button onClick={save} disabled={saving}
          className="px-6 py-3 rounded-xl bg-saffron-gradient text-white font-bold shadow disabled:opacity-50">
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
