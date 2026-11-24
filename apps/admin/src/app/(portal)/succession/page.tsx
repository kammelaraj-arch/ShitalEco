'use client'
// Trustee succession heatmap — Charity Governance Code principle 3.5.
// Grid: trustees × next 8 years. Cells: active / retiring / gap.
// Years with 3+ retirements highlighted; trustees approaching 9-year
// cumulative service flagged.

import { useCallback, useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'

interface SuccessionRow {
  trustee_id: string
  name: string
  role: string
  term_start: string | null
  term_end: string | null
  term_number: number
  term_max_years: number
  cumulative_years: number
  approaching_cap: boolean
  states: Array<'active' | 'retiring' | 'gap'>
}

interface CapWarning {
  trustee_id: string
  name: string
  cumulative_years: number
  max_years: number
}

interface SuccessionResponse {
  years: string[]
  trustees: SuccessionRow[]
  retirements_by_year: Record<string, number>
  high_risk_years: string[]
  cap_warnings: CapWarning[]
}

export default function SuccessionPage() {
  const [data, setData] = useState<SuccessionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [years, setYears] = useState(8)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await apiFetch<SuccessionResponse>(`/admin/board/succession?years=${years}`)
      setData(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [years])
  useEffect(() => { void load() }, [load])

  return (
    <div className="p-6 space-y-6 text-white max-w-[1400px] mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black">Succession planning</h1>
          <p className="text-white/50 text-sm mt-0.5">
            Charity Governance Code principle 3.5 — see who retires when, plan recruitment accordingly.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-white/50 text-xs">Horizon:</label>
          <select value={years} onChange={e => setYears(Number(e.target.value))}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm">
            {[4, 6, 8, 10, 12].map(n => <option key={n} value={n}>{n} years</option>)}
          </select>
        </div>
      </header>

      {error && <div className="bg-red-500/15 border border-red-500/40 text-red-200 px-4 py-3 rounded-xl text-sm">{error}</div>}
      {loading && <p className="text-white/50 text-sm">Loading…</p>}

      {data && (
        <>
          {data.high_risk_years.length > 0 && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200 text-sm">
              ⚠ High-risk succession years: {data.high_risk_years.map(y => (
                <b key={y} className="mx-1">{y} ({data.retirements_by_year[y]} retirements)</b>
              ))}
              — begin recruitment at least 18 months out.
            </div>
          )}
          {data.cap_warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200 text-sm">
              ⚠ {data.cap_warnings.length} trustee{data.cap_warnings.length === 1 ? '' : 's'} approaching term cap:
              {data.cap_warnings.map(w => (
                <span key={w.trustee_id} className="inline-block ml-2">
                  <b>{w.name}</b> ({w.cumulative_years}/{w.max_years} yrs)
                </span>
              ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-white/60 text-xs uppercase tracking-widest">
                <tr>
                  <th className="px-3 py-2 text-left sticky left-0 bg-neutral-900 min-w-[200px]">Trustee</th>
                  <th className="px-3 py-2 text-left">Role</th>
                  <th className="px-3 py-2 text-left">Tenure</th>
                  {data.years.map(y => (
                    <th key={y} className={'px-2 py-2 text-center min-w-[60px] ' +
                      (data.high_risk_years.includes(y) ? 'bg-red-500/20 text-red-200' : '')}>
                      {y}
                      <div className="text-[9px] opacity-70">
                        {data.retirements_by_year[y] > 0 && `↓${data.retirements_by_year[y]}`}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.trustees.map(t => (
                  <tr key={t.trustee_id} className="border-t border-white/5">
                    <td className="px-3 py-2 sticky left-0 bg-neutral-900">
                      <p className="font-bold text-white">{t.name}</p>
                      {t.approaching_cap && (
                        <p className="text-amber-300 text-[10px] font-bold">⚠ near term cap</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-white/60 text-xs">{t.role.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2 text-white/60 text-xs">
                      {t.term_start && new Date(t.term_start).toLocaleDateString()}
                      {t.term_end && ` → ${new Date(t.term_end).toLocaleDateString()}`}
                      {t.cumulative_years > 0 && <div>{t.cumulative_years}/{t.term_max_years} yrs</div>}
                    </td>
                    {t.states.map((s, i) => (
                      <td key={i} className={
                        'px-1 py-1 text-center text-xs font-black border-l border-white/5 ' +
                        (s === 'active' ? 'bg-emerald-500/20 text-emerald-200'
                          : s === 'retiring' ? 'bg-amber-500/25 text-amber-100'
                          : 'bg-red-500/15 text-red-300')
                      }>
                        {s === 'active' ? '●' : s === 'retiring' ? '↓' : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3 text-xs flex-wrap text-white/60">
            <span><span className="inline-block w-3 h-3 rounded bg-emerald-500/40 mr-1"></span>In post</span>
            <span><span className="inline-block w-3 h-3 rounded bg-amber-500/40 mr-1"></span>Term ends</span>
            <span><span className="inline-block w-3 h-3 rounded bg-red-500/30 mr-1"></span>Vacancy</span>
          </div>
        </>
      )}
    </div>
  )
}
