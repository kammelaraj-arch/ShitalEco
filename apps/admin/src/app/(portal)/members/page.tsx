'use client'
// Members register — Charities Act 2011 + Companies Act 2006 §303-305.
// Admin list + CSV import + per-member edit form.

import { useCallback, useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'

type MembershipType = 'ORDINARY' | 'LIFE' | 'HONORARY' | 'CORPORATE' | 'CONCESSIONARY'
type MemberStatus = 'ACTIVE' | 'LAPSED' | 'RESIGNED' | 'REMOVED'

interface Member {
  id: string
  full_name: string
  email: string
  phone: string
  address?: string
  postcode?: string
  membership_type: MembershipType
  joined_at: string | null
  resigned_at: string | null
  status: MemberStatus
  subscription_paid_until: string | null
  voting_rights: boolean
  gift_aid_declared: boolean
  notes?: string
}

interface Stats {
  total: number
  active: number
  lapsed: number
  voting: number
  renewal_due_30d: number
}

const MEMBERSHIP_TYPES: MembershipType[] = ['ORDINARY', 'LIFE', 'HONORARY', 'CORPORATE', 'CONCESSIONARY']
const STATUSES: MemberStatus[] = ['ACTIVE', 'LAPSED', 'RESIGNED', 'REMOVED']

export default function MembersPage() {
  const [rows, setRows] = useState<Member[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterStatus, setFilterStatus] = useState<MemberStatus | ''>('ACTIVE')
  const [filterType, setFilterType] = useState<MembershipType | ''>('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const [draft, setDraft] = useState({
    full_name: '', email: '', phone: '', address: '', postcode: '',
    membership_type: 'ORDINARY' as MembershipType,
    joined_at: '', subscription_paid_until: '',
    voting_rights: true, gift_aid_declared: false, notes: '',
  })
  const [showImport, setShowImport] = useState(false)
  const [csvText, setCsvText] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const q = new URLSearchParams()
      if (filterStatus) q.set('status', filterStatus)
      if (filterType)   q.set('membership_type', filterType)
      const [r, s] = await Promise.all([
        apiFetch<{ members: Member[] }>(`/admin/members${q.toString() ? '?' + q.toString() : ''}`),
        apiFetch<Stats>('/admin/members/stats'),
      ])
      setRows(r.members || [])
      setStats(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterType])
  useEffect(() => { void load() }, [load])

  function openEdit(m: Member) {
    setEditing(m)
    setDraft({
      full_name: m.full_name, email: m.email, phone: m.phone,
      address: m.address || '', postcode: m.postcode || '',
      membership_type: m.membership_type,
      joined_at: m.joined_at?.slice(0, 10) || '',
      subscription_paid_until: m.subscription_paid_until?.slice(0, 10) || '',
      voting_rights: m.voting_rights,
      gift_aid_declared: m.gift_aid_declared,
      notes: m.notes || '',
    })
    setShowForm(true)
  }

  async function save() {
    if (!draft.full_name.trim()) { setError('Full name is required'); return }
    const body = {
      ...draft,
      joined_at: draft.joined_at || null,
      subscription_paid_until: draft.subscription_paid_until || null,
    }
    try {
      if (editing) {
        await apiFetch(`/admin/members/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
      } else {
        await apiFetch('/admin/members', { method: 'POST', body: JSON.stringify(body) })
      }
      setShowForm(false); setEditing(null)
      setDraft({
        full_name: '', email: '', phone: '', address: '', postcode: '',
        membership_type: 'ORDINARY', joined_at: '', subscription_paid_until: '',
        voting_rights: true, gift_aid_declared: false, notes: '',
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function resign(m: Member) {
    if (!confirm(`Mark "${m.full_name}" as resigned?`)) return
    try {
      await apiFetch(`/admin/members/${m.id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function importCsv() {
    if (!csvText.trim()) return
    try {
      const r = await apiFetch<{ created: number; updated: number; errors: string[] }>(
        '/admin/members/import-csv',
        { method: 'POST', body: JSON.stringify({ csv_text: csvText }) },
      )
      alert(`Created ${r.created}, updated ${r.updated}. ${r.errors.length} errors.`)
      setCsvText('')
      setShowImport(false)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <div className="p-6 space-y-6 text-white max-w-[1400px] mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black">Members register</h1>
          <p className="text-white/50 text-sm mt-0.5">
            Charities Act 2011 + Companies Act 2006 §303-305. The voting body behind the AGM.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowImport(s => !s)}
            className="px-4 py-2 rounded-xl border border-white/15 text-white/80 text-sm font-bold hover:bg-white/5">
            Import CSV
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true) }}
            className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
            + New member
          </button>
        </div>
      </header>

      {error && <div className="bg-red-500/15 border border-red-500/40 text-red-200 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {stats && (
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Total', val: stats.total, c: 'text-white' },
            { label: 'Active', val: stats.active, c: 'text-emerald-300' },
            { label: 'Lapsed', val: stats.lapsed, c: 'text-amber-300' },
            { label: 'Voting rights', val: stats.voting, c: 'text-sky-300' },
            { label: 'Renewal due 30d', val: stats.renewal_due_30d, c: 'text-red-300' },
          ].map(k => (
            <div key={k.label} className="rounded-xl border border-white/10 bg-white/3 p-3">
              <p className="text-white/50 text-[10px] uppercase tracking-widest font-bold">{k.label}</p>
              <p className={`text-3xl font-black mt-1 ${k.c}`}>{k.val}</p>
            </div>
          ))}
        </section>
      )}

      <div className="flex items-center gap-3 flex-wrap text-sm">
        <label className="text-white/50 text-xs">Status:</label>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as MemberStatus | '')}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="text-white/50 text-xs">Type:</label>
        <select value={filterType} onChange={e => setFilterType(e.target.value as MembershipType | '')}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All</option>
          {MEMBERSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {showImport && (
        <section className="rounded-2xl border border-sky-400/30 bg-sky-400/5 p-5 space-y-3">
          <h2 className="text-sky-300 text-xs uppercase tracking-widest font-black">Import CSV</h2>
          <p className="text-white/60 text-xs">
            Columns: <code>full_name, email, phone, membership_type, joined_at</code>.
            Rows matched by email are updated; new rows inserted.
          </p>
          <textarea rows={8} value={csvText} onChange={e => setCsvText(e.target.value)}
            placeholder="full_name,email,phone,membership_type,joined_at&#10;Mr Bhadra Thaker,bhadra@example.com,+447xxxxxxxx,ORDINARY,2023-04-01"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono resize-none" />
          <button onClick={importCsv}
            className="px-4 py-2 rounded-xl bg-sky-500 text-white text-sm font-black">
            Import
          </button>
        </section>
      )}

      {showForm && (
        <section className="rounded-2xl border border-saffron-400/30 bg-saffron-400/5 p-5 space-y-3">
          <h2 className="text-saffron-300 text-xs uppercase tracking-widest font-black">{editing ? 'Edit' : 'New'} member</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Full name *</label>
              <input value={draft.full_name} onChange={e => setDraft(d => ({ ...d, full_name: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Email</label>
              <input type="email" value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Phone</label>
              <input value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Membership type</label>
              <select value={draft.membership_type}
                onChange={e => setDraft(d => ({ ...d, membership_type: e.target.value as MembershipType }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm">
                {MEMBERSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Joined</label>
              <input type="date" value={draft.joined_at}
                onChange={e => setDraft(d => ({ ...d, joined_at: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Subscription paid until</label>
              <input type="date" value={draft.subscription_paid_until}
                onChange={e => setDraft(d => ({ ...d, subscription_paid_until: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Address</label>
              <input value={draft.address} onChange={e => setDraft(d => ({ ...d, address: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-white/50 text-xs font-bold mb-1">Postcode</label>
              <input value={draft.postcode} onChange={e => setDraft(d => ({ ...d, postcode: e.target.value.toUpperCase() }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm uppercase" />
            </div>
            <div className="flex gap-4 items-center md:col-span-2">
              <label className="flex items-center gap-2 text-white/80 text-sm">
                <input type="checkbox" checked={draft.voting_rights}
                  onChange={e => setDraft(d => ({ ...d, voting_rights: e.target.checked }))}
                  className="accent-saffron-400" />
                Voting rights
              </label>
              <label className="flex items-center gap-2 text-white/80 text-sm">
                <input type="checkbox" checked={draft.gift_aid_declared}
                  onChange={e => setDraft(d => ({ ...d, gift_aid_declared: e.target.checked }))}
                  className="accent-saffron-400" />
                Gift Aid declared
              </label>
            </div>
            <div className="md:col-span-2">
              <label className="block text-white/50 text-xs font-bold mb-1">Notes</label>
              <textarea rows={2} value={draft.notes}
                onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm resize-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={save}
              className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
              {editing ? 'Save changes' : 'Create member'}
            </button>
            <button onClick={() => { setShowForm(false); setEditing(null) }}
              className="px-4 py-2 rounded-xl border border-white/15 text-white/70 text-sm font-bold hover:bg-white/5">
              Cancel
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <p className="text-white/50 text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-white/40 text-sm italic">No members found for this filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-xs uppercase tracking-widest">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Joined</th>
                <th className="px-3 py-2 text-left">Paid until</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(m => (
                <tr key={m.id} className="border-t border-white/5">
                  <td className="px-3 py-2">
                    <p className="font-bold text-white">{m.full_name}</p>
                    {m.voting_rights && <span className="text-sky-300 text-[10px] font-bold uppercase tracking-widest">voting</span>}
                  </td>
                  <td className="px-3 py-2 text-white/70 text-xs">{m.email}</td>
                  <td className="px-3 py-2 text-white/70 text-xs">{m.membership_type}</td>
                  <td className="px-3 py-2 text-white/60 text-xs">{m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-2 text-white/60 text-xs">{m.subscription_paid_until ? new Date(m.subscription_paid_until).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-2">
                    <span className={
                      'px-2 py-0.5 rounded-full text-[10px] font-black border ' +
                      (m.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30'
                        : m.status === 'LAPSED' ? 'bg-amber-500/20 text-amber-200 border-amber-400/30'
                        : 'bg-white/10 text-white/50 border-white/20')
                    }>{m.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openEdit(m)} className="text-white/60 hover:text-white text-xs px-1">✎</button>
                    {m.status === 'ACTIVE' && (
                      <button onClick={() => resign(m)} className="text-red-400/60 hover:text-red-400 text-xs px-1">Resign</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
