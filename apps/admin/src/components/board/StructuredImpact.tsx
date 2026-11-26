'use client'
// Structured Risk/Impact and Budget Impact inputs for the resolution
// wizard's Impact step. Operator feedback: "we should be able to select
// from predefined options as standard — avoid free text where possible".
//
// Approach: both panels edit the existing `risk_impact` and
// `budget_impact` TEXT columns on `resolutions` (no schema change).
// The structured controls serialise to a tidy multi-line string on
// every change. A small parser tries to reconstruct the structure from
// the stored text on load so an operator who saved a draft yesterday
// still sees their chip picks today. Anything we can't parse lives on
// in the "Additional notes" free-text box.

import { useEffect, useMemo, useRef, useState } from 'react'

export const RISK_CATEGORIES = [
  'Operational',
  'Financial',
  'Reputational',
  'Safeguarding',
  'Compliance',
  'Cyber',
  'Governance',
  'External',
] as const

export const AFFECTED_GROUPS = [
  'Beneficiaries',
  'Donors',
  'Staff',
  'Volunteers',
  'Trustees',
  'Public',
  'Property',
  'Reputation',
] as const

export const FUNDS = ['General', 'Restricted', 'Capital', 'Designated'] as const
export const VAT_TREATMENTS = ['Not applicable', 'Exempt', 'Zero-rated', 'Standard rated'] as const

interface StructuredRisk {
  categories: string[]
  affected: string[]
  what: string
  likelihood: number | null
  impact: number | null
  mitigation: string
  owner: string
  notes: string
}

interface StructuredBudget {
  fund: string
  oneOff: string
  recurring: string
  vat: string
  restrictions: string
  notes: string
}

function emptyRisk(): StructuredRisk {
  return { categories: [], affected: [], what: '', likelihood: null, impact: null, mitigation: '', owner: '', notes: '' }
}
function emptyBudget(): StructuredBudget {
  return { fund: '', oneOff: '', recurring: '', vat: '', restrictions: '', notes: '' }
}

export function serializeRisk(d: StructuredRisk): string {
  const lines: string[] = []
  if (d.categories.length) lines.push(`Category: ${d.categories.join(', ')}`)
  if (d.affected.length) lines.push(`Affected: ${d.affected.join(', ')}`)
  if (d.what.trim()) lines.push(`What could go wrong: ${d.what.trim()}`)
  if (d.likelihood && d.impact) lines.push(`Score: Likelihood ${d.likelihood} × Impact ${d.impact} = ${d.likelihood * d.impact}`)
  if (d.mitigation.trim()) lines.push(`Mitigation: ${d.mitigation.trim()}`)
  if (d.owner.trim()) lines.push(`Owner: ${d.owner.trim()}`)
  const body = lines.join('\n')
  const notes = d.notes.trim()
  if (!body) return notes
  if (!notes) return body
  return `${body}\n\n${notes}`
}

export function parseRisk(text: string): StructuredRisk {
  const out = emptyRisk()
  if (!text.trim()) return out
  const rest: string[] = []
  for (const raw of text.split('\n')) {
    const ln = raw.trim()
    const m = ln.match(/^(Category|Affected|What could go wrong|Score|Mitigation|Owner):\s*(.*)$/i)
    if (!m) { if (ln) rest.push(ln); else rest.push(''); continue }
    const key = m[1].toLowerCase()
    const val = m[2]
    if (key === 'category') out.categories = val.split(',').map(s => s.trim()).filter(Boolean)
    else if (key === 'affected') out.affected = val.split(',').map(s => s.trim()).filter(Boolean)
    else if (key === 'what could go wrong') out.what = val
    else if (key === 'score') {
      const sm = val.match(/Likelihood\s+(\d)\s*[×xX*]\s*Impact\s+(\d)/)
      if (sm) { out.likelihood = parseInt(sm[1], 10); out.impact = parseInt(sm[2], 10) }
    } else if (key === 'mitigation') out.mitigation = val
    else if (key === 'owner') out.owner = val
  }
  out.notes = rest.join('\n').trim()
  return out
}

export function serializeBudget(d: StructuredBudget): string {
  const lines: string[] = []
  if (d.fund) lines.push(`Fund: ${d.fund}`)
  const oneOff = d.oneOff.trim()
  const recurring = d.recurring.trim()
  if (oneOff || recurring) {
    const parts = []
    if (oneOff) parts.push(`One-off £${oneOff}`)
    if (recurring) parts.push(`Recurring £${recurring}/year`)
    lines.push(`Amount: ${parts.join(' · ')}`)
  }
  if (d.vat) lines.push(`VAT: ${d.vat}`)
  if (d.restrictions.trim()) lines.push(`Restrictions: ${d.restrictions.trim()}`)
  const body = lines.join('\n')
  const notes = d.notes.trim()
  if (!body) return notes
  if (!notes) return body
  return `${body}\n\n${notes}`
}

export function parseBudget(text: string): StructuredBudget {
  const out = emptyBudget()
  if (!text.trim()) return out
  const rest: string[] = []
  for (const raw of text.split('\n')) {
    const ln = raw.trim()
    const m = ln.match(/^(Fund|Amount|VAT|Restrictions):\s*(.*)$/i)
    if (!m) { if (ln) rest.push(ln); else rest.push(''); continue }
    const key = m[1].toLowerCase()
    const val = m[2]
    if (key === 'fund') out.fund = val
    else if (key === 'amount') {
      const oneOffM = val.match(/One-off\s*£\s*([\d,.]+)/i)
      const recM = val.match(/Recurring\s*£\s*([\d,.]+)/i)
      if (oneOffM) out.oneOff = oneOffM[1].replace(/,/g, '')
      if (recM) out.recurring = recM[1].replace(/,/g, '')
    } else if (key === 'vat') out.vat = val
    else if (key === 'restrictions') out.restrictions = val
  }
  out.notes = rest.join('\n').trim()
  return out
}

// ─── Small UI primitives ────────────────────────────────────────────────────

function Chip({ active, disabled, label, onClick }: { active: boolean; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
        active
          ? 'bg-saffron-400/20 border-saffron-400/50 text-saffron-200'
          : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      {active ? '✓ ' : ''}{label}
    </button>
  )
}

function Segmented({ value, max, disabled, onChange }: { value: number | null; max: number; disabled?: boolean; onChange: (n: number) => void }) {
  return (
    <div className="inline-flex gap-1">
      {Array.from({ length: max }, (_, i) => i + 1).map(n => (
        <button key={n} type="button" onClick={() => onChange(n)} disabled={disabled}
          className={`w-9 h-9 rounded-lg text-sm font-black border transition-colors ${
            value === n
              ? 'bg-saffron-500 border-saffron-500 text-black'
              : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
          {n}
        </button>
      ))}
    </div>
  )
}

const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'
const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-saffron-400/50'

// ─── Risk panel ─────────────────────────────────────────────────────────────

export function StructuredRiskPanel({
  value, onChange, disabled,
}: {
  value: string
  onChange: (text: string) => void
  disabled?: boolean
}) {
  const [data, setData] = useState<StructuredRisk>(() => parseRisk(value))
  const initialSerialised = useRef<string>(serializeRisk(data))

  // When an EXTERNAL change arrives (meeting-pull, AI draft, etc.) and the
  // incoming text differs from what our structured controls would currently
  // produce, re-parse so the chips stay in sync. Guard with the ref so our
  // own setData → onChange round-trips don't restart the loop.
  useEffect(() => {
    if (value === initialSerialised.current) return
    setData(parseRisk(value))
    initialSerialised.current = value
  }, [value])

  function update(patch: Partial<StructuredRisk>) {
    const next = { ...data, ...patch }
    setData(next)
    const out = serializeRisk(next)
    initialSerialised.current = out
    onChange(out)
  }

  const score = data.likelihood && data.impact ? data.likelihood * data.impact : null
  const scoreBand = score == null ? '' : score >= 15 ? 'HIGH' : score >= 8 ? 'MEDIUM' : 'LOW'
  const scoreColour = scoreBand === 'HIGH' ? 'text-red-300' : scoreBand === 'MEDIUM' ? 'text-amber-300' : 'text-emerald-300'

  const toggle = (arr: string[], item: string): string[] =>
    arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]

  return (
    <div className="space-y-4">
      <div>
        <label className={lbl}>Risk category <span className="text-white/30 normal-case tracking-normal">· pick one or more</span></label>
        <div className="flex flex-wrap gap-1.5">
          {RISK_CATEGORIES.map(c => (
            <Chip key={c} label={c} active={data.categories.includes(c)} disabled={disabled}
              onClick={() => update({ categories: toggle(data.categories, c) })} />
          ))}
        </div>
      </div>

      <div>
        <label className={lbl}>Who is affected</label>
        <div className="flex flex-wrap gap-1.5">
          {AFFECTED_GROUPS.map(a => (
            <Chip key={a} label={a} active={data.affected.includes(a)} disabled={disabled}
              onClick={() => update({ affected: toggle(data.affected, a) })} />
          ))}
        </div>
      </div>

      <div>
        <label className={lbl}>What could go wrong</label>
        <input disabled={disabled} value={data.what} onChange={e => update({ what: e.target.value })}
          className={inp} placeholder="e.g. Overflow car parking on Northwick Avenue annoys neighbours" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-4 items-end">
        <div>
          <label className={lbl}>Likelihood (1–5)</label>
          <Segmented value={data.likelihood} max={5} disabled={disabled} onChange={n => update({ likelihood: n })} />
        </div>
        <div>
          <label className={lbl}>Impact (1–5)</label>
          <Segmented value={data.impact} max={5} disabled={disabled} onChange={n => update({ impact: n })} />
        </div>
        {score != null && (
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-center">
            <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest">Score</p>
            <p className={`text-xl font-black ${scoreColour}`}>{score}</p>
            <p className={`text-[11px] font-bold ${scoreColour}`}>{scoreBand}</p>
          </div>
        )}
      </div>

      <div>
        <label className={lbl}>Mitigation plan</label>
        <input disabled={disabled} value={data.mitigation} onChange={e => update({ mitigation: e.target.value })}
          className={inp} placeholder="e.g. 4 marshals + shuttle from Harrow Leisure Centre" />
      </div>

      <div>
        <label className={lbl}>Mitigation owner</label>
        <input disabled={disabled} value={data.owner} onChange={e => update({ owner: e.target.value })}
          className={inp} placeholder="e.g. CEO (or email)" />
      </div>

      <details>
        <summary className="text-white/50 text-xs cursor-pointer hover:text-white/70">Additional notes (free text)</summary>
        <textarea disabled={disabled} value={data.notes} onChange={e => update({ notes: e.target.value })}
          rows={3} className={inp + ' resize-none mt-2'}
          placeholder="Anything that doesn't fit above — specific CC26 taxonomy, related prior incidents, etc." />
      </details>

      <p className="text-white/40 text-xs">If the risk is strategic or ongoing, it will be auto-added to the Org Risk Register on publish (CC26 §3).</p>
    </div>
  )
}

// ─── Budget panel ───────────────────────────────────────────────────────────

export function StructuredBudgetPanel({
  value, onChange, disabled,
}: {
  value: string
  onChange: (text: string) => void
  disabled?: boolean
}) {
  const [data, setData] = useState<StructuredBudget>(() => parseBudget(value))
  const initialSerialised = useRef<string>(serializeBudget(data))

  useEffect(() => {
    if (value === initialSerialised.current) return
    setData(parseBudget(value))
    initialSerialised.current = value
  }, [value])

  function update(patch: Partial<StructuredBudget>) {
    const next = { ...data, ...patch }
    setData(next)
    const out = serializeBudget(next)
    initialSerialised.current = out
    onChange(out)
  }

  const total = useMemo(() => {
    const o = parseFloat(data.oneOff.replace(/,/g, '')) || 0
    const r = parseFloat(data.recurring.replace(/,/g, '')) || 0
    return { o, r }
  }, [data.oneOff, data.recurring])

  return (
    <div className="space-y-4">
      <div>
        <label className={lbl}>Fund</label>
        <div className="flex flex-wrap gap-1.5">
          {FUNDS.map(f => (
            <Chip key={f} label={f} active={data.fund === f} disabled={disabled}
              onClick={() => update({ fund: data.fund === f ? '' : f })} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>One-off amount (£)</label>
          <input inputMode="decimal" disabled={disabled} value={data.oneOff}
            onChange={e => update({ oneOff: e.target.value.replace(/[^\d.,]/g, '') })}
            className={inp} placeholder="e.g. 15000" />
        </div>
        <div>
          <label className={lbl}>Recurring per year (£)</label>
          <input inputMode="decimal" disabled={disabled} value={data.recurring}
            onChange={e => update({ recurring: e.target.value.replace(/[^\d.,]/g, '') })}
            className={inp} placeholder="e.g. 3000" />
        </div>
      </div>

      {(total.o > 0 || total.r > 0) && (
        <p className="text-white/50 text-xs">
          Over 5 years ≈ £{(total.o + total.r * 5).toLocaleString('en-GB', { maximumFractionDigits: 0 })}
        </p>
      )}

      <div>
        <label className={lbl}>VAT treatment</label>
        <div className="flex flex-wrap gap-1.5">
          {VAT_TREATMENTS.map(v => (
            <Chip key={v} label={v} active={data.vat === v} disabled={disabled}
              onClick={() => update({ vat: data.vat === v ? '' : v })} />
          ))}
        </div>
      </div>

      <div>
        <label className={lbl}>Restrictions / match-funding</label>
        <input disabled={disabled} value={data.restrictions} onChange={e => update({ restrictions: e.target.value })}
          className={inp} placeholder="e.g. £5,000 from Harrow Council grant — must be spent by 31 Mar" />
      </div>

      <details>
        <summary className="text-white/50 text-xs cursor-pointer hover:text-white/70">Additional notes (free text)</summary>
        <textarea disabled={disabled} value={data.notes} onChange={e => update({ notes: e.target.value })}
          rows={3} className={inp + ' resize-none mt-2'} />
      </details>

      <p className="text-white/40 text-xs">If the amount is above the Treasurer&rsquo;s delegated authority, the decision type must be BOARD MEETING (step 1).</p>
    </div>
  )
}
