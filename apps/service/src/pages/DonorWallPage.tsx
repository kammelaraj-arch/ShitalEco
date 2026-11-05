import { useEffect, useState } from 'react'
import { useStore } from '../store'

// Digital donor wall — Future Legacy Appeal recognition.
// Pulls /api/v1/public/donor-wall and renders each tier as its own card
// grid, biggest donors first. Auto-refreshes every 2 minutes so TVs left
// on the page stay current.

interface Entry {
  prefix: string
  dedication: string
  date: string
}
interface Tier {
  key: string
  name: string
  amount: number
  count: number
  items: Entry[]
}
interface WallData {
  tiers: Tier[]
  total_entries: number
}

const TIER_ACCENT: Record<string, { color: string; emoji: string; blurb: string }> = {
  founder: { color: '#e5e4e2', emoji: '💠', blurb: 'The founder panel — those who gave most generously.' },
  gold:    { color: '#d4af37', emoji: '🪔', blurb: 'Gold brick donors.' },
  sqft:    { color: '#f6c454', emoji: '🏛', blurb: 'Square-foot sponsors — each gift clears a piece of our sacred ground.' },
  bronze:  { color: '#cd7f32', emoji: '🧱', blurb: 'Bronze brick donors.' },
  red:     { color: '#c0392b', emoji: '🧱', blurb: 'Red brick donors.' },
  anyamt:  { color: '#9b7a3e', emoji: '🌼', blurb: 'With gratitude for every contribution.' },
}

export function DonorWallPage() {
  const setScreen = useStore(s => s.setScreen)
  const [data, setData] = useState<WallData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const API = (import.meta as any).env?.VITE_API_URL || '/api/v1'
        const r = await fetch(`${API}/public/donor-wall`, { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const d = (await r.json()) as WallData
        if (alive) { setData(d); setError('') }
      } catch (e: any) {
        if (alive) setError(e?.message || 'Could not load wall')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    const iv = setInterval(load, 120_000)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  const tiers = data?.tiers?.filter(t => t.items.length > 0) || []

  return (
    <div className="min-h-screen px-4 py-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <button onClick={() => setScreen('browse')} className="text-xs font-bold opacity-70 hover:opacity-100 mb-2">
              ← Back
            </button>
            <h1 className="text-2xl sm:text-3xl font-black" style={{ fontFamily: 'Georgia, serif' }}>
              🏛 Digital Donor Wall
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              Future Legacy Appeal · Gratitude from Shital Temple
            </p>
          </div>
          <button onClick={() => setScreen('sqft')}
            className="px-5 py-2.5 rounded-xl font-black text-sm"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)', color: '#4a0e18',
                     boxShadow: '0 4px 14px rgba(212,175,55,0.3)' }}>
            Add your name →
          </button>
        </div>

        {loading && (
          <p className="text-center opacity-60 text-sm py-20">Loading the wall…</p>
        )}
        {error && !loading && (
          <p className="text-center text-red-400 text-sm py-20">Could not load the wall. Please try again shortly.</p>
        )}
        {!loading && !error && tiers.length === 0 && (
          <div className="text-center py-20 px-6 rounded-2xl"
            style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(212,175,55,0.2)' }}>
            <div className="text-5xl mb-3">🙏</div>
            <p className="font-black text-lg">Be the first to leave a dedication.</p>
            <p className="text-sm mt-2 opacity-70">
              Sponsor a Square Foot or a Brick, add the name you'd like on the wall,
              and it will appear here after approval.
            </p>
          </div>
        )}

        {tiers.map(t => {
          const accent = TIER_ACCENT[t.key] || TIER_ACCENT.anyamt
          return (
            <section key={t.key} className="mb-10">
              <div className="flex items-end justify-between flex-wrap gap-2 mb-3 pb-2"
                style={{ borderBottom: `1px solid ${accent.color}55` }}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl" aria-hidden>{accent.emoji}</span>
                    <h2 className="text-xl font-black" style={{ color: accent.color, fontFamily: 'Georgia, serif' }}>
                      {t.name}
                    </h2>
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                      style={{ background: `${accent.color}22`, color: accent.color }}>
                      {t.count}
                    </span>
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{accent.blurb}</p>
                </div>
                <p className="text-sm font-black" style={{ color: accent.color }}>
                  £{t.amount.toLocaleString('en-GB')}
                </p>
              </div>
              <div className="grid gap-2"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {t.items.map((e, i) => (
                  <div key={i} className="px-3 py-2 rounded-lg"
                    style={{ background: 'rgba(0,0,0,0.25)',
                             borderLeft: `3px solid ${accent.color}` }}>
                    {e.prefix && (
                      <div className="text-[10px] italic opacity-70">{e.prefix}</div>
                    )}
                    <div className="text-sm font-bold leading-tight">{e.dedication}</div>
                  </div>
                ))}
              </div>
            </section>
          )
        })}

        {data && data.total_entries > 0 && (
          <p className="text-center text-xs opacity-50 mt-10 pb-6">
            {data.total_entries} dedication{data.total_entries === 1 ? '' : 's'} · Jay Shri Krishna 🙏
          </p>
        )}
      </div>
    </div>
  )
}
