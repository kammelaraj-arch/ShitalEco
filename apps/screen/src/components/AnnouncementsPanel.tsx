import { motion } from 'framer-motion'

// In future: pull from backend API. For now, static with graceful data.
const ANNOUNCEMENTS = [
  {
    icon: '🎉',
    title: 'Navratri Celebrations',
    body: 'Join us for 9 nights of Garba, Aarti and Prasad. All are welcome.',
    color: '#ffd700',
  },
  {
    icon: '🍲',
    title: 'Sunday Langar',
    body: 'Free community meal every Sunday after Sandhya Aarti. Volunteers welcome.',
    color: '#86efac',
  },
  {
    icon: '📚',
    title: 'Bal Mandal Classes',
    body: 'Children\'s religious and cultural classes every Saturday 10am–12pm.',
    color: '#93c5fd',
  },
  {
    icon: '🏗️',
    title: 'Temple Expansion Project',
    body: 'Help build our new prayer hall. Donate a brick from £1 at the kiosk.',
    color: '#c4b5fd',
  },
]

export function AnnouncementsPanel() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      padding: '50px 80px 100px', gap: 36,
    }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 52, fontWeight: 900, color: '#fff', marginBottom: 8 }}>
          📢 Temple Notices
        </h2>
        <p style={{ fontSize: 28, color: 'rgba(255,255,255,0.4)' }}>
          Events & Community Updates
        </p>
      </motion.div>

      {/* Announcements */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, justifyContent: 'center' }}>
        {ANNOUNCEMENTS.map((a, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.12 }}
            style={{
              display: 'flex', gap: 28, alignItems: 'center',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderLeft: `4px solid ${a.color}`,
              borderRadius: '0 20px 20px 0',
              padding: '24px 32px',
            }}
          >
            <div style={{ fontSize: 52, flexShrink: 0 }}>{a.icon}</div>
            <div>
              <div style={{ fontSize: 30, fontWeight: 800, color: a.color, marginBottom: 6 }}>
                {a.title}
              </div>
              <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>
                {a.body}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
