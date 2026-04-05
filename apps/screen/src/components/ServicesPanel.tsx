import { motion } from 'framer-motion'
import type { CatalogItem } from '../App'

const CATEGORY_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  GENERAL_DONATION: { label: 'General Donation', color: '#ffd700', bg: 'rgba(255,215,0,0.1)' },
  SOFT_DONATION:    { label: 'Food Donation',    color: '#86efac', bg: 'rgba(134,239,172,0.1)' },
  PROJECT_DONATION: { label: 'Project',           color: '#93c5fd', bg: 'rgba(147,197,253,0.1)' },
  SHOP:             { label: 'Puja Items',        color: '#fca5a5', bg: 'rgba(252,165,165,0.1)' },
  SPONSORSHIP:      { label: 'Sponsorship',       color: '#c4b5fd', bg: 'rgba(196,181,253,0.1)' },
}

const FALLBACK_ITEMS: CatalogItem[] = [
  { id: '1', name: 'General Donation',  category: 'GENERAL_DONATION', price: 5,   emoji: '🙏', description: '' },
  { id: '2', name: 'Maha Puja £51',     category: 'GENERAL_DONATION', price: 51,  emoji: '🪔', description: '' },
  { id: '3', name: 'Swarna Dan £101',   category: 'GENERAL_DONATION', price: 101, emoji: '✨', description: '' },
  { id: '4', name: 'Rice Bag 10kg',     category: 'SOFT_DONATION',    price: 15,  emoji: '🌾', description: '' },
  { id: '5', name: 'Festival Sponsor',  category: 'SPONSORSHIP',      price: 51,  emoji: '📖', description: '' },
  { id: '6', name: 'Coconut',           category: 'SHOP',             price: 1,   emoji: '🥥', description: '' },
  { id: '7', name: 'Incense Sticks',    category: 'SHOP',             price: 3,   emoji: '🕯️', description: '' },
  { id: '8', name: 'Gold Brick £51',    category: 'PROJECT_DONATION', price: 51,  emoji: '🧱', description: '' },
]

export function ServicesPanel({ items }: { items: CatalogItem[] }) {
  const display = items.length > 0 ? items.slice(0, 12) : FALLBACK_ITEMS

  // Group by category
  const grouped: Record<string, CatalogItem[]> = {}
  for (const item of display) {
    const cat = item.category || 'OTHER'
    ;(grouped[cat] = grouped[cat] || []).push(item)
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      padding: '50px 80px 100px', gap: 32,
    }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 52, fontWeight: 900, color: '#fff', marginBottom: 8 }}>
          🙏 Seva & Donations
        </h2>
        <p style={{ fontSize: 28, color: 'rgba(255,255,255,0.4)' }}>
          Visit the kiosk to donate — all donations gift-aid eligible
        </p>
      </motion.div>

      {/* Items grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 20,
        flex: 1,
      }}>
        {display.map((item, i) => {
          const cat = CATEGORY_LABELS[item.category] || { label: item.category, color: '#fff', bg: 'rgba(255,255,255,0.05)' }
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.06 }}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 20,
                padding: '24px 20px',
                display: 'flex', flexDirection: 'column', gap: 10,
              }}
            >
              <div style={{ fontSize: 48 }}>{item.emoji || '🙏'}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                {item.name}
              </div>
              <div style={{
                fontSize: 32, fontWeight: 900, color: '#ff9933',
              }}>
                £{item.price}
              </div>
              <div style={{
                fontSize: 16, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
                background: cat.bg, color: cat.color, alignSelf: 'flex-start',
              }}>
                {cat.label}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
