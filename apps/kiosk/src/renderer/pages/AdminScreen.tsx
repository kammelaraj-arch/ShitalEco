import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { useKioskStore, EndScreenTemplate, FormTextConfig } from '../store/kiosk.store'
import { clearKioskCache } from '../utils/cachedFetch'

const ICON_PRESETS = ['🕉', '🙏', '🪔', '✨', '🌸', '☀️', '🌺', '🕊️']

export function AdminScreen() {
  const { setScreen, endScreenTemplate, setEndScreenTemplate, formTextConfig, setFormTextConfig, branchId, cardProvider, stripeReaderLabel, squareDeviceName } = useKioskStore()

  const [tab, setTab] = useState<'endscreen' | 'formtext' | 'device'>('endscreen')
  const [draft, setDraft] = useState<EndScreenTemplate>({ ...endScreenTemplate })
  const [textDraft, setTextDraft] = useState<FormTextConfig>({ ...formTextConfig })
  const [saved, setSaved] = useState(false)

  function handleSave() {
    setEndScreenTemplate(draft)
    setFormTextConfig(textDraft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="w-full h-full flex flex-col bg-gray-50"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0 bg-gray-900 text-white">
        <button
          onClick={() => setScreen('home')}
          className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center font-bold text-lg active:scale-90">
          ←
        </button>
        <div className="flex-1">
          <h1 className="font-black text-base">⚙️ Admin Settings</h1>
          <p className="text-gray-400 text-xs">Kiosk configuration</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 flex-shrink-0 border-b border-gray-200 bg-white">
        {(['endscreen', 'formtext', 'device'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-3 text-xs font-bold transition-colors"
            style={{ color: tab === t ? '#FF9933' : '#6b7280', borderBottom: tab === t ? '3px solid #FF9933' : '3px solid transparent' }}>
            {t === 'endscreen' ? '🎉 End Screen' : t === 'formtext' ? '📝 Form Text' : '⚙️ Device'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5">

        {tab === 'endscreen' && (
          <div className="space-y-5 max-w-lg">
            <div>
              <p className="text-xs font-black text-gray-500 uppercase tracking-wide mb-3">Preview</p>
              <div className="bg-white rounded-2xl border border-gray-200 px-6 py-5 text-center shadow-sm">
                <div className="text-5xl mb-2">{draft.icon}</div>
                <div className="inline-block px-4 py-1 rounded-full text-xs font-black text-white mb-2"
                  style={{ background: 'linear-gradient(135deg,#22C55E,#16A34A)' }}>
                  ✓ Payment Confirmed
                </div>
                <p className="font-black text-gray-900 text-lg">Thank you, Guest!</p>
                <p className="font-black" style={{ color: '#FF9933' }}>{draft.thankYouLine}</p>
                {draft.subMessage && <p className="text-gray-500 text-sm mt-1">{draft.subMessage}</p>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-black text-gray-700 mb-2">Icon</label>
              <div className="flex gap-2 flex-wrap mb-2">
                {ICON_PRESETS.map(ic => (
                  <button key={ic} onClick={() => setDraft(d => ({ ...d, icon: ic }))}
                    className="w-11 h-11 rounded-xl text-2xl flex items-center justify-center border-2 transition-all active:scale-90"
                    style={{ borderColor: draft.icon === ic ? '#FF9933' : '#e5e7eb', background: draft.icon === ic ? '#fff7ed' : '#fff' }}>
                    {ic}
                  </button>
                ))}
              </div>
              <input
                value={draft.icon}
                onChange={e => setDraft(d => ({ ...d, icon: e.target.value }))}
                placeholder="or type any emoji"
                className="w-full border-2 rounded-xl px-4 py-2.5 text-base focus:outline-none bg-white"
                style={{ borderColor: '#e5e7eb' }}
              />
            </div>

            <div>
              <label className="block text-sm font-black text-gray-700 mb-2">Thank You Line</label>
              <input
                value={draft.thankYouLine}
                onChange={e => setDraft(d => ({ ...d, thankYouLine: e.target.value }))}
                placeholder="e.g. Jay Shri Krishna 🙏"
                className="w-full border-2 rounded-xl px-4 py-3 text-base focus:outline-none bg-white"
                style={{ borderColor: '#e5e7eb' }}
              />
            </div>

            <div>
              <label className="block text-sm font-black text-gray-700 mb-2">
                Sub Message <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                value={draft.subMessage}
                onChange={e => setDraft(d => ({ ...d, subMessage: e.target.value }))}
                placeholder="e.g. Your donation blesses all beings"
                className="w-full border-2 rounded-xl px-4 py-3 text-base focus:outline-none bg-white"
                style={{ borderColor: '#e5e7eb' }}
              />
            </div>

            <button
              onClick={handleSave}
              className="w-full py-4 rounded-2xl text-white font-black text-base shadow-lg active:scale-[0.98] transition-all"
              style={{ background: saved ? '#16a34a' : '#FF9933' }}>
              {saved ? '✓ Saved!' : 'Save End Screen'}
            </button>
          </div>
        )}

        {tab === 'formtext' && (
          <div className="space-y-4 max-w-lg">
            {[
              { key: 'noFormHeading',  label: 'No Gift Aid — Heading' },
              { key: 'noFormSub',      label: 'No Gift Aid — Sub Text' },
              { key: 'anonymousLabel', label: 'Anonymous Checkbox Label' },
              { key: 'anonymousSub',   label: 'Anonymous Checkbox Sub' },
              { key: 'nameLabel',      label: 'Name Field Label' },
              { key: 'emailLabel',     label: 'Email Field Label' },
              { key: 'phoneLabel',     label: 'Phone Field Label' },
              { key: 'gdprTitle',      label: 'GDPR Box Title' },
              { key: 'gdprText',       label: 'GDPR Text' },
              { key: 'termsTitle',     label: 'T&C Box Title' },
              { key: 'termsText',      label: 'T&C Text' },
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
                <textarea
                  value={(textDraft as unknown as Record<string, string>)[key]}
                  onChange={e => setTextDraft(d => ({ ...d, [key]: e.target.value }))}
                  rows={key.endsWith('Text') ? 3 : 1}
                  className="w-full border-2 rounded-xl px-3 py-2 text-sm focus:outline-none bg-white resize-none"
                  style={{ borderColor: '#e5e7eb' }}
                />
              </div>
            ))}
          </div>
        )}

        {tab === 'device' && (
          <div className="space-y-4 max-w-lg">
            <div className="bg-white border border-gray-200 rounded-2xl px-4 py-4">
              <p className="text-sm font-black text-gray-700 mb-3">Device Info</p>
              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex justify-between">
                  <span className="text-gray-400">Branch</span>
                  <span className="font-bold capitalize">
                    {branchId === 'main' ? 'Wembley' : branchId === 'leicester' ? 'Leicester' : branchId === 'reading' ? 'Reading' : branchId === 'mk' ? 'Milton Keynes' : branchId}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Payment</span>
                  <span className="font-bold capitalize">{cardProvider.replace('_', ' ')}</span>
                </div>
                {cardProvider === 'stripe_terminal' && stripeReaderLabel && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Terminal</span>
                    <span className="font-bold">{stripeReaderLabel}</span>
                  </div>
                )}
                {cardProvider === 'square' && squareDeviceName && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Square Device</span>
                    <span className="font-bold">{squareDeviceName}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm text-amber-800">
              <p className="font-bold mb-1">ℹ️ Branch & Device Setup</p>
              <p className="text-xs">Branch assignment and payment terminal configuration are set at device profile level and cannot be changed here.</p>
            </div>
            <ClearCacheButton />
          </div>
        )}
      </div>
    </motion.div>
  )
}

function ClearCacheButton() {
  const [cleared, setCleared] = useState(false)
  function handleClear() {
    clearKioskCache()
    setCleared(true)
    setTimeout(() => setCleared(false), 2500)
  }
  return (
    <button
      onClick={handleClear}
      className="w-full py-3 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
      style={{ background: cleared ? '#dcfce7' : '#f1f5f9', color: cleared ? '#16a34a' : '#374151', border: '1px solid #e2e8f0' }}
    >
      {cleared ? '✓ Cache cleared — next load fetches fresh data' : '🔄 Clear Catalog Cache (force refresh)'}
    </button>
  )
}
