import React from 'react'
import QRCode from 'qrcode.react'
import { useKioskStore, THEMES } from '../store/kiosk.store'

const SERVICE_URL = import.meta.env.VITE_SERVICE_URL || 'https://service.shital.org.uk'

export function MonthlyGivingScreen() {
  const { setScreen, theme, branchId } = useKioskStore()
  const th = THEMES[theme]

  const serviceUrl = `${SERVICE_URL}/?screen=monthly-giving&branch=${encodeURIComponent(branchId)}`

  return (
    <div className="w-full h-full flex flex-col" style={{ fontFamily: 'Inter, system-ui, sans-serif', background: th.mainBg }}>

      {/* Header — kiosk back button + title.
          The service portal's own header is hidden when embedded in an
          iframe (Header.tsx isEmbedded check), so this is the only
          "Monthly Temple Support" bar a user sees. */}
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

      {/* QR code — moved to TOP of the iframe so it's the first thing the
          devotee sees (more discoverable than at the bottom of a long
          embedded form). Compact: 70px QR + tagline. */}
      <div
        className="flex-shrink-0 flex items-center gap-4 px-5 py-2.5"
        style={{ background: '#fff', borderBottom: `2px solid ${th.langActive}30` }}
      >
        <div className="p-1.5 bg-white rounded-lg border border-gray-200 flex-shrink-0">
          <QRCode value={serviceUrl} size={70} level="M" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm text-gray-800 leading-tight">Prefer to use your phone?</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-snug">
            Scan to continue securely on your device — branch pre-selected.
          </p>
          <p className="text-[11px] text-gray-400 mt-1 truncate">
            <span className="font-bold" style={{ color: th.langActive }}>service.shital.org.uk</span>
          </p>
        </div>
      </div>

      {/* Embedded service.shital.org.uk monthly-giving page (branch pre-selected).
          Service portal's Header.tsx auto-hides when window.self !== window.top
          so there's only one header on screen (the kiosk one above). */}
      <div className="flex-1 min-h-0 bg-white">
        <iframe
          title="Monthly Giving"
          src={serviceUrl}
          className="w-full h-full border-0"
          allow="payment *; clipboard-write"
        />
      </div>
    </div>
  )
}
