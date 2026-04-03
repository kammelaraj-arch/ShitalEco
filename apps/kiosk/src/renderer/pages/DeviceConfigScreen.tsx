/**
 * DeviceConfigScreen — admin-accessible device setup.
 *
 * Load order:
 *   1. GET /terminal-devices/by-branch/{branch_id} — our DB (registered devices)
 *   2. GET /kiosk/terminal/readers                  — Stripe API live readers
 *   3. Manual entry fallback if backend unreachable
 */
import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'

const API_BASE = import.meta.env.VITE_API_URL || 'https://sshitaleco.onrender.com/api/v1'
const BRANCH_ID = import.meta.env.VITE_BRANCH_ID || 'main'

interface StripeReader {
  id: string; label: string; device_type: string; status: string; serial_number: string
}
interface SquareDevice {
  id: string; name: string; status: string; model: string
}
interface DbDevice {
  id: string; label: string; provider: string
  stripe_reader_id: string; square_device_id: string
  device_type: string; serial_number: string; status: string; user_name: string
}

type Provider = 'stripe_terminal' | 'square' | 'cash'

const PROVIDERS: { id: Provider; name: string; logo: string; sub: string; color: string }[] = [
  { id: 'stripe_terminal', name: 'Stripe WisePOS E', logo: '💳', sub: 'Stripe Terminal — tap/chip/contactless', color: '#6772E5' },
  { id: 'square',          name: 'Square Terminal',  logo: '◼',  sub: 'Square POS — card present',              color: '#3E4348' },
  { id: 'cash',            name: 'Cash / Counter',   logo: '💷', sub: 'Customer pays at front desk',            color: '#2E7D32' },
]

export function DeviceConfigScreen({ onClose }: { onClose: () => void }) {
  const { theme, cardProvider, stripeReaderId, squareDeviceId, setCardDevice } = useKioskStore()
  const th = THEMES[theme]

  const [selectedProvider, setSelectedProvider] = useState<Provider>(cardProvider)
  const [dbDevices, setDbDevices]         = useState<DbDevice[]>([])
  const [stripeReaders, setStripeReaders] = useState<StripeReader[]>([])
  const [squareDevices, setSquareDevices] = useState<SquareDevice[]>([])
  const [loading, setLoading]             = useState(false)
  const [backendDown, setBackendDown]     = useState(false)
  const [apiError, setApiError]           = useState('')
  const [saved, setSaved]                 = useState(false)
  const [manualMode, setManualMode]       = useState(false)

  // Selection state
  const [selectedStripeId, setSelectedStripeId] = useState(stripeReaderId)
  const [selectedSquareId, setSelectedSquareId] = useState(squareDeviceId)
  const [manualReaderId, setManualReaderId]     = useState(stripeReaderId)
  const [manualReaderLabel, setManualReaderLabel] = useState('')

  // ── Load DB-registered devices for this branch ─────────────────────────────
  useEffect(() => {
    fetchDevices()
  }, [selectedProvider])

  async function fetchDevices() {
    setLoading(true)
    setApiError('')
    setBackendDown(false)
    setManualMode(false)

    try {
      // 1. Try DB first (our registered devices table)
      const dbRes = await fetch(
        `${API_BASE}/terminal-devices/by-branch/${BRANCH_ID}`,
        { signal: AbortSignal.timeout(5000) }
      )
      if (dbRes.ok) {
        const dbData = await dbRes.json()
        const allDevices: DbDevice[] = dbData.devices || []
        setDbDevices(allDevices)

        // Build provider-specific lists from DB
        const stripeFromDb: StripeReader[] = allDevices
          .filter(d => d.provider === 'stripe_terminal' && d.stripe_reader_id)
          .map(d => ({
            id: d.stripe_reader_id,
            label: d.label,
            device_type: d.device_type,
            status: d.status,
            serial_number: d.serial_number,
          }))

        const squareFromDb: SquareDevice[] = allDevices
          .filter(d => d.provider === 'square' && d.square_device_id)
          .map(d => ({
            id: d.square_device_id,
            name: d.label,
            status: d.status,
            model: d.device_type,
          }))

        if (stripeFromDb.length > 0) setStripeReaders(stripeFromDb)
        if (squareFromDb.length > 0) setSquareDevices(squareFromDb)

        // If DB has results for this provider, we're done
        if (selectedProvider === 'stripe_terminal' && stripeFromDb.length > 0) {
          setLoading(false); return
        }
        if (selectedProvider === 'square' && squareFromDb.length > 0) {
          setLoading(false); return
        }
      }
    } catch { /* fall through to Stripe API */ }

    // 2. Fall back to Stripe / Square API
    try {
      if (selectedProvider === 'stripe_terminal') {
        const r = await fetch(`${API_BASE}/kiosk/terminal/readers`, { signal: AbortSignal.timeout(5000) })
        const d = await r.json()
        if (d.error) setApiError(`Stripe: ${d.error}`)
        else if (d.readers?.length) setStripeReaders(d.readers)
      } else if (selectedProvider === 'square') {
        const r = await fetch(`${API_BASE}/kiosk/square/devices`, { signal: AbortSignal.timeout(5000) })
        const d = await r.json()
        if (d.error) setApiError(`Square: ${d.error}`)
        else if (d.devices?.length) setSquareDevices(d.devices)
      }
    } catch {
      // Backend is not reachable — allow manual entry
      setBackendDown(true)
      // Pre-fill manual entry with currently configured reader
      if (selectedProvider === 'stripe_terminal' && stripeReaderId) {
        setManualReaderId(stripeReaderId)
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = () => {
    if (selectedProvider === 'stripe_terminal') {
      if (manualMode || backendDown) {
        const id = manualReaderId.trim()
        if (!id) return
        setCardDevice('stripe_terminal', id, manualReaderLabel || id)
      } else {
        const reader = stripeReaders.find(r => r.id === selectedStripeId)
        setCardDevice('stripe_terminal', selectedStripeId, reader?.label || selectedStripeId)
      }
    } else if (selectedProvider === 'square') {
      const dev = squareDevices.find(d => d.id === selectedSquareId)
      setCardDevice('square', selectedSquareId, dev?.name || selectedSquareId)
    } else {
      setCardDevice('cash', '', 'Cash')
    }
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 1200)
  }

  const canSave = selectedProvider === 'cash'
    || (selectedProvider === 'stripe_terminal' && (manualMode || backendDown ? manualReaderId.trim().length > 3 : !!selectedStripeId))
    || (selectedProvider === 'square' && !!selectedSquareId)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.88, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.88, y: 20 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xl font-black" style={{ background: th.logoBg }}>
            ⚙
          </div>
          <div>
            <h2 className="font-black text-gray-900 text-lg">Payment Device Setup</h2>
            <p className="text-gray-400 text-xs">Select card reader or payment method</p>
          </div>
          <button onClick={onClose} className="ml-auto w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 font-bold text-lg transition-colors">×</button>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>

          {/* Provider */}
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Choose Provider</p>
          <div className="flex flex-col gap-2 mb-5">
            {PROVIDERS.map(prov => {
              const isActive = selectedProvider === prov.id
              return (
                <button
                  key={prov.id}
                  onClick={() => { setSelectedProvider(prov.id); setManualMode(false) }}
                  className="flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all"
                  style={{ borderColor: isActive ? prov.color : '#F3F4F6', background: isActive ? `${prov.color}10` : 'white' }}
                >
                  <span className="text-2xl w-9 text-center">{prov.logo}</span>
                  <div className="flex-1">
                    <p className="font-bold text-gray-900 text-sm">{prov.name}</p>
                    <p className="text-gray-400 text-xs">{prov.sub}</p>
                  </div>
                  {isActive && <span className="text-lg font-black" style={{ color: prov.color }}>✓</span>}
                </button>
              )
            })}
          </div>

          {/* Stripe readers */}
          <AnimatePresence>
            {selectedProvider === 'stripe_terminal' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>

                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">WisePOS E Readers</p>
                  <div className="flex items-center gap-3">
                    {!manualMode && (
                      <button onClick={fetchDevices} className="text-xs text-indigo-500 font-semibold hover:text-indigo-700 flex items-center gap-1">
                        ↻ Refresh
                      </button>
                    )}
                    <button
                      onClick={() => setManualMode(m => !m)}
                      className="text-xs text-gray-400 font-semibold hover:text-gray-600 underline underline-offset-2"
                    >
                      {manualMode ? 'Back to list' : 'Enter ID manually'}
                    </button>
                  </div>
                </div>

                {/* Manual entry mode */}
                {(manualMode || (backendDown && !stripeReaders.length)) ? (
                  <div className="space-y-3 mb-3">
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700 flex items-start gap-2">
                      <span className="text-base flex-shrink-0">{backendDown ? '⚠️' : '✏️'}</span>
                      <div>
                        <p className="font-bold mb-0.5">
                          {backendDown ? 'Backend offline — enter reader ID manually' : 'Manual entry mode'}
                        </p>
                        <p>Find your reader ID at <span className="font-mono">dashboard.stripe.com → Terminal → Readers</span>. It starts with <span className="font-mono">tmr_</span>.</p>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Stripe Reader ID *</label>
                      <input
                        value={manualReaderId}
                        onChange={e => setManualReaderId(e.target.value)}
                        placeholder="tmr_xxxxxxxxxxxxxxxxxxxxxx"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono text-gray-800 focus:outline-none focus:border-indigo-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Display Label (optional)</label>
                      <input
                        value={manualReaderLabel}
                        onChange={e => setManualReaderLabel(e.target.value)}
                        placeholder="e.g. Wembley Kiosk 1"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-indigo-400"
                      />
                    </div>
                    {!backendDown && (
                      <button
                        onClick={() => { setManualMode(false); fetchDevices() }}
                        className="w-full py-2 rounded-xl bg-indigo-50 text-indigo-600 text-xs font-semibold hover:bg-indigo-100 transition-colors"
                      >
                        ↻ Try loading from backend again
                      </button>
                    )}
                  </div>
                ) : loading ? (
                  <div className="text-center py-8 text-gray-300">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="text-3xl inline-block">⟳</motion.div>
                    <p className="mt-2 text-xs text-gray-400">Looking for readers…</p>
                  </div>
                ) : apiError ? (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600 mb-3">
                    <p className="font-bold mb-1">⚠ API Error</p>
                    <p className="text-xs mb-2">{apiError}</p>
                    <button onClick={() => setManualMode(true)} className="text-xs bg-red-100 text-red-700 px-3 py-1 rounded-lg font-semibold">
                      Enter ID manually
                    </button>
                  </div>
                ) : stripeReaders.length === 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700 mb-3">
                    <p className="font-bold mb-1">No readers found</p>
                    <p className="text-xs mb-2">Register your WisePOS E in the admin portal (Terminal Devices), or enter the reader ID manually.</p>
                    <button onClick={() => setManualMode(true)} className="text-xs bg-amber-100 text-amber-800 px-3 py-1 rounded-lg font-semibold">
                      Enter ID manually
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 mb-3">
                    {stripeReaders.map(r => {
                      const isSelected = selectedStripeId === r.id
                      const isOnline = r.status === 'online'
                      return (
                        <button
                          key={r.id}
                          onClick={() => setSelectedStripeId(r.id)}
                          className="flex items-center gap-3 p-3.5 rounded-2xl border-2 text-left transition-all"
                          style={{ borderColor: isSelected ? '#6772E5' : '#F3F4F6', background: isSelected ? '#6772E510' : 'white' }}
                        >
                          <div className="relative">
                            <span className="text-2xl">📟</span>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${isOnline ? 'bg-green-400' : 'bg-gray-300'}`} />
                          </div>
                          <div className="flex-1">
                            <p className="font-bold text-gray-900 text-sm">{r.label || r.id}</p>
                            <p className="text-gray-400 text-xs font-mono">{r.device_type} · {r.serial_number || r.id}</p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isOnline ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {r.status || 'offline'}
                          </span>
                          {isSelected && <span className="text-indigo-500 font-black text-lg">✓</span>}
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Setup instructions */}
                {!manualMode && !backendDown && (
                  <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700 mt-2">
                    <p className="font-bold mb-1">🔌 Setup: Stripe WisePOS E</p>
                    <ol className="space-y-1 list-decimal list-inside text-blue-600">
                      <li>Power on the WisePOS E device</li>
                      <li>Connect it to the same Wi-Fi network as this kiosk</li>
                      <li>Register it at <span className="font-mono">dashboard.stripe.com → Terminal → Readers</span></li>
                      <li>Go to <span className="font-mono">Admin → Terminal Devices</span> and register it there</li>
                      <li>Click Refresh above to discover it here</li>
                    </ol>
                  </div>
                )}
              </motion.div>
            )}

            {/* Square devices */}
            {selectedProvider === 'square' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Square Devices</p>
                  <button onClick={fetchDevices} className="text-xs text-gray-500 font-semibold hover:text-gray-700">↻ Refresh</button>
                </div>

                {loading ? (
                  <div className="text-center py-8 text-gray-300">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="text-3xl inline-block">⟳</motion.div>
                  </div>
                ) : backendDown ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
                    <p className="font-bold mb-1">⚠️ Backend offline</p>
                    <p className="text-xs">Cannot discover Square devices right now. Start the backend and tap Refresh.</p>
                  </div>
                ) : apiError ? (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">{apiError}</div>
                ) : squareDevices.length === 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700 mb-3">
                    <p className="font-bold mb-1">No Square devices found</p>
                    <p className="text-xs">Register the device in Admin → Terminal Devices, or add <span className="font-mono">SQUARE_ACCESS_TOKEN</span> / <span className="font-mono">SQUARE_LOCATION_ID</span> to backend env.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 mb-3">
                    {squareDevices.map(d => {
                      const isSelected = selectedSquareId === d.id
                      const isOnline = d.status?.toLowerCase() === 'online'
                      return (
                        <button
                          key={d.id}
                          onClick={() => setSelectedSquareId(d.id)}
                          className="flex items-center gap-3 p-3.5 rounded-2xl border-2 text-left transition-all"
                          style={{ borderColor: isSelected ? '#3E4348' : '#F3F4F6', background: isSelected ? '#3E434810' : 'white' }}
                        >
                          <span className="text-2xl">◼</span>
                          <div className="flex-1">
                            <p className="font-bold text-gray-900 text-sm">{d.name}</p>
                            <p className="text-gray-400 text-xs">{d.model} · {d.id.slice(0, 12)}…</p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isOnline ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {d.status}
                          </span>
                          {isSelected && <span className="font-black text-lg" style={{ color: '#3E4348' }}>✓</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </motion.div>
            )}

            {selectedProvider === 'cash' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="bg-green-50 border border-green-200 rounded-2xl p-4 text-sm text-green-800"
              >
                <p className="font-bold mb-1">💷 Cash / Counter Payment</p>
                <p className="text-xs text-green-700">The kiosk will show an order reference. The customer takes it to the front desk to pay in cash.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 border-t border-gray-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-500 font-semibold text-sm hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saved || !canSave}
            className="flex-2 py-3 px-6 rounded-xl text-white font-black text-sm transition-all active:scale-95 disabled:opacity-50"
            style={{ background: th.basketBtn, flex: 2 }}
          >
            {saved ? '✓ Saved!' : 'Save Device Config'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
