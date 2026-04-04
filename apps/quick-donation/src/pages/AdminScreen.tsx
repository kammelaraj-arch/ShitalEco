import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useDonationStore } from '../store/donation.store'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

interface Reader {
  id: string
  label: string
  device_type: string
  status: string
}

const BRANCHES = [
  { id: 'main', name: 'Wembley' },
  { id: 'leicester', name: 'Leicester' },
  { id: 'reading', name: 'Reading' },
  { id: 'mk', name: 'Milton Keynes' },
]

export function AdminScreen() {
  const { branchId, stripeReaderId, stripeReaderLabel, setBranchId, setReader, setScreen } = useDonationStore()
  const [readers, setReaders] = useState<Reader[]>([])
  const [loading, setLoading] = useState(false)

  async function loadReaders() {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/kiosk/terminal/readers`)
      const data = await res.json()
      setReaders(data.readers || [])
    } catch {
      setReaders([])
    }
    setLoading(false)
  }

  useEffect(() => { loadReaders() }, [])

  return (
    <div className="w-full h-full flex flex-col bg-white p-8" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-black text-gray-900">Quick Donation Settings</h1>
          <button
            onClick={() => setScreen('idle')}
            className="px-4 py-2 rounded-xl bg-gray-100 text-gray-600 font-semibold text-sm active:scale-95"
          >
            ← Back
          </button>
        </div>

        {/* Branch Selection */}
        <div className="mb-8">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Temple Branch</h2>
          <div className="grid grid-cols-2 gap-3">
            {BRANCHES.map(b => (
              <button
                key={b.id}
                onClick={() => setBranchId(b.id)}
                className={`py-4 px-5 rounded-2xl font-bold text-base transition-all active:scale-95 ${
                  branchId === b.id
                    ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg'
                    : 'bg-gray-50 text-gray-700 border-2 border-gray-100'
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>

        {/* Card Reader Selection */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Stripe Terminal Reader</h2>
            <button
              onClick={loadReaders}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-500 text-xs font-semibold"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {stripeReaderId && (
            <div className="mb-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
              <p className="text-green-700 text-sm font-semibold">
                Active: <span className="font-black">{stripeReaderLabel}</span>
              </p>
              <p className="text-green-600 text-xs">{stripeReaderId}</p>
            </div>
          )}

          <div className="space-y-2">
            {readers.map(r => (
              <button
                key={r.id}
                onClick={() => setReader(r.id, r.label)}
                className={`w-full text-left px-4 py-3 rounded-xl transition-all active:scale-[0.98] ${
                  stripeReaderId === r.id
                    ? 'bg-orange-50 border-2 border-orange-400'
                    : 'bg-gray-50 border-2 border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-gray-900 text-sm">{r.label}</p>
                    <p className="text-gray-400 text-xs">{r.device_type} - {r.id}</p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded-lg ${
                    r.status === 'online' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {r.status}
                  </span>
                </div>
              </button>
            ))}
            {!loading && readers.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-6">
                No readers found. Ensure Stripe Terminal is configured.
              </p>
            )}
          </div>
        </div>

        {/* Manual Reader ID */}
        <div className="mb-8">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Manual Reader ID</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={stripeReaderId}
              onChange={e => setReader(e.target.value, stripeReaderLabel)}
              placeholder="tmr_xxxxx"
              className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-400"
            />
            <input
              type="text"
              value={stripeReaderLabel}
              onChange={e => setReader(stripeReaderId, e.target.value)}
              placeholder="Reader label"
              className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-orange-400"
            />
          </div>
        </div>

        {/* API URL info */}
        <div className="text-center">
          <p className="text-gray-400 text-xs">
            API: {API_BASE}
          </p>
          <p className="text-gray-300 text-xs mt-1">
            Quick Donation Kiosk v1.0.0
          </p>
        </div>
      </motion.div>
    </div>
  )
}
