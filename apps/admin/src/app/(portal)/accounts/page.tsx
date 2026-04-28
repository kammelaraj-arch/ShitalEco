'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'

interface Account {
  id: string
  name: string
  legal_name: string
  account_type: string
  status: string
  email: string
  phone: string
  website: string
  industry: string
  charity_number: string
  branch_id: string
  primary_contact_name: string | null
  contacts_count: number
  services_count: number
  created_at: string
  updated_at: string
}

const TYPE_COLORS: Record<string, string> = {
  customer:         'bg-blue-500/20 text-blue-300 border-blue-500/30',
  vendor:           'bg-purple-500/20 text-purple-300 border-purple-500/30',
  partner:          'bg-green-500/20 text-green-300 border-green-500/30',
  donor:            'bg-saffron-500/20 text-saffron-300 border-saffron-500/30',
  supplier:         'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'charity-partner':'bg-pink-500/20 text-pink-300 border-pink-500/30',
}

const ACCOUNT_TYPES = ['customer', 'vendor', 'partner', 'donor', 'supplier', 'charity-partner']
const STATUSES = ['active', 'prospect', 'inactive']

export default function AccountsPage() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [accountType, setAccountType] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createType, setCreateType] = useState('customer')
  const [createSaving, setCreateSaving] = useState(false)
  const PER_PAGE = 50

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) })
      if (q) params.set('q', q)
      if (accountType) params.set('account_type', accountType)
      if (status) params.set('status', status)
      const data = await apiFetch<{ accounts: Account[]; total: number }>(`/admin/accounts?${params}`)
      setAccounts(data.accounts || [])
      setTotal(data.total || 0)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }, [q, accountType, status, page])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!createName.trim()) return
    setCreateSaving(true)
    try {
      const data = await apiFetch<{ id: string }>('/admin/accounts', {
        method: 'POST',
        body: JSON.stringify({ name: createName.trim(), account_type: createType }),
      })
      setShowCreate(false); setCreateName(''); setCreateType('customer')
      router.push(`/accounts/${data.id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create')
    } finally {
      setCreateSaving(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">🏢 Accounts</h1>
          <p className="text-white/40 mt-1">Companies, organisations, vendors, partners and donors.</p>
        </div>
        <button onClick={() => setShowCreate(s => !s)}
          className="px-4 py-2.5 rounded-lg bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90 transition">
          {showCreate ? '× Cancel' : '+ New Account'}
        </button>
      </div>

      {showCreate && (
        <div className="glass rounded-2xl p-5 space-y-3">
          <h3 className="text-white font-bold">Create account</h3>
          <div className="flex gap-3 flex-wrap">
            <input
              autoFocus
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && create()}
              placeholder="Company / organisation name"
              className="flex-1 min-w-[260px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-saffron-500/60"
            />
            <select
              value={createType}
              onChange={e => setCreateType(e.target.value)}
              className="px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-saffron-500/60">
              {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={create} disabled={createSaving || !createName.trim()}
              className="px-5 py-2.5 rounded-lg bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90 disabled:opacity-40 transition">
              {createSaving ? 'Creating…' : 'Create & open'}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="glass rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={q}
          onChange={e => { setQ(e.target.value); setPage(1) }}
          placeholder="Search name, email, charity #…"
          className="flex-1 min-w-[260px] px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-saffron-500/60"
        />
        <select
          value={accountType}
          onChange={e => { setAccountType(e.target.value); setPage(1) }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-saffron-500/60">
          <option value="">All types</option>
          {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-saffron-500/60">
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-white/40 text-sm">{total} account{total === 1 ? '' : 's'}</span>
      </div>

      {error && <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{error}</div>}

      <div className="glass rounded-2xl overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-white/30">Loading accounts…</div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-12 text-white/30">No accounts yet. Click <em>+ New Account</em> above.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Name', 'Type', 'Status', 'Primary contact', 'Contacts', 'Services', 'Updated'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts.map(a => (
                  <tr key={a.id}
                    onClick={() => router.push(`/accounts/${a.id}`)}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition cursor-pointer">
                    <td className="px-4 py-3">
                      <Link href={`/accounts/${a.id}`} className="text-white font-bold hover:text-saffron-400">
                        {a.name}
                      </Link>
                      {a.legal_name && a.legal_name !== a.name && (
                        <div className="text-white/40 text-xs">{a.legal_name}</div>
                      )}
                      {a.email && <div className="text-white/30 text-xs font-mono">{a.email}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${TYPE_COLORS[a.account_type] || 'bg-white/5 text-white/60 border-white/10'}`}>
                        {a.account_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold ${
                        a.status === 'active'   ? 'text-green-400'
                        : a.status === 'prospect' ? 'text-amber-400'
                        : 'text-white/40'
                      }`}>
                        ● {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/70 text-sm">{a.primary_contact_name || '—'}</td>
                    <td className="px-4 py-3 text-white/60 text-sm font-mono">{a.contacts_count}</td>
                    <td className="px-4 py-3 text-white/60 text-sm font-mono">{a.services_count}</td>
                    <td className="px-4 py-3 text-white/40 text-xs">
                      {a.updated_at ? new Date(a.updated_at).toLocaleDateString('en-GB') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 text-sm">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 disabled:opacity-30 hover:bg-white/10 transition">← Prev</button>
          <span className="px-3 py-1.5 text-white/50">Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 disabled:opacity-30 hover:bg-white/10 transition">Next →</button>
        </div>
      )}
    </div>
  )
}
