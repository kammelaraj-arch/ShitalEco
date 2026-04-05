import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

const JAI_MESSAGES = [
  'जय श्री कृष्ण', 'Jai Shri Krishna',
  'જય શ્રી કૃષ્ણ', 'Jai Mata Di',
  'ॐ नमः शिवाय', 'Har Har Mahadev',
  'जय श्री राम', 'Jai Shri Ram',
]

export function ClockPanel({ branchName }: { branchName: string }) {
  const [now, setNow] = useState(new Date())
  const [msgIdx, setMsgIdx] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const t = setInterval(() => setMsgIdx(i => (i + 1) % JAI_MESSAGES.length), 3000)
    return () => clearInterval(t)
  }, [])

  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 32,
      padding: '60px 80px 100px',
    }}>
      {/* Om symbol */}
      <motion.div
        animate={{ scale: [1, 1.05, 1], opacity: [0.8, 1, 0.8] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        style={{ fontSize: 120, lineHeight: 1, filter: 'drop-shadow(0 0 40px rgba(255,153,51,0.6))' }}
      >
        🕉️
      </motion.div>

      {/* Temple name */}
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          fontSize: 64, fontWeight: 900, color: '#fff',
          textAlign: 'center', lineHeight: 1.1,
          textShadow: '0 0 60px rgba(185,28,28,0.8)',
        }}
      >
        {branchName}
      </motion.h1>

      {/* Rotating jai message */}
      <motion.div
        key={msgIdx}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0 }}
        style={{
          fontSize: 44, fontWeight: 700,
          background: 'linear-gradient(90deg, #ff9933, #ffd700)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          textAlign: 'center',
        }}
      >
        {JAI_MESSAGES[msgIdx]}
      </motion.div>

      {/* Divider */}
      <div style={{ width: 300, height: 2, background: 'linear-gradient(90deg, transparent, rgba(185,28,28,0.6), transparent)' }} />

      {/* Clock */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: 120, fontWeight: 900, letterSpacing: '0.05em',
          color: '#fff', fontVariantNumeric: 'tabular-nums',
          textShadow: '0 0 80px rgba(255,153,51,0.4)',
          lineHeight: 1,
        }}>
          {time}
        </div>
        <div style={{ fontSize: 36, color: 'rgba(255,255,255,0.5)', marginTop: 16, fontWeight: 500 }}>
          {date}
        </div>
      </div>
    </div>
  )
}
