'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'
import { BranchSelect, SearchSelect } from '@/components/ui/SearchSelect'

// ── Types ─────────────────────────────────────────────────────────────────────
type KioskThemeId = 'lotus' | 'saffron' | 'royal' | 'peacock' | 'jasmine' | 'crimson'

interface KioskDevice {
  id: string
  name: string
  description: string
  device_type: 'KIOSK' | 'QUICK_DONATION' | 'SMART_DISPLAY'
  branch_id: string
  location: string
  status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE'
  screen_profile_id: string | null
  peak_start: string
  peak_end: string
  off_peak_playlist_id: string | null
  default_donate_amount: number
  card_reader_id: string | null
  serial_number: string
  ip_address: string
  device_token: string
  last_seen_at: string | null
  notes: string
  kiosk_theme: KioskThemeId
  org_name: string
  org_logo_url: string
  device_username: string | null
  donate_title?: string
  monthly_giving_text?: string
  monthly_giving_amount?: number
  confirmation_text?: string
  bg_color?: string
  show_monthly_giving: boolean
  enable_gift_aid: boolean
  tap_and_go: boolean
  created_at: string
  updated_at: string
}

const KIOSK_THEMES: { id: KioskThemeId; name: string; emoji: string; bg: string; accent: string }[] = [
  { id: 'lotus',   name: 'Lotus Light',    emoji: '🪷', bg: '#FFF3E0', accent: '#FF9933' },
  { id: 'saffron', name: 'Saffron Temple', emoji: '🪔', bg: '#1C0000', accent: '#FF9933' },
  { id: 'royal',   name: 'Royal Gold',     emoji: '👑', bg: '#0D0D2B', accent: '#FFD700' },
  { id: 'peacock', name: 'Peacock Blue',   emoji: '🦚', bg: '#003333', accent: '#4DD0E1' },
  { id: 'jasmine', name: 'Jasmine Breeze', emoji: '🌸', bg: '#FFF8E1', accent: '#FF8F00' },
  { id: 'crimson', name: 'Crimson Fire',   emoji: '🔴', bg: '#5C0000', accent: '#DC143C' },
]

interface CardReader {
  id: string
  label: string
  branch_id: string
  provider: string
  status: string
  is_active: boolean
}

interface Branch { id: string; branch_id: string; name: string; city: string }
interface ScreenProfile { id: string; name: string; location: string; branch_id: string }
interface Playlist { id: string; name: string; branch_id: string }

type DeviceType = 'KIOSK' | 'QUICK_DONATION' | 'SMART_DISPLAY'
type DeviceStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE'

const EMPTY_FORM = {
  name: '', description: '', device_type: 'KIOSK' as DeviceType,
  branch_id: 'main', location: '', status: 'ACTIVE' as DeviceStatus,
  screen_profile_id: '', peak_start: '09:00', peak_end: '21:00',
  off_peak_playlist_id: '', default_donate_amount: 5,
  card_reader_id: '',
  serial_number: '', ip_address: '', notes: '',
  kiosk_theme: 'lotus' as KioskThemeId,
  org_name: '', org_logo_url: '',
  device_username: '', device_password: '',
  show_monthly_giving: false, enable_gift_aid: false, tap_and_go: true,
  donate_title: 'Tap & Donate',
  monthly_giving_text: 'Make a big impact from just £5/month',
  monthly_giving_amount: 5,
  confirmation_text: '',
  bg_color: '',
}

// ── Constants ─────────────────────────────────────────────────────────────────
const DEVICE_TYPES: { id: DeviceType; icon: string; label: string; desc: string; color: string }[] = [
  { id: 'KIOSK',          icon: '🖥️', label: 'Kiosk',          desc: 'Full self-service (donations, shop, services)',    color: '#6366F1' },
  { id: 'QUICK_DONATION', icon: '💳', label: 'Quick Donation',  desc: 'Tap-and-go donation-only (7"+ touchscreen)',      color: '#F59E0B' },
  { id: 'SMART_DISPLAY',  icon: '📺', label: 'Smart Display',   desc: 'Lobby/prayer-room screen driven by profile',     color: '#10B981' },
]

const STATUS_META: Record<DeviceStatus, { label: string; color: string; bg: string }> = {
  ACTIVE:      { label: 'Active',      color: '#16A34A', bg: '#DCFCE7' },
  INACTIVE:    { label: 'Inactive',    color: '#6B7280', bg: '#F3F4F6' },
  MAINTENANCE: { label: 'Maintenance', color: '#D97706', bg: '#FEF3C7' },
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-amber-500/50 transition-colors'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'
const row = 'grid grid-cols-2 gap-3'

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DevicesPage() {
  const [devices, setDevices]           = useState<KioskDevice[]>([])
  const [branches, setBranches]         = useState<Branch[]>([])
  const [profiles, setProfiles]         = useState<ScreenProfile[]>([])
  const [playlists, setPlaylists]       = useState<Playlist[]>([])
  const [cardReaders, setCardReaders]   = useState<CardReader[]>([])
  const [loading, setLoading]           = useState(true)
  const [drawerOpen, setDrawerOpen]     = useState(false)
  const [editing, setEditing]           = useState<KioskDevice | null>(null)
  const [form, setForm]                 = useState(EMPTY_FORM)
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState('')
  const [tokenMap, setTokenMap]         = useState<Record<string, string>>({}) // id → revealed token
  const [regenning, setRegenning]       = useState<string | null>(null)
  const [copied, setCopied]             = useState<string | null>(null)
  const [filterType, setFilterType]     = useState('')
  const [filterBranch, setFilterBranch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [deleting, setDeleting]         = useState<string | null>(null)

  // ── Load data ───────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [devData, brData, profData, plData, crData] = await Promise.all([
        apiFetch<{ devices: KioskDevice[] }>('/kiosk-devices'),
        apiFetch<{ branches: Branch[] }>('/branches').catch(() => ({ branches: [] })),
        apiFetch<{ profiles: ScreenProfile[] }>('/screen/profiles').catch(() => ({ profiles: [] })),
        apiFetch<{ playlists: Playlist[] }>('/screen/playlists').catch(() => ({ playlists: [] })),
        apiFetch<{ devices: CardReader[] }>('/terminal-devices/?active_only=true').catch(() => ({ devices: [] })),
      ])
      setDevices(devData.devices || [])
      setBranches(brData.branches || [])
      setProfiles(profData.profiles || [])
      setPlaylists(plData.playlists || [])
      setCardReaders(crData.devices || [])
    } catch (e: unknown) {
      setError(String(e))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── Filtered list ───────────────────────────────────────────────────────────
  const filtered = devices.filter(d =>
    (!filterType   || d.device_type === filterType) &&
    (!filterBranch || d.branch_id === filterBranch) &&
    (!filterStatus || d.status === filterStatus)
  )

  // ── Open drawer ─────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError('')
    setDrawerOpen(true)
  }
  const openEdit = (d: KioskDevice) => {
    setEditing(d)
    setForm({
      name: d.name, description: d.description, device_type: d.device_type,
      branch_id: d.branch_id, location: d.location, status: d.status,
      screen_profile_id: d.screen_profile_id || '',
      peak_start: d.peak_start, peak_end: d.peak_end,
      off_peak_playlist_id: d.off_peak_playlist_id || '',
      default_donate_amount: d.default_donate_amount,
      card_reader_id: d.card_reader_id || '',
      serial_number: d.serial_number, ip_address: d.ip_address, notes: d.notes,
      kiosk_theme: (d.kiosk_theme || 'lotus') as KioskThemeId,
      org_name: d.org_name || '', org_logo_url: d.org_logo_url || '',
      device_username: d.device_username || '', device_password: '',
      show_monthly_giving: d.show_monthly_giving ?? false,
      enable_gift_aid: d.enable_gift_aid ?? false,
      tap_and_go: d.tap_and_go ?? true,
      donate_title: d.donate_title || 'Tap & Donate',
      monthly_giving_text: d.monthly_giving_text || 'Make a big impact from just £5/month',
      monthly_giving_amount: d.monthly_giving_amount ?? 5,
      confirmation_text: d.confirmation_text || '',
      bg_color: d.bg_color || '',
    })
    setError('')
    setDrawerOpen(true)
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.name.trim()) { setError('Device name is required'); return }
    setSaving(true); setError('')
    try {
      const body = {
        ...form,
        screen_profile_id: form.screen_profile_id || null,
        off_peak_playlist_id: form.off_peak_playlist_id || null,
        device_username: form.device_username.trim() || null,
        device_password: form.device_password.trim() || null,
      }
      const bodyWithReader = { ...body, card_reader_id: form.card_reader_id || null }
      if (editing) {
        await apiFetch<{ ok: boolean }>(`/kiosk-devices/${editing.id}`, { method: 'PUT', body: JSON.stringify(bodyWithReader) })
      } else {
        const created = await apiFetch<{ ok: boolean; id: string; device_token: string }>('/kiosk-devices', { method: 'POST', body: JSON.stringify(bodyWithReader) })
        if (created.device_token) {
          setTokenMap(m => ({ ...m, [created.id]: created.device_token }))
        }
      }
      await load()
      setDrawerOpen(false)
    } catch (e: unknown) {
      setError(String(e))
    }
    setSaving(false)
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this device? This cannot be undone.')) return
    setDeleting(id)
    await apiFetch(`/kiosk-devices/${id}`, { method: 'DELETE' }).catch(() => {})
    await load()
    setDeleting(null)
  }

  // ── Regen token ──────────────────────────────────────────────────────────────
  const handleRegen = async (id: string) => {
    if (!confirm('Regenerate token? The device will need reconfiguring with the new token.')) return
    setRegenning(id)
    const res = await apiFetch<{ device_token: string }>(`/kiosk-devices/${id}/regen-token`, { method: 'POST' })
    setTokenMap(m => ({ ...m, [id]: res.device_token }))
    setRegenning(null)
  }

  // ── Copy to clipboard ────────────────────────────────────────────────────────
  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  // ── Last seen helper ─────────────────────────────────────────────────────────
  const lastSeen = (ts: string | null) => {
    if (!ts) return 'Never'
    const diff = Date.now() - new Date(ts).getTime()
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
  }

  // ── Branch name ──────────────────────────────────────────────────────────────
  const branchName = (id: string) => branches.find(b => b.branch_id === id || b.id === id)?.name || id

  const branchOptions = branches.map(b => ({ value: b.branch_id || b.id, label: `${b.name} — ${b.city}` }))
  const cardReaderOptions = [
    { value: '', label: '— None (no card reader) —' },
    ...cardReaders
      .filter(r => r.is_active && (!form.branch_id || r.branch_id === form.branch_id))
      .map(r => ({ value: r.id, label: `${r.label} (${r.provider.replace('_', ' ')})` })),
  ]
  const profileOptions = [
    { value: '', label: '— None —' },
    ...profiles.filter(p => !form.branch_id || p.branch_id === form.branch_id)
               .map(p => ({ value: p.id, label: `${p.name}${p.location ? ` (${p.location})` : ''}` })),
  ]
  const playlistOptions = [
    { value: '', label: '— None (idle) —' },
    ...playlists.filter(p => !form.branch_id || p.branch_id === form.branch_id)
                .map(p => ({ value: p.id, label: p.name })),
  ]

  const selectedType = DEVICE_TYPES.find(t => t.id === form.device_type)!

  return (
    <div className="min-h-screen" style={{ background: '#0D0404', fontFamily: 'Inter, sans-serif' }}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-white">Kiosk Devices</h1>
          <p className="text-white/40 text-sm mt-0.5">Manage kiosks, quick donation terminals & smart displays</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white font-bold text-sm transition-all active:scale-95"
          style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)', boxShadow: '0 4px 14px rgba(185,28,28,0.35)' }}
        >
          + Add Device
        </button>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="px-6 pb-4 flex flex-wrap gap-2">
        {/* Type filter */}
        <div className="flex rounded-xl overflow-hidden border border-white/10">
          <button onClick={() => setFilterType('')} className={`px-3 py-1.5 text-xs font-bold transition-colors ${!filterType ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'}`}>All</button>
          {DEVICE_TYPES.map(t => (
            <button key={t.id} onClick={() => setFilterType(filterType === t.id ? '' : t.id)}
              className={`px-3 py-1.5 text-xs font-bold transition-colors flex items-center gap-1.5 ${filterType === t.id ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'}`}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
        {/* Status filter */}
        <div className="flex rounded-xl overflow-hidden border border-white/10">
          {(['', 'ACTIVE', 'INACTIVE', 'MAINTENANCE'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s as DeviceStatus | '')}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${filterStatus === s ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'}`}>
              {s || 'Any Status'}
            </button>
          ))}
        </div>
        <span className="text-white/20 text-xs self-center ml-auto">{filtered.length} device{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Device grid ─────────────────────────────────────────────────── */}
      <div className="px-6 pb-10">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1,2,3].map(i => <div key={i} className="h-52 rounded-2xl animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">🖥️</p>
            <p className="text-white/40 font-semibold">No devices registered yet</p>
            <button onClick={openCreate} className="mt-4 text-amber-400 hover:text-amber-300 text-sm font-bold">+ Add your first device</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(d => {
              const typeMeta = DEVICE_TYPES.find(t => t.id === d.device_type)!
              const statusMeta = STATUS_META[d.status] || STATUS_META.INACTIVE
              const revealedToken = tokenMap[d.id]
              return (
                <motion.div
                  key={d.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl p-4 flex flex-col gap-3"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  {/* Card header */}
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                      style={{ background: `${typeMeta.color}20`, border: `1px solid ${typeMeta.color}40` }}>
                      {typeMeta.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-white font-black text-sm truncate">{d.name}</h3>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: statusMeta.bg, color: statusMeta.color }}>
                          {statusMeta.label}
                        </span>
                      </div>
                      <p className="text-white/40 text-xs">{typeMeta.label} · {branchName(d.branch_id)}</p>
                      {d.location && <p className="text-white/30 text-xs">📍 {d.location}</p>}
                    </div>
                  </div>

                  {/* Description */}
                  {d.description && <p className="text-white/50 text-xs line-clamp-2">{d.description}</p>}

                  {/* Type-specific info */}
                  <div className="flex flex-wrap gap-2">
                    {d.device_type === 'SMART_DISPLAY' && (
                      <span className="text-[10px] font-medium px-2 py-1 rounded-lg" style={{ background: 'rgba(16,185,129,0.12)', color: '#34D399' }}>
                        ⏰ Peak {d.peak_start}–{d.peak_end}
                      </span>
                    )}
                    {d.device_type === 'QUICK_DONATION' && (
                      <span className="text-[10px] font-medium px-2 py-1 rounded-lg" style={{ background: 'rgba(245,158,11,0.12)', color: '#FCD34D' }}>
                        💷 Default £{d.default_donate_amount}
                      </span>
                    )}
                    {d.card_reader_id && (cardReaders.find(r => r.id === d.card_reader_id)) && (
                      <span className="text-[10px] font-medium px-2 py-1 rounded-lg" style={{ background: 'rgba(99,102,241,0.12)', color: '#A5B4FC' }}>
                        💳 {cardReaders.find(r => r.id === d.card_reader_id)?.label}
                      </span>
                    )}
                    <span className="text-[10px] font-medium px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>
                      Last seen: {lastSeen(d.last_seen_at)}
                    </span>
                  </div>

                  {/* Device token */}
                  <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-white/30 text-[10px] font-semibold uppercase tracking-wide mb-1">Device Token</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[10px] font-mono text-amber-300/80 truncate">
                        {revealedToken || d.device_token.slice(0, 8) + '••••••••••••••••••••••••••••••••••••••••'}
                      </code>
                      <button
                        onClick={() => copy(revealedToken || d.device_token, `copy-${d.id}`)}
                        className="text-[10px] text-white/40 hover:text-amber-300 transition-colors flex-shrink-0"
                        title="Copy token"
                      >
                        {copied === `copy-${d.id}` ? '✓' : '📋'}
                      </button>
                      <button
                        onClick={() => handleRegen(d.id)}
                        disabled={regenning === d.id}
                        className="text-[10px] text-white/30 hover:text-red-400 transition-colors flex-shrink-0"
                        title="Regenerate token"
                      >
                        {regenning === d.id ? '…' : '🔄'}
                      </button>
                    </div>
                    {/* Copy Device URL — for KIOSK + QUICK_DONATION */}
                    {(d.device_type === 'KIOSK' || d.device_type === 'QUICK_DONATION') && (
                      <button
                        onClick={() => {
                          const base = d.device_type === 'QUICK_DONATION'
                            ? 'https://donate.shital.org.uk'
                            : 'https://kiosk.shital.org.uk'
                          const token = revealedToken || d.device_token
                          copy(`${base}/?token=${token}`, `url-${d.id}`)
                        }}
                        className="mt-2 w-full py-1.5 rounded-lg text-[10px] font-bold transition-colors flex items-center justify-center gap-1"
                        style={{ background: 'rgba(255,153,51,0.12)', color: copied === `url-${d.id}` ? '#22C55E' : '#FF9933', border: '1px solid rgba(255,153,51,0.2)' }}
                      >
                        {copied === `url-${d.id}` ? '✓ URL Copied!' : '📱 Copy Device URL'}
                      </button>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => openEdit(d)}
                      className="flex-1 py-2 rounded-xl text-xs font-bold text-white/70 hover:text-white hover:bg-white/8 transition-colors text-center"
                      style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(d.id)}
                      disabled={deleting === d.id}
                      className="px-3 py-2 rounded-xl text-xs font-bold text-red-400/70 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                      style={{ border: '1px solid rgba(220,38,38,0.15)' }}
                    >
                      {deleting === d.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Side drawer ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              onClick={() => setDrawerOpen(false)}
            />
            {/* Panel */}
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 h-full z-50 w-full max-w-xl flex flex-col overflow-hidden"
              style={{ background: '#130606', borderLeft: '1px solid rgba(185,28,28,0.2)' }}
            >
              {/* Drawer header */}
              <div className="px-6 py-5 flex items-center gap-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <button onClick={() => setDrawerOpen(false)} className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors text-lg">
                  ←
                </button>
                <div>
                  <h2 className="text-white font-black text-lg">{editing ? 'Edit Device' : 'Add Device'}</h2>
                  <p className="text-white/30 text-xs">{editing ? `ID: ${editing.id.slice(0, 8)}…` : 'Register a new kiosk or display'}</p>
                </div>
              </div>

              {/* Drawer body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

                {/* ── Device type ─────────────────────────────────────── */}
                <div>
                  <p className={lbl}>Device Type</p>
                  <div className="grid grid-cols-3 gap-2">
                    {DEVICE_TYPES.map(t => {
                      const active = form.device_type === t.id
                      return (
                        <button
                          key={t.id} type="button"
                          onClick={() => setForm(f => ({ ...f, device_type: t.id }))}
                          className="rounded-2xl p-3 text-left transition-all"
                          style={{
                            background: active ? `${t.color}20` : 'rgba(255,255,255,0.04)',
                            border: active ? `1.5px solid ${t.color}60` : '1.5px solid rgba(255,255,255,0.08)',
                            boxShadow: active ? `0 0 0 1px ${t.color}30` : 'none',
                          }}
                        >
                          <div className="text-2xl mb-1">{t.icon}</div>
                          <p className="text-white font-bold text-xs">{t.label}</p>
                          <p className="text-white/40 text-[10px] mt-0.5 leading-snug">{t.desc}</p>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* ── Basic info ──────────────────────────────────────── */}
                <div>
                  <p className={lbl}>Device Name *</p>
                  <input className={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Lobby Kiosk 1" />
                </div>

                <div>
                  <p className={lbl}>Description</p>
                  <textarea className={`${inp} resize-none`} rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional notes about this device" />
                </div>

                {/* ── Branch ─────────────────────────────────────────── */}
                <div>
                  <p className={lbl}>Branch *</p>
                  <BranchSelect
                    value={form.branch_id}
                    onChange={v => setForm(f => ({ ...f, branch_id: v, screen_profile_id: '', off_peak_playlist_id: '', card_reader_id: '' }))}
                    placeholder="Search branch…"
                  />
                </div>

                {/* ── Card Reader ─────────────────────────────────────── */}
                {(form.device_type === 'KIOSK' || form.device_type === 'QUICK_DONATION') && (
                  <div>
                    <p className={lbl}>Card Reader</p>
                    <SearchSelect
                      options={cardReaderOptions}
                      value={form.card_reader_id}
                      onChange={v => setForm(f => ({ ...f, card_reader_id: v }))}
                      placeholder="— None (no card reader) —"
                    />
                    {cardReaderOptions.length <= 1 && (
                      <p className="text-white/30 text-[10px] mt-1">No active card readers for this branch. Register one in Card Readers first.</p>
                    )}
                  </div>
                )}

                <div className={row}>
                  <div>
                    <p className={lbl}>Location</p>
                    <input className={inp} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Main Entrance" />
                  </div>
                  <div>
                    <p className={lbl}>Status</p>
                    <select className={inp} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as DeviceStatus }))}>
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                      <option value="MAINTENANCE">Maintenance</option>
                    </select>
                  </div>
                </div>

                {/* ── Smart Display: profile + peak hours ────────────── */}
                {form.device_type === 'SMART_DISPLAY' && (
                  <div className="rounded-2xl p-4 space-y-4" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.18)' }}>
                    <p className="text-emerald-400 text-xs font-bold uppercase tracking-wide">📺 Smart Display Settings</p>

                    <div>
                      <p className={lbl}>Screen Profile</p>
                      <SearchSelect
                        options={profileOptions}
                        value={form.screen_profile_id}
                        onChange={v => setForm(f => ({ ...f, screen_profile_id: v }))}
                        placeholder="Search profile…"
                      />
                      <p className="text-white/30 text-[10px] mt-1">Content shown during peak hours</p>
                    </div>

                    <div className={row}>
                      <div>
                        <p className={lbl}>Peak Start</p>
                        <input type="time" className={inp} value={form.peak_start} onChange={e => setForm(f => ({ ...f, peak_start: e.target.value }))} />
                      </div>
                      <div>
                        <p className={lbl}>Peak End</p>
                        <input type="time" className={inp} value={form.peak_end} onChange={e => setForm(f => ({ ...f, peak_end: e.target.value }))} />
                      </div>
                    </div>

                    <div>
                      <p className={lbl}>Off-Peak Playlist</p>
                      <SearchSelect
                        options={playlistOptions}
                        value={form.off_peak_playlist_id}
                        onChange={v => setForm(f => ({ ...f, off_peak_playlist_id: v }))}
                        placeholder="Search playlist…"
                      />
                      <p className="text-white/30 text-[10px] mt-1">Shown outside peak hours (idle screensaver)</p>
                    </div>
                  </div>
                )}

                {/* ── Quick Donation: settings + feature flags ────────── */}
                {form.device_type === 'QUICK_DONATION' && (
                  <div className="rounded-2xl p-4 space-y-4" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)' }}>
                    <p className="text-amber-400 text-xs font-bold uppercase tracking-wide">💳 Quick Donation Settings</p>

                    <div>
                      <p className={lbl}>Default Pre-selected Amount (£)</p>
                      <input
                        type="number" min="1" step="1"
                        className={inp}
                        value={form.default_donate_amount}
                        onChange={e => setForm(f => ({ ...f, default_donate_amount: parseFloat(e.target.value) || 5 }))}
                      />
                      <p className="text-white/30 text-[10px] mt-1">This tile is pre-selected when the device starts up</p>
                    </div>

                    {/* Screen title */}
                    <div>
                      <p className={lbl}>Screen Title</p>
                      <input
                        className={inp}
                        value={form.donate_title}
                        onChange={e => setForm(f => ({ ...f, donate_title: e.target.value }))}
                        placeholder="Tap & Donate"
                      />
                      <p className="text-white/30 text-[10px] mt-1">Shown as the main heading on the donation screen</p>
                    </div>

                    {/* Confirmation screen message */}
                    <div>
                      <p className={lbl}>Confirmation Message</p>
                      <input
                        className={inp}
                        value={form.confirmation_text}
                        onChange={e => setForm(f => ({ ...f, confirmation_text: e.target.value }))}
                        placeholder="Jay Shri Krishna (default)"
                      />
                      <p className="text-white/30 text-[10px] mt-1">Shown on the thank-you screen after a successful donation</p>
                    </div>

                    {/* Monthly Giving text + amount — shown when toggle is on */}
                    {form.show_monthly_giving && (
                      <div className="space-y-3 pt-1 pl-1" style={{ borderLeft: '2px solid rgba(74,222,128,0.25)' }}>
                        <div>
                          <p className={lbl}>Banner Text</p>
                          <input
                            className={inp}
                            value={form.monthly_giving_text}
                            onChange={e => setForm(f => ({ ...f, monthly_giving_text: e.target.value }))}
                            placeholder="Make a big impact from just £5/month"
                          />
                        </div>
                        <div>
                          <p className={lbl}>Monthly Amount (£)</p>
                          <input
                            type="number" min="1" step="0.5"
                            className={inp}
                            value={form.monthly_giving_amount}
                            onChange={e => setForm(f => ({ ...f, monthly_giving_amount: parseFloat(e.target.value) || 5 }))}
                          />
                          <p className="text-white/30 text-[10px] mt-1">Shown as the starting price in the banner</p>
                        </div>
                      </div>
                    )}

                    {/* Feature toggles */}
                    <div className="space-y-2.5 pt-1">
                      {([
                        { key: 'show_monthly_giving' as const, label: 'Display Monthly Giving banner', desc: 'Show monthly giving promo above tiles' },
                        { key: 'enable_gift_aid'      as const, label: 'Enable Gift Aid collection',   desc: 'Ask UK taxpayers to claim Gift Aid after tapping a tile' },
                        { key: 'tap_and_go'           as const, label: 'Just Tap & Go (no extras)',    desc: 'Tap tile → tap card directly — no gift aid, no extras' },
                      ] as const).map(({ key, label, desc }) => (
                        <label key={key} className="flex items-start gap-3 cursor-pointer p-3 rounded-xl transition-colors hover:bg-white/5">
                          <div className="relative flex-shrink-0 mt-0.5">
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={form[key]}
                              onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                            />
                            <div
                              className="w-9 h-5 rounded-full transition-colors"
                              style={{ background: form[key] ? '#F59E0B' : 'rgba(255,255,255,0.12)' }}
                            >
                              <div
                                className="w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform"
                                style={{ transform: form[key] ? 'translateX(18px)' : 'translateX(2px)' }}
                              />
                            </div>
                          </div>
                          <div>
                            <p className="text-white/80 text-xs font-bold">{label}</p>
                            <p className="text-white/35 text-[10px] mt-0.5">{desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Device Login Credentials (all types) ────────────── */}
                {(form.device_type === 'KIOSK' || form.device_type === 'QUICK_DONATION' || form.device_type === 'SMART_DISPLAY') && (
                  <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)' }}>
                    <p className="text-indigo-400 text-xs font-bold uppercase tracking-wide">🔐 Device Login</p>
                    <p className="text-white/35 text-[10px]">Set credentials staff use to log in to this device. Used by Kiosk, Quick Donation, and Smart Display apps.</p>
                    <div className={row}>
                      <div>
                        <p className={lbl}>Username</p>
                        <input className={inp} value={form.device_username}
                          onChange={e => setForm(f => ({ ...f, device_username: e.target.value.trim() }))}
                          placeholder="e.g. wembley-1" autoComplete="off" />
                      </div>
                      <div>
                        <p className={lbl}>Password{editing && ' (leave blank to keep)'}</p>
                        <input type="password" className={inp} value={form.device_password}
                          onChange={e => setForm(f => ({ ...f, device_password: e.target.value }))}
                          placeholder={editing ? '••••••••' : 'Set password'}
                          autoComplete="new-password" />
                      </div>
                    </div>
                    {form.device_username && (
                      <p className="text-indigo-400/60 text-[10px]">
                        Login: <span className="font-mono font-bold">{form.device_username}</span> / {form.device_password ? '(new password set)' : '(existing password)'}
                      </p>
                    )}
                  </div>
                )}

                {/* ── Kiosk Branding ─────────────────────────────────── */}
                {(form.device_type === 'KIOSK' || form.device_type === 'QUICK_DONATION') && (
                  <div className="rounded-2xl p-4 space-y-4" style={{ background: 'rgba(255,153,51,0.06)', border: '1px solid rgba(255,153,51,0.18)' }}>
                    <p className="text-amber-400 text-xs font-bold uppercase tracking-wide">🎨 Kiosk Appearance</p>

                    <div>
                      <p className={lbl}>Theme</p>
                      <div className="grid grid-cols-3 gap-2">
                        {KIOSK_THEMES.map(t => {
                          const active = form.kiosk_theme === t.id
                          return (
                            <button
                              key={t.id} type="button"
                              onClick={() => setForm(f => ({ ...f, kiosk_theme: t.id }))}
                              className="rounded-xl p-2.5 text-left transition-all flex flex-col items-center gap-1"
                              style={{
                                background: active ? `${t.accent}20` : 'rgba(255,255,255,0.04)',
                                border: active ? `1.5px solid ${t.accent}80` : '1.5px solid rgba(255,255,255,0.08)',
                              }}
                            >
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg" style={{ background: t.bg }}>
                                {t.emoji}
                              </div>
                              <p className="text-white text-[10px] font-bold text-center leading-tight">{t.name}</p>
                              {active && <span className="text-[9px] font-black" style={{ color: t.accent }}>✓ Active</span>}
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-white/30 text-[10px] mt-1">Theme applied when device loads via token URL</p>
                    </div>

                    <div>
                      <p className={lbl}>Organisation Name</p>
                      <input className={inp} value={form.org_name} onChange={e => setForm(f => ({ ...f, org_name: e.target.value }))} placeholder="e.g. Shital (leave blank to use default)" />
                    </div>

                    <div>
                      <p className={lbl}>Logo URL</p>
                      <input className={inp} value={form.org_logo_url} onChange={e => setForm(f => ({ ...f, org_logo_url: e.target.value }))} placeholder="https://… (leave blank for Om symbol)" />
                      {form.org_logo_url && (
                        <div className="mt-2 flex items-center gap-3">
                          <img src={form.org_logo_url} alt="Logo preview" className="w-12 h-12 rounded-xl object-contain"
                            style={{ background: 'rgba(255,255,255,0.08)' }}
                            onError={e => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3' }} />
                          <p className="text-white/30 text-[10px]">Logo preview</p>
                        </div>
                      )}
                    </div>

                    {/* Background colour override */}
                    <div>
                      <p className={lbl}>Background Colour Override</p>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {[
                          { label: 'None (use theme)', value: '' },
                          { label: 'Deep Saffron',    value: '#1a0a00' },
                          { label: 'Crimson Night',   value: '#5C0000' },
                          { label: 'Royal Indigo',    value: '#0D0D2B' },
                          { label: 'Peacock Teal',    value: '#003333' },
                          { label: 'Lotus Cream',     value: '#FFF3E0' },
                          { label: 'Jasmine White',   value: '#FFF8E1' },
                          { label: 'Midnight Black',  value: '#0a0a0a' },
                          { label: 'Forest Green',    value: '#0d2b0d' },
                        ].map(opt => {
                          const active = form.bg_color === opt.value
                          return (
                            <button
                              key={opt.value} type="button"
                              onClick={() => setForm(f => ({ ...f, bg_color: opt.value }))}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition-all"
                              style={{
                                background: active ? 'rgba(255,153,51,0.2)' : 'rgba(255,255,255,0.05)',
                                border: active ? '1.5px solid rgba(255,153,51,0.6)' : '1.5px solid rgba(255,255,255,0.1)',
                                color: active ? '#FF9933' : 'rgba(255,255,255,0.6)',
                              }}
                            >
                              {opt.value && (
                                <span
                                  className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                                  style={{ background: opt.value, border: '1px solid rgba(255,255,255,0.2)' }}
                                />
                              )}
                              {opt.label}
                            </button>
                          )
                        })}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={form.bg_color || '#1a0a00'}
                          onChange={e => setForm(f => ({ ...f, bg_color: e.target.value }))}
                          className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent"
                          title="Pick custom colour"
                        />
                        <input
                          className={`${inp} flex-1`}
                          value={form.bg_color}
                          onChange={e => setForm(f => ({ ...f, bg_color: e.target.value }))}
                          placeholder="e.g. #1a0a00 or linear-gradient(…) — blank = use theme"
                        />
                      </div>
                      <p className="text-white/30 text-[10px] mt-1">Overrides the theme background with a solid colour or CSS gradient</p>
                    </div>
                  </div>
                )}

                {/* ── Hardware info ───────────────────────────────────── */}
                <div className={row}>
                  <div>
                    <p className={lbl}>Serial Number</p>
                    <input className={inp} value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} placeholder="Optional" />
                  </div>
                  <div>
                    <p className={lbl}>IP Address</p>
                    <input className={inp} value={form.ip_address} onChange={e => setForm(f => ({ ...f, ip_address: e.target.value }))} placeholder="e.g. 192.168.1.50" />
                  </div>
                </div>

                <div>
                  <p className={lbl}>Notes</p>
                  <textarea className={`${inp} resize-none`} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Internal notes" />
                </div>

                {error && (
                  <div className="rounded-xl px-4 py-3 text-sm font-medium" style={{ background: '#7f1d1d30', border: '1px solid #7f1d1d80', color: '#FCA5A5' }}>
                    {error}
                  </div>
                )}
              </div>

              {/* Drawer footer */}
              <div className="px-6 py-4 flex gap-3 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="flex-1 py-3 rounded-xl text-white/60 hover:text-white font-bold text-sm transition-colors"
                  style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-2 px-8 py-3 rounded-xl text-white font-black text-sm transition-all active:scale-95 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)', boxShadow: '0 4px 14px rgba(185,28,28,0.3)', flex: 2 }}
                >
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Device'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
