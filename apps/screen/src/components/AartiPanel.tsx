import { motion } from 'framer-motion'

const AARTI_TIMES = [
  { name: 'Mangala Aarti',   time: '06:30', icon: '🌅', desc: 'Morning awakening prayer' },
  { name: 'Shangar Aarti',   time: '08:00', icon: '🌸', desc: 'Decoration & adornment ritual' },
  { name: 'Raj Bhog Aarti',  time: '11:45', icon: '☀️', desc: 'Midday offering to the deity' },
  { name: 'Utthapan Aarti',  time: '16:00', icon: '🌤️', desc: 'Afternoon awakening ceremony' },
  { name: 'Sandhya Aarti',   time: '18:30', icon: '🌆', desc: 'Evening lamp ritual' },
  { name: 'Shayan Aarti',    time: '21:00', icon: '🌙', desc: 'Night resting ceremony' },
]

function isCurrentOrNext(time: string): 'current' | 'next' | 'past' | 'future' {
  const now = new Date()
  const [h, m] = time.split(':').map(Number)
  const slotMins = h * 60 + m
  const nowMins = now.getHours() * 60 + now.getMinutes()
  if (Math.abs(slotMins - nowMins) < 30) return 'current'
  if (slotMins > nowMins && slotMins - nowMins < 120) return 'next'
  if (slotMins < nowMins) return 'past'
  return 'future'
}

export function AartiPanel() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      padding: '50px 80px 100px', gap: 36,
    }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 52, fontWeight: 900, color: '#fff', marginBottom: 8 }}>
          🪔 Aarti & Prayer Times
        </h2>
        <p style={{ fontSize: 28, color: 'rgba(255,255,255,0.4)' }}>
          Daily darshan schedule
        </p>
      </motion.div>

      {/* Aarti grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 24, flex: 1,
      }}>
        {AARTI_TIMES.map((a, i) => {
          const status = isCurrentOrNext(a.time)
          const isCurrent = status === 'current'
          const isNext = status === 'next'
          const isPast = status === 'past'
          return (
            <motion.div
              key={a.name}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.08 }}
              style={{
                borderRadius: 24,
                padding: '28px 28px',
                display: 'flex', flexDirection: 'column', gap: 12,
                position: 'relative', overflow: 'hidden',
                background: isCurrent
                  ? 'linear-gradient(135deg, rgba(185,28,28,0.35), rgba(255,153,51,0.2))'
                  : isNext
                  ? 'rgba(255,153,51,0.08)'
                  : 'rgba(255,255,255,0.03)',
                border: isCurrent
                  ? '2px solid rgba(255,153,51,0.6)'
                  : isNext
                  ? '1px solid rgba(255,153,51,0.25)'
                  : '1px solid rgba(255,255,255,0.07)',
                opacity: isPast ? 0.4 : 1,
              }}
            >
              {isCurrent && (
                <motion.div
                  animate={{ opacity: [0.4, 0.8, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  style={{
                    position: 'absolute', top: 16, right: 16,
                    width: 14, height: 14, borderRadius: '50%',
                    background: '#ff9933',
                    boxShadow: '0 0 12px #ff9933',
                  }}
                />
              )}
              <div style={{ fontSize: 52 }}>{a.icon}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: '#fff' }}>{a.name}</div>
              <div style={{
                fontSize: 44, fontWeight: 900,
                color: isCurrent ? '#ff9933' : isNext ? '#ffd700' : 'rgba(255,255,255,0.5)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {a.time}
              </div>
              <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.4)' }}>{a.desc}</div>
              {isCurrent && (
                <div style={{
                  fontSize: 18, fontWeight: 700, color: '#ff9933',
                  background: 'rgba(255,153,51,0.15)', padding: '6px 14px',
                  borderRadius: 8, alignSelf: 'flex-start',
                }}>
                  NOW
                </div>
              )}
              {isNext && (
                <div style={{
                  fontSize: 18, fontWeight: 700, color: '#ffd700',
                  background: 'rgba(255,215,0,0.1)', padding: '6px 14px',
                  borderRadius: 8, alignSelf: 'flex-start',
                }}>
                  NEXT
                </div>
              )}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
