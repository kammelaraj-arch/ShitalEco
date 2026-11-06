import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'

// Live Darshan — real-time stream of the murthy from the main temple.
// If a live feed isn't being broadcast, we fall back to a still of Baba
// so the screen is never empty.
//
// Stream contract: GET /api/v1/public/darshan/{branchId}
//   200 { url: '<hls or mp4 url>', status: 'live' | 'offline', poster?: string }
//   404 → treat as offline
//
// Native <video> handles HLS on Safari and MP4 everywhere; we don't ship
// hls.js yet. If the backend endpoint isn't wired, the page shows the
// fallback immediately — that's the default experience for every branch.

const BABA_FALLBACK_URL =
  'https://admin.shital.org.uk/api/v1/media/library/00a4a66d-d25b-4195-8d33-57b1f2853f63'

interface DarshanFeed {
  url: string
  status: 'live' | 'offline'
  poster?: string
}

export function DarshanPage() {
  const setScreen = useStore(s => s.setScreen)
  const branchId = useStore(s => s.branchId)
  const branchName = useStore(s => s.branchName)

  const [feed, setFeed] = useState<DarshanFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [videoFailed, setVideoFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const API = (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL || '/api/v1'
        const slug = branchId || 'any'
        const r = await fetch(`${API}/public/darshan/${encodeURIComponent(slug)}`, { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const d = (await r.json()) as DarshanFeed
        if (alive) { setFeed(d.status === 'live' && d.url ? d : null); setVideoFailed(false) }
      } catch {
        if (alive) setFeed(null)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    // Re-check every 60s so a stream that comes online mid-visit shows up.
    const iv = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(iv) }
  }, [branchId])

  const isLive = Boolean(feed && !videoFailed)

  return (
    <div className="min-h-screen px-4 py-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="max-w-5xl mx-auto">
        <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
          <div>
            <button onClick={() => setScreen('browse')} className="text-xs font-bold opacity-70 hover:opacity-100 mb-2">
              ← Back
            </button>
            <h1 className="text-2xl sm:text-3xl font-black" style={{ fontFamily: 'Georgia, serif' }}>
              🕉 Live Darshan
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              {branchName ? `${branchName} · ` : ''}Watch the murthy from wherever you are.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest"
            style={{
              background: isLive ? 'rgba(220,38,38,0.18)' : 'rgba(255,255,255,0.08)',
              color: isLive ? '#F87171' : 'var(--text-muted)',
              border: `1px solid ${isLive ? 'rgba(220,38,38,0.55)' : 'rgba(255,255,255,0.18)'}`,
            }}>
            <span className="w-2 h-2 rounded-full" style={{
              background: isLive ? '#EF4444' : '#9CA3AF',
              boxShadow: isLive ? '0 0 10px #EF4444' : 'none',
              animation: isLive ? 'pulse 1.6s ease-in-out infinite' : 'none',
            }} />
            {isLive ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        <div className="relative rounded-2xl overflow-hidden"
          style={{
            background: '#000',
            border: '1px solid rgba(246,196,84,0.35)',
            boxShadow: '0 12px 44px rgba(0,0,0,0.55)',
            aspectRatio: '16 / 9',
          }}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-sm opacity-70">
              Connecting to the temple…
            </div>
          )}

          {!loading && isLive && feed && (
            <video
              ref={videoRef}
              src={feed.url}
              poster={feed.poster || BABA_FALLBACK_URL}
              autoPlay
              playsInline
              controls
              muted
              onError={() => setVideoFailed(true)}
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}

          {!loading && !isLive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
              <img
                src={BABA_FALLBACK_URL}
                alt="Shri Shirdi Sai Baba"
                className="w-40 h-40 sm:w-52 sm:h-52 rounded-full object-cover mb-5"
                style={{ border: '3px solid rgba(246,196,84,0.65)', boxShadow: '0 8px 28px rgba(0,0,0,0.5)' }}
              />
              <p className="font-black text-lg sm:text-xl mb-2" style={{ fontFamily: 'Georgia, serif', color: '#F6C454' }}>
                Darshan is not live right now
              </p>
              <p className="text-sm opacity-75 max-w-md">
                Baba is with you. The next aarti stream will appear here automatically — this page
                re-checks every minute.
              </p>
            </div>
          )}
        </div>

        <p className="text-[11px] opacity-60 mt-3 text-center">
          Live stream times usually follow aarti: morning 6:00 · evening 7:00 (UK).
          Mute/unmute the player if your device is set to silent.
        </p>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(1.22); }
        }
      `}</style>
    </div>
  )
}
