'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

const API = process.env.NEXT_PUBLIC_API_URL || '/api/v1'
function authToken() { return typeof window !== 'undefined' ? (localStorage.getItem('shital_access_token') || '') : '' }

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

interface Branch { branch_id: string; name: string }

interface Donation {
  id: string
  branch_id: string
  amount: number | string
  currency: string
  purpose: string
  payment_provider: string
  payment_ref: string | null
  gift_aid_eligible: boolean
  gift_aid_amount: number | string
  status: string
  reference: string
  created_at: string
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1'

const PURPOSES = ['General', 'Building Fund', 'Education', 'Food Bank', 'Festival', 'Specific', 'Sponsorship', 'Zakat', 'Sadaqah']
const STATUSES = ['COMPLETED', 'PENDING', 'CANCELLED', 'REFUNDED']

export default function DonationsPage() {
  const [donations, setDonations] = useState<Donation[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const [firstOfYear] = useState(() => `${new Date().getFullYear()}-01-01`)
  const [fromDate, setFromDate] = useState(() => `${new Date().getFullYear()}-01-01`)
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10))

  // CSV
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [csvDownloading, setCsvDownloading] = useState(false)
  const [csvImporting, setCsvImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: { row: number; error: string }[] } | null>(null)

  // New / Edit form
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Donation | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    amount: '',
    purpose: 'General',
    payment_provider: 'cash',
    payment_ref: '',
    status: 'COMPLETED',
    reference: '',
    donation_date: new Date().toISOString().slice(0, 10),
    branch_id: 'main',
  })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [donData, brData] = await Promise.all([
        apiFetch<{ donations: Donation[] }>(`/finance/donations?from_date=${fromDate}&to_date=${toDate}&limit=500`),
        apiFetch<{ branches: Branch[] }>('/branches'),
      ])
      setDonations(donData.donations || [])
      setBranches(brData.branches || [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  useEffect(() => { load() }, [load])

  const openNew = () => {
    setEditing(null)
    setForm({ amount: '', purpose: 'General', payment_provider: 'cash', payment_ref: '',
      status: 'COMPLETED', reference: '', donation_date: today, branch_id: branches[0]?.branch_id || 'main' })
    setFormError(''); setShowForm(true)
  }

  const openEdit = (d: Donation) => {
    setEditing(d)
    setForm({
      amount: String(d.amount),
      purpose: d.purpose,
      payment_provider: d.payment_provider,
      payment_ref: d.payment_ref || '',
      status: d.status,
      reference: d.reference || '',
      donation_date: d.created_at.slice(0, 10),
      branch_id: d.branch_id,
    })
    setFormError(''); setShowForm(true)
  }

  const submit = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) { setFormError('Enter a valid amount'); return }
    setSaving(true); setFormError('')
    try {
      if (editing) {
        await apiFetch(`/finance/donations/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            amount: parseFloat(form.amount),
            purpose: form.purpose,
            payment_provider: form.payment_provider,
            payment_ref: form.payment_ref,
            status: form.status,
            reference: form.reference,
            donation_date: form.donation_date,
          }),
        })
      } else {
        await apiFetch('/finance/donations', {
          method: 'POST',
          body: JSON.stringify({
            amount: parseFloat(form.amount).toFixed(2),
            purpose: form.purpose,
            payment_provider: form.payment_provider,
            payment_ref: form.payment_ref,
            idempotency_key: generateUUID(),
          }),
        })
      }
      setShowForm(false)
      await load()
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  // Delete is intentionally not exposed in the UI — donations are an audit
  // trail. Voids/refunds should be tracked as separate records, not removed.

  async function downloadCsv() {
    setCsvDownloading(true)
    try {
      const res = await fetch(
        `${API}/finance/donations/export.csv?from_date=${fromDate}&to_date=${toDate}`,
        { headers: { Authorization: `Bearer ${authToken()}` } }
      )
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `donations-${fromDate}-to-${toDate}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally { setCsvDownloading(false) }
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvImporting(true); setImportResult(null); setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API}/finance/donations/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken()}` },
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Import failed')
      setImportResult(data)
      if (data.imported > 0) await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setCsvImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const totalAmount  = donations.reduce((s, d) => s + Number(d.amount), 0)
  const totalGiftAid = donations.reduce((s, d) => s + Number(d.gift_aid_amount || 0), 0)
  // Per-status breakdown (count + sum) so the summary cards reflect the
  // health of the cashflow, not just the total.
  const byStatus = donations.reduce<Record<string, { count: number; sum: number }>>((acc, d) => {
    const k = d.status || 'UNKNOWN'
    if (!acc[k]) acc[k] = { count: 0, sum: 0 }
    acc[k].count += 1
    acc[k].sum   += Number(d.amount)
    return acc
  }, {})

  // Edit/delete RBAC — only SUPER_ADMIN can edit; deletion is disabled for
  // everyone (records are auditable; refunds/voids are tracked separately).
  const userRole = (() => {
    if (typeof window === 'undefined') return ''
    try { return (JSON.parse(localStorage.getItem('shital_user') || '{}')?.role || '') } catch { return '' }
  })()
  const canEdit = userRole === 'SUPER_ADMIN'

  // Column sort. Click a header to toggle asc/desc. Persists only in component state.
  type SortKey = 'date' | 'amount' | 'purpose' | 'branch_id' | 'payment_provider' | 'status'
  const [sortBy, setSortBy] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(k); setSortDir(k === 'amount' || k === 'date' ? 'desc' : 'asc') }
  }
  const sortedDonations = [...donations].sort((a, b) => {
    const getVal = (d: Donation): string | number => {
      switch (sortBy) {
        case 'date':             return new Date(d.donation_date).getTime()
        case 'amount':           return Number(d.amount)
        case 'purpose':          return (d.purpose || '').toLowerCase()
        case 'branch_id':        return (d.branch_id || '').toLowerCase()
        case 'payment_provider': return (d.payment_provider || '').toLowerCase()
        case 'status':           return d.status || ''
      }
    }
    const av = getVal(a); const bv = getVal(b)
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const branchName = (bid: string) => branches.find(b => b.branch_id === bid)?.name || bid

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Donations</h1>
          <p className="text-white/40 mt-1">Track and manage all temple donations</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={openNew} className="btn-primary">+ New Donation</button>
          <button
            onClick={downloadCsv}
            disabled={csvDownloading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            {csvDownloading ? '⏳' : '⬇'} Export CSV
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={csvImporting}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            {csvImporting ? '⏳' : '⬆'} Import CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvUpload} />
        </div>
      </div>

      {/* Import result */}
      <AnimatePresence>
        {importResult && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl p-4 space-y-2"
            style={{ background: importResult.imported > 0 ? 'rgba(21,128,61,0.1)' : 'rgba(185,28,28,0.1)', border: `1px solid ${importResult.imported > 0 ? 'rgba(21,128,61,0.25)' : 'rgba(185,28,28,0.25)'}` }}
          >
            <div className="flex items-center justify-between">
              <p className="font-bold text-sm" style={{ color: importResult.imported > 0 ? '#4ade80' : '#f87171' }}>
                {importResult.imported > 0 ? `✅ Imported ${importResult.imported} donation${importResult.imported !== 1 ? 's' : ''}` : '❌ Import completed with errors'}
                {importResult.skipped > 0 && <span className="text-white/40 font-normal ml-2">({importResult.skipped} row{importResult.skipped !== 1 ? 's' : ''} skipped)</span>}
              </p>
              <button onClick={() => setImportResult(null)} className="text-white/30 hover:text-white/60 text-lg leading-none">✕</button>
            </div>
            {importResult.errors.length > 0 && (
              <div className="space-y-1 mt-2">
                {importResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-red-400/80 font-mono">Row {e.row}: {e.error}</p>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Date range filter */}
      <div className="flex flex-wrap gap-2 sm:gap-3 items-end">
        <div className="min-w-0">
          <label className={lbl}>From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={inp + ' w-full sm:w-40'} />
        </div>
        <div className="min-w-0">
          <label className={lbl}>To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={inp + ' w-full sm:w-40'} />
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="px-4 py-2.5 rounded-xl text-white text-sm font-bold"
            style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>Apply</button>
          <button onClick={() => { setFromDate(firstOfYear); setToDate(today) }}
            className="px-4 py-2.5 rounded-xl border border-white/10 text-white/50 text-sm font-semibold hover:bg-white/5">This Year</button>
          <button onClick={() => { setFromDate('2020-01-01'); setToDate(today) }}
            className="px-4 py-2.5 rounded-xl border border-white/10 text-white/50 text-sm font-semibold hover:bg-white/5">All Time</button>
        </div>
      </div>

      {/* Summary cards — per-status breakdown + grand totals */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'Completed',
            value: `£${(byStatus.COMPLETED?.sum ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
            sub:   `${byStatus.COMPLETED?.count ?? 0} donation${(byStatus.COMPLETED?.count ?? 0) === 1 ? '' : 's'}`,
            icon: '✅', color: 'from-green-600 to-emerald-500' },
          { label: 'Pending',
            value: `£${(byStatus.PENDING?.sum ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
            sub:   `${byStatus.PENDING?.count ?? 0} donation${(byStatus.PENDING?.count ?? 0) === 1 ? '' : 's'}`,
            icon: '⏳', color: 'from-amber-500 to-orange-500' },
          { label: 'Failed / Other',
            value: `£${(donations.length - (byStatus.COMPLETED?.count ?? 0) - (byStatus.PENDING?.count ?? 0)) === 0
                       ? '0.00'
                       : Object.entries(byStatus)
                           .filter(([k]) => !['COMPLETED','PENDING'].includes(k))
                           .reduce((s, [, v]) => s + v.sum, 0)
                           .toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
            sub:   `${donations.length - (byStatus.COMPLETED?.count ?? 0) - (byStatus.PENDING?.count ?? 0)} record${donations.length - (byStatus.COMPLETED?.count ?? 0) - (byStatus.PENDING?.count ?? 0) === 1 ? '' : 's'}`,
            icon: '⚠️', color: 'from-red-600 to-rose-500' },
          { label: 'Total (all)',
            value: `£${totalAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
            sub:   `${donations.length} donation${donations.length === 1 ? '' : 's'}`,
            icon: '💰', color: 'from-saffron-600 to-orange-600' },
          { label: 'Gift Aid',
            value: `£${totalGiftAid.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
            sub:   '25% reclaim',
            icon: '🇬🇧', color: 'from-blue-600 to-indigo-500' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="glass rounded-2xl p-4 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-base mb-2`}>{s.icon}</div>
            <p className="text-white/50 text-xs font-medium mb-0.5">{s.label}</p>
            <p className="text-2xl font-black text-white">{loading ? '—' : s.value}</p>
            {'sub' in s && s.sub && <p className="text-white/30 text-xs mt-0.5">{s.sub}</p>}
          </motion.div>
        ))}
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Donation records table */}
      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        {loading ? (
          <div className="text-center py-20 text-white/30">Loading donations…</div>
        ) : donations.length === 0 ? (
          <div className="text-center py-20 text-white/30">
            <p className="text-4xl mb-3">🙏</p>
            <p className="font-medium">No donations in this period.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {([
                    { k: 'date',             label: 'Date',    cls: '' },
                    { k: 'amount',           label: 'Amount',  cls: '' },
                    { k: 'purpose',          label: 'Purpose', cls: 'hidden sm:table-cell' },
                    { k: 'branch_id',        label: 'Branch',  cls: 'hidden md:table-cell' },
                    { k: 'payment_provider', label: 'Method',  cls: 'hidden lg:table-cell' },
                    { k: 'status',           label: 'Status',  cls: '' },
                  ] as const).map(({ k, label, cls }) => (
                    <th key={k}
                      onClick={() => toggleSort(k as SortKey)}
                      className={`text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase cursor-pointer select-none hover:text-white/70 ${cls}`}>
                      {label}
                      {sortBy === k && (
                        <span className="ml-1 text-saffron-400">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </th>
                  ))}
                  {canEdit && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {sortedDonations.map((d, i) => (
                  <motion.tr key={d.id}
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.01 }}
                    className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3 text-white/60 text-sm whitespace-nowrap">
                      {new Date(d.created_at).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-saffron-400 whitespace-nowrap">
                      £{Number(d.amount).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-white/70 text-sm hidden sm:table-cell">{d.purpose}</td>
                    <td className="px-4 py-3 text-white/50 text-sm hidden md:table-cell">{branchName(d.branch_id)}</td>
                    <td className="px-4 py-3 text-white/50 text-xs capitalize hidden lg:table-cell">{d.payment_provider}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                        d.status === 'COMPLETED' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                        d.status === 'PENDING'   ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                                                   'bg-red-500/20 text-red-400 border-red-500/30'
                      }`}>{d.status}</span>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => openEdit(d)}
                          className="text-white/40 hover:text-saffron-400 text-sm font-medium px-2 py-1">Edit</button>
                      </td>
                    )}
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Slide-over form */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-[480px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editing ? 'Edit Donation' : 'New Donation'}</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl p-1">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4">
                {formError && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{formError}</div>}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Amount (£) *</label>
                    <input type="number" min="0.01" step="0.01" value={form.amount}
                      onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                      placeholder="0.00" className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Date *</label>
                    <input type="date" value={form.donation_date}
                      onChange={e => setForm(p => ({ ...p, donation_date: e.target.value }))} className={inp} />
                  </div>
                </div>

                <div>
                  <label className={lbl}>Purpose *</label>
                  <select value={form.purpose} onChange={e => setForm(p => ({ ...p, purpose: e.target.value }))} className={inp}>
                    {PURPOSES.map(pu => <option key={pu} value={pu}>{pu}</option>)}
                  </select>
                </div>

                <div>
                  <label className={lbl}>Branch</label>
                  <select value={form.branch_id} onChange={e => setForm(p => ({ ...p, branch_id: e.target.value }))} className={inp}>
                    {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
                    {branches.length === 0 && <option value="main">Main</option>}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Payment Method</label>
                    <select value={form.payment_provider} onChange={e => setForm(p => ({ ...p, payment_provider: e.target.value }))} className={inp}>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="online">Online</option>
                      <option value="stripe">Stripe</option>
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Status</label>
                    <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={inp}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={lbl}>Payment Reference</label>
                  <input value={form.payment_ref} onChange={e => setForm(p => ({ ...p, payment_ref: e.target.value }))}
                    placeholder="Cheque no. / transaction ID" className={inp} />
                </div>

                <div>
                  <label className={lbl}>Internal Reference</label>
                  <input value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))}
                    placeholder="e.g. Receipt number" className={inp} />
                </div>
              </div>
              <div className="px-4 sm:px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={submit} disabled={saving}
                  className="flex-[2] py-3 rounded-xl text-white font-black text-sm disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Record Donation'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
