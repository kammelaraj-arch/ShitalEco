'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Note {
  id: string
  git_sha: string
  pr_number: number | null
  title: string
  summary: string
  area: string
  tags: string[]
  released_at: string | null
  created_at: string | null
}

const AREA_BADGES: Record<string, string> = {
  finance:    'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  board:      'bg-purple-500/15 text-purple-300 border-purple-500/30',
  payments:   'bg-amber-500/15 text-amber-300 border-amber-500/30',
  volunteers: 'bg-saffron-400/15 text-saffron-300 border-saffron-400/30',
  admin:      'bg-blue-500/15 text-blue-300 border-blue-500/30',
  service:    'bg-pink-500/15 text-pink-300 border-pink-500/30',
  infra:      'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  kiosk:      'bg-orange-500/15 text-orange-300 border-orange-500/30',
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

export default function ReleaseNotesPage() {
  const [items, setItems] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [areaFilter, setAreaFilter] = useState('')

  useEffect(() => {
    setLoading(true); setError('')
    const qs = areaFilter ? `?area=${encodeURIComponent(areaFilter)}` : ''
    apiFetch<{ items: Note[]; count: number }>(`/release-notes${qs}`)
      .then(d => setItems(d.items || []))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [areaFilter])

  // Group by released_at date (yyyy-mm-dd) so the list reads as a per-day changelog.
  const groups: Record<string, Note[]> = {}
  for (const n of items) {
    const day = (n.released_at || '').slice(0, 10) || 'undated'
    ;(groups[day] = groups[day] || []).push(n)
  }
  const days = Object.keys(groups).sort().reverse()

  const allAreas = Array.from(new Set(items.map(i => i.area).filter(Boolean))).sort()

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">📋 Release Notes</h1>
          <p className="text-white/40 mt-1">Features shipped per deploy. Sourced from PR descriptions + auto-seeded on every backend startup.</p>
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Area filter */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setAreaFilter('')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${areaFilter === '' ? 'bg-saffron-gradient text-white' : 'bg-white/5 text-white/50 border border-white/10'}`}>
          All ({items.length})
        </button>
        {allAreas.map(a => (
          <button key={a} onClick={() => setAreaFilter(a === areaFilter ? '' : a)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all capitalize ${a === areaFilter ? 'bg-saffron-gradient text-white' : 'bg-white/5 text-white/50 border border-white/10'}`}>
            {a}
          </button>
        ))}
      </div>

      {/* Day-grouped list */}
      {loading && <p className="text-white/40 text-sm">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="text-white/40 text-sm">No release notes yet.</p>
      )}
      {!loading && days.map(day => (
        <div key={day}>
          <h2 className="text-white/60 text-xs font-bold uppercase tracking-widest mb-3">
            {day === 'undated' ? 'Undated' : new Date(day).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
          </h2>
          <div className="space-y-3">
            {groups[day].map((n, i) => (
              <motion.div key={n.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="glass rounded-2xl p-4 sm:p-5">
                <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <h3 className="font-bold text-white">{n.title}</h3>
                    {n.pr_number && (
                      <a href={`https://github.com/kammelaraj-arch/shitaleco/pull/${n.pr_number}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-xs font-mono text-saffron-300 hover:text-saffron-200">
                        #{n.pr_number}
                      </a>
                    )}
                    {n.area && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${AREA_BADGES[n.area] || 'bg-white/10 text-white/60 border-white/15'}`}>
                        {n.area}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-white/30 font-mono">{fmtDate(n.released_at)}</span>
                </div>
                {n.summary && (
                  <p className="text-sm text-white/70 leading-relaxed">{n.summary}</p>
                )}
                {n.tags?.length > 0 && (
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    {n.tags.map(t => (
                      <span key={t} className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-white/40 font-mono">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
