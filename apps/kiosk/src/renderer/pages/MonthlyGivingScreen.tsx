import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import QRCode from 'qrcode.react'
import { useKioskStore, THEMES } from '../store/kiosk.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'
const SERVICE_URL = import.meta.env.VITE_SERVICE_URL || 'https://service.shital.org.uk'

interface GivingTier {
  id: string
  amount: number
  label: string
  description: string
  frequency: string
  is_default: boolean
  display_order: number
}

export function MonthlyGivingScreen() {
  const { setScreen, theme, branchId } = useKioskStore()
  const th = THEMES[theme]

  const [tiers, setTiers] = useState<GivingTier[]>([])
  const [selected, setSelected] = useState<GivingTier | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_BASE}/service/giving/tiers`)
      .then(r => r.ok ? r.json() : { tiers: [] })
      .then(d => {
        setTiers(d.tiers ?? [])
        const def = d.tiers?.find((t: GivingTier) => t.is_default) ?? d.tiers?.[0]
        if (def) setSelected(def)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const qrUrl = `${SERVICE_URL}/?screen=monthly-giving${selected ? `&tier=${selected.id}` : ''}&branch=${branchId}`

  return (
    <div className="w-full h-full flex flex-col" style={{ fontFamily: 'Inter, system-ui, sans-serif', background: th.mainBg }}>

      {/* Header */}
      <header
        className="flex items-center h-16 px-4 gap-3 flex-shrink-0"
        style={{ background: th.headerBg, borderBottom: `2px solid rgba(255,153,51,0.25)`, boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}
      >
        <button
          onClick={() => setScreen('home')}
          className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg active:scale-95"
          style={{ background: `${th.langActive}20`, color: th.headerText }}
        >←</button>
        <div className="flex-1">
          <h1 className="font-black text-base leading-tight" style={{ color: th.headerText }}>Monthly Temple Support</h1>
          <p className="text-xs" style={{ color: th.headerSub }}>Regular giving from just £5/month</p>
        </div>
        <div className="text-2xl">🔁</div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5" style={{ scrollbarWidth: 'none' }}>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }} className="text-4xl">🕉</motion.div>
            <p className="text-sm text-gray-400">Loading…</p>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

            {/* Tier selection */}
            <div>
              <p className="text-xs font-bold uppercase tracking-widest mb-3 text-gray-500">Choose your monthly amount</p>
              <div className="grid grid-cols-2 gap-3">
                {tiers.map(tier => (
                  <button
                    key={tier.id}
                    onClick={() => setSelected(tier)}
                    className="rounded-2xl p-4 text-left transition-all active:scale-[0.97] border-2"
                    style={{
                      background: selected?.id === tier.id ? `${th.langActive}18` : '#fff',
                      borderColor: selected?.id === tier.id ? th.langActive : '#e5e7eb',
                      boxShadow: selected?.id === tier.id ? `0 4px 16px ${th.langActive}30` : undefined,
                    }}
                  >
                    {tier.is_default && (
                      <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full mb-2 inline-block"
                        style={{ background: `${th.langActive}25`, color: th.langActive }}>Popular</span>
                    )}
                    <p className="font-black text-2xl" style={{ color: th.langActive }}>£{Number(tier.amount).toFixed(0)}</p>
                    <p className="text-xs font-bold text-gray-800 mt-0.5">{tier.label}</p>
                    <p className="text-xs mt-1 text-gray-400">{tier.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* QR Code section */}
            <div className="rounded-2xl border-2 p-5 text-center"
              style={{ background: '#fff', borderColor: `${th.langActive}30` }}>
              <p className="font-black text-base text-gray-800 mb-1">Scan to set up monthly giving</p>
              <p className="text-xs text-gray-400 mb-4">
                Use your phone to set up a secure PayPal subscription
                {selected && ` — £${Number(selected.amount).toFixed(0)}/month`}
              </p>

              <div className="flex justify-center mb-4">
                <div className="p-3 bg-white rounded-2xl shadow-md border border-gray-100">
                  <QRCode value={qrUrl} size={180} level="M" />
                </div>
              </div>

              <p className="text-xs text-gray-400">
                Or visit <span className="font-bold" style={{ color: th.langActive }}>service.shital.org.uk</span>
              </p>
            </div>

            {/* Benefits list */}
            <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-3">
              <p className="font-black text-sm text-gray-800">Why give monthly?</p>
              {[
                { icon: '🙏', text: 'Supports daily temple operations & services' },
                { icon: '🔁', text: 'Cancel anytime through your PayPal account' },
                { icon: '🔒', text: 'Secure recurring payment via PayPal' },
                { icon: '📧', text: 'Get a receipt emailed to you each month' },
              ].map(({ icon, text }) => (
                <div key={text} className="flex items-center gap-3 text-sm text-gray-600">
                  <span className="text-lg flex-shrink-0">{icon}</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>

          </motion.div>
        )}
      </div>
    </div>
  )
}
