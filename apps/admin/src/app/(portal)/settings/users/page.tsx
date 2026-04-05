'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: string
  email: string
  name: string
  phone: string | null
  role: string
  branch_id: string | null
  is_active: boolean
  mfa_enabled: boolean
  last_login_at: string | null
  azure_oid: string | null
  azure_upn: string | null
  auth_provider: string
  created_at: string
}

// ─── Role config ──────────────────────────────────────────────────────────────

const ROLES: { id: string; label: string; desc: string; color: string; bg: string; level: number }[] = [
  { id: 'SUPER_ADMIN',    label: 'Super Admin',    desc: 'Full system access',                  color: '#ef4444', bg: '#fef2f2', level: 100 },
  { id: 'TRUSTEE',        label: 'Trustee',        desc: 'Governance & finance oversight',       color: '#d97706', bg: '#fffbeb', level: 80 },
  { id: 'ACCOUNTANT',     label: 'Accountant',     desc: 'Finance read/write access',           color: '#7c3aed', bg: '#f5f3ff', level: 70 },
  { id: 'HR_MANAGER',     label: 'HR Manager',     desc: 'HR, payroll, employees',              color: '#0891b2', bg: '#ecfeff', level: 65 },
  { id: 'AUDITOR',        label: 'Auditor',        desc: 'Read-only compliance & finance',      color: '#475569', bg: '#f8fafc', level: 60 },
  { id: 'BRANCH_MANAGER', label: 'Branch Manager', desc: 'Branch operations & bookings',        color: '#059669', bg: '#f0fdf4', level: 50 },
  { id: 'STAFF',          label: 'Staff',          desc: 'Bookings, kiosk, general ops',        color: '#2563eb', bg: '#eff6ff', level: 30 },
  { id: 'VOLUNTEER',      label: 'Volunteer',      desc: 'Limited operational access',          color: '#16a34a', bg: '#f0fdf4', level: 20 },
  { id: 'DEVOTEE',        label: 'Devotee',        desc: 'Self-service donations & bookings',   color: '#9333ea', bg: '#fdf4ff', level: 10 },
  { id: 'KIOSK',          label: 'Kiosk',          desc: 'Kiosk terminal access only',          color: '#64748b', bg: '#f8fafc', level: 5 },
]

function roleInfo(id: string) {
  return ROLES.find(r => r.id === id) ?? { id, label: id, desc: '', color: '#6b7280', bg: '#f9fafb', level: 0 }
}

function RoleBadge({ role }: { role: string }) {
  const r = roleInfo(role)
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold"
      style={{ background: r.bg, color: r.color, border: `1px solid ${r.color}30` }}>
      {r.label}
    </span>
  )
}

function AuthBadge({ provider }: { provider: string }) {
  if (provider === 'azure_ad') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/20">
      🔷 Microsoft
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-white/10 text-white/40 border border-white/10">
      🔑 Password
    </span>
  )
}

function fmtDate(iso: string | null) {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

// ─── Create / Edit user modal ─────────────────────────────────────────────────

function UserModal({ user, onClose, onSaved }: {
  user: User | null; onClose: () => void; onSaved: () => void
}) {
  const isEdit = !!user
  const [name, setName]         = useState(user?.name ?? '')
  const [email, setEmail]       = useState(user?.email ?? '')
  const [role, setRole]         = useState(user?.role ?? 'STAFF')
  const [branchId, setBranchId] = useState(user?.branch_id ?? '')
  const [phone, setPhone]       = useState(user?.phone ?? '')
  const [password, setPassword] = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  async function save() {
    setError(''); setSaving(true)
    try {
      if (isEdit) {
        // Update role only (edit modal)
        const res = await fetch(`${API}/users/${user!.id}/role`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role, branch_id: branchId || null }),
        })
        if (!res.ok) throw new Error((await res.json()).detail)
      } else {
        // Create new user
        if (!name.trim() || !email.trim()) { setError('Name and email are required'); setSaving(false); return }
        const res = await fetch(`${API}/users/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, role, branch_id: branchId || '', phone, password }),
        })
        if (!res.ok) throw new Error((await res.json()).detail)
      }
      onSaved(); onClose()
    } catch (e: any) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}>
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
        className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div>
            <h2 className="text-white font-black text-lg">{isEdit ? `Edit ${user!.name}` : 'Create User'}</h2>
            <p className="text-white/40 text-xs mt-0.5">{isEdit ? 'Change role & branch assignment' : 'Add a new staff member'}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 font-bold">×</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-500/15 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl">{error}</div>}

          {!isEdit && (
            <>
              <div>
                <label className="block text-white/50 text-xs font-semibold mb-1.5 uppercase tracking-wider">Full Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Priya Patel"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-saffron-400/40" />
              </div>
              <div>
                <label className="block text-white/50 text-xs font-semibold mb-1.5 uppercase tracking-wider">Email *</label>
                <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="priya@shital.org"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-saffron-400/40" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-white/50 text-xs font-semibold mb-1.5 uppercase tracking-wider">Phone</label>
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="07xxx xxxxxx"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-saffron-400/40" />
                </div>
                <div>
                  <label className="block text-white/50 text-xs font-semibold mb-1.5 uppercase tracking-wider">Password</label>
                  <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Leave blank for SSO only"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-saffron-400/40" />
                </div>
              </div>
            </>
          )}

          {/* Role picker */}
          <div>
            <label className="block text-white/50 text-xs font-semibold mb-2 uppercase tracking-wider">Role *</label>
            <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
              {ROLES.map(r => (
                <button key={r.id} onClick={() => setRole(r.id)}
                  className={`p-3 rounded-xl border text-left transition-all ${role === r.id ? 'border-saffron-400/60 bg-saffron-400/10' : 'border-white/5 bg-white/3 hover:border-white/15'}`}>
                  <p className="font-bold text-sm" style={{ color: r.color }}>{r.label}</p>
                  <p className="text-white/30 text-xs leading-tight mt-0.5">{r.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-white/50 text-xs font-semibold mb-1.5 uppercase tracking-wider">Branch ID <span className="text-white/20 font-normal">(optional)</span></label>
            <input value={branchId} onChange={e => setBranchId(e.target.value)} placeholder="e.g. wembley"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-saffron-400/40" />
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-white/5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-white/5 text-white/60 text-sm font-semibold">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-2 py-2.5 px-6 rounded-xl text-white text-sm font-black disabled:opacity-50 transition-all hover:scale-105 active:scale-95"
            style={{ background: 'linear-gradient(135deg, #d97706, #ea580c)', flex: 2 }}>
            {saving ? 'Saving…' : isEdit ? 'Save Role' : 'Create User'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const [users, setUsers]           = useState<User[]>([])
  const [loading, setLoading]       = useState(true)
  const [filterRole, setFilterRole] = useState('')
  const [search, setSearch]         = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [modal, setModal]           = useState<'create' | 'edit' | null>(null)
  const [selected, setSelected]     = useState<User | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterRole) params.set('role', filterRole)
      if (search) params.set('search', search)
      params.set('active_only', showInactive ? 'false' : 'true')
      const res = await fetch(`${API}/users/?${params}`)
      const data = await res.json()
      setUsers(data.users ?? [])
    } finally {
      setLoading(false)
    }
  }, [filterRole, search, showInactive])

  useEffect(() => { load() }, [load])

  async function toggleActive(u: User) {
    await fetch(`${API}/users/${u.id}/toggle-active`, { method: 'PUT' })
    load()
  }

  async function deleteUser(u: User) {
    if (!confirm(`Remove ${u.name}? This cannot be undone.`)) return
    await fetch(`${API}/users/${u.id}`, { method: 'DELETE' })
    load()
  }

  // Stats
  const byRole = ROLES.map(r => ({ ...r, count: users.filter(u => u.role === r.id).length }))
  const azureCount = users.filter(u => u.auth_provider === 'azure_ad').length

  return (
    <div className="space-y-8 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">🔐 Users & Roles</h1>
          <p className="text-white/40 mt-1">Manage staff accounts and permission levels</p>
        </div>
        <button onClick={() => { setSelected(null); setModal('create') }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-black shadow-lg hover:scale-105 active:scale-95 transition-all"
          style={{ background: 'linear-gradient(135deg, #d97706, #ea580c)' }}>
          + Create User
        </button>
      </div>

      {/* Role summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {byRole.filter(r => r.level >= 30).map((r, i) => (
          <motion.button key={r.id}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            onClick={() => setFilterRole(filterRole === r.id ? '' : r.id)}
            className={`glass rounded-2xl p-4 text-left transition-all hover:scale-[1.02] ${filterRole === r.id ? 'ring-2 ring-saffron-400/50' : ''}`}>
            <p className="font-black text-2xl text-white mb-1">{r.count}</p>
            <p className="text-xs font-bold" style={{ color: r.color }}>{r.label}</p>
            <p className="text-white/25 text-[10px] leading-tight mt-0.5">{r.desc}</p>
          </motion.button>
        ))}
      </div>

      {/* Info bar */}
      <div className="glass rounded-xl px-5 py-3 flex items-center gap-4 text-sm">
        <span className="text-white/50">{users.length} users shown</span>
        <span className="text-white/20">•</span>
        <span className="text-blue-400">🔷 {azureCount} via Microsoft SSO</span>
        <span className="text-white/20">•</span>
        <span className="text-white/40">{users.filter(u => u.auth_provider === 'local').length} via password</span>
      </div>

      {/* Filters */}
      <div className="glass rounded-2xl p-4 flex flex-wrap items-center gap-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search name or email…"
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-white/25 focus:outline-none focus:border-saffron-400/40 flex-1 min-w-48" />
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-saffron-400/40">
          <option value="">All Roles</option>
          {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <label className="flex items-center gap-2 cursor-pointer">
          <div onClick={() => setShowInactive(v => !v)}
            className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${showInactive ? 'bg-saffron-400/80' : 'bg-white/10'}`}>
            <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${showInactive ? 'translate-x-5' : 'translate-x-0'}`} />
          </div>
          <span className="text-white/50 text-sm">Show inactive</span>
        </label>
        <button onClick={load} className="px-4 py-2 rounded-xl bg-white/5 text-white/50 text-sm hover:bg-white/10">↻</button>
      </div>

      {/* Role legend */}
      <div className="glass rounded-2xl p-5">
        <h3 className="text-white font-black text-sm mb-3">Role Permission Levels</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {ROLES.map(r => (
            <div key={r.id} className="flex items-start gap-2.5 py-2 px-3 rounded-xl bg-white/2">
              <div className="w-2 h-2 rounded-full flex-shrink-0 mt-0.5" style={{ background: r.color }} />
              <span className="font-bold text-xs flex-shrink-0 w-24" style={{ color: r.color }}>{r.label}</span>
              <span className="text-white/30 text-xs leading-snug flex-1 min-w-0">{r.desc}</span>
              <span className="text-white/20 text-xs font-mono flex-shrink-0">L{r.level}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Users table */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full">
          <thead>
            <tr className="border-b border-white/5">
              {['User', 'Role', 'Branch', 'Sign-in Method', 'Last Login', 'Status', 'Actions'].map(h => (
                <th key={h} className="text-left text-white/30 text-xs font-semibold uppercase tracking-wider px-5 py-3 first:pl-6 last:pr-6">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-6 py-16 text-center text-white/20 text-sm">Loading users…</td></tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-20 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <span className="text-5xl opacity-20">👥</span>
                    <p className="text-white/30 text-sm">No users found</p>
                    <button onClick={() => setModal('create')}
                      className="mt-2 px-5 py-2 rounded-xl text-white text-sm font-black"
                      style={{ background: 'linear-gradient(135deg, #d97706, #ea580c)' }}>
                      + Create First User
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              users.map((u, i) => (
                <motion.tr key={u.id}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                  className="border-b border-white/3 hover:bg-white/2 transition-colors">

                  {/* User */}
                  <td className="px-5 py-4 pl-6">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-black text-white flex-shrink-0"
                        style={{ background: `${roleInfo(u.role).color}40` }}>
                        {initials(u.name)}
                      </div>
                      <div>
                        <p className="text-white font-semibold text-sm">{u.name}</p>
                        <p className="text-white/35 text-xs">{u.email}</p>
                        {u.phone && <p className="text-white/25 text-xs">{u.phone}</p>}
                      </div>
                    </div>
                  </td>

                  {/* Role */}
                  <td className="px-5 py-4"><RoleBadge role={u.role} /></td>

                  {/* Branch */}
                  <td className="px-5 py-4">
                    <span className="text-white/50 text-sm">{u.branch_id || <span className="text-white/20">—</span>}</span>
                  </td>

                  {/* Auth */}
                  <td className="px-5 py-4"><AuthBadge provider={u.auth_provider} /></td>

                  {/* Last login */}
                  <td className="px-5 py-4">
                    <span className="text-white/40 text-xs">{fmtDate(u.last_login_at)}</span>
                  </td>

                  {/* Status */}
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${u.is_active ? 'bg-green-400/15 text-green-400 border-green-400/20' : 'bg-gray-500/15 text-gray-400 border-gray-500/20'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? 'bg-green-400' : 'bg-gray-500'}`} />
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-5 py-4 pr-6">
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setSelected(u); setModal('edit') }}
                        className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-saffron-400 hover:bg-saffron-400/10 transition-colors text-xs" title="Change role">
                        ✏️
                      </button>
                      <button onClick={() => toggleActive(u)}
                        className={`p-1.5 rounded-lg bg-white/5 transition-colors text-xs ${u.is_active ? 'text-white/40 hover:text-yellow-400 hover:bg-yellow-400/10' : 'text-white/40 hover:text-green-400 hover:bg-green-400/10'}`}
                        title={u.is_active ? 'Deactivate' : 'Activate'}>
                        {u.is_active ? '🔒' : '🔓'}
                      </button>
                      <button onClick={() => deleteUser(u)}
                        className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-colors text-xs" title="Remove user">
                        🗑️
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table></div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {modal === 'create' && <UserModal user={null} onClose={() => setModal(null)} onSaved={load} />}
        {modal === 'edit' && selected && <UserModal user={selected} onClose={() => { setModal(null); setSelected(null) }} onSaved={load} />}
      </AnimatePresence>
    </div>
  )
}
