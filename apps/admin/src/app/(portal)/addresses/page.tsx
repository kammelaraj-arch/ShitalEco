'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

interface Address {
  id: string
  contact_id: string | null
  contact_name: string | null
  contact_email: string | null
  formatted: string | null
  postcode: string | null
  uprn: string | null
  is_primary: boolean
  lookup_source: string | null
  created_at: string
}

export default function AddressesPage() {
  const [addresses, setAddresses] = useState<Address[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const PER_PAGE = 50

  const load = useCallback(async (search = q, pg = page) => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ page: String(pg), per_page: String(PER_PAGE) })
      if (search) params.set('q', search)
      const res = await fetch(`${API}/admin/addresses?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setAddresses(data.addresses || [])
      setTotal(data.total || 0)
    } catch (e: unknown) {
      setError(`Failed to load: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally { setLoading(false) }
  }, [q, page])

  useEffect(() => { load() }, [load])

  function search() { setPage(1); load(q, 1) }
  const fmt = (dt: string) => new Date(dt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Addresses</h1>
          <p className="text-white/40 mt-1">{total.toLocaleString()} address records</p>
        </div>
        <button onClick={() => load()} className="px-4 py-2 rounded-xl border border-white/10 text-white/60 text-sm font-medium hover:bg-white/5 transition-all">
          ↻ Refresh
        </button>
      </div>

      <div className="glass rounded-2xl p-4 border border-temple-border flex gap-3">
        <input
          value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Search postcode, address, contact name or email…"
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-saffron-500/50"
        />
        <button onClick={search} className="px-5 py-2 rounded-xl bg-saffron-500/20 text-saffron-300 border border-saffron-500/30 text-sm font-semibold hover:bg-saffron-500/30 transition-all">
          Search
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {loading ? (
        <div className="text-center py-20 text-white/30">Loading…</div>
      ) : addresses.length === 0 ? (
        <div className="text-center py-20 text-white/30">
          <p className="text-4xl mb-3">📍</p>
          <p>No addresses found.</p>
        </div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden border border-temple-border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Contact', 'Address', 'Postcode', 'UPRN', 'Source', 'Primary', 'Added'].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {addresses.map((a, i) => (
                  <motion.tr key={a.id}
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                    className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="text-white text-sm font-medium">{a.contact_name || '—'}</p>
                      <p className="text-white/30 text-xs">{a.contact_email || ''}</p>
                    </td>
                    <td className="px-5 py-3.5 max-w-xs">
                      <p className="text-white/80 text-sm truncate">{a.formatted || '—'}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-saffron-300 text-sm font-bold">{a.postcode || '—'}</span>
                    </td>
                    <td className="px-5 py-3.5 text-white/40 text-xs font-mono">{a.uprn || '—'}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-white/5 text-white/40 border-white/10 capitalize">
                        {a.lookup_source || '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {a.is_primary
                        ? <span className="text-xs font-bold px-2 py-0.5 rounded-full border bg-green-500/20 text-green-300 border-green-500/30">Primary</span>
                        : <span className="text-white/20 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-white/50 text-sm">{fmt(a.created_at)}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-white/5">
              <p className="text-white/40 text-sm">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <button disabled={page === 1} onClick={() => { setPage(p => p - 1); load(q, page - 1) }}
                  className="px-3 py-1.5 rounded-lg border border-white/10 text-white/60 text-sm disabled:opacity-30 hover:bg-white/5">← Prev</button>
                <button disabled={page >= totalPages} onClick={() => { setPage(p => p + 1); load(q, page + 1) }}
                  className="px-3 py-1.5 rounded-lg border border-white/10 text-white/60 text-sm disabled:opacity-30 hover:bg-white/5">Next →</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
