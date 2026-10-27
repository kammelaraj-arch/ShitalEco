'use client'
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

interface Profile {
  id: string
  email: string
  name: string
  phone: string
  role: string
  branch_id: string
  auth_provider: string
  has_pin: boolean
}

export default function MyProfilePage() {
  const [p, setP] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  // Profile form state
  const [name, setName]   = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)

  // PIN form state
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin]         = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinSaving, setPinSaving]   = useState(false)
  const [pinMsg, setPinMsg]         = useState('')
  const [pinErr, setPinErr]         = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const data = await apiFetch<Profile>('/me/profile')
      setP(data)
      setName(data.name)
      setEmail(data.email)
      setPhone(data.phone)
    } catch (e: any) {
      setErr(e.message || 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function saveProfile() {
    setSaving(true); setErr(''); setMsg('')
    try {
      const data = await apiFetch<Profile>('/me/profile', {
        method: 'PUT',
        body: JSON.stringify({ name, email, phone }),
      })
      setP(data)
      setMsg('Profile saved.')
    } catch (e: any) {
      setErr(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function savePin() {
    setPinSaving(true); setPinErr(''); setPinMsg('')
    if (!/^\d{4,8}$/.test(newPin)) {
      setPinErr('PIN must be 4 to 8 digits')
      setPinSaving(false)
      return
    }
    if (newPin !== confirmPin) {
      setPinErr('PINs do not match')
      setPinSaving(false)
      return
    }
    try {
      await apiFetch('/me/pin', {
        method: 'PUT',
        body: JSON.stringify({
          pin: newPin,
          current_pin: p?.has_pin ? currentPin : undefined,
        }),
      })
      setPinMsg(p?.has_pin ? 'PIN changed.' : 'PIN set.')
      setCurrentPin(''); setNewPin(''); setConfirmPin('')
      if (p) setP({ ...p, has_pin: true })
    } catch (e: any) {
      setPinErr(e.message || 'PIN save failed')
    } finally {
      setPinSaving(false)
    }
  }

  const inp = 'w-full px-4 py-2.5 rounded-lg bg-black/40 border border-white/10 text-white text-sm focus:border-amber-500 focus:outline-none'
  const lbl = 'text-white/60 text-xs mb-1'

  if (loading) {
    return <div className="p-8 text-white/60 text-sm">Loading…</div>
  }

  return (
    <div className="min-h-screen" style={{ background: '#0D0404', fontFamily: 'Inter, sans-serif' }}>
      <div className="px-6 pt-6 pb-4">
        <h1 className="text-2xl font-black text-white">👤 My Profile</h1>
        <p className="text-white/40 text-sm mt-1">Update your display name, email, phone, and PIN.</p>
      </div>

      {err && (
        <div className="mx-6 mb-4 px-4 py-2 rounded-lg bg-red-900/40 border border-red-500/40 text-red-200 text-sm">
          {err}
        </div>
      )}

      <div className="px-6 pb-10 grid gap-6 grid-cols-1 lg:grid-cols-2 max-w-5xl">
        {/* ── Profile card ────────────────────────────────────────── */}
        <section className="p-5 rounded-xl bg-white/[0.03] border border-white/5">
          <h2 className="text-white font-bold mb-4">Account details</h2>

          <div className="mb-3">
            <p className={lbl}>Role (read-only)</p>
            <p className="text-white/70 text-sm px-4 py-2.5 rounded-lg bg-black/20 border border-white/5">
              {p?.role} · {p?.auth_provider}
              {p?.branch_id ? ` · ${p.branch_id}` : ''}
            </p>
          </div>

          <div className="mb-3">
            <p className={lbl}>Display name</p>
            <input className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
          </div>

          <div className="mb-3">
            <p className={lbl}>Email</p>
            <input
              className={inp} type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={p?.auth_provider === 'azure'}
            />
            {p?.auth_provider === 'azure' && (
              <p className="text-white/30 text-xs mt-1">Email is managed by Microsoft SSO and cannot be changed here.</p>
            )}
          </div>

          <div className="mb-5">
            <p className={lbl}>Phone</p>
            <input className={inp} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+44 7700 900000" />
          </div>

          {msg && <p className="text-emerald-400 text-xs mb-2">{msg}</p>}

          <button
            onClick={saveProfile}
            disabled={saving}
            className="px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </section>

        {/* ── PIN card ────────────────────────────────────────────── */}
        <section className="p-5 rounded-xl bg-white/[0.03] border border-white/5">
          <h2 className="text-white font-bold mb-1">PIN</h2>
          <p className="text-white/40 text-xs mb-4">
            {p?.has_pin
              ? 'You have a PIN set. Enter your current PIN to change it.'
              : 'Set a 4 to 8 digit PIN for quick clock-in / check-in at the branch kiosk.'}
          </p>

          {p?.has_pin && (
            <div className="mb-3">
              <p className={lbl}>Current PIN</p>
              <input
                className={inp} inputMode="numeric" maxLength={8}
                value={currentPin}
                onChange={e => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                type="password"
              />
            </div>
          )}

          <div className="mb-3">
            <p className={lbl}>New PIN</p>
            <input
              className={inp} inputMode="numeric" maxLength={8}
              value={newPin}
              onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
              type="password"
            />
          </div>

          <div className="mb-5">
            <p className={lbl}>Confirm new PIN</p>
            <input
              className={inp} inputMode="numeric" maxLength={8}
              value={confirmPin}
              onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              type="password"
            />
          </div>

          {pinMsg && <p className="text-emerald-400 text-xs mb-2">{pinMsg}</p>}
          {pinErr && <p className="text-red-400 text-xs mb-2">{pinErr}</p>}

          <button
            onClick={savePin}
            disabled={pinSaving || !newPin}
            className="px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm disabled:opacity-40"
          >
            {pinSaving ? 'Saving…' : (p?.has_pin ? 'Change PIN' : 'Set PIN')}
          </button>
        </section>
      </div>
    </div>
  )
}
