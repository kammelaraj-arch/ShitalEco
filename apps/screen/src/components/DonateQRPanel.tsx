import { motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'

export function DonateQRPanel({ donateUrl }: { donateUrl: string }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '60px 80px 110px', gap: 40,
    }}>
      <motion.h2
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ fontSize: 56, fontWeight: 900, color: '#fff', textAlign: 'center' }}
      >
        🙏 Donate Online
      </motion.h2>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        style={{ fontSize: 30, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}
      >
        Scan the QR code with your phone to donate instantly
      </motion.p>

      <div style={{ display: 'flex', gap: 80, alignItems: 'center', marginTop: 20 }}>
        {/* QR code */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4, type: 'spring', stiffness: 200 }}
          style={{
            padding: 28,
            background: '#fff',
            borderRadius: 28,
            boxShadow: '0 0 80px rgba(255,153,51,0.4)',
          }}
        >
          <QRCodeSVG
            value={donateUrl}
            size={280}
            bgColor="#ffffff"
            fgColor="#0a0008"
            level="M"
          />
        </motion.div>

        {/* Info */}
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
          style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 500 }}
        >
          {[
            { icon: '💳', text: 'Card, Apple Pay, Google Pay accepted' },
            { icon: '🇬🇧', text: 'Gift Aid — we claim 25p per £1 for UK taxpayers' },
            { icon: '🔒', text: 'Secure payments via Stripe' },
            { icon: '🧾', text: 'Instant email receipt' },
          ].map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.6 + i * 0.1 }}
              style={{ display: 'flex', gap: 20, alignItems: 'center' }}
            >
              <span style={{ fontSize: 44 }}>{item.icon}</span>
              <span style={{ fontSize: 26, color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>
                {item.text}
              </span>
            </motion.div>
          ))}

          <div style={{
            marginTop: 12,
            padding: '16px 24px',
            borderRadius: 16,
            background: 'rgba(255,153,51,0.1)',
            border: '1px solid rgba(255,153,51,0.3)',
          }}>
            <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Or visit</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#ff9933' }}>{donateUrl}</div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
