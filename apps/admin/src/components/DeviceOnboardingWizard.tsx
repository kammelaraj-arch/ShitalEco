'use client'
/**
 * Multi-step wizard for creating a kiosk / quick-donation / smart-display
 * device and pairing it to a card reader.
 *
 * Flow:
 *   1. Pick device type           — Kiosk / Quick Donation / Smart Display
 *   2. Basic info                 — name, branch, location, status
 *   3. Pair a card reader         — tile per registered reader with its
 *                                   provider illustration + friendly name
 *                                   + RDR-XXXX pill. Admin sees exactly
 *                                   what they're attaching.
 *   4. Theme + feature flags      — kiosk-only (quick donation inherits
 *                                   sensible defaults; smart-display skips)
 *   5. Review & Save              — shows the generated pairing PIN that
 *                                   the operator must write on the back of
 *                                   the physical kiosk.
 */
import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'
import { BranchSelect } from '@/components/ui/SearchSelect'
import { ReaderIllustration, getProvider, type ProviderId } from './ReaderProviderInfo'

type DeviceType = 'KIOSK' | 'QUICK_DONATION' | 'SMART_DISPLAY'
type DeviceStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE'
type KioskThemeId = 'lotus' | 'saffron' | 'royal' | 'peacock' | 'jasmine' | 'crimson'

interface Reader {
  id: string
  label: string
  branch_id: string
  provider: ProviderId
  internal_ref?: string
  status: string
  is_active: boolean
}

export interface DeviceOnboardingWizardProps {
  onClose: () => void
  onCreated: () => void
}

interface WizardForm {
  device_type: DeviceType
  name: string
  description: string
  branch_id: string
  location: string
  status: DeviceStatus
  card_reader_id: string
  kiosk_theme: KioskThemeId
  org_name: string
  org_logo_url: string
  default_donate_amount: number
  show_monthly_giving: boolean
  enable_gift_aid: boolean
  tap_and_go: boolean
}

const EMPTY_FORM: WizardForm = {
  device_type: 'QUICK_DONATION',
  name: '',
  description: '',
  branch_id: 'main',
  location: '',
  status: 'ACTIVE',
  card_reader_id: '',
  kiosk_theme: 'saffron',
  org_name: '',
  org_logo_url: '',
  default_donate_amount: 5,
  show_monthly_giving: false,
  enable_gift_aid: false,
  tap_and_go: true,
}

const DEVICE_TYPES: { id: DeviceType; icon: string; label: string; desc: string; color: string }[] = [
  { id: 'KIOSK',          icon: '🖥️', label: 'Kiosk',          desc: 'Full self-service: donations, shop, services. Branch floor use.',  color: '#6366F1' },
  { id: 'QUICK_DONATION', icon: '💳', label: 'Quick Donation',  desc: 'Tap-and-go donation device, 7"+ touchscreen. Entrance / collection area.', color: '#F59E0B' },
  { id: 'SMART_DISPLAY',  icon: '📺', label: 'Smart Display',   desc: 'Lobby / prayer-room screen running a scheduled playlist.',         color: '#10B981' },
]

const KIOSK_THEMES: { id: KioskThemeId; name: string; emoji: string; bg: string; accent: string }[] = [
  { id: 'lotus',   name: 'Lotus Light',    emoji: '🪷', bg: '#FFF3E0', accent: '#FF9933' },
  { id: 'saffron', name: 'Saffron Temple', emoji: '🪔', bg: '#1C0000', accent: '#FF9933' },
  { id: 'royal',   name: 'Royal Gold',     emoji: '👑', bg: '#0D0D2B', accent: '#FFD700' },
  { id: 'peacock', name: 'Peacock Blue',   emoji: '🦚', bg: '#003333', accent: '#4DD0E1' },
  { id: 'jasmine', name: 'Jasmine Breeze', emoji: '🌸', bg: '#FFF8E1', accent: '#FF8F00' },
  { id: 'crimson', name: 'Crimson Fire',   emoji: '🔴', bg: '#5C0000', accent: '#DC143C' },
]

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-amber-500/50 transition-colors'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

export function DeviceOnboardingWizard({ onClose, onCreated }: DeviceOnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [form, setForm] = useState<WizardForm>({ ...EMPTY_FORM })
  const [readers, setReaders] = useState<Reader[]>([])
  const [loadingReaders, setLoadingReaders] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createdPin, setCreatedPin] = useState<string | null>(null)
  const [pinCopied, setPinCopied] = useState(false)

  const isKioskLike = form.device_type === 'KIOSK' || form.device_type === 'QUICK_DONATION'

  // Pull readers filtered to the chosen branch. Admin only sees readers
  // they can realistically assign — one less "wait, that's the wrong
  // branch" trap.
  useEffect(() => {
    if (step !== 3 || !isKioskLike) return
    setLoadingReaders(true)
    apiFetch<{ devices: Reader[] }>(`/terminal-devices/?active_only=true&branch_id=${encodeURIComponent(form.branch_id)}`)
      .then(d => setReaders(d.devices || []))
      .catch(() => setReaders([]))
      .finally(() => setLoadingReaders(false))
  }, [step, isKioskLike, form.branch_id])

  const chosenReader = useMemo(() => readers.find(r => r.id === form.card_reader_id), [readers, form.card_reader_id])

  // Skip the reader step for Smart Display (it doesn't take payments).
  const skipReaderStep = form.device_type === 'SMART_DISPLAY'
  // Smart Display also skips theme/flags — those are kiosk app chrome.
  const skipThemeStep = form.device_type === 'SMART_DISPLAY'

  const effectiveStepList: (1 | 2 | 3 | 4 | 5)[] = [
    1,
    2,
    ...(skipReaderStep ? ([] as (1|2|3|4|5)[]) : [3 as const]),
    ...(skipThemeStep  ? ([] as (1|2|3|4|5)[]) : [4 as const]),
    5,
  ]
  const stepLabel: Record<number, string> = {
    1: 'Type', 2: 'Basics', 3: 'Reader', 4: 'Look & Feel', 5: 'Review',
  }

  const canAdvance = (): { ok: boolean; reason?: string } => {
    if (step === 1) return { ok: true }
    if (step === 2) {
      if (!form.name.trim()) return { ok: false, reason: 'Device name is required.' }
      if (!form.branch_id.trim()) return { ok: false, reason: 'Pick a branch.' }
      return { ok: true }
    }
    if (step === 3) {
      // Reader is optional — a kiosk can be registered first and paired
      // later. Just note it so the admin knows.
      return { ok: true }
    }
    return { ok: true }
  }

  const goNext = () => {
    const v = canAdvance()
    if (!v.ok) { setError(v.reason || ''); return }
    setError('')
    // Walk through the effective step list so skipped steps aren't landed on.
    const i = effectiveStepList.indexOf(step)
    if (i >= 0 && i < effectiveStepList.length - 1) setStep(effectiveStepList[i + 1])
  }
  const goBack = () => {
    setError('')
    const i = effectiveStepList.indexOf(step)
    if (i > 0) setStep(effectiveStepList[i - 1])
  }

  const handleSave = async () => {
    setError(''); setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim(),
        device_type: form.device_type,
        branch_id: form.branch_id,
        location: form.location.trim(),
        status: form.status,
        card_reader_id: form.card_reader_id || null,
        kiosk_theme: form.kiosk_theme,
        org_name: form.org_name.trim(),
        org_logo_url: form.org_logo_url.trim(),
        default_donate_amount: form.default_donate_amount,
        show_monthly_giving: form.show_monthly_giving,
        enable_gift_aid: form.enable_gift_aid,
        tap_and_go: form.tap_and_go,
      }
      const res = await apiFetch<{ ok: boolean; id: string; device_token: string; pairing_pin: string }>(
        '/kiosk-devices',
        { method: 'POST', body: JSON.stringify(body) },
      )
      setCreatedPin(res.pairing_pin || null)
      // Don't close yet — show the generated PIN so the operator can write
      // it on the back of the kiosk before dismissing the modal.
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setSaving(false)
    }
  }

  const finish = () => { onCreated(); onClose() }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={createdPin ? undefined : onClose}
        className="fixed inset-0 bg-black/70 z-40"
      />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed right-0 top-0 h-full w-full sm:max-w-[680px] z-50 flex flex-col overflow-hidden"
        style={{ background: '#0f0008', borderLeft: '1px solid rgba(249,115,22,0.3)' }}
      >
        {/* Header + progress strip */}
        <div className="px-6 py-4 border-b border-white/5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-white font-black text-lg">Register a Device</h2>
              <p className="text-white/40 text-xs mt-0.5">A kiosk, quick-donation point, or smart display.</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 font-bold transition-colors">×</button>
          </div>

          {/* Progress dots — hide skipped steps so they don't look pending */}
          <div className="flex items-center gap-2 mt-4">
            {effectiveStepList.map((s, i) => (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors"
                  style={{
                    background: step >= s ? '#F59E0B' : 'rgba(255,255,255,0.08)',
                    color:      step >= s ? '#1C0000' : 'rgba(255,255,255,0.4)',
                  }}
                >{s}</div>
                <span className={`text-[11px] font-semibold whitespace-nowrap ${step === s ? 'text-amber-400' : step > s ? 'text-white/50' : 'text-white/30'}`}>{stepLabel[s]}</span>
                {i < effectiveStepList.length - 1 && <div className={`flex-1 h-px ${step > s ? 'bg-amber-500/60' : 'bg-white/10'}`} />}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
          {error && (
            <div className="bg-red-500/15 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl">{error}</div>
          )}

          {createdPin ? (
            // Success state. The PIN is only shown once — the operator must
            // write it down before dismissing. Mirrors the reader onboarding's
            // RDR-XXXX reveal step.
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="rounded-2xl p-5 text-center" style={{ background: 'rgba(249,115,22,0.08)', border: '1.5px solid rgba(249,115,22,0.4)' }}>
                <p className="text-amber-200/90 text-xs font-bold uppercase tracking-widest mb-2">Device registered</p>
                <p className="text-amber-200/70 text-xs mb-4">Write this pairing PIN on the back of the physical kiosk with a permanent marker.</p>
                <div className="flex items-center justify-center gap-3">
                  <div
                    className="font-mono text-5xl font-black tracking-widest"
                    style={{ color: '#F59E0B' }}
                  >{createdPin}</div>
                  <button
                    type="button"
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(createdPin); setPinCopied(true); setTimeout(() => setPinCopied(false), 1500) } catch {}
                    }}
                    className="px-3 py-2 rounded-lg bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 text-xs font-bold border border-amber-500/40"
                  >
                    {pinCopied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-white/40 text-[11px] mt-4 leading-snug">
                  The PIN is required whenever an admin changes which card reader is paired to this kiosk — a non-automatic sanity check that the admin is standing at the right device.
                </p>
              </div>
            </motion.div>
          ) : (
            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div
                  key="s1"
                  initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-3"
                >
                  <div>
                    <p className="text-white font-bold text-sm mb-1">What kind of device is this?</p>
                    <p className="text-white/40 text-xs">Pick the role this device will play. Quick Donation is the most common — a tap-and-go unit at an entrance.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {DEVICE_TYPES.map(t => {
                      const active = form.device_type === t.id
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, device_type: t.id }))}
                          className="rounded-2xl p-4 text-left transition-all"
                          style={{
                            background: active ? `${t.color}18` : 'rgba(255,255,255,0.03)',
                            border: active ? `1.5px solid ${t.color}80` : '1.5px solid rgba(255,255,255,0.08)',
                            boxShadow: active ? `0 0 0 1px ${t.color}50` : 'none',
                          }}
                        >
                          <div className="flex gap-4 items-center">
                            <div className="text-4xl">{t.icon}</div>
                            <div className="min-w-0">
                              <p className="font-bold text-base" style={{ color: active ? t.color : 'white' }}>{t.label}</p>
                              <p className="text-white/50 text-xs mt-0.5 leading-snug">{t.desc}</p>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div
                  key="s2"
                  initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-4"
                >
                  <div>
                    <p className={lbl}>Device Name *</p>
                    <input
                      className={inp}
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Wembley Main Hall Quick Donation 1"
                    />
                    <p className="text-white/40 text-[11px] mt-1.5">Short, distinctive — admins scan this in the Kiosks panel.</p>
                  </div>

                  <div>
                    <p className={lbl}>Branch *</p>
                    <BranchSelect
                      value={form.branch_id}
                      onChange={v => setForm(f => ({ ...f, branch_id: v, card_reader_id: '' }))}
                      placeholder="Search branch…"
                    />
                    <p className="text-white/40 text-[11px] mt-1.5">Readers are filtered by branch on the next step.</p>
                  </div>

                  <div>
                    <p className={lbl}>Location</p>
                    <input
                      className={inp}
                      value={form.location}
                      onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                      placeholder="e.g. Main entrance, left of the shoe rack"
                    />
                  </div>

                  <div>
                    <p className={lbl}>Description</p>
                    <textarea
                      className={`${inp} resize-none`}
                      rows={2}
                      value={form.description}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Optional notes about this device"
                    />
                  </div>
                </motion.div>
              )}

              {step === 3 && isKioskLike && (
                <motion.div
                  key="s3"
                  initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-3"
                >
                  <div>
                    <p className="text-white font-bold text-sm mb-1">Pair a card reader</p>
                    <p className="text-white/40 text-xs">
                      Only active readers at <span className="text-white/70 font-bold">{form.branch_id}</span> are shown.
                      You can skip this for now and pair later — but the device won't take payments until a reader is attached.
                    </p>
                  </div>

                  {loadingReaders ? (
                    <div className="text-white/40 text-sm py-6 text-center">Loading readers…</div>
                  ) : readers.length === 0 ? (
                    <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <p className="text-white/70 text-sm">No active readers at this branch yet.</p>
                      <p className="text-white/40 text-[11px] mt-1">
                        Register one at <a href="/terminal-devices" className="underline text-amber-400/80 hover:text-amber-300">Terminal Devices</a>, or skip and pair later.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, card_reader_id: '' }))}
                        className="rounded-xl p-3 text-left transition-all flex items-center gap-3"
                        style={{
                          background: !form.card_reader_id ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                          border: !form.card_reader_id ? '1.5px solid rgba(255,255,255,0.3)' : '1.5px solid rgba(255,255,255,0.08)',
                        }}
                      >
                        <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center text-white/40 text-xl">–</div>
                        <div className="text-white/70 text-sm">
                          <p className="font-bold">No reader yet</p>
                          <p className="text-white/40 text-[11px] mt-0.5">Pair later from Device Edit.</p>
                        </div>
                      </button>

                      {readers.map(r => {
                        const active = form.card_reader_id === r.id
                        const meta = getProvider(r.provider)
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => setForm(f => ({ ...f, card_reader_id: r.id }))}
                            className="rounded-xl p-3 text-left transition-all flex items-center gap-3"
                            style={{
                              background: active ? (meta?.bg || 'rgba(255,255,255,0.08)') : 'rgba(255,255,255,0.03)',
                              border: active ? `1.5px solid ${meta?.accent || 'rgba(255,255,255,0.3)'}80` : '1.5px solid rgba(255,255,255,0.08)',
                            }}
                          >
                            <ReaderIllustration provider={r.provider} size={48} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-bold text-sm text-white truncate">{r.label}</p>
                                {r.internal_ref && (
                                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded"
                                    style={{ color: meta?.accent || '#F59E0B', background: `${meta?.accent || '#F59E0B'}15` }}>
                                    {r.internal_ref}
                                  </span>
                                )}
                              </div>
                              <p className="text-white/50 text-[11px] mt-0.5">{meta?.label || r.provider} · {r.status}</p>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </motion.div>
              )}

              {step === 4 && !skipThemeStep && (
                <motion.div
                  key="s4"
                  initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-4"
                >
                  <div>
                    <p className="text-white font-bold text-sm mb-2">Kiosk theme</p>
                    <div className="grid grid-cols-2 gap-2">
                      {KIOSK_THEMES.map(t => {
                        const active = form.kiosk_theme === t.id
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setForm(f => ({ ...f, kiosk_theme: t.id }))}
                            className="rounded-xl p-3 text-left transition-all flex items-center gap-3"
                            style={{
                              background: active ? `${t.accent}25` : t.bg + '20',
                              border: active ? `1.5px solid ${t.accent}` : '1.5px solid rgba(255,255,255,0.08)',
                            }}
                          >
                            <div className="text-2xl">{t.emoji}</div>
                            <p className="font-bold text-sm" style={{ color: active ? t.accent : 'white' }}>{t.name}</p>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {form.device_type === 'QUICK_DONATION' && (
                    <>
                      <div>
                        <p className={lbl}>Default donation amount (£)</p>
                        <input
                          type="number"
                          step="0.01"
                          className={inp}
                          value={form.default_donate_amount}
                          onChange={e => setForm(f => ({ ...f, default_donate_amount: Number(e.target.value) || 0 }))}
                        />
                      </div>

                      <div className="space-y-2">
                        {([
                          { k: 'tap_and_go',        label: 'Tap & Go (one-tap donation)' },
                          { k: 'show_monthly_giving', label: 'Show Monthly Giving option' },
                          { k: 'enable_gift_aid',   label: 'Prompt for Gift Aid details' },
                        ] as const).map(f2 => (
                          <label key={f2.k} className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              className="w-4 h-4 accent-amber-500"
                              checked={form[f2.k]}
                              onChange={e => setForm(f => ({ ...f, [f2.k]: e.target.checked } as WizardForm))}
                            />
                            <span className="text-white/80 text-sm">{f2.label}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </motion.div>
              )}

              {step === 5 && (
                <motion.div
                  key="s5"
                  initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-3"
                >
                  <p className="text-white/70 text-sm">Check everything looks right, then register.</p>

                  <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.25)' }}>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div className="col-span-2">
                        <p className="text-white/40 uppercase tracking-wider text-[10px] font-bold mb-0.5">Name</p>
                        <p className="text-white font-bold">{form.name}</p>
                      </div>
                      <div>
                        <p className="text-white/40 uppercase tracking-wider text-[10px] font-bold mb-0.5">Type</p>
                        <p className="text-white/90">{DEVICE_TYPES.find(t => t.id === form.device_type)?.label}</p>
                      </div>
                      <div>
                        <p className="text-white/40 uppercase tracking-wider text-[10px] font-bold mb-0.5">Branch</p>
                        <p className="text-white/90">{form.branch_id}</p>
                      </div>
                      {form.location && (
                        <div className="col-span-2">
                          <p className="text-white/40 uppercase tracking-wider text-[10px] font-bold mb-0.5">Location</p>
                          <p className="text-white/80">{form.location}</p>
                        </div>
                      )}
                      {isKioskLike && (
                        <div className="col-span-2 pt-1 border-t border-white/5">
                          <p className="text-white/40 uppercase tracking-wider text-[10px] font-bold mb-1">Paired Reader</p>
                          {chosenReader ? (
                            <div className="flex gap-3 items-center">
                              <ReaderIllustration provider={chosenReader.provider} size={44} />
                              <div className="min-w-0">
                                <p className="text-white font-bold text-sm truncate">{chosenReader.label}</p>
                                <p className="text-white/50 text-[11px]">
                                  {getProvider(chosenReader.provider)?.label}
                                  {chosenReader.internal_ref ? ` · ${chosenReader.internal_ref}` : ''}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <p className="text-white/50 text-xs">— None (pair later)</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl p-3" style={{ background: 'rgba(255,153,51,0.06)', border: '1px solid rgba(255,153,51,0.25)' }}>
                    <p className="text-amber-200 text-[11px] leading-snug">
                      After save, a 4-digit pairing PIN will be shown.
                      Write it on the back of the physical kiosk with a permanent marker.
                      The PIN is required later whenever an admin re-pairs a card reader to this device.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between gap-3">
          {createdPin ? (
            <>
              <div />
              <button
                type="button"
                onClick={finish}
                className="px-5 py-2.5 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 transition-colors"
              >
                Done ✓
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={effectiveStepList.indexOf(step) === 0 ? onClose : goBack}
                className="px-4 py-2 rounded-xl text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
              >
                {effectiveStepList.indexOf(step) === 0 ? 'Cancel' : '← Back'}
              </button>
              {effectiveStepList.indexOf(step) < effectiveStepList.length - 1 ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 transition-colors disabled:opacity-40"
                >
                  Next →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 transition-colors disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Register Device'}
                </button>
              )}
            </>
          )}
        </div>
      </motion.div>
    </>
  )
}
