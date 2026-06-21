'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'
import { ProjectPicker } from '@/components/ui/ProjectPicker'

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
  source: string
  purpose: string
  payment_provider: string
  payment_ref: string | null
  gift_aid_eligible: boolean
  gift_aid_amount: number | string
  status: string
  reference: string
  contact_id: string | null
  contact_name: string | null
  contact_email: string | null
  donation_type: 'one-time' | 'recurring' | string
  created_at: string
  updated_at: string
  project_id?: string | null
  project_name?: string | null
}

// Master column list — drives the column-toggle menu + the table render.
// `default` = visible on first load (mirrors what the old grid showed plus
// Gift Aid + Contact, which are the most commonly-requested additions).
const ALL_COLUMNS = [
  { key: 'gift_aid',         label: '🇬🇧 Gift Aid',  default: true,  always: false },
  { key: 'date',             label: 'Date',           default: true,  always: true  },
  { key: 'amount',           label: 'Amount',         default: true,  always: true  },
  { key: 'contact',          label: 'Donor',          default: true,  always: false },
  { key: 'purpose',          label: 'Purpose',        default: true,  always: false },
  { key: 'branch',           label: 'Branch',         default: true,  always: false },
  { key: 'source',           label: 'Source',         default: false, always: false },
  { key: 'donation_type',    label: 'Type',           default: false, always: false },
  { key: 'payment_provider', label: 'Method',         default: true,  always: false },
  { key: 'payment_ref',      label: 'Payment Ref',    default: false, always: false },
  { key: 'reference',        label: 'Reference',      default: false, always: false },
  { key: 'status',           label: 'Status',         default: true,  always: true  },
] as const

type ColumnKey = typeof ALL_COLUMNS[number]['key']

const SOURCES = ['', 'service-portal', 'quick-donation', 'monthly-giving', 'manual', 'kiosk']

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

  // Extended query filters (all wired to the existing /finance/donations params)
  const [filterBranch, setFilterBranch]   = useState('')
  const [filterSource, setFilterSource]   = useState('')
  const [filterPurpose, setFilterPurpose] = useState('')
  const [filterStatus, setFilterStatus]   = useState('')
  const [filterLimit, setFilterLimit]     = useState(500)
  const [giftAidOnly, setGiftAidOnly]     = useState(false)
  const [search, setSearch]               = useState('')

  // Column toggle — visible columns persist in localStorage so each trustee
  // keeps their own view. Defaults come from ALL_COLUMNS.
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('shital_donations_cols')
        if (raw) return new Set(JSON.parse(raw) as ColumnKey[])
      } catch { /* ignore */ }
    }
    return new Set(ALL_COLUMNS.filter(c => c.default).map(c => c.key))
  })
  useEffect(() => {
    try { localStorage.setItem('shital_donations_cols', JSON.stringify([...visibleCols])) }
    catch { /* ignore */ }
  }, [visibleCols])
  const [showColMenu, setShowColMenu] = useState(false)
  const toggleCol = (k: ColumnKey) => {
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }
  const isVisible = (k: ColumnKey) => visibleCols.has(k)

  // CSV
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [csvDownloading, setCsvDownloading] = useState(false)
  const [csvImporting, setCsvImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: { row: number; error: string }[] } | null>(null)
  const [reconciling, setReconciling] = useState(false)

  // Paste SumUp's daily payments PDF transaction table (or any TSV/CSV with
  // transaction_code, amount, datetime). Forces matches against PENDING
  // donations by amount + ± window. The "I have the proof in hand" path
  // when reconcile-via-API doesn't catch them (eg. SumUp purged checkouts
  // older than a day or SUMUP_MERCHANT_CODE isn't configured).
  async function importSumUpPaidList() {
    const sample = `# Paste rows from the SumUp daily PDF, one per line.
# Format: TRANSACTION_CODE  AMOUNT  DATE TIME
# Tab or 2+ spaces between columns. Date/time in UK format.
# Example (7 Jun 2026):
TAAA3G3ANXK  11.00  2026-06-07 09:54
TAAA3G3B6EH  5.00   2026-06-07 09:57`
    const raw = prompt('Paste SumUp transaction list (one per line: CODE  AMOUNT  YYYY-MM-DD HH:MM)\n\nExample format below — replace with real rows:', sample)
    if (!raw) return
    const entries: Array<{ transaction_code: string; amount: number; datetime_str: string }> = []
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      // Split on tabs or 2+ spaces
      const parts = t.split(/\t+|\s{2,}/).map(s => s.trim()).filter(Boolean)
      if (parts.length < 3) continue
      const code = parts[0]
      const amount = parseFloat(parts[1].replace(/[£$,]/g, ''))
      const dt = parts.slice(2).join(' ')
      if (!code || !Number.isFinite(amount) || !dt) continue
      entries.push({ transaction_code: code, amount, datetime_str: dt })
    }
    if (entries.length === 0) {
      alert('No valid rows parsed. Each line must be: CODE AMOUNT YYYY-MM-DD HH:MM (whitespace-separated).')
      return
    }
    if (!confirm(`Parsed ${entries.length} rows. Submit to mark matching PENDING donations as COMPLETED?`)) return
    setReconciling(true); setError('')
    try {
      const r = await apiFetch<{
        submitted: number; matched_and_completed: number;
        already_completed: number; no_match: number; errors: number;
        rows: Array<{ code: string; outcome: string; donation_id?: string }>
      }>('/kiosk/sumup/import-paid-list', {
        method: 'POST',
        body: JSON.stringify({ entries, match_window_minutes: 30 }),
      })
      const noMatchCodes = (r.rows || []).filter(x => x.outcome === 'no_match').map(x => x.code).slice(0, 10)
      alert(
        `Import complete\n\n` +
        `Submitted: ${r.submitted}\n` +
        `✅ Marked COMPLETED: ${r.matched_and_completed}\n` +
        `↻ Already complete (payment_ref updated): ${r.already_completed}\n` +
        `🔍 No matching PENDING donation: ${r.no_match}` +
        (noMatchCodes.length ? `\n   (first 10: ${noMatchCodes.join(', ')})` : '') +
        `\n❌ Errors: ${r.errors}`
      )
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setReconciling(false)
    }
  }

  async function reconcileSumUp() {
    const days = parseInt(prompt('Days to sweep (default 14 covers the 7 Jun window):', '14') || '0', 10)
    if (!days || days < 1) return
    setReconciling(true); setError('')
    try {
      const r = await apiFetch<{
        scanned: number; completed: number; failed: number;
        still_pending: number; not_found: number; errors: number;
        rows: Array<{ outcome: string; amount?: number }>
      }>(`/kiosk/sumup/reconcile-pending?days=${days}`, { method: 'POST' })
      const recovered = (r.rows || [])
        .filter(x => x.outcome === 'completed')
        .reduce((acc, x) => acc + (x.amount || 0), 0)
      alert(
        `Reconcile complete (${days} days)\n\n` +
        `Scanned: ${r.scanned}\n` +
        `✅ Recovered (now COMPLETED): ${r.completed}   £${recovered.toFixed(2)}\n` +
        `❌ Marked failed: ${r.failed}\n` +
        `⏳ Still pending on SumUp side: ${r.still_pending}\n` +
        `🔍 Not found on SumUp: ${r.not_found}\n` +
        `⚠ Errors: ${r.errors}`
      )
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reconcile failed')
    } finally { setReconciling(false) }
  }

  // New / Edit form
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Donation | null>(null)
  const [taggingDonation, setTaggingDonation] = useState<Donation | null>(null)

  async function tagDonationToProject(donation: Donation, projectId: string | null) {
    try {
      await apiFetch(`/admin/donations/${donation.id}/project`, {
        method: 'PATCH', body: JSON.stringify({ project_id: projectId }),
      })
      setTaggingDonation(null)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to tag donation') }
  }
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
      const qs = new URLSearchParams({
        from_date: fromDate,
        to_date:   toDate,
        limit:     String(filterLimit),
      })
      if (filterBranch)  qs.set('branch_id', filterBranch)
      if (filterSource)  qs.set('source',    filterSource)
      if (filterPurpose) qs.set('purpose',   filterPurpose)
      if (filterStatus)  qs.set('status',    filterStatus)
      const [donData, brData] = await Promise.all([
        apiFetch<{ donations: Donation[] }>(`/finance/donations?${qs}`),
        apiFetch<{ branches: Branch[] }>('/branches'),
      ])
      setDonations(donData.donations || [])
      setBranches(brData.branches || [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate, filterBranch, filterSource, filterPurpose, filterStatus, filterLimit])

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

  // Apply client-side filters on top of the server response — must come
  // before the totals/byStatus calculations below since they consume
  // visibleDonations.
  const q = search.trim().toLowerCase()
  const visibleDonations = donations.filter(d => {
    if (giftAidOnly && !d.gift_aid_eligible) return false
    if (q) {
      const hay = [
        d.contact_name, d.contact_email, d.purpose, d.reference,
        d.payment_ref, d.payment_provider, d.source, d.branch_id,
        String(d.amount),
      ].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  // Totals reflect the FILTERED dataset so trustees see what their query
  // returned, not the whole period.
  const totalAmount  = visibleDonations.reduce((s, d) => s + Number(d.amount), 0)
  const totalGiftAid = visibleDonations.reduce((s, d) => s + Number(d.gift_aid_amount || 0), 0)
  const gaEligibleCount = visibleDonations.filter(d => d.gift_aid_eligible).length
  // Per-status breakdown (count + sum) so the summary cards reflect the
  // health of the cashflow, not just the total.
  const byStatus = visibleDonations.reduce<Record<string, { count: number; sum: number }>>((acc, d) => {
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
  const sortedDonations = [...visibleDonations].sort((a, b) => {
    const getVal = (d: Donation): string | number => {
      switch (sortBy) {
        case 'date':             return new Date(d.created_at).getTime()
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
          <button
            onClick={reconcileSumUp}
            disabled={reconciling}
            title="Sweep the last N days of PENDING SumUp donations, ask SumUp the real status, flip to COMPLETED / FAILED. Use after a container restart or webhook outage."
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(245,158,11,0.4)' }}
          >
            {reconciling ? '⏳ Reconciling…' : '🔄 Reconcile SumUp'}
          </button>
          <button
            onClick={importSumUpPaidList}
            disabled={reconciling}
            title="Paste rows from SumUp's daily payments PDF (transaction_code, amount, date/time). Force-matches PENDING donations to COMPLETED."
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'rgba(34,197,94,0.18)', border: '1px solid rgba(34,197,94,0.4)' }}
          >
            📋 Import SumUp PDF
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

      {/* Filter panel — every backend query param exposed + Gift-Aid-only
          shortcut + a free-text search across donor/purpose/refs.
          Date + status/source/branch/purpose hit the API; gift-aid-only
          + search are client-side over the returned set. */}
      <div className="glass rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2 sm:gap-3 items-end">
          <div className="min-w-0 flex-1 sm:flex-none">
            <label className={lbl}>From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={inp + ' w-full sm:w-40'} />
          </div>
          <div className="min-w-0 flex-1 sm:flex-none">
            <label className={lbl}>To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={inp + ' w-full sm:w-40'} />
          </div>
          <div className="min-w-0">
            <label className={lbl}>Branch</label>
            <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)} className={inp + ' min-w-[140px]'}>
              <option value="">All</option>
              {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className={lbl}>Source</label>
            <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className={inp + ' min-w-[150px]'}>
              {SOURCES.map(s => <option key={s} value={s}>{s || 'All sources'}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className={lbl}>Purpose contains</label>
            <input value={filterPurpose} onChange={e => setFilterPurpose(e.target.value)}
              placeholder="any" className={inp + ' min-w-[140px]'} />
          </div>
          <div className="min-w-0">
            <label className={lbl}>Status</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={inp + ' min-w-[130px]'}>
              <option value="">All</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className={lbl}>Row limit</label>
            <select value={filterLimit} onChange={e => setFilterLimit(Number(e.target.value))} className={inp + ' min-w-[100px]'}>
              {[100, 250, 500, 1000, 2500].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="px-4 py-2.5 rounded-xl text-white text-sm font-bold"
              style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>Apply</button>
            <button onClick={() => {
              setFromDate(firstOfYear); setToDate(today)
              setFilterBranch(''); setFilterSource(''); setFilterPurpose('')
              setFilterStatus(''); setFilterLimit(500); setGiftAidOnly(false); setSearch('')
            }}
              className="px-4 py-2.5 rounded-xl border border-white/10 text-white/50 text-sm font-semibold hover:bg-white/5">Reset</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3 items-center pt-2 border-t border-white/5">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search donor / purpose / reference / payment ref…"
            className={inp + ' flex-1 min-w-[220px]'} />
          <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer select-none px-3 py-2.5 rounded-xl border border-white/10 hover:bg-white/5">
            <input type="checkbox" checked={giftAidOnly} onChange={e => setGiftAidOnly(e.target.checked)}
              className="w-4 h-4 accent-saffron-500" />
            <span className="text-base">🇬🇧</span>
            <span className="font-bold">Gift Aid only</span>
          </label>
          <div className="relative">
            <button onClick={() => setShowColMenu(v => !v)}
              className="px-4 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/5">
              ⚙ Columns ({visibleCols.size})
            </button>
            {showColMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowColMenu(false)} />
                <div className="absolute right-0 mt-2 w-60 bg-temple-deep border border-white/10 rounded-xl shadow-2xl p-3 z-40">
                  <p className="text-[10px] font-bold text-white/40 uppercase mb-2">Show columns</p>
                  <div className="space-y-1.5">
                    {ALL_COLUMNS.map(c => (
                      <label key={c.key}
                        className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg cursor-pointer ${c.always ? 'opacity-60 cursor-not-allowed' : 'hover:bg-white/5'}`}>
                        <input type="checkbox"
                          checked={isVisible(c.key)} disabled={c.always}
                          onChange={() => !c.always && toggleCol(c.key)}
                          className="w-4 h-4 accent-saffron-500" />
                        <span className="text-white/80">{c.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
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
            sub:   `${gaEligibleCount} of ${visibleDonations.length} eligible · 25% reclaim`,
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
                  {isVisible('gift_aid') && (
                    <th className="text-center px-3 py-3 text-white/40 text-xs font-semibold uppercase">🇬🇧 GA</th>
                  )}
                  {isVisible('date') && (
                    <th onClick={() => toggleSort('date')}
                      className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase cursor-pointer select-none hover:text-white/70">
                      Date {sortBy === 'date' && <span className="ml-1 text-saffron-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  )}
                  {isVisible('amount') && (
                    <th onClick={() => toggleSort('amount')}
                      className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase cursor-pointer select-none hover:text-white/70">
                      Amount {sortBy === 'amount' && <span className="ml-1 text-saffron-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  )}
                  {isVisible('contact') && (
                    <th className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase">Donor</th>
                  )}
                  {isVisible('purpose') && (
                    <th onClick={() => toggleSort('purpose')}
                      className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase cursor-pointer select-none hover:text-white/70">
                      Purpose {sortBy === 'purpose' && <span className="ml-1 text-saffron-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  )}
                  {isVisible('branch') && (
                    <th onClick={() => toggleSort('branch_id')}
                      className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase cursor-pointer select-none hover:text-white/70">
                      Branch {sortBy === 'branch_id' && <span className="ml-1 text-saffron-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  )}
                  {isVisible('source') && (
                    <th className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase">Source</th>
                  )}
                  {isVisible('donation_type') && (
                    <th className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase">Type</th>
                  )}
                  {isVisible('payment_provider') && (
                    <th onClick={() => toggleSort('payment_provider')}
                      className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase cursor-pointer select-none hover:text-white/70">
                      Method {sortBy === 'payment_provider' && <span className="ml-1 text-saffron-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  )}
                  {isVisible('payment_ref') && (
                    <th className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase">Payment Ref</th>
                  )}
                  {isVisible('reference') && (
                    <th className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase">Reference</th>
                  )}
                  {isVisible('status') && (
                    <th onClick={() => toggleSort('status')}
                      className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase cursor-pointer select-none hover:text-white/70">
                      Status {sortBy === 'status' && <span className="ml-1 text-saffron-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  )}
                  {canEdit && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {sortedDonations.map((d, i) => (
                  <motion.tr key={d.id}
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.01 }}
                    className={`border-b border-white/5 hover:bg-white/3 transition-colors ${
                      d.gift_aid_eligible ? 'bg-blue-500/[0.04]' : ''
                    }`}
                    style={d.gift_aid_eligible ? { borderLeft: '3px solid #3B82F6' } : { borderLeft: '3px solid transparent' }}
                  >
                    {isVisible('gift_aid') && (
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {d.gift_aid_eligible ? (
                          <div className="inline-flex flex-col items-center gap-0.5">
                            <span className="inline-flex items-center gap-1 text-xs font-black px-2.5 py-0.5 rounded-full bg-blue-500/25 text-blue-100 border border-blue-400/50 shadow shadow-blue-500/20">
                              🇬🇧 Yes
                            </span>
                            {Number(d.gift_aid_amount) > 0 && (
                              <span className="text-[10px] font-mono font-bold text-blue-300">
                                +£{Number(d.gift_aid_amount).toFixed(2)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10">No</span>
                        )}
                      </td>
                    )}
                    {isVisible('date') && (
                      <td className="px-4 py-3 text-white/60 text-sm whitespace-nowrap">
                        <div>{new Date(d.created_at).toLocaleDateString('en-GB')}</div>
                        <div className="text-xs text-white/40 font-mono">
                          {new Date(d.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                    )}
                    {isVisible('amount') && (
                      <td className="px-4 py-3 font-mono font-bold text-saffron-400 whitespace-nowrap">
                        £{Number(d.amount).toFixed(2)}
                      </td>
                    )}
                    {isVisible('contact') && (
                      <td className="px-4 py-3 text-white/80 text-sm">
                        {d.contact_name ? (
                          <div>
                            <div className="font-semibold">{d.contact_name}</div>
                            {d.contact_email && <div className="text-white/40 text-[11px] truncate max-w-[200px]">{d.contact_email}</div>}
                          </div>
                        ) : (
                          <span className="text-white/30 italic">anonymous</span>
                        )}
                      </td>
                    )}
                    {isVisible('purpose') && (
                      <td className="px-4 py-3 text-white/70 text-sm">{d.purpose}</td>
                    )}
                    {isVisible('branch') && (
                      <td className="px-4 py-3 text-white/50 text-sm">{branchName(d.branch_id)}</td>
                    )}
                    {isVisible('source') && (
                      <td className="px-4 py-3 text-white/50 text-xs font-mono">{d.source}</td>
                    )}
                    {isVisible('donation_type') && (
                      <td className="px-4 py-3 text-xs">
                        <span className={`px-2 py-0.5 rounded-full border ${
                          d.donation_type === 'recurring'
                            ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                            : 'bg-white/5 text-white/50 border-white/10'
                        }`}>
                          {d.donation_type === 'recurring' ? '🔄 recurring' : 'one-time'}
                        </span>
                      </td>
                    )}
                    {isVisible('payment_provider') && (
                      <td className="px-4 py-3 text-white/50 text-xs capitalize">{d.payment_provider}</td>
                    )}
                    {isVisible('payment_ref') && (
                      <td className="px-4 py-3 text-white/50 text-xs font-mono truncate max-w-[180px]" title={d.payment_ref || ''}>
                        {d.payment_ref || '—'}
                      </td>
                    )}
                    {isVisible('reference') && (
                      <td className="px-4 py-3 text-white/50 text-xs">{d.reference || '—'}</td>
                    )}
                    {isVisible('status') && (
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                          d.status === 'COMPLETED' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                          d.status === 'PENDING'   ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                                                     'bg-red-500/20 text-red-400 border-red-500/30'
                        }`}>{d.status}</span>
                      </td>
                    )}
                    {canEdit && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => setTaggingDonation(d)}
                          className="text-white/40 hover:text-saffron-400 text-sm font-medium px-2 py-1" title="Tag to project">
                          {d.project_name ? <span className="text-saffron-300 text-xs">🏗️ {d.project_name.slice(0,16)}</span> : '🏗️ Tag'}
                        </button>
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

      {/* Tag-to-project modal */}
      <AnimatePresence>
        {taggingDonation && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setTaggingDonation(null)} className="fixed inset-0 bg-black/70 z-40" />
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92%] max-w-md bg-temple-deep border border-white/10 rounded-2xl z-50 p-5 space-y-4">
              <div>
                <h3 className="text-white font-black text-lg">🏗️ Tag donation to a project</h3>
                <p className="text-white/40 text-xs mt-1">
                  Attributes this {typeof taggingDonation.amount === 'number' ? `£${taggingDonation.amount}` : `£${taggingDonation.amount}`} {taggingDonation.purpose} donation to a project's incoming funds.
                </p>
              </div>
              {taggingDonation.project_name && (
                <p className="text-saffron-300 text-xs bg-saffron-500/10 border border-saffron-500/30 rounded-lg p-2">
                  Currently tagged to <b>{taggingDonation.project_name}</b>
                </p>
              )}
              <ProjectPicker
                value={taggingDonation.project_id ? { id: taggingDonation.project_id, name: taggingDonation.project_name || '' } : null}
                onChange={sel => tagDonationToProject(taggingDonation, sel?.id || null)}
                placeholder="Search projects…"
              />
              <div className="flex justify-between gap-3 pt-1">
                <button onClick={() => tagDonationToProject(taggingDonation, null)} className="text-red-400 text-xs hover:underline">Untag</button>
                <button onClick={() => setTaggingDonation(null)} className="text-white/40 hover:text-white text-xs">Cancel</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
