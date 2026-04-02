/**
 * DeviceConfigScreen — admin-accessible device setup.
 * Lets staff choose between Stripe WisePOS E, Square Terminal, or Cash.
 * Discovered readers load from the backend API.
 */
import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES } from '../store/kiosk.store'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

interface StripeReader { id: string; label: string; device_type: string; status: string; serial_number: string }
interface SquareDevice { id: string; name: string; status: string; model: string }

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
  const [stripeReaders, setStripeReaders] = useState<StripeReader[]>([])
  const [squareDevices, setSquareDevices] = useState<SquareDevice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const [selectedStripeId, setSelectedStripeId] = useState(stripeReaderId)
  const [selectedSquareId, setSelectedSquareId] = useState(squareDeviceId)

  useEffect(() => {
    if (selectedProvider === 'stripe_terminal') fetchStripeReaders()
    if (selectedProvider === 'square')          fetchSquareDevices()
  }, [selectedProvider])

  const fetchStripeReaders = async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch(`${API_BASE}/kiosk/terminal/readers`)
      const d = await r.json()
      if (d.error) setError(`Stripe: ${d.error}`)
      else setStripeReaders(d.readers || [])
    } catch { setError('Could not reach backend — check connection') }
    finally { setLoading(false) }
  }

  const fetchSquareDevices = async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch(`${API_BASE}/kiosk/square/devices`)
      const d = await r.json()
      if (d.error) setError(`Square: ${d.error}`)
      else setSquareDevices(d.devices || [])
    } catch { setError('Could not reach backend — check connection') }
    finally { setLoading(false) }
  }

  const handleSave = () => {
    if (selectedProvider === 'stripe_terminal') {
      const reader = stripeReaders.find(r => r.id === selectedStripeId)
      setCardDevice('stripe_terminal', selectedStripeId, reader?.label || selectedStripeId)
    } else if (selectedProvider === 'square') {
      const dev = squareDevices.find(d => d.id === selectedSquareId)
      setCardDevice('square', selectedSquareId, dev?.name || selectedSquareId)
    } else {
      setCardDevice('cash', '', 'Cash')
    }
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 1200)
  }

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
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xl font-black"
            style={{ background: th.logoBg }}
          >
            ⚙
          </div>
          <div>
            <h2 className="font-black text-gray-900 text-lg">Payment Device Setup</h2>
            <p className="text-gray-400 text-xs">Select card reader or payment method</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 font-bold text-lg transition-colors"
          >×</button>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>

          {/* Provider selection */}
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Choose Provider</p>
          <div className="flex flex-col gap-2 mb-5">
            {PROVIDERS.map(prov => {
              const isActive = selectedProvider === prov.id
              return (
                <button
                  key={prov.id}
                  onClick={() => setSelectedProvider(prov.id)}
                  className="flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all"
                  style={{
                    borderColor: isActive ? prov.color : '#F3F4F6',
                    background: isActive ? `${prov.color}10` : 'white',
                  }}
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

          {/* Reader selection for Stripe */}
          <AnimatePresence>
            {selectedProvider === 'stripe_terminal' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">WisePOS E Readers</p>
                  <button
                    onClick={fetchStripeReaders}
                    className="text-xs text-indigo-500 font-semibold hover:text-indigo-700"
                  >
                    ↻ Refresh
                  </button>
                </div>

                {loading ? (
                  <div className="text-center py-8 text-gray-300">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="text-3xl inline-block">⟳</motion.div>
                    <p className="mt-2 text-xs text-gray-400">Discovering readers...</p>
                  </div>
                ) : error ? (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600 mb-3">{error}</div>
                ) : stripeReaders.length === 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700 mb-3">
                    <p className="font-bold mb-1">No readers found</p>
                    <p className="text-xs">Make sure the WisePOS E is powered on, connected to Wi-Fi, and registered in your Stripe Dashboard under Readers.</p>
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
                          style={{
                            borderColor: isSelected ? '#6772E5' : '#F3F4F6',
                            background: isSelected ? '#6772E510' : 'white',
                          }}
                        >
                          <div className="relative">
                            <span className="text-2xl">📟</span>
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${isOnline ? 'bg-green-400' : 'bg-gray-300'}`}
                            />
                          </div>
                          <div className="flex-1">
                            <p className="font-bold text-gray-900 text-sm">{r.label || r.id}</p>
                            <p className="text-gray-400 text-xs">{r.device_type} · {r.serial_number || r.id}</p>
                          </div>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isOnline ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                          >
                            {r.status}
                          </span>
                          {isSelected && <span className="text-indigo-500 font-black text-lg">✓</span>}
                        </button>
                      )
                    })}
                  </div>
                )}

                <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700">
                  <p className="font-bold mb-1">🔌 Setup: Stripe WisePOS E</p>
                  <ol className="space-y-1 list-decimal list-inside text-blue-600">
                    <li>Power on the WisePOS E device</li>
                    <li>Connect it to the same Wi-Fi network as this kiosk</li>
                    <li>Register it at dashboard.stripe.com → Terminal → Readers</li>
                    <li>Set <code className="bg-blue-100 px-1 rounded">STRIPE_TERMINAL_LOCATION_ID</code> in backend env vars</li>
                    <li>Click Refresh above to discover it</li>
                  </ol>
                </div>
              </motion.div>
            )}

            {/* Reader selection for Square */}
            {selectedProvider === 'square' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Square Devices</p>
                  <button onClick={fetchSquareDevices} className="text-xs text-gray-500 font-semibold hover:text-gray-700">↻ Refresh</button>
                </div>

                {loading ? (
                  <div className="text-center py-8 text-gray-300">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="text-3xl inline-block">⟳</motion.div>
                  </div>
                ) : error ? (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">{error}</div>
                ) : squareDevices.length === 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700 mb-3">
                    <p className="font-bold mb-1">No Square devices found</p>
                    <p className="text-xs">Add <code className="bg-amber-100 px-1 rounded">SQUARE_ACCESS_TOKEN</code> and <code className="bg-amber-100 px-1 rounded">SQUARE_LOCATION_ID</code> to backend env vars, then register the device in your Square Dashboard.</p>
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
                            <p className="text-gray-400 text-xs">{d.model} · {d.id.slice(0, 12)}...</p>
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
                <p className="text-xs text-green-700">The kiosk will print an order reference. The customer takes it to the front desk to pay in cash.</p>
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
            disabled={saved}
            className="flex-2 py-3 px-6 rounded-xl text-white font-black text-sm transition-all active:scale-95 disabled:opacity-70"
            style={{ background: th.basketBtn, flex: 2 }}
          >
            {saved ? '✓ Saved!' : 'Save Device Config'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
