'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

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

export default function GiftAidPage() {
  const [tab, setTab] = useState<'config' | 'declarations' | 'submit' | 'history'>('config')

  // Config
  const [config, setConfig] = useState<GiftAidConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(false)

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

  useEffect(() => {
    if (tab === 'config') loadConfig()
    else if (tab === 'declarations') loadDeclarations()
    else if (tab === 'history') loadHistory()
  }, [tab, loadConfig, loadDeclarations, loadHistory])

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

      {/* Tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit flex-wrap">
        {(['config', 'declarations', 'submit', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all capitalize ${
              tab === t ? 'bg-saffron-gradient text-white shadow-saffron' : 'text-white/50 hover:text-white/80'
            }`}>
            {t === 'submit' ? 'Submit to HMRC' : t === 'history' ? 'History' : t === 'declarations' ? `Declarations${pendingCount > 0 && !showSubmitted ? ` (${pendingCount})` : ''}` : t}
          </button>
        ))}
      </div>

      {/* Config tab */}
      <AnimatePresence mode="wait">
        {tab === 'config' && (
          <motion.div key="config" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="glass rounded-2xl p-6 space-y-5 max-w-2xl">
            {configLoading ? (
              <div className="text-center py-10 text-white/30">Loading config…</div>
            ) : config ? (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-white font-bold text-lg">HMRC Configuration</h2>
                  <EnvBadge env={config.hmrc_environment || 'test'} />
                </div>

                <div className="space-y-3">
                  <ConfigRow
                    label="Government Gateway User ID"
                    value={config.hmrc_user_id || '—'}
                    set={!!config.hmrc_user_id}
                  />
                  <ConfigRow
                    label="HMRC Password"
                    value={config.hmrc_credentials_set ? '••••••••' : 'Not set'}
                    set={config.hmrc_credentials_set}
                  />
                  <ConfigRow
                    label="Charity HMRC Reference"
                    value={config.hmrc_charity_ref || '—'}
                    set={!!config.hmrc_charity_ref}
                  />
                  <ConfigRow
                    label="Vendor ID"
                    value={config.hmrc_vendor_id || '—'}
                    set={!!config.hmrc_vendor_id}
                  />
                  <ConfigRow
                    label="Charity Number"
                    value={config.charity_number || '—'}
                    set={!!config.charity_number}
                  />
                  <ConfigRow
                    label="GetAddress.io API Key"
                    value={config.getaddress_api_key_set ? config.getaddress_api_key_preview : 'Not set'}
                    set={config.getaddress_api_key_set}
                  />
                  <ConfigRow
                    label="Submission Environment"
                    value={(config.hmrc_environment || 'test').toUpperCase()}
                    set={true}
                  />
                </div>

                <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                  <p className="text-amber-300 text-sm font-semibold mb-2">How to update credentials</p>
                  <p className="text-white/50 text-xs leading-relaxed">
                    Set these environment variables on your backend server and restart:
                  </p>
                  <div className="mt-2 space-y-1 font-mono text-xs text-white/40">
                    <div>HMRC_GIFT_AID_USER_ID=your-gateway-id</div>
                    <div>HMRC_GIFT_AID_PASSWORD=your-gateway-password</div>
                    <div>HMRC_GIFT_AID_CHARITY_HMO_REF=AB12345</div>
                    <div>HMRC_GIFT_AID_VENDOR_ID=your-vendor-id</div>
                    <div>HMRC_GIFT_AID_ENVIRONMENT=test  # or live</div>
                  </div>
                </div>

                {!config.hmrc_credentials_set && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <p className="text-red-300 text-sm font-semibold">Credentials not configured</p>
                    <p className="text-white/40 text-xs mt-1">
                      HMRC submissions will fail until credentials are set. Register at{' '}
                      <a href="https://www.gov.uk/guidance/charities-online" target="_blank" rel="noopener noreferrer"
                        className="text-saffron-400 underline">gov.uk/guidance/charities-online</a>.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-10 text-white/30">Failed to load config</div>
            )}
          </motion.div>
        )}

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
              <label className="flex items-center gap-2 text-white/50 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={showSubmitted} onChange={e => setShowSubmitted(e.target.checked)}
                  className="w-4 h-4 rounded" />
                Show submitted
              </label>
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
                        {['Donor', 'Postcode', 'Donation', 'Date', 'Order Ref', 'Status'].map(h => (
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
                          <td className="px-4 py-3 text-white font-medium text-sm">{d.full_name}</td>
                          <td className="px-4 py-3 text-white/60 text-sm">{d.postcode}</td>
                          <td className="px-4 py-3 font-mono font-bold text-white text-sm">
                            £{Number(d.donation_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-white/50 text-sm">
                            {d.donation_date ? new Date(d.donation_date).toLocaleDateString('en-GB') : '—'}
                          </td>
                          <td className="px-4 py-3 text-white/40 text-xs font-mono">{d.order_ref || '—'}</td>
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
            className="glass rounded-2xl overflow-hidden border border-temple-border">
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
                      {['Date', 'Correlation ID', 'Declarations', 'Donated', 'Claimed', 'Env', 'Status'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((s, i) => (
                      <motion.tr key={s.id}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                        className="border-b border-white/5 hover:bg-white/3 transition-colors">
                        <td className="px-4 py-3 text-white/50 text-sm whitespace-nowrap">
                          {new Date(s.submitted_at).toLocaleDateString('en-GB')}{' '}
                          <span className="text-white/30 text-xs">{new Date(s.submitted_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-white/60 text-xs">{s.correlation_id}</td>
                        <td className="px-4 py-3 text-white text-sm">{s.declarations_count}</td>
                        <td className="px-4 py-3 font-mono text-white/70 text-sm">
                          £{Number(s.total_donated).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 font-mono text-green-400 font-bold text-sm">
                          £{Number(s.amount_claimed).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3">
                          <EnvBadge env={s.environment} />
                        </td>
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
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
