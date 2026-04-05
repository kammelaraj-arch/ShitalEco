import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { ClockPanel } from './components/ClockPanel'
import { ServicesPanel } from './components/ServicesPanel'
import { DonationTickerBar } from './components/DonationTickerBar'
import { AartiPanel } from './components/AartiPanel'
import { AnnouncementsPanel } from './components/AnnouncementsPanel'
import { DonateQRPanel } from './components/DonateQRPanel'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CatalogItem {
  id: string
  name: string
  category: string
  price: number
  emoji: string
  description: string
}

export interface Order {
  id: string
  total: number
  customer_name: string
  created_at: string
  items: { name: string; qty: number }[]
}

export interface ScreenData {
  items: CatalogItem[]
  recentOrders: Order[]
  branchName: string
}

const API = (import.meta as any).env?.VITE_API_URL || '/api/v1'
const DONATE_URL = (import.meta as any).env?.VITE_DONATE_URL || 'https://shital.org.uk/donate'

// ── Slide definitions ─────────────────────────────────────────────────────────

const SLIDES = ['clock', 'services', 'aarti', 'announcements', 'donate'] as const
type Slide = typeof SLIDES[number]
const SLIDE_DURATION = 12000 // 12 seconds per slide

// ── Ambient particles ─────────────────────────────────────────────────────────

function Particle({ i }: { i: number }) {
  const x = (i * 137.5) % 100
  const delay = (i * 0.7) % 8
  const size = 2 + (i % 3)
  const dur = 15 + (i % 10)
  return (
    <motion.div
      style={{
        position: 'absolute',
        left: `${x}%`,
        bottom: '-10px',
        width: size,
        height: size,
        borderRadius: '50%',
        background: i % 3 === 0 ? 'rgba(255,153,51,0.6)' : i % 3 === 1 ? 'rgba(185,28,28,0.5)' : 'rgba(255,215,0,0.4)',
        pointerEvents: 'none',
      }}
      animate={{ y: [0, -900], opacity: [0, 0.8, 0] }}
      transition={{ duration: dur, delay, repeat: Infinity, ease: 'linear' }}
    />
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [slide, setSlide] = useState<Slide>('clock')
  const [slideIdx, setSlideIdx] = useState(0)
  const [data, setData] = useState<ScreenData>({ items: [], recentOrders: [], branchName: 'Shital Hindu Temple' })
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Fetch live data every 60 s ─────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const [itemsRes] = await Promise.allSettled([
        fetch(`${API}/kiosk/catalog?branch_id=main&limit=20`).then(r => r.json()),
      ])
      const items = itemsRes.status === 'fulfilled' ? (itemsRes.value?.items || []) : []
      setData(prev => ({ ...prev, items }))
    } catch { /* ignore — display continues without live data */ }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60_000)
    return () => clearInterval(interval)
  }, [fetchData])

  // ── Auto-advance slides ────────────────────────────────────────────────────
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSlideIdx(i => {
        const next = (i + 1) % SLIDES.length
        setSlide(SLIDES[next])
        return next
      })
    }, SLIDE_DURATION)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  return (
    <div style={{
      width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative',
      background: 'linear-gradient(160deg, #0a0008 0%, #12000e 40%, #0d0005 100%)',
    }}>
      {/* Ambient particles */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {Array.from({ length: 20 }, (_, i) => <Particle key={i} i={i} />)}
      </div>

      {/* Decorative top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 6,
        background: 'linear-gradient(90deg, #b91c1c, #ff9933, #ffd700, #ff9933, #b91c1c)',
      }} />

      {/* Main slide content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={slide}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          transition={{ duration: 0.8, ease: 'easeInOut' }}
          style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}
        >
          {slide === 'clock'         && <ClockPanel branchName={data.branchName} />}
          {slide === 'services'      && <ServicesPanel items={data.items} />}
          {slide === 'aarti'         && <AartiPanel />}
          {slide === 'announcements' && <AnnouncementsPanel />}
          {slide === 'donate'        && <DonateQRPanel donateUrl={DONATE_URL} />}
        </motion.div>
      </AnimatePresence>

      {/* Donation ticker bar — always visible at bottom */}
      <DonationTickerBar orders={data.recentOrders} />

      {/* Slide dots */}
      <div style={{
        position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 10,
      }}>
        {SLIDES.map((s, i) => (
          <div key={s} style={{
            width: i === slideIdx ? 32 : 8,
            height: 8,
            borderRadius: 4,
            background: i === slideIdx ? '#ff9933' : 'rgba(255,255,255,0.2)',
            transition: 'all 0.4s ease',
          }} />
        ))}
      </div>

      {/* Bottom bar: temple name + time */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: 50,
        background: 'rgba(0,0,0,0.7)',
        borderTop: '1px solid rgba(185,28,28,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 40px',
      }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18 }}>
          🕉 {data.branchName}
        </span>
        <span style={{ color: 'rgba(255,153,51,0.6)', fontSize: 18 }}>
          shital.org.uk
        </span>
      </div>
    </div>
  )
}
