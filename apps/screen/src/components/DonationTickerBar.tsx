import { useEffect, useRef, useState } from 'react'
import type { Order } from '../App'

// Fallback ticker messages when no live orders
const FALLBACK_TICKERS = [
  '🙏 Thank you to all our generous donors',
  '🪔 Your seva supports the temple community',
  '💛 Every donation makes a difference',
  '🌸 May your blessings multiply a thousandfold',
  '🕉 Jai Shri Krishna — thank you for your generosity',
]

function formatOrder(order: Order): string {
  const name = order.customer_name || 'Anonymous'
  const items = order.items?.map(i => i.name).join(', ') || 'donation'
  return `💛 ${name} donated £${order.total} — ${items}`
}

export function DonationTickerBar({ orders }: { orders: Order[] }) {
  const tickerRef = useRef<HTMLDivElement>(null)
  const [messages, setMessages] = useState<string[]>(FALLBACK_TICKERS)

  useEffect(() => {
    const msgs = orders.length > 0
      ? orders.map(formatOrder)
      : FALLBACK_TICKERS
    setMessages(msgs)
  }, [orders])

  // Duplicate for seamless loop
  const combined = [...messages, ...messages]

  return (
    <div style={{
      position: 'absolute',
      bottom: 50,
      left: 0,
      right: 0,
      height: 52,
      background: 'rgba(185,28,28,0.85)',
      borderTop: '1px solid rgba(255,153,51,0.3)',
      borderBottom: '1px solid rgba(255,153,51,0.3)',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
    }}>
      {/* "LIVE" badge */}
      <div style={{
        flexShrink: 0,
        padding: '0 20px',
        height: '100%',
        display: 'flex', alignItems: 'center',
        background: 'rgba(255,153,51,0.9)',
        fontSize: 18, fontWeight: 900, color: '#000',
        letterSpacing: '0.1em',
        zIndex: 1,
      }}>
        SEVA
      </div>

      {/* Scrolling text */}
      <div style={{ overflow: 'hidden', flex: 1 }}>
        <div
          ref={tickerRef}
          style={{
            display: 'flex', gap: 80, whiteSpace: 'nowrap',
            animation: 'ticker 40s linear infinite',
            paddingLeft: 40,
          }}
        >
          {combined.map((msg, i) => (
            <span key={i} style={{ fontSize: 22, color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>
              {msg}
              <span style={{ marginLeft: 80, color: 'rgba(255,153,51,0.5)' }}>✦</span>
            </span>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes ticker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  )
}
