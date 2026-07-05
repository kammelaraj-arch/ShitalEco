'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface PlatformApp {
  slug: string
  name: string
  description: string
  url: string | null
  icon: string
  color: string
  coming_soon?: boolean
}

interface AppUser {
  id: string
  email: string
  name: string
  role: string
  branch_id: string | null
  is_active: boolean
  role_default: Record<string, boolean>
  overrides: Record<string, boolean>
  effective: Record<string, boolean>
}

interface AccessData {
  apps: PlatformApp[]
  roles: string[]
  users: AppUser[]
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

export default function AppAccessPage() {
  const [data, setData] = useState<AccessData | null>(null)
  // Working per-user overrides, keyed by user id → { slug: bool }. Seeded from
  // the server's saved overrides; edited locally until Save.
  const [edits, setEdits] = useState<Record<string, Record<string, boolean>>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [appFilter, setAppFilter] = useState<string>('')   // '' = all apps

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<AccessData>('/settings/app-permissions/users')
      setData(res)
      const seed: Record<string, Record<string, boolean>> = {}
      res.users.forEach(u => { seed[u.id] = { ...u.overrides } })
      setEdits(seed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const apps = useMemo(() => {
    const all = data?.apps ?? []
    const live = all.filter(a => !a.coming_soon)
    return appFilter ? all.filter(a => a.slug === appFilter) : live
  }, [data, appFilter])

  const users = useMemo(() => {
    const list = data?.users ?? []
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(u =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q))
  }, [data, search])

  // Access shown for a cell = local override if set, else the role default.
  function shows(u: AppUser, slug: string): boolean {
    const ov = edits[u.id] || {}
    return slug in ov ? ov[slug] : !!u.role_default[slug]
  }
  function isOverride(u: AppUser, slug: string): boolean {
    const ov = edits[u.id] || {}
    return slug in ov && ov[slug] !== !!u.role_default[slug]
  }
  function dirty(u: AppUser): boolean {
    const cur = edits[u.id] || {}
    const orig = u.overrides || {}
    const keys = new Set([...Object.keys(cur), ...Object.keys(orig)])
    for (const k of keys) if ((cur[k] ?? undefined) !== (orig[k] ?? undefined)) return true
    return false
  }

  function toggle(u: AppUser, slug: string) {
    setError('')
    const next = !shows(u, slug)
    setEdits(prev => {
      const cur = { ...(prev[u.id] || {}) }
      if (next === !!u.role_default[slug]) {
        // Back to the role default → drop the explicit override.
        delete cur[slug]
      } else {
        cur[slug] = next
      }
      return { ...prev, [u.id]: cur }
    })
  }

  function resetUser(u: AppUser) {
    setEdits(prev => ({ ...prev, [u.id]: {} }))
  }

  async function saveUser(u: AppUser) {
    setSavingId(u.id)
    setError('')
    try {
      const overrides = edits[u.id] || {}
      await apiFetch(`/settings/app-permissions/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({ overrides }),
      })
      // Reflect the save into the loaded baseline so `dirty` clears.
      setData(prev => prev && {
        ...prev,
        users: prev.users.map(x => x.id === u.id
          ? { ...x, overrides: { ...overrides },
              effective: Object.fromEntries(prev.apps.map(a => [a.slug,
                a.slug in overrides ? overrides[a.slug] : !!x.role_default[a.slug]])) }
          : x),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingId(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-white/40">Loading…</div>
  )

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-white">App Access</h1>
          <p className="text-white/40 text-sm mt-1 max-w-2xl">
            Who can use each app. Every user starts from their <b>role default</b> (set on
            App Permissions); here you can <b>grant</b> or <b>revoke</b> a specific app for a
            specific user. A dot marks an override. Empty allow-list on an app = public.
          </p>
        </div>
        <a href="/settings/app-permissions"
          className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 font-bold text-sm hover:border-white/25 transition-colors">
          🗂️ Role Defaults →
        </a>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search users by name, email or role…"
          className="flex-1 min-w-[220px] px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-saffron-400/40 placeholder-white/30"
        />
        <select
          value={appFilter}
          onChange={e => setAppFilter(e.target.value)}
          className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-saffron-400/40"
        >
          <option value="">All live apps</option>
          {(data?.apps ?? []).map(a => (
            <option key={a.slug} value={a.slug}>{a.icon} {a.name}{a.coming_soon ? ' (soon)' : ''}</option>
          ))}
        </select>
      </div>

      {/* Access grid */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left px-4 py-3 font-bold text-white/40 text-xs uppercase tracking-widest sticky left-0 bg-[#141414] z-10">
                  User
                </th>
                {apps.map(a => (
                  <th key={a.slug} className="px-2 py-3 text-center font-bold text-white/50 text-xs whitespace-nowrap"
                    title={a.description}>
                    <span className="mr-1">{a.icon}</span>{a.name}
                  </th>
                ))}
                <th className="px-3 py-3 text-right font-bold text-white/40 text-xs uppercase tracking-widest">Save</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5 sticky left-0 bg-[#141414] z-10">
                    <div className="flex items-center gap-2">
                      <div>
                        <div className={`font-bold text-sm ${u.is_active ? 'text-white' : 'text-white/40 line-through'}`}>
                          {u.name || u.email}
                        </div>
                        <div className="text-white/30 text-xs">{u.email}</div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${ROLE_COLORS[u.role] || 'bg-white/10 text-white/40 border-white/15'}`}>
                        {(u.role || '—').replace('_', ' ')}
                      </span>
                    </div>
                  </td>
                  {apps.map(a => {
                    const on = shows(u, a.slug)
                    const over = isOverride(u, a.slug)
                    return (
                      <td key={a.slug} className="px-2 py-2.5 text-center">
                        <button
                          onClick={() => toggle(u, a.slug)}
                          title={over ? 'Override — click to reset toward role default' : 'Role default — click to override'}
                          className={`relative w-9 h-5 rounded-full transition-colors ${on ? 'bg-green-500' : 'bg-white/10'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
                          {over && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-saffron-400 ring-2 ring-[#141414]" />
                          )}
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {dirty(u) ? (
                      <div className="flex items-center gap-1.5 justify-end">
                        <button onClick={() => resetUser(u)}
                          className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/50 text-xs hover:text-white/80">
                          Reset
                        </button>
                        <button onClick={() => saveUser(u)} disabled={savingId === u.id}
                          className="px-3 py-1 rounded-lg bg-saffron-gradient text-white font-bold text-xs shadow disabled:opacity-50">
                          {savingId === u.id ? '…' : 'Save'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-white/20 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={apps.length + 2} className="px-4 py-10 text-center text-white/30 text-sm">No users match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-white/30 text-xs">
        <span className="inline-block w-2 h-2 rounded-full bg-saffron-400 align-middle mr-1.5" />
        dot = per-user override (differs from the role default). Toggling a cell back to its
        role default clears the override. Changes save per user.
      </p>
    </div>
  )
}
