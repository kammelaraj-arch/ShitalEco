'use client'
// Trustee skills matrix — Charity Governance Code principle 3.4.
// Heatmap: trustees as columns, skills as rows. Gap rows (no trustee
// at Proficient or above) pin to the top. Click a cell to edit a
// trustee's rating.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { apiFetch } from '@/lib/api'

interface Skill {
  code: string
  label: string
  category: string
  description: string
  sort_order: number
}
interface TrusteeLite {
  id: string
  full_name: string
  role: string
}
interface Rating {
  self_rating: number
  evidence: string
  last_reviewed_at: string | null
}
interface MatrixResponse {
  skills: Skill[]
  trustees: TrusteeLite[]
  ratings: Record<string, Record<string, Rating>>
  max_by_skill: Record<string, number>
  gaps: string[]
}

const RATING_LABEL = ['—', 'Awareness', 'Working', 'Proficient', 'Advanced', 'Expert']

function cellColour(rating: number): string {
  if (rating === 0) return 'bg-neutral-800/40 text-white/30'
  if (rating === 1) return 'bg-red-500/20 text-red-200'
  if (rating === 2) return 'bg-amber-500/20 text-amber-200'
  if (rating === 3) return 'bg-sky-500/20 text-sky-200'
  if (rating === 4) return 'bg-emerald-500/25 text-emerald-200'
  return 'bg-emerald-500/40 text-emerald-100'
}

export default function SkillsMatrixPage() {
  const [data, setData] = useState<MatrixResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [edit, setEdit] = useState<{ trusteeId: string; code: string; rating: number; evidence: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await apiFetch<MatrixResponse>('/admin/board/skills-matrix')
      setData(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function saveRating() {
    if (!edit) return
    try {
      await apiFetch(`/admin/board/trustees/${edit.trusteeId}/skills/${edit.code}`, {
        method: 'PUT',
        body: JSON.stringify({ self_rating: edit.rating, evidence: edit.evidence }),
      })
      setEdit(null)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  const sorted = useMemo(() => {
    if (!data) return null
    const gapSet = new Set(data.gaps)
    const skills = [...data.skills].sort((a, b) => {
      const ga = gapSet.has(a.code) ? 0 : 1
      const gb = gapSet.has(b.code) ? 0 : 1
      if (ga !== gb) return ga - gb
      return (a.sort_order || 999) - (b.sort_order || 999)
    })
    return skills
  }, [data])

  return (
    <div className="p-6 space-y-6 text-white max-w-[1600px] mx-auto">
      <header>
        <h1 className="text-2xl font-black">Skills matrix</h1>
        <p className="text-white/50 text-sm mt-0.5">
          Charity Governance Code principle 3.4 — map required skills against current trustees.
        </p>
      </header>

      {error && <div className="bg-red-500/15 border border-red-500/40 text-red-200 px-4 py-3 rounded-xl text-sm">{error}</div>}
      {loading && <p className="text-white/50 text-sm">Loading…</p>}

      {data && sorted && (
        <>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <span className="text-white/60">Rating scale:</span>
            {RATING_LABEL.map((l, i) => (
              <span key={i} className={'px-2 py-0.5 rounded ' + cellColour(i)}>{i} {l}</span>
            ))}
            <span className="text-white/50 ml-4">Gap rows (no trustee at Proficient+) are pinned to the top.</span>
          </div>

          {data.gaps.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200 text-sm">
              ⚠ {data.gaps.length} skill{data.gaps.length === 1 ? '' : 's'} with no trustee at Proficient or above — consider recruitment or training.
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-white/60 text-xs uppercase tracking-widest sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left min-w-[220px]">Skill</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  {data.trustees.map(t => (
                    <th key={t.id} className="px-2 py-2 text-center min-w-[90px]">
                      <div className="font-bold text-white text-xs">{t.full_name}</div>
                      <div className="text-white/40 text-[10px] uppercase">{t.role}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(s => {
                  const isGap = data.gaps.includes(s.code)
                  return (
                    <tr key={s.code} className={'border-t border-white/5 ' + (isGap ? 'bg-red-500/5' : '')}>
                      <td className="px-3 py-2">
                        <div className="font-bold text-white">{s.label}</div>
                        {s.description && <div className="text-white/40 text-[10px] mt-0.5">{s.description}</div>}
                      </td>
                      <td className="px-3 py-2 text-white/60 text-xs">{s.category.replace(/_/g, ' ')}</td>
                      {data.trustees.map(t => {
                        const r = data.ratings[t.id]?.[s.code]
                        const rating = r?.self_rating ?? 0
                        return (
                          <td key={t.id} className="px-1 py-1 text-center">
                            <button
                              onClick={() => setEdit({
                                trusteeId: t.id, code: s.code,
                                rating, evidence: r?.evidence || '',
                              })}
                              className={'w-full px-2 py-1.5 rounded-lg font-bold text-sm transition ' + cellColour(rating) + ' hover:ring-1 hover:ring-white/20'}
                              title={`${t.full_name} — ${s.label}: ${RATING_LABEL[rating]}`}
                            >
                              {rating}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {edit && data && (
        <>
          <div onClick={() => setEdit(null)} className="fixed inset-0 bg-black/60 z-40" />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="pointer-events-auto bg-temple-deep border border-temple-border rounded-2xl p-5 w-full max-w-md space-y-4">
              <div>
                <p className="text-white/50 text-xs uppercase tracking-widest font-bold">
                  {data.trustees.find(t => t.id === edit.trusteeId)?.full_name} · {data.skills.find(s => s.code === edit.code)?.label}
                </p>
              </div>
              <div>
                <label className="block text-white/50 text-xs font-bold mb-1">Self-rating</label>
                <div className="flex gap-1 flex-wrap">
                  {RATING_LABEL.map((l, i) => (
                    <button key={i} onClick={() => setEdit(e => e && ({ ...e, rating: i }))}
                      className={'px-3 py-1.5 rounded text-xs font-bold ' +
                        (edit.rating === i ? cellColour(i) + ' ring-2 ring-white/40' : 'bg-white/5 text-white/60 hover:bg-white/10')}>
                      {i} — {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-white/50 text-xs font-bold mb-1">Evidence (CV / qualification / past role)</label>
                <textarea rows={3} value={edit.evidence}
                  onChange={e => setEdit(st => st && ({ ...st, evidence: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm resize-none" />
              </div>
              <div className="flex gap-2">
                <button onClick={saveRating}
                  className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
                  Save
                </button>
                <button onClick={() => setEdit(null)}
                  className="px-4 py-2 rounded-xl border border-white/15 text-white/70 text-sm font-bold hover:bg-white/5">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
