'use client'
/**
 * Multi-step wizard for registering a new card reader.
 *
 * Flow:
 *   1. Pick provider              — tile per provider with illustration + tagline
 *   2. Enter the reader ID        — provider-specific instructions + doc link + input
 *   3. Name it + choose branch    — Friendly Name, Description, Branch
 *   4. Review & Save              — summary of what will be saved
 *
 * Why a wizard and not a flat form?
 *   Onboarding is a once-per-device activity usually done by a volunteer who
 *   has never set up a reader before. Front-loading the "where do I find
 *   this value?" instructions beside the input (step 2) is what prevents the
 *   SumUp-labeled-STRIPE class of mistake. The admin already has the backend
 *   sanity check (PR #343) — the wizard removes the mistake upstream.
 *
 * Editing an existing reader still uses the flat form in DeviceModal — it's
 * meant for small corrections, not a guided first-time experience.
 */
import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'
import { BranchSelect } from '@/components/ui/SearchSelect'
import { PROVIDERS, getProvider, ReaderIllustration, type ProviderId } from './ReaderProviderInfo'

export interface ReaderOnboardingWizardProps {
  onClose: () => void
  onCreated: (newDeviceId?: string) => void
}

type WizardForm = {
  provider: ProviderId | ''
  stripe_reader_id: string
  stripe_location_id: string
  sumup_reader_serial: string
  clover_device_id: string
  square_device_id: string
  branch_id: string
  branch_name: string
  label: string
  description: string
  notes: string
}

const DEFAULT_LOCATION_ID = 'tml_Gcuz0gCsvSvQZg'

const EMPTY_FORM: WizardForm = {
  provider: '',
  stripe_reader_id: '',
  stripe_location_id: DEFAULT_LOCATION_ID,
  sumup_reader_serial: '',
  clover_device_id: '',
  square_device_id: '',
  branch_id: '',
  branch_name: '',
  label: '',
  description: '',
  notes: '',
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-amber-500/50 transition-colors'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

export function ReaderOnboardingWizard({ onClose, onCreated }: ReaderOnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [form, setForm] = useState<WizardForm>({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const providerMeta = useMemo(() => (form.provider ? getProvider(form.provider) : undefined), [form.provider])

  // The current provider's ID value — derived so step 2's input and step 4's
  // review card only need to read one field no matter which provider is chosen.
  const currentIdValue = useMemo(() => {
    if (!providerMeta) return ''
    switch (providerMeta.idFieldName) {
      case 'stripe_reader_id':    return form.stripe_reader_id
      case 'sumup_reader_serial': return form.sumup_reader_serial
      case 'clover_device_id':    return form.clover_device_id
      case 'square_device_id':    return form.square_device_id
      default:                    return ''
    }
  }, [providerMeta, form])

  const setCurrentIdValue = (v: string) => {
    if (!providerMeta) return
    setForm(f => ({ ...f, [providerMeta.idFieldName]: v } as WizardForm))
  }

  // Per-step validation. Each step gates the Next button so the volunteer
  // can't skip ahead with missing fields.
  const canAdvance = (): { ok: boolean; reason?: string } => {
    if (step === 1) {
      if (!form.provider) return { ok: false, reason: 'Pick a provider to continue.' }
      return { ok: true }
    }
    if (step === 2) {
      // Cash doesn't need an ID.
      if (form.provider === 'cash') return { ok: true }
      const v = (currentIdValue || '').trim()
      if (!v) return { ok: false, reason: `${providerMeta?.idFieldLabel || 'The reader ID'} is required.` }
      if (providerMeta?.idPattern && !providerMeta.idPattern.test(v)) {
        return {
          ok: false,
          reason: `That doesn\'t look right. ${providerMeta.idShapeHint}`,
        }
      }
      return { ok: true }
    }
    if (step === 3) {
      if (!form.label.trim()) return { ok: false, reason: 'Friendly name is required.' }
      if (!form.branch_id.trim()) return { ok: false, reason: 'Pick a branch.' }
      return { ok: true }
    }
    return { ok: true }
  }

  const goNext = () => {
    const v = canAdvance()
    if (!v.ok) { setError(v.reason || ''); return }
    setError('')
    setStep(s => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s))
  }
  const goBack = () => { setError(''); setStep(s => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s)) }

  const handleSave = async () => {
    setError(''); setSaving(true)
    try {
      const body = {
        branch_id: form.branch_id,
        branch_name: form.branch_name,
        label: form.label.trim(),
        provider: form.provider,
        stripe_reader_id:    form.stripe_reader_id.trim(),
        stripe_location_id:  form.stripe_location_id.trim(),
        sumup_reader_serial: form.sumup_reader_serial.trim(),
        clover_device_id:    form.clover_device_id.trim(),
        square_device_id:    form.square_device_id.trim(),
        description: form.description.trim(),
        notes:       form.notes.trim(),
      }
      const res = await apiFetch<{ device_id: string; created: boolean }>(
        '/terminal-devices/',
        { method: 'POST', body: JSON.stringify(body) },
      )
      onCreated(res.device_id)
      onClose()
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setSaving(false)
    }
  }

  // ─── Step labels in the progress strip ─────────────────────────────────
  const STEPS: { n: 1 | 2 | 3 | 4; label: string }[] = [
    { n: 1, label: 'Provider' },
    { n: 2, label: 'Reader ID' },
    { n: 3, label: 'Name & Branch' },
    { n: 4, label: 'Review' },
  ]

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/70 z-40"
      />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed right-0 top-0 h-full w-full sm:max-w-[640px] z-50 flex flex-col overflow-hidden"
        style={{ background: '#0f0008', borderLeft: '1px solid rgba(249,115,22,0.3)' }}
      >
        {/* Header + progress strip */}
        <div className="px-6 py-4 border-b border-white/5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-white font-black text-lg">Register a Card Reader</h2>
              <p className="text-white/40 text-xs mt-0.5">Step-by-step setup — takes about a minute.</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 font-bold transition-colors">×</button>
          </div>

          {/* Progress dots */}
          <div className="flex items-center gap-2 mt-4">
            {STEPS.map((s, i) => (
              <div key={s.n} className="flex items-center gap-2 flex-1">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors"
                  style={{
                    background: step >= s.n ? '#F59E0B' : 'rgba(255,255,255,0.08)',
                    color:      step >= s.n ? '#1C0000' : 'rgba(255,255,255,0.4)',
                  }}
                >{s.n}</div>
                <span className={`text-[11px] font-semibold ${step === s.n ? 'text-amber-400' : step > s.n ? 'text-white/50' : 'text-white/30'}`}>{s.label}</span>
                {i < STEPS.length - 1 && <div className={`flex-1 h-px ${step > s.n ? 'bg-amber-500/60' : 'bg-white/10'}`} />}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
          {error && (
            <div className="bg-red-500/15 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl">{error}</div>
          )}

          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="s1"
                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.18 }}
                className="space-y-3"
              >
                <div>
                  <p className="text-white font-bold text-sm mb-1">Which type of card reader is this?</p>
                  <p className="text-white/40 text-xs">Pick the hardware in front of you. The provider decides how the device pairs and which payment flow runs it.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {PROVIDERS.map(p => {
                    const active = form.provider === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, provider: p.id }))}
                        className="rounded-2xl p-3 text-left transition-all"
                        style={{
                          background: active ? p.bg : 'rgba(255,255,255,0.03)',
                          border: active ? `1.5px solid ${p.accent}80` : '1.5px solid rgba(255,255,255,0.08)',
                          boxShadow: active ? `0 0 0 1px ${p.accent}50` : 'none',
                        }}
                      >
                        <div className="flex gap-3 items-center">
                          <ReaderIllustration provider={p.id} size={64} />
                          <div className="min-w-0">
                            <p className="font-bold text-sm" style={{ color: active ? p.accent : 'white' }}>{p.label}</p>
                            <p className="text-white/50 text-[11px] mt-0.5 leading-snug">{p.tagline}</p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </motion.div>
            )}

            {step === 2 && providerMeta && (
              <motion.div
                key="s2"
                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.18 }}
                className="space-y-4"
              >
                <div className="flex gap-4 items-center">
                  <ReaderIllustration provider={providerMeta.id} size={84} />
                  <div>
                    <p className="text-white font-bold text-base">{providerMeta.label}</p>
                    <p className="text-white/50 text-xs mt-0.5">{providerMeta.tagline}</p>
                  </div>
                </div>

                <div className="rounded-xl p-4" style={{ background: providerMeta.bg, border: `1px solid ${providerMeta.accent}40` }}>
                  <p className="font-bold text-sm mb-2" style={{ color: providerMeta.accent }}>
                    {providerMeta.id === 'cash' ? 'No ID needed' : `Where to find the ${providerMeta.idFieldLabel}`}
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 text-white/70 text-xs leading-relaxed">
                    {providerMeta.whereToFindId.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                  {providerMeta.docUrl && (
                    <a
                      href={providerMeta.docUrl}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                      style={{ background: `${providerMeta.accent}20`, color: providerMeta.accent, border: `1px solid ${providerMeta.accent}50` }}
                    >
                      {providerMeta.docLabel}
                    </a>
                  )}
                </div>

                {providerMeta.id !== 'cash' && (
                  <div>
                    <p className={lbl}>{providerMeta.idFieldLabel} *</p>
                    <input
                      className={inp}
                      value={currentIdValue}
                      onChange={e => setCurrentIdValue(e.target.value)}
                      placeholder={providerMeta.idPlaceholder}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="text-white/40 text-[11px] mt-1.5">{providerMeta.idShapeHint}</p>
                  </div>
                )}

                {providerMeta.id === 'stripe_terminal' && (
                  <div>
                    <p className={lbl}>Stripe Location ID</p>
                    <input
                      className={inp}
                      value={form.stripe_location_id}
                      onChange={e => setForm(f => ({ ...f, stripe_location_id: e.target.value }))}
                      placeholder="tml_..."
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="text-white/40 text-[11px] mt-1.5">
                      Leave the default unless Stripe has issued a new Terminal location for this branch.
                    </p>
                  </div>
                )}
              </motion.div>
            )}

            {step === 3 && providerMeta && (
              <motion.div
                key="s3"
                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.18 }}
                className="space-y-4"
              >
                <div>
                  <p className={lbl}>Friendly Name *</p>
                  <input
                    className={inp}
                    value={form.label}
                    onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                    placeholder="e.g. Wembley Main Hall Reader"
                  />
                  <p className="text-white/40 text-[11px] mt-1.5">
                    Short name shown in the Kiosks admin so volunteers can tell readers apart.
                  </p>
                </div>

                <div>
                  <p className={lbl}>Branch *</p>
                  <BranchSelect
                    value={form.branch_id}
                    onChange={v => setForm(f => ({ ...f, branch_id: v }))}
                    placeholder="Search branch…"
                  />
                </div>

                <div>
                  <p className={lbl}>Description</p>
                  <textarea
                    className={`${inp} resize-none`}
                    rows={3}
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="e.g. Mounted on the main hall entrance kiosk, used for Sunday collection."
                  />
                </div>

                <div>
                  <p className={lbl}>Notes (operator / maintenance)</p>
                  <textarea
                    className={`${inp} resize-none`}
                    rows={2}
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Anything useful for whoever maintains this device."
                  />
                </div>
              </motion.div>
            )}

            {step === 4 && providerMeta && (
              <motion.div
                key="s4"
                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.18 }}
                className="space-y-3"
              >
                <p className="text-white/70 text-sm">Check everything looks right, then save.</p>

                <div className="rounded-xl p-4 space-y-3" style={{ background: providerMeta.bg, border: `1px solid ${providerMeta.accent}40` }}>
                  <div className="flex gap-4 items-center">
                    <ReaderIllustration provider={providerMeta.id} size={72} />
                    <div className="min-w-0">
                      <p className="font-bold text-base" style={{ color: providerMeta.accent }}>{providerMeta.label}</p>
                      <p className="text-white/70 text-sm mt-0.5 truncate">{form.label || <span className="text-white/40">(no name)</span>}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {providerMeta.id !== 'cash' && (
                      <div className="col-span-2">
                        <p className="text-white/40 uppercase tracking-wider text-[10px] font-bold mb-0.5">{providerMeta.idFieldLabel}</p>
                        <p className="font-mono text-white/90 break-all">{currentIdValue || <span className="text-white/40 font-sans">—</span>}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-white/40 uppercase tracking-wider text-[10px] font-bold mb-0.5">Branch</p>
                      <p className="text-white/90">{form.branch_id || <span className="text-white/40">—</span>}</p>
                    </div>
                    {form.description && (
                      <div className="col-span-2">
                        <p className="text-white/40 uppercase tracking-wider text-[10px] font-bold mb-0.5">Description</p>
                        <p className="text-white/80 leading-snug">{form.description}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl p-3" style={{ background: 'rgba(255,153,51,0.06)', border: '1px solid rgba(255,153,51,0.25)' }}>
                  <p className="text-amber-200 text-[11px] leading-snug">
                    After save, an <span className="font-mono font-bold">RDR-XXXX</span> reference code will be generated.
                    Write it on the back of the physical reader with a permanent marker — it's how we match this row to the device later.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={step === 1 ? onClose : goBack}
            className="px-4 py-2 rounded-xl text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
          >
            {step === 1 ? 'Cancel' : '← Back'}
          </button>
          {step < 4 ? (
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
              {saving ? 'Saving…' : 'Register Reader'}
            </button>
          )}
        </div>
      </motion.div>
    </>
  )
}
