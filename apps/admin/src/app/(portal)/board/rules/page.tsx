'use client'
import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/api'

interface Rules {
  id: string
  quorum_min: number
  quorum_fraction_numerator: number
  quorum_fraction_denominator: number
  chair_casting_vote_enabled: boolean
  written_resolution_requires_unanimous: boolean
  anonymous_ballot_for_officer_elections: boolean
  notice_period_days: number
  data_retention_years: number
  active_trustees: number
  effective_quorum: number
  updated_at: string
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

export default function GoverningRulesPage() {
  const [rules, setRules] = useState<Rules | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState({
    quorum_min: 3,
    quorum_fraction_numerator: 1,
    quorum_fraction_denominator: 3,
    chair_casting_vote_enabled: true,
    written_resolution_requires_unanimous: true,
    anonymous_ballot_for_officer_elections: true,
    notice_period_days: 7,
    data_retention_years: 6,
  })

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ rules: Rules }>('/admin/board/governing-rules')
        setRules(data.rules)
        setForm({
          quorum_min: data.rules.quorum_min,
          quorum_fraction_numerator: data.rules.quorum_fraction_numerator,
          quorum_fraction_denominator: data.rules.quorum_fraction_denominator,
          chair_casting_vote_enabled: data.rules.chair_casting_vote_enabled,
          written_resolution_requires_unanimous: data.rules.written_resolution_requires_unanimous,
          anonymous_ballot_for_officer_elections: data.rules.anonymous_ballot_for_officer_elections,
          notice_period_days: data.rules.notice_period_days,
          data_retention_years: data.rules.data_retention_years,
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load rules')
      } finally { setLoading(false) }
    })()
  }, [])

  async function save() {
    setSaving(true); setError(''); setSuccess('')
    try {
      await apiFetch('/admin/board/governing-rules', { method: 'PUT', body: JSON.stringify(form) })
      const data = await apiFetch<{ rules: Rules }>('/admin/board/governing-rules')
      setRules(data.rules)
      setSuccess('Saved.')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Failed to save'
      try { const p = JSON.parse(msg); if (p?.detail?.errors) msg = p.detail.errors.join(' · ') } catch { /* not JSON */ }
      setError(msg)
    } finally { setSaving(false) }
  }

  if (loading) return <div className="text-white/40 p-8">Loading…</div>
  if (!rules) return <div className="text-red-400 p-8">{error || 'Failed to load rules'}</div>

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-3xl font-black text-white">Governing Rules</h1>
        <p className="text-white/40 mt-1">Quorum, voting, written-resolution, notice period — the rules engine for every board decision.</p>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}
      {success && <div className="bg-green-500/10 border border-green-500/30 text-green-300 px-4 py-3 rounded-xl text-sm">{success}</div>}

      <div className="glass rounded-2xl p-5 border border-saffron-400/20 bg-saffron-400/5">
        <p className="text-saffron-400 text-xs font-bold uppercase tracking-widest mb-2">Currently in effect</p>
        <p className="text-white text-base">
          With <strong className="text-saffron-300">{rules.active_trustees} active trustees</strong>,
          the effective quorum is <strong className="text-saffron-300">{rules.effective_quorum}</strong>.
        </p>
        <p className="text-white/60 text-xs mt-1">
          Formula: max({rules.quorum_min}, ⌈{rules.active_trustees} × {rules.quorum_fraction_numerator}/{rules.quorum_fraction_denominator}⌉)
        </p>
      </div>

      <div className="glass rounded-2xl p-6 space-y-5">
        <h2 className="text-white font-black text-lg">Quorum</h2>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={lbl}>Minimum trustees *</label>
            <input type="number" min="1" value={form.quorum_min}
              onChange={e => setForm(p => ({ ...p, quorum_min: parseInt(e.target.value) || 1 }))} className={inp} />
          </div>
          <div>
            <label className={lbl}>Fraction numerator</label>
            <input type="number" min="1" value={form.quorum_fraction_numerator}
              onChange={e => setForm(p => ({ ...p, quorum_fraction_numerator: parseInt(e.target.value) || 1 }))} className={inp} />
          </div>
          <div>
            <label className={lbl}>Fraction denominator</label>
            <input type="number" min="1" value={form.quorum_fraction_denominator}
              onChange={e => setForm(p => ({ ...p, quorum_fraction_denominator: parseInt(e.target.value) || 3 }))} className={inp} />
          </div>
        </div>
        <p className="text-white/40 text-xs">
          Effective quorum = max(min trustees, ⌈total active × numerator/denominator⌉).
          Default <code className="text-saffron-300">max(3, ⅓ of trustees)</code> matches the SHITAL note.
        </p>
      </div>

      <div className="glass rounded-2xl p-6 space-y-4">
        <h2 className="text-white font-black text-lg">Voting</h2>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.chair_casting_vote_enabled}
            onChange={e => setForm(p => ({ ...p, chair_casting_vote_enabled: e.target.checked }))}
            className="w-4 h-4 rounded accent-saffron-400 mt-1" />
          <div>
            <p className="text-white text-sm font-bold">Chair has a casting vote when tied</p>
            <p className="text-white/50 text-xs">If a vote is tied, Chair may cast a second vote to break the tie. Action is logged separately.</p>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.anonymous_ballot_for_officer_elections}
            onChange={e => setForm(p => ({ ...p, anonymous_ballot_for_officer_elections: e.target.checked }))}
            className="w-4 h-4 rounded accent-saffron-400 mt-1" />
          <div>
            <p className="text-white text-sm font-bold">Officer elections are anonymous ballot</p>
            <p className="text-white/50 text-xs">Names not shown alongside choices in the result. Vote totals + audit log retained.</p>
          </div>
        </label>
      </div>

      <div className="glass rounded-2xl p-6 space-y-4">
        <h2 className="text-white font-black text-lg">Written (Circular) Resolutions</h2>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.written_resolution_requires_unanimous}
            onChange={e => setForm(p => ({ ...p, written_resolution_requires_unanimous: e.target.checked }))}
            className="w-4 h-4 rounded accent-saffron-400 mt-1" />
          <div>
            <p className="text-white text-sm font-bold">Written resolutions require unanimous trustee approval</p>
            <p className="text-white/50 text-xs">Per SHITAL governance note: a written resolution signed by all trustees is as valid as one passed at a properly held meeting.</p>
          </div>
        </label>
      </div>

      <div className="glass rounded-2xl p-6 space-y-4">
        <h2 className="text-white font-black text-lg">Procedural</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Notice period (days)</label>
            <input type="number" min="0" value={form.notice_period_days}
              onChange={e => setForm(p => ({ ...p, notice_period_days: parseInt(e.target.value) || 0 }))} className={inp} />
            <p className="text-white/40 text-xs mt-1">Minimum days notice for a regular meeting (excl. Emergency).</p>
          </div>
          <div>
            <label className={lbl}>Data retention (years)</label>
            <input type="number" min="1" value={form.data_retention_years}
              onChange={e => setForm(p => ({ ...p, data_retention_years: parseInt(e.target.value) || 6 }))} className={inp} />
            <p className="text-white/40 text-xs mt-1">Charity Commission default is 6 years for accounts; meeting records typically 6+.</p>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 sticky bottom-0 bg-temple-deep/80 backdrop-blur py-4 -mx-6 px-6 border-t border-white/5">
        <button onClick={save} disabled={saving}
          className="px-6 py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
          {saving ? 'Saving…' : 'Save Rules'}
        </button>
      </div>

      <p className="text-white/30 text-xs italic">
        Changes apply to future resolutions and meetings. Past decisions stand under whichever rules were in force at the time.
        Audit log records every rules change.
      </p>
    </div>
  )
}
