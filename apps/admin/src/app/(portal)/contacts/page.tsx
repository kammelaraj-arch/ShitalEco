'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

interface Contact {
  id: string
  email: string | null
  full_name: string | null
  first_name: string | null
  surname: string | null
  phone: string | null
  gdpr_consent: boolean
  first_source: string | null
  first_branch_id: string | null
  order_count: number
  total_donated: number
  active_subscriptions: number
  postcode: string | null
  created_at: string
}

const SOURCE_COLORS: Record<string, string> = {
  kiosk:          'bg-saffron-500/20 text-saffron-300 border-saffron-500/30',
  'quick-donation':'bg-orange-500/20 text-orange-300 border-orange-500/30',
  service:        'bg-blue-500/20 text-blue-300 border-blue-500/30',
  paypal:         'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  admin:          'bg-purple-500/20 text-purple-300 border-purple-500/30',
}

function initials(name: string | null) {
  if (!name) return '?'
  return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [source, setSource] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Contact | null>(null)
  const PER_PAGE = 50

  const load = useCallback(async (search = q, src = source, pg = page) => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ page: String(pg), per_page: String(PER_PAGE) })
      if (search) params.set('q', search)
      if (src)    params.set('source', src)
      const res = await fetch(`${API}/admin/contacts?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setContacts(data.contacts || [])
      setTotal(data.total || 0)
    } catch (e: unknown) {
      setError(`Failed to load: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally { setLoading(false) }
  }, [q, source, page])

  useEffect(() => { load() }, [load])

  function search() { setPage(1); load(q, source, 1) }

  const fmt = (dt: string) => new Date(dt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Contacts</h1>
          <p className="text-white/40 mt-1">{total.toLocaleString()} donor contacts in CRM</p>
        </div>
        <button onClick={() => load()} className="px-4 py-2 rounded-xl border border-white/10 text-white/60 text-sm font-medium hover:bg-white/5 transition-all">
          ↻ Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="glass rounded-2xl p-4 border border-temple-border flex flex-wrap gap-3">
        <input
          value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Search name, email or phone…"
          className="flex-1 min-w-48 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-saffron-500/50"
        />
        <select value={source} onChange={e => { setSource(e.target.value); setPage(1); load(q, e.target.value, 1) }}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-saffron-500/50">
          <option value="">All sources</option>
          <option value="kiosk">Kiosk</option>
          <option value="quick-donation">Quick Donation</option>
          <option value="service">Service Portal</option>
          <option value="paypal">PayPal</option>
          <option value="admin">Admin</option>
        </select>
        <button onClick={search} className="px-5 py-2 rounded-xl bg-saffron-500/20 text-saffron-300 border border-saffron-500/30 text-sm font-semibold hover:bg-saffron-500/30 transition-all">
          Search
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Contacts', value: total.toLocaleString(), icon: '👤' },
          { label: 'Showing', value: contacts.length.toString(), icon: '📋' },
          { label: 'With GDPR Consent', value: contacts.filter(c => c.gdpr_consent).length.toString(), icon: '✅' },
        ].map(c => (
          <div key={c.label} className="glass rounded-2xl p-4 border border-temple-border">
            <p className="text-2xl mb-1">{c.icon}</p>
            <p className="text-2xl font-black text-white">{c.value}</p>
            <p className="text-white/40 text-xs mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {loading ? (
        <div className="text-center py-20 text-white/30">Loading…</div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-20 text-white/30">
          <p className="text-4xl mb-3">👤</p>
          <p>No contacts found.</p>
        </div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden border border-temple-border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Contact', 'Email / Phone', 'Source', 'Branch', 'Orders', 'Total Donated', 'GDPR', 'Joined'].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contacts.map((c, i) => (
                  <motion.tr key={c.id}
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                    onClick={() => setSelected(c)}
                    className="border-b border-white/5 hover:bg-white/3 transition-colors cursor-pointer">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-saffron-500/20 flex items-center justify-center text-saffron-300 text-xs font-bold flex-shrink-0">
                          {initials(c.full_name)}
                        </div>
                        <p className="text-white text-sm font-medium">{c.full_name || '—'}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-white/80 text-sm">{c.email || '—'}</p>
                      <p className="text-white/30 text-xs">{c.phone || ''}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${SOURCE_COLORS[c.first_source || ''] || 'bg-white/5 text-white/40 border-white/10'}`}>
                        {c.first_source || '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-white/50 text-sm capitalize">{c.first_branch_id || '—'}</td>
                    <td className="px-5 py-3.5 text-white font-bold text-sm">{c.order_count}</td>
                    <td className="px-5 py-3.5 text-white font-bold text-sm">£{Number(c.total_donated).toFixed(2)}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${c.gdpr_consent ? 'bg-green-500/20 text-green-300 border-green-500/30' : 'bg-red-500/20 text-red-300 border-red-500/30'}`}>
                        {c.gdpr_consent ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-white/50 text-sm">{fmt(c.created_at)}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-white/5">
              <p className="text-white/40 text-sm">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <button disabled={page === 1} onClick={() => { setPage(p => p - 1); load(q, source, page - 1) }}
                  className="px-3 py-1.5 rounded-lg border border-white/10 text-white/60 text-sm disabled:opacity-30 hover:bg-white/5">← Prev</button>
                <button disabled={page >= totalPages} onClick={() => { setPage(p => p + 1); load(q, source, page + 1) }}
                  className="px-3 py-1.5 rounded-lg border border-white/10 text-white/60 text-sm disabled:opacity-30 hover:bg-white/5">Next →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail slide-over */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40" onClick={() => setSelected(null)} />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed right-0 top-0 h-full w-full max-w-md bg-[#1a0808] border-l border-temple-border z-50 overflow-y-auto p-6 space-y-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-saffron-500/20 flex items-center justify-center text-saffron-300 font-bold text-lg">
                    {initials(selected.full_name)}
                  </div>
                  <div>
                    <h2 className="text-white font-black text-lg">{selected.full_name || 'Anonymous'}</h2>
                    <p className="text-white/40 text-sm">{selected.email || 'No email'}</p>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-white/30 hover:text-white text-2xl leading-none">×</button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Orders', value: selected.order_count },
                  { label: 'Total Donated', value: `£${Number(selected.total_donated).toFixed(2)}` },
                  { label: 'Active Subscriptions', value: selected.active_subscriptions },
                  { label: 'Postcode', value: selected.postcode || '—' },
                ].map(s => (
                  <div key={s.label} className="glass rounded-xl p-3 border border-temple-border">
                    <p className="text-white font-bold">{s.value}</p>
                    <p className="text-white/40 text-xs">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="glass rounded-xl p-4 border border-temple-border space-y-2.5">
                {[
                  ['Phone',    selected.phone],
                  ['Source',   selected.first_source],
                  ['Branch',   selected.first_branch_id],
                  ['GDPR',     selected.gdpr_consent ? 'Consented' : 'Not consented'],
                  ['Joined',   fmt(selected.created_at)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-white/40">{k}</span>
                    <span className="text-white">{v || '—'}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
