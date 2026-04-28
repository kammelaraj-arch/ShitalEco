'use client'
import { useState, useEffect, useCallback, Fragment } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch, API_BASE, getToken } from '@/lib/api'

interface GiftAidConfig {
  hmrc_user_id: string
  hmrc_charity_ref: string
  hmrc_environment: string
  hmrc_credentials_set: boolean
  hmrc_vendor_id: string
  getaddress_api_key_set: boolean
  getaddress_api_key_preview: string
  charity_number: string
}

interface Declaration {
  id: string
  full_name: string
  first_name?: string
  surname?: string
  house_number?: string
  contact_email: string
  postcode: string
  address: string
  donation_amount: number
  donation_date: string
  hmrc_submitted: boolean
  hmrc_submission_ref: string
  order_ref: string
  created_at: string
}

interface Submission {
  id: string
  correlation_id: string
  status: string
  declarations_count: number
  total_donated: number
  amount_claimed: number
  hmrc_reference: string
  environment: string
  errors: string
  submitted_at: string
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

function EnvBadge({ env }: { env: string }) {
  const isLive = env === 'live'
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border ${
      isLive
        ? 'bg-green-500/20 text-green-300 border-green-500/40'
        : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    }`}>
      <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
      {isLive ? 'LIVE' : 'TEST MODE'}
    </span>
  )
}

interface SummaryData {
  year: number
  declarations_total: number
  declarations_pending: number
  donations_total: number
  donations_pending: number
  potential_claim: number
  submissions_total: number
  claimed_ytd: number
  gasds_total: number
  gasds_unclaimed: number
  gasds_records: number
  gasds_cap: number
  error?: string
}

interface GASDSCollection {
  id: string
  collection_date: string
  amount: number
  branch_id: string | null
  location: string
  description: string
  tax_year: number | null
  claimed_at: string | null
}

interface Branch {
  id: string
  branch_id: string
  name: string
}

interface GASDSBuilding {
  branch_id: string
  name: string
  total: number
  unclaimed: number
  claimed: number
  records: number
  cap: number
  cap_remaining: number
  cap_used_pct: number
  potential_claim: number
}

const fmtGBP = (n: number | string) =>
  `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Trigger a CSV download via the auth-protected API
async function downloadCsv(path: string, filename: string) {
  const r = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function GiftAidPage() {
  const [tab, setTab] = useState<'declarations' | 'submit' | 'history' | 'gasds'>('declarations')

  // Config
  const [config, setConfig] = useState<GiftAidConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(false)

  // Summary
  const [summary, setSummary] = useState<SummaryData | null>(null)

  // History expansion + detail
  const [expandedSubmissionId, setExpandedSubmissionId] = useState<string | null>(null)
  const [submissionDetail, setSubmissionDetail] = useState<{ declarations: Declaration[] } | null>(null)
  const [submissionDetailLoading, setSubmissionDetailLoading] = useState(false)

  // GASDS
  const [gasdsCollections, setGasdsCollections] = useState<GASDSCollection[]>([])
  const [gasdsLoading, setGasdsLoading] = useState(false)
  const [gasdsForm, setGasdsForm] = useState({ date: '', amount: '', branch_id: '', description: '' })
  const [gasdsAdding, setGasdsAdding] = useState(false)
  const [gasdsError, setGasdsError] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [gasdsBuildings, setGasdsBuildings] = useState<GASDSBuilding[]>([])

  // Declarations
  const [declarations, setDeclarations] = useState<Declaration[]>([])
  const [declLoading, setDeclLoading] = useState(false)
  const [declError, setDeclError] = useState('')
  const [showSubmitted, setShowSubmitted] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Date-range filter (controls both the list view and the submission scope)
  type RangePreset = 'all' | 'this-month' | 'last-month' | 'this-quarter' | 'last-quarter' | 'custom'
  const [rangePreset, setRangePreset] = useState<RangePreset>('last-month')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const yyyy = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const startOfMonth   = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
  const endOfMonth     = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const startOfQuarter = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)
  const endOfQuarter   = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0)

  const applyPreset = (preset: RangePreset) => {
    setRangePreset(preset)
    const now = new Date()
    if (preset === 'all') { setFromDate(''); setToDate(''); return }
    if (preset === 'this-month') {
      setFromDate(yyyy(startOfMonth(now))); setToDate(yyyy(endOfMonth(now))); return
    }
    if (preset === 'last-month') {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      setFromDate(yyyy(startOfMonth(lm))); setToDate(yyyy(endOfMonth(lm))); return
    }
    if (preset === 'this-quarter') {
      setFromDate(yyyy(startOfQuarter(now))); setToDate(yyyy(endOfQuarter(now))); return
    }
    if (preset === 'last-quarter') {
      const lq = new Date(now.getFullYear(), now.getMonth() - 3, 1)
      setFromDate(yyyy(startOfQuarter(lq))); setToDate(yyyy(endOfQuarter(lq))); return
    }
    // 'custom' — keep user-typed fromDate / toDate as-is
  }

  // Initialize range to "Last Month" on mount (best practice for monthly HMRC batches)
  useEffect(() => { applyPreset('last-month') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Submit
  const [claimToDate, setClaimToDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<Record<string, unknown> | null>(null)
  const [submitError, setSubmitError] = useState('')
  const [showXml, setShowXml] = useState(false)
  const [xmlPreview, setXmlPreview] = useState('')
  const [xmlLoading, setXmlLoading] = useState(false)

  // History
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [histLoading, setHistLoading] = useState(false)

  const loadConfig = useCallback(async () => {
    setConfigLoading(true)
    try {
      const data = await apiFetch<GiftAidConfig>('/gift-aid/config')
      setConfig(data)
    } catch {
      // config may not exist yet
    } finally {
      setConfigLoading(false)
    }
  }, [])

  const loadDeclarations = useCallback(async () => {
    setDeclLoading(true); setDeclError('')
    try {
      const qs = new URLSearchParams()
      if (!showSubmitted) qs.set('submitted', 'false')
      if (fromDate) qs.set('from_date', fromDate)
      if (toDate) qs.set('to_date', toDate)
      qs.set('limit', '500')
      const data = await apiFetch<{ declarations: Declaration[] }>(`/gift-aid/declarations?${qs.toString()}`)
      setDeclarations(data.declarations || [])
    } catch (e: unknown) {
      setDeclError(e instanceof Error ? e.message : 'Failed to load declarations')
    } finally {
      setDeclLoading(false)
    }
  }, [showSubmitted, fromDate, toDate])

  const loadHistory = useCallback(async () => {
    setHistLoading(true)
    try {
      const data = await apiFetch<{ submissions: Submission[] }>('/gift-aid/submissions?limit=50')
      setSubmissions(data.submissions || [])
    } catch { /* empty submissions table */ } finally { setHistLoading(false) }
  }, [])

  const loadSummary = useCallback(async () => {
    try {
      const data = await apiFetch<SummaryData>('/gift-aid/summary')
      setSummary(data)
    } catch { /* ignore — summary failure is non-critical */ }
  }, [])

  const loadSubmissionDetail = async (id: string) => {
    if (expandedSubmissionId === id) {
      setExpandedSubmissionId(null)
      setSubmissionDetail(null)
      return
    }
    setExpandedSubmissionId(id)
    setSubmissionDetailLoading(true)
    try {
      const data = await apiFetch<{ declarations: Declaration[] }>(`/gift-aid/submissions/${id}`)
      setSubmissionDetail({ declarations: data.declarations || [] })
    } catch {
      setSubmissionDetail({ declarations: [] })
    } finally {
      setSubmissionDetailLoading(false)
    }
  }

  const loadGasds = useCallback(async () => {
    setGasdsLoading(true)
    try {
      const year = new Date().getFullYear()
      const [list, buildings, brs] = await Promise.all([
        apiFetch<{ collections: GASDSCollection[] }>(`/gift-aid/gasds/collections?year=${year}`),
        apiFetch<{ buildings: GASDSBuilding[] }>(`/gift-aid/gasds/buildings?year=${year}`),
        apiFetch<{ branches: Branch[] }>('/branches').catch(() => ({ branches: [] })),
      ])
      setGasdsCollections(list.collections || [])
      setGasdsBuildings(buildings.buildings || [])
      setBranches(brs.branches || [])
    } catch { /* ignore */ } finally { setGasdsLoading(false) }
  }, [])

  const addGasdsCollection = async () => {
    setGasdsError('')
    if (!gasdsForm.date || !gasdsForm.amount) {
      setGasdsError('Date and amount are required')
      return
    }
    if (!gasdsForm.branch_id) {
      setGasdsError('Building is required — pick which branch this cash was collected at (HMRC caps GASDS per building)')
      return
    }
    setGasdsAdding(true)
    try {
      await apiFetch<{ ok: boolean }>('/gift-aid/gasds/collections', {
        method: 'POST',
        body: JSON.stringify({
          collection_date: gasdsForm.date,
          amount: gasdsForm.amount,
          branch_id: gasdsForm.branch_id,
          description: gasdsForm.description,
        }),
      })
      setGasdsForm({ date: '', amount: '', branch_id: gasdsForm.branch_id, description: '' })
      await loadGasds()
      await loadSummary()
    } catch (e: unknown) {
      setGasdsError(e instanceof Error ? e.message : 'Failed to add')
    } finally {
      setGasdsAdding(false)
    }
  }

  const deleteGasdsCollection = async (id: string) => {
    if (!confirm('Delete this GASDS collection record?')) return
    try {
      await apiFetch(`/gift-aid/gasds/collections/${id}`, { method: 'DELETE' })
      await loadGasds()
      await loadSummary()
    } catch { /* ignore */ }
  }

  const markGasdsClaimed = async () => {
    const ids = gasdsCollections.filter(c => !c.claimed_at).map(c => c.id)
    if (ids.length === 0) return
    if (!confirm(`Mark ${ids.length} unclaimed collection(s) as claimed? Use this AFTER you've submitted them via HMRC's portal.`)) return
    try {
      await apiFetch('/gift-aid/gasds/mark-claimed', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      })
      await loadGasds()
      await loadSummary()
    } catch { /* ignore */ }
  }

  useEffect(() => {
    // Config moved to Settings → Gift Aid (admin function, not daily ops).
    // Always load config in the background so the env badge stays accurate.
    loadConfig()
    if (tab === 'declarations') { loadDeclarations(); loadSummary() }
    else if (tab === 'history') loadHistory()
    else if (tab === 'gasds') { loadGasds(); loadSummary() }
  }, [tab, loadConfig, loadDeclarations, loadHistory, loadSummary, loadGasds])

  useEffect(() => { loadSummary() }, [loadSummary])

  useEffect(() => {
    if (tab === 'declarations' || tab === 'submit') loadDeclarations()
  }, [showSubmitted, fromDate, toDate]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAll = () => {
    const pending = declarations.filter(d => !d.hmrc_submitted)
    if (selectedIds.size === pending.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(pending.map(d => d.id)))
    }
  }

  const loadXmlPreview = async () => {
    setXmlLoading(true)
    try {
      const ids = selectedIds.size > 0 ? Array.from(selectedIds) : []
      const data = await apiFetch<{ xml: string; declarations_count: number; amount_claimed: number }>(
        '/gift-aid/preview-xml',
        { method: 'POST', body: JSON.stringify({ declaration_ids: ids, claim_to_date: claimToDate || null }) }
      )
      setXmlPreview(data.xml || '')
    } catch (e: unknown) {
      setXmlPreview(e instanceof Error ? e.message : 'Failed to load preview')
    } finally {
      setXmlLoading(false)
    }
  }

  // Submission scope priority:
  //   1. Explicit checkbox selection
  //   2. Date-range filter (if active) → submits the currently-listed pending decls
  //   3. All unsubmitted (legacy fallback)
  const submissionScope = (): { ids: string[]; label: string } => {
    if (selectedIds.size > 0) {
      return { ids: Array.from(selectedIds), label: `${selectedIds.size} selected` }
    }
    if (fromDate || toDate) {
      const ids = declarations.filter(d => !d.hmrc_submitted).map(d => d.id)
      const range = `${fromDate || '…'} → ${toDate || 'today'}`
      return { ids, label: `${ids.length} filtered (${range})` }
    }
    return { ids: [], label: `all ${pendingCount} unsubmitted` }
  }

  const handleSubmit = async () => {
    const { ids, label } = submissionScope()
    const env = (config?.hmrc_environment || 'test').toUpperCase()
    if (!confirm(`Submit ${label} declaration(s) to HMRC ${env}?\n\nThis cannot be undone.`)) return
    setSubmitting(true); setSubmitResult(null); setSubmitError('')
    try {
      const res = await apiFetch<Record<string, unknown>>('/gift-aid/submit-to-hmrc', {
        method: 'POST',
        body: JSON.stringify({ declaration_ids: ids, claim_to_date: claimToDate || null }),
      })
      setSubmitResult(res)
      setSelectedIds(new Set())
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  const pendingCount = declarations.filter(d => !d.hmrc_submitted).length
  const pendingTotal = declarations.filter(d => !d.hmrc_submitted)
    .reduce((s, d) => s + Number(d.donation_amount), 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Gift Aid</h1>
          <p className="text-white/40 mt-1">HMRC Charities Online — R68 Gift Aid claims</p>
        </div>
        {config && <EnvBadge env={config.hmrc_environment || 'test'} />}
      </div>

      {/* YTD summary banner */}
      {summary && !summary.error && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="glass rounded-xl px-4 py-3">
            <p className="text-white/40 text-xs uppercase tracking-wider">Claimed YTD</p>
            <p className="text-green-400 font-black text-lg">{fmtGBP(summary.claimed_ytd)}</p>
            <p className="text-white/30 text-xs">{summary.submissions_total} submission(s) {summary.year}</p>
          </div>
          <div className="glass rounded-xl px-4 py-3">
            <p className="text-white/40 text-xs uppercase tracking-wider">Potential to claim</p>
            <p className="text-saffron-400 font-black text-lg">{fmtGBP(summary.potential_claim)}</p>
            <p className="text-white/30 text-xs">{summary.declarations_pending} pending</p>
          </div>
          <div className="glass rounded-xl px-4 py-3">
            <p className="text-white/40 text-xs uppercase tracking-wider">Donations YTD</p>
            <p className="text-white font-black text-lg">{fmtGBP(summary.donations_total)}</p>
            <p className="text-white/30 text-xs">{summary.declarations_total} declaration(s)</p>
          </div>
          <div className="glass rounded-xl px-4 py-3">
            <p className="text-white/40 text-xs uppercase tracking-wider">GASDS YTD</p>
            <p className="text-white font-black text-lg">{fmtGBP(summary.gasds_total)}</p>
            <p className="text-white/30 text-xs">{fmtGBP(summary.gasds_unclaimed)} unclaimed · cap {fmtGBP(summary.gasds_cap)}</p>
          </div>
          <div className="glass rounded-xl px-4 py-3">
            <p className="text-white/40 text-xs uppercase tracking-wider">GASDS potential</p>
            <p className="text-green-400/80 font-black text-lg">{fmtGBP(summary.gasds_unclaimed * 0.25)}</p>
            <p className="text-white/30 text-xs">25% of unclaimed cash</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit flex-wrap">
        {(['declarations', 'submit', 'history', 'gasds'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all capitalize ${
              tab === t ? 'bg-saffron-gradient text-white shadow-saffron' : 'text-white/50 hover:text-white/80'
            }`}>
            {t === 'submit' ? 'Submit to HMRC'
              : t === 'history' ? 'History'
              : t === 'gasds' ? 'GASDS (Cash)'
              : t === 'declarations' ? `Declarations${pendingCount > 0 && !showSubmitted ? ` (${pendingCount})` : ''}`
              : t}
          </button>
        ))}
        <a href="/settings/gift-aid"
          className="px-4 py-2.5 rounded-lg text-sm font-medium text-white/40 hover:text-white/80 transition-all">
          ⚙️ Config
        </a>
      </div>

      <AnimatePresence mode="wait">
        {/* Declarations tab */}
        {tab === 'declarations' && (
          <motion.div key="decls" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-4">

            {/* Date-range filter */}
            <div className="glass rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white/50 text-xs uppercase tracking-wider font-semibold mr-1">Date range:</span>
                  {([
                    { key: 'last-month',   label: 'Last Month',   recommended: true },
                    { key: 'this-month',   label: 'This Month' },
                    { key: 'last-quarter', label: 'Last Quarter' },
                    { key: 'this-quarter', label: 'This Quarter' },
                    { key: 'all',          label: 'All time' },
                    { key: 'custom',       label: 'Custom' },
                  ] as { key: RangePreset; label: string; recommended?: boolean }[]).map(p => (
                    <button
                      key={p.key}
                      onClick={() => applyPreset(p.key)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        rangePreset === p.key
                          ? 'bg-saffron-gradient text-white shadow-saffron'
                          : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80 border border-white/10'
                      }`}
                    >
                      {p.label}{p.recommended && rangePreset !== p.key ? ' ★' : ''}
                    </button>
                  ))}
                </div>
              </div>

              {(rangePreset === 'custom' || (fromDate || toDate)) && (
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-white/40 text-xs">From</label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={e => { setFromDate(e.target.value); setRangePreset('custom') }}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm outline-none focus:border-saffron-400/50"
                  />
                  <label className="text-white/40 text-xs">To</label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={e => { setToDate(e.target.value); setRangePreset('custom') }}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm outline-none focus:border-saffron-400/50"
                  />
                  {(fromDate || toDate) && (
                    <button
                      onClick={() => applyPreset('all')}
                      className="text-white/40 text-xs hover:text-red-400 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              <p className="text-white/30 text-xs">
                ⭐ <span className="text-saffron-400/80">Last Month</span> is the recommended cadence — most UK charities batch monthly to HMRC for the best balance of cashflow and admin overhead.
              </p>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <button onClick={toggleAll}
                  className="px-4 py-2 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/5 transition-all">
                  {selectedIds.size === pendingCount && pendingCount > 0 ? 'Deselect All' : 'Select All Pending'}
                </button>
                {selectedIds.size > 0 && (
                  <span className="text-saffron-400 text-sm font-bold">{selectedIds.size} selected</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-white/50 text-sm cursor-pointer select-none">
                  <input type="checkbox" checked={showSubmitted} onChange={e => setShowSubmitted(e.target.checked)}
                    className="w-4 h-4 rounded" />
                  Show submitted
                </label>
                <button
                  onClick={() => {
                    const qs = new URLSearchParams()
                    if (!showSubmitted) qs.set('submitted', 'false')
                    if (fromDate) qs.set('from_date', fromDate)
                    if (toDate) qs.set('to_date', toDate)
                    qs.set('limit', '10000')
                    downloadCsv(`/gift-aid/declarations.csv?${qs}`, `gift-aid-declarations-${new Date().toISOString().slice(0, 10)}.csv`)
                      .catch(() => alert('Export failed'))
                  }}
                  className="px-3 py-2 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/5 transition-all"
                >
                  ⬇ Export CSV
                </button>
              </div>
            </div>

            {declError && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{declError}</div>}

            <div className="glass rounded-2xl overflow-hidden border border-temple-border">
              {declLoading ? (
                <div className="text-center py-20 text-white/30">Loading declarations…</div>
              ) : declarations.length === 0 ? (
                <div className="text-center py-20 text-white/30">
                  <p className="text-4xl mb-3">🇬🇧</p>
                  <p>{showSubmitted ? 'No declarations found.' : 'No pending declarations — all submitted!'}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th className="px-4 py-3 w-8"></th>
                        {['First name', 'Surname', 'House #', 'Postcode', 'Email', 'Donation', 'Date', 'Status'].map(h => (
                          <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {declarations.map((d, i) => (
                        <motion.tr key={d.id}
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                          className={`border-b border-white/5 transition-colors cursor-pointer ${
                            selectedIds.has(d.id) ? 'bg-saffron-400/5' : 'hover:bg-white/3'
                          } ${d.hmrc_submitted ? 'opacity-50' : ''}`}
                          onClick={() => {
                            if (d.hmrc_submitted) return
                            const next = new Set(selectedIds)
                            if (next.has(d.id)) next.delete(d.id)
                            else next.add(d.id)
                            setSelectedIds(next)
                          }}>
                          <td className="px-4 py-3">
                            {!d.hmrc_submitted && (
                              <input type="checkbox" checked={selectedIds.has(d.id)} readOnly
                                className="w-4 h-4 rounded accent-amber-400 pointer-events-none" />
                            )}
                          </td>
                          <td className="px-4 py-3 text-white font-medium text-sm">
                            {d.first_name || (d.full_name?.split(' ', 1)[0] || '—')}
                          </td>
                          <td className="px-4 py-3 text-white font-medium text-sm">
                            {d.surname || (d.full_name?.includes(' ') ? d.full_name.split(' ').slice(1).join(' ') : '—')}
                          </td>
                          <td className="px-4 py-3 text-white/70 text-sm font-mono">
                            {d.house_number || (d.address ? d.address.split(',')[0].trim() : '—')}
                          </td>
                          <td className="px-4 py-3 text-white/60 text-sm font-mono">{d.postcode}</td>
                          <td className="px-4 py-3 text-white/50 text-xs truncate max-w-[180px]" title={d.contact_email}>
                            {d.contact_email || '—'}
                          </td>
                          <td className="px-4 py-3 font-mono font-bold text-white text-sm">
                            £{Number(d.donation_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-white/50 text-sm">
                            {d.donation_date ? new Date(d.donation_date).toLocaleDateString('en-GB') : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                              d.hmrc_submitted
                                ? 'bg-green-500/15 text-green-400 border-green-500/30'
                                : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                            }`}>
                              {d.hmrc_submitted ? 'Submitted' : 'Pending'}
                            </span>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Pending summary bar */}
            {pendingCount > 0 && !showSubmitted && (
              <div className="glass rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-white/40 text-xs">Pending Declarations</p>
                    <p className="text-white font-black text-xl">{pendingCount}</p>
                  </div>
                  <div>
                    <p className="text-white/40 text-xs">Total Donations</p>
                    <p className="text-white font-black text-xl">£{pendingTotal.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div>
                    <p className="text-white/40 text-xs">Gift Aid to Claim (25%)</p>
                    <p className="text-green-400 font-black text-xl">£{(pendingTotal * 0.25).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
                <button onClick={() => setTab('submit')}
                  className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-black text-sm shadow-saffron">
                  Submit to HMRC →
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* Submit tab */}
        {tab === 'submit' && (
          <motion.div key="submit" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-4 max-w-2xl">

            {config && (
              <div className={`glass rounded-xl p-4 flex items-center gap-4 border ${
                config.hmrc_environment === 'live'
                  ? 'border-green-500/30'
                  : 'border-amber-500/30'
              }`}>
                <EnvBadge env={config.hmrc_environment || 'test'} />
                <div>
                  <p className="text-white text-sm font-semibold">
                    {config.hmrc_environment === 'live' ? 'Live HMRC Submission' : 'Test HMRC Submission'}
                  </p>
                  <p className="text-white/40 text-xs">
                    {config.hmrc_environment === 'live'
                      ? 'This will submit a real claim to HMRC Charities Online.'
                      : 'Using HMRC test endpoint — no real claim will be processed.'}
                  </p>
                </div>
              </div>
            )}

            <div className="glass rounded-2xl p-6 space-y-4">
              <h2 className="text-white font-bold text-lg">Submit Gift Aid Claim</h2>

              <div>
                <label className={lbl}>Claim to Date (optional)</label>
                <input type="date" value={claimToDate} onChange={e => setClaimToDate(e.target.value)} className={inp} />
                <p className="text-white/30 text-xs mt-1">Leave blank to use today&apos;s date as the claim period end.</p>
              </div>

              <div className="p-3 bg-white/5 rounded-xl border border-white/10 text-sm space-y-1">
                {selectedIds.size > 0 ? (
                  <p className="text-white/70">
                    Submitting <span className="text-saffron-400 font-bold">{selectedIds.size} selected</span> declaration(s)
                  </p>
                ) : (fromDate || toDate) ? (
                  <p className="text-white/70">
                    Submitting <span className="text-saffron-400 font-bold">{pendingCount}</span> declaration(s) in range{' '}
                    <span className="font-mono text-white/80">{fromDate || '…'}</span> →{' '}
                    <span className="font-mono text-white/80">{toDate || 'today'}</span>
                    {pendingCount > 0 && (
                      <>{' '}(£{pendingTotal.toLocaleString('en-GB', { minimumFractionDigits: 2 })} → claiming £{(pendingTotal * 0.25).toLocaleString('en-GB', { minimumFractionDigits: 2 })})</>
                    )}
                  </p>
                ) : (
                  <p className="text-white/70">
                    Submitting <span className="text-white font-bold">all {pendingCount} unsubmitted</span> declaration(s)
                    {pendingCount > 0 && (
                      <>{' '}(£{pendingTotal.toLocaleString('en-GB', { minimumFractionDigits: 2 })} → claiming £{(pendingTotal * 0.25).toLocaleString('en-GB', { minimumFractionDigits: 2 })})</>
                    )}
                  </p>
                )}
                <p className="text-white/40 text-xs">
                  Tip: change the date range on the Declarations tab to control which donations get submitted.
                </p>
              </div>

              {/* XML Preview toggle */}
              <div>
                <button
                  onClick={async () => {
                    if (!showXml) { await loadXmlPreview() }
                    setShowXml(v => !v)
                  }}
                  className="text-saffron-400 text-sm font-semibold hover:text-saffron-300 transition-colors">
                  {showXml ? '▼ Hide XML Preview' : '▶ Preview GovTalk XML'}
                </button>
                {showXml && (
                  <div className="mt-3 bg-black/30 border border-white/10 rounded-xl p-4 max-h-72 overflow-auto">
                    {xmlLoading ? (
                      <p className="text-white/30 text-sm">Loading XML…</p>
                    ) : (
                      <pre className="text-white/60 text-xs whitespace-pre-wrap font-mono">{xmlPreview}</pre>
                    )}
                  </div>
                )}
              </div>

              {submitError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{submitError}</div>
              )}

              {submitResult && (
                <div className={`rounded-xl p-4 border ${
                  submitResult.status === 'submitted'
                    ? 'bg-green-500/10 border-green-500/30'
                    : 'bg-red-500/10 border-red-500/30'
                }`}>
                  <p className={`text-sm font-black mb-2 ${submitResult.status === 'submitted' ? 'text-green-400' : 'text-red-400'}`}>
                    {submitResult.status === 'submitted' ? '✓ Submitted to HMRC' : '✗ Submission Failed'}
                  </p>
                  {submitResult.status === 'submitted' && (
                    <div className="space-y-1 text-xs text-white/60">
                      <p>Correlation ID: <span className="font-mono text-white/80">{String(submitResult.correlation_id)}</span></p>
                      <p>Declarations: <span className="text-white/80">{String(submitResult.declarations_submitted)}</span></p>
                      <p>Amount to reclaim: <span className="text-green-400 font-bold">£{Number(submitResult.amount_claimed_from_hmrc).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span></p>
                      <p>Environment: <span className="text-white/80">{String(submitResult.environment)}</span></p>
                    </div>
                  )}
                  {Array.isArray(submitResult.errors) && submitResult.errors.length > 0 && (
                    <div className="mt-2 text-xs text-red-300">
                      {(submitResult.errors as string[]).map((e, i) => <p key={i}>{e}</p>)}
                    </div>
                  )}
                </div>
              )}

              <button onClick={handleSubmit} disabled={submitting || pendingCount === 0}
                className="w-full py-3.5 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40 shadow-saffron">
                {submitting ? 'Submitting to HMRC…' : `Submit to HMRC ${config?.hmrc_environment === 'live' ? '(LIVE)' : '(TEST)'}`}
              </button>
            </div>
          </motion.div>
        )}

        {/* History tab */}
        {tab === 'history' && (
          <motion.div key="history" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-3">
            <div className="flex justify-end">
              <button
                onClick={() => downloadCsv('/gift-aid/submissions.csv', `gift-aid-submissions-${new Date().toISOString().slice(0, 10)}.csv`).catch(() => alert('Export failed'))}
                className="px-4 py-2 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/5 transition-all"
              >
                ⬇ Export CSV
              </button>
            </div>
            <div className="glass rounded-2xl overflow-hidden border border-temple-border">
            {histLoading ? (
              <div className="text-center py-20 text-white/30">Loading history…</div>
            ) : submissions.length === 0 ? (
              <div className="text-center py-20 text-white/30">
                <p className="text-4xl mb-3">📋</p>
                <p>No submissions yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5">
                      {['', 'Date', 'Correlation ID', 'Declarations', 'Donated', 'Claimed', 'Env', 'Status'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((s, i) => (
                      <Fragment key={s.id}>
                      <motion.tr
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                        onClick={() => loadSubmissionDetail(s.id)}
                        className={`border-b border-white/5 transition-colors cursor-pointer ${
                          expandedSubmissionId === s.id ? 'bg-saffron-400/5' : 'hover:bg-white/3'
                        }`}>
                        <td className="px-4 py-3 text-white/40 text-sm">
                          {expandedSubmissionId === s.id ? '▼' : '▶'}
                        </td>
                        <td className="px-4 py-3 text-white/50 text-sm whitespace-nowrap">
                          {new Date(s.submitted_at).toLocaleDateString('en-GB')}{' '}
                          <span className="text-white/30 text-xs">{new Date(s.submitted_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-white/60 text-xs">{s.correlation_id}</td>
                        <td className="px-4 py-3 text-white text-sm">{s.declarations_count}</td>
                        <td className="px-4 py-3 font-mono text-white/70 text-sm">{fmtGBP(s.total_donated)}</td>
                        <td className="px-4 py-3 font-mono text-green-400 font-bold text-sm">{fmtGBP(s.amount_claimed)}</td>
                        <td className="px-4 py-3"><EnvBadge env={s.environment} /></td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                            s.status === 'submitted'
                              ? 'bg-green-500/15 text-green-400 border-green-500/30'
                              : 'bg-red-500/15 text-red-400 border-red-500/30'
                          }`}>
                            {s.status}
                          </span>
                          {s.errors && (
                            <p className="text-red-400/70 text-xs mt-1 max-w-[200px] truncate" title={s.errors}>{s.errors}</p>
                          )}
                        </td>
                      </motion.tr>
                      {expandedSubmissionId === s.id && (
                        <tr className="bg-black/20">
                          <td colSpan={8} className="px-6 py-4">
                            {submissionDetailLoading ? (
                              <p className="text-white/30 text-sm">Loading declarations…</p>
                            ) : !submissionDetail || submissionDetail.declarations.length === 0 ? (
                              <p className="text-white/40 text-sm">No declarations linked to this submission. (May predate linking — older submissions might not have associated declaration records.)</p>
                            ) : (
                              <div>
                                <p className="text-white/50 text-xs uppercase tracking-wider mb-2">
                                  {submissionDetail.declarations.length} declaration(s) in this batch:
                                </p>
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-white/40 text-xs">
                                      <th className="text-left py-1">Donor</th>
                                      <th className="text-left py-1">Postcode</th>
                                      <th className="text-right py-1">Donated</th>
                                      <th className="text-left py-1 pl-4">Date</th>
                                      <th className="text-left py-1 pl-4">Order Ref</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {submissionDetail.declarations.map(d => (
                                      <tr key={d.id} className="border-t border-white/5">
                                        <td className="py-1 text-white">{d.full_name}</td>
                                        <td className="py-1 text-white/60">{d.postcode}</td>
                                        <td className="py-1 text-right font-mono text-white">{fmtGBP(d.donation_amount)}</td>
                                        <td className="py-1 pl-4 text-white/50">
                                          {d.donation_date ? new Date(d.donation_date).toLocaleDateString('en-GB') : '—'}
                                        </td>
                                        <td className="py-1 pl-4 text-white/40 font-mono text-xs">{d.order_ref || '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          </motion.div>
        )}

        {/* GASDS tab */}
        {tab === 'gasds' && (
          <motion.div key="gasds" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-4">

            <div className="glass rounded-2xl p-5 space-y-2">
              <div className="flex items-start gap-3">
                <span className="text-2xl">💰</span>
                <div>
                  <h2 className="text-white font-bold text-lg">Gift Aid Small Donations Scheme (GASDS)</h2>
                  <p className="text-white/50 text-sm mt-1">
                    Claim 25% on cash bucket donations (under £30 each, no declaration needed). Annual cap:{' '}
                    <span className="text-saffron-400 font-bold">£8,000 per community building</span> — most temples qualify.
                  </p>
                  <p className="text-white/40 text-xs mt-2">
                    Record your weekly/monthly cash collection totals here. Submit the claim through HMRC&apos;s portal,
                    then click &quot;Mark all as claimed&quot; to update the audit trail.
                  </p>
                </div>
              </div>
            </div>

            {/* Per-building cap usage — HMRC caps £8,000/yr per community building */}
            {gasdsBuildings.length > 0 && (
              <div>
                <h3 className="text-white/70 font-semibold text-sm uppercase tracking-wider mb-2">
                  Per-building cap usage
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {gasdsBuildings.map(b => {
                    const overCap = b.total > b.cap
                    const nearCap = b.cap_used_pct > 80 && !overCap
                    return (
                      <div key={b.branch_id || 'none'} className="glass rounded-xl px-4 py-3 space-y-2"
                        style={{ borderLeft: `3px solid ${overCap ? '#f87171' : nearCap ? '#fbbf24' : '#22c55e'}` }}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-white font-bold text-sm">{b.name}</p>
                            <p className="text-white/30 text-xs">{b.records} record(s)</p>
                          </div>
                          {overCap && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
                              OVER CAP
                            </span>
                          )}
                        </div>
                        <div>
                          <p className="text-white/40 text-xs">Collected this year</p>
                          <p className="text-white font-mono font-bold">{fmtGBP(b.total)}</p>
                        </div>
                        {/* progress bar */}
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            style={{
                              width: `${Math.min(100, b.cap_used_pct)}%`,
                              background: overCap ? '#f87171' : nearCap ? '#fbbf24' : 'linear-gradient(90deg, #22c55e, #16a34a)',
                            }}
                            className="h-full rounded-full transition-all"
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/50">{b.cap_used_pct.toFixed(0)}% used</span>
                          <span className={overCap ? 'text-red-400 font-bold' : 'text-white/60'}>
                            {fmtGBP(b.cap_remaining)} left of {fmtGBP(b.cap)}
                          </span>
                        </div>
                        {b.unclaimed > 0 && (
                          <p className="text-saffron-400/80 text-xs">
                            ⚠ <span className="font-bold">{fmtGBP(b.unclaimed)}</span> unclaimed → claim{' '}
                            <span className="font-bold text-green-400">{fmtGBP(b.potential_claim)}</span> from HMRC
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {summary && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                <div className="glass rounded-xl px-4 py-3">
                  <p className="text-white/40 text-xs uppercase tracking-wider">All buildings — collected {summary.year}</p>
                  <p className="text-white font-black text-xl">{fmtGBP(summary.gasds_total)}</p>
                  <p className="text-white/30 text-xs">{summary.gasds_records} record(s)</p>
                </div>
                <div className="glass rounded-xl px-4 py-3">
                  <p className="text-white/40 text-xs uppercase tracking-wider">All buildings — unclaimed</p>
                  <p className="text-saffron-400 font-black text-xl">{fmtGBP(summary.gasds_unclaimed)}</p>
                  <p className="text-white/30 text-xs">→ claim {fmtGBP(summary.gasds_unclaimed * 0.25)} from HMRC</p>
                </div>
                <div className="glass rounded-xl px-4 py-3">
                  <p className="text-white/40 text-xs uppercase tracking-wider">Total cap pool</p>
                  <p className="text-white font-black text-xl">{fmtGBP(summary.gasds_cap * Math.max(1, gasdsBuildings.length))}</p>
                  <p className="text-white/30 text-xs">{fmtGBP(summary.gasds_cap)}/yr × {Math.max(1, gasdsBuildings.length)} building(s)</p>
                </div>
              </div>
            )}

            {/* Add new collection */}
            <div className="glass rounded-2xl p-5 space-y-3">
              <h3 className="text-white font-bold">Record cash collection</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className={lbl}>Date</label>
                  <input type="date" value={gasdsForm.date} onChange={e => setGasdsForm({ ...gasdsForm, date: e.target.value })} className={inp} />
                </div>
                <div>
                  <label className={lbl}>Amount (£)</label>
                  <input type="number" step="0.01" min="0" value={gasdsForm.amount} onChange={e => setGasdsForm({ ...gasdsForm, amount: e.target.value })} className={inp} placeholder="450.00" />
                </div>
                <div>
                  <label className={lbl}>Building (community building)</label>
                  <select
                    value={gasdsForm.branch_id}
                    onChange={e => setGasdsForm({ ...gasdsForm, branch_id: e.target.value })}
                    className={inp}
                  >
                    <option value="">— Select building —</option>
                    {branches.map(b => (
                      <option key={b.branch_id || b.id} value={b.branch_id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Description (optional)</label>
                  <input type="text" value={gasdsForm.description} onChange={e => setGasdsForm({ ...gasdsForm, description: e.target.value })} className={inp} placeholder="Sunday darshan bucket" />
                </div>
              </div>
              <p className="text-white/30 text-xs">
                💡 Each branch is treated as a separate community building for HMRC&apos;s £8,000/yr per-building cap.
              </p>
              {gasdsError && <p className="text-red-400 text-sm">{gasdsError}</p>}
              <button onClick={addGasdsCollection} disabled={gasdsAdding}
                className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold text-sm shadow-saffron disabled:opacity-50">
                {gasdsAdding ? 'Adding…' : '+ Add collection'}
              </button>
            </div>

            {/* List */}
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-white font-semibold">Collections {new Date().getFullYear()}</h3>
              <div className="flex gap-2">
                {summary && summary.gasds_unclaimed > 0 && (
                  <button onClick={markGasdsClaimed}
                    className="px-4 py-2 rounded-xl bg-green-500/15 border border-green-500/30 text-green-400 text-sm font-semibold hover:bg-green-500/25 transition-all">
                    ✓ Mark all unclaimed as claimed
                  </button>
                )}
              </div>
            </div>

            <div className="glass rounded-2xl overflow-hidden border border-temple-border">
              {gasdsLoading ? (
                <div className="text-center py-20 text-white/30">Loading…</div>
              ) : gasdsCollections.length === 0 ? (
                <div className="text-center py-20 text-white/30">
                  <p className="text-4xl mb-3">💷</p>
                  <p>No GASDS collections recorded yet.</p>
                  <p className="text-xs mt-1">Use the form above to record your first cash collection.</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5">
                      {['Date', 'Amount', 'Building', 'Description', 'Status', ''].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gasdsCollections.map(c => {
                      const branch = branches.find(b => b.branch_id === (c.branch_id || ''))
                      const buildingLabel = branch?.name || c.location || (c.branch_id || '—')
                      return (
                      <tr key={c.id} className="border-b border-white/5 hover:bg-white/3">
                        <td className="px-4 py-3 text-white/50 text-sm">{new Date(c.collection_date).toLocaleDateString('en-GB')}</td>
                        <td className="px-4 py-3 font-mono font-bold text-white">{fmtGBP(c.amount)}</td>
                        <td className="px-4 py-3 text-white/70 text-sm font-semibold">{buildingLabel}</td>
                        <td className="px-4 py-3 text-white/50 text-sm">{c.description || '—'}</td>
                        <td className="px-4 py-3">
                          {c.claimed_at ? (
                            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
                              Claimed
                            </span>
                          ) : (
                            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                              Unclaimed
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {!c.claimed_at && (
                            <button onClick={() => deleteGasdsCollection(c.id)}
                              className="text-red-400/60 hover:text-red-400 text-xs">
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ConfigRow({ label, value, set }: { label: string; value: string; set: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-4 bg-white/5 rounded-xl border border-white/10">
      <div>
        <p className="text-white/50 text-xs font-semibold uppercase tracking-wide">{label}</p>
        <p className="text-white text-sm font-mono mt-0.5">{value}</p>
      </div>
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
        set
          ? 'bg-green-500/15 text-green-400 border-green-500/30'
          : 'bg-red-500/15 text-red-400 border-red-500/30'
      }`}>
        {set ? '✓ Set' : '✗ Missing'}
      </span>
    </div>
  )
}
