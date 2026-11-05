'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

type Provider = 'stripe' | 'sumup' | 'paypal'

interface Txn {
  id: string
  provider: Provider
  external_id: string
  kind: string
  status: string
  amount_pence: number
  currency: string
  fee_pence: number
  net_pence: number
  description: string
  customer_hint: string
  payment_method_hint: string
  source_ref: string
  payout_ref: string
  provider_created_at: string
  synced_at: string
  account_id: string
  account_name: string
  account_type: string
  donation_id: string
  gift_aid_eligible: boolean
  gift_aid_amount: number
  donation_purpose: string
  contact_id: string
  contact_name: string
  contact_email: string
  // Rich detail
  customer_name: string
  customer_email: string
  customer_phone: string
  billing_country: string
  billing_postcode: string
  payment_method_type: string
  card_brand: string
  card_last4: string
  card_country: string
  card_funding: string
  receipt_url: string
  statement_descriptor: string
  available_at: string
  refunded: boolean
  refund_amount_pence: number
  disputed: boolean
}

interface FinanceAccount {
  id: string
  name: string
  account_type: string
  branch_id: string
  is_active: boolean
}

type SortKey = 'date' | 'amount' | 'net' | 'status' | 'kind' | 'provider' | 'account'

interface SyncRun {
  id: string
  provider: string
  status: string
  started_at: string
  completed_at: string
  cursor_from: string
  cursor_to: string
  rows_fetched: number
  rows_inserted: number
  rows_updated: number
  error_message: string
  triggered_by: string
}

function fmtDateTime(iso: string): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}

function fmtMoney(pence: number, ccy: string): string {
  const amount = (pence || 0) / 100
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: ccy || 'GBP' }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${ccy || 'GBP'}`
  }
}

const PROVIDER_BADGE: Record<string, string> = {
  stripe: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  sumup:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  paypal: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
}

const STATUS_RUN_BADGE: Record<string, string> = {
  running: 'bg-white/10 text-white/70 border-white/20',
  ok:      'bg-green-500/20 text-green-300 border-green-500/30',
  error:   'bg-red-500/20 text-red-300 border-red-500/30',
  skipped: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
}

export default function TransactionsPage() {
  const [items, setItems] = useState<Txn[]>([])
  const [accounts, setAccounts] = useState<FinanceAccount[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [provider, setProvider] = useState<Provider | ''>('')
  const [kind, setKind] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [search, setSearch] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [sort, setSort] = useState<SortKey>('date')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')

  const [history, setHistory] = useState<SyncRun[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [running, setRunning] = useState<Provider | 'all' | ''>('')
  const [runSummary, setRunSummary] = useState('')

  interface ProviderBucket { provider: string; count: number; gross: number; fee: number; net: number; currency: string }
  const [summary, setSummary] = useState<{ providers: ProviderBucket[]; total: { count: number; gross: number; fee: number; net: number; currency: string } } | null>(null)

  const [detail, setDetail] = useState<Txn | null>(null)

  useEffect(() => {
    apiFetch<{ items: FinanceAccount[] }>(`/admin/finance/accounts`).then(d => setAccounts(d.items || [])).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({
        limit: String(pageSize), offset: String(page * pageSize),
        sort, order,
      })
      if (provider) qs.set('provider', provider)
      if (kind) qs.set('kind', kind)
      if (accountFilter) qs.set('account_id', accountFilter)
      if (since) qs.set('since', since)
      if (until) qs.set('until', until)
      if (search.trim()) qs.set('search', search.trim())
      const data = await apiFetch<{ total: number; items: Txn[] }>(`/admin/finance/transactions?${qs}`)
      setItems(data.items || [])
      setTotal(data.total || 0)

      // Summary totals match the filter set but ignore pagination so finance
      // can see the WHOLE picture (not just the current page). Separate call
      // so the ledger table and the totals card refresh together.
      const sumQs = new URLSearchParams()
      if (provider) sumQs.set('provider', provider)
      if (kind) sumQs.set('kind', kind)
      if (accountFilter) sumQs.set('account_id', accountFilter)
      if (since) sumQs.set('since', since)
      if (until) sumQs.set('until', until)
      if (search.trim()) sumQs.set('search', search.trim())
      try {
        const s = await apiFetch<{ providers: ProviderBucket[]; total: { count: number; gross: number; fee: number; net: number; currency: string } }>(
          `/admin/finance/transactions/summary?${sumQs}`,
        )
        setSummary(s)
      } catch { /* summary optional — table still works */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }, [provider, kind, accountFilter, search, since, until, page, pageSize, sort, order])

  function toggleSort(col: SortKey) {
    if (sort === col) setOrder(o => o === 'asc' ? 'desc' : 'asc')
    else { setSort(col); setOrder(col === 'date' ? 'desc' : 'asc') }
    setPage(0)
  }
  function sortArrow(col: SortKey) {
    if (sort !== col) return <span className="text-white/20">↕</span>
    return <span className="text-saffron-400">{order === 'asc' ? '↑' : '↓'}</span>
  }

  useEffect(() => { load() }, [load])

  async function loadHistory() {
    try {
      const data = await apiFetch<{ items: SyncRun[] }>(`/admin/finance/sync/history?limit=20`)
      setHistory(data.items || [])
      setHistoryOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history')
    }
  }

  async function downloadCsv() {
    const qs = new URLSearchParams()
    if (provider) qs.set('provider', provider)
    if (kind) qs.set('kind', kind)
    if (accountFilter) qs.set('account_id', accountFilter)
    if (since) qs.set('since', since)
    if (until) qs.set('until', until)
    if (search.trim()) qs.set('search', search.trim())
    const token = typeof window !== 'undefined' ? (localStorage.getItem('shital_access_token') || '') : ''
    const API = process.env.NEXT_PUBLIC_API_URL || '/api/v1'
    const resp = await fetch(`${API}/admin/finance/transactions/export.csv?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) { setError(`CSV download failed: HTTP ${resp.status}`); return }
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const stamp = since && until ? `${since}_to_${until}` : since ? `from-${since}` : until ? `to-${until}` : 'all-time'
    a.download = `transactions-${provider || 'all'}-${stamp}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function runSync(which: Provider | 'all') {
    if (!confirm(
      which === 'all'
        ? 'Sync both Stripe and SumUp now?'
        : `Sync ${which.toUpperCase()} now?`,
    )) return
    setRunning(which); setError(''); setRunSummary('')
    try {
      const url = which === 'all'
        ? `/admin/finance/sync/all`
        : `/admin/finance/sync/${which}`
      const body = which === 'all' ? { days: 2 } : {}
      const r = await apiFetch<{
        status?: string; results?: Array<{ provider: string; status: string; fetched?: number; inserted?: number; updated?: number; error?: string; reason?: string }>;
        fetched?: number; inserted?: number; updated?: number; error?: string; reason?: string;
      }>(url, { method: 'POST', body: JSON.stringify(body) })
      let summary: string
      if (which === 'all' && r.results) {
        summary = r.results.map(x =>
          x.status === 'ok'
            ? `${x.provider}: +${x.inserted || 0} new, ${x.updated || 0} updated`
            : x.status === 'skipped'
              ? `${x.provider}: skipped (${x.reason || 'not configured'})`
              : `${x.provider}: ERROR ${x.error || ''}`
        ).join(' · ')
      } else {
        summary = r.status === 'ok'
          ? `+${r.inserted || 0} new, ${r.updated || 0} updated, ${r.fetched || 0} fetched`
          : r.status === 'skipped' ? `Skipped (${r.reason || 'not configured'})`
          : `Error: ${r.error || 'unknown'}`
      }
      setRunSummary(summary)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally { setRunning('') }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize))
  const pageTotalPence = items.reduce((sum, i) => sum + (i.net_pence || 0), 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Stripe + SumUp Transactions</h1>
          <p className="text-white/40 mt-1">
            Unified ledger of every money movement across both providers. Synced nightly at 02:15 UTC. Totals reconcile to the bank statement.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={loadHistory}
            className="px-3 py-2 rounded-xl border border-white/10 text-white/70 text-sm font-bold hover:bg-white/5">
            🕒 Sync history
          </button>
          <button onClick={() => runSync('stripe')} disabled={!!running}
            className="px-3 py-2 rounded-xl border border-indigo-400/40 text-indigo-300 text-sm font-bold hover:bg-indigo-500/10 disabled:opacity-40">
            {running === 'stripe' ? 'Syncing…' : '🔄 Sync Stripe'}
          </button>
          <button onClick={() => runSync('sumup')} disabled={!!running}
            className="px-3 py-2 rounded-xl border border-emerald-400/40 text-emerald-300 text-sm font-bold hover:bg-emerald-500/10 disabled:opacity-40">
            {running === 'sumup' ? 'Syncing…' : '🔄 Sync SumUp'}
          </button>
          <button onClick={() => runSync('paypal')} disabled={!!running}
            className="px-3 py-2 rounded-xl border border-sky-400/40 text-sky-300 text-sm font-bold hover:bg-sky-500/10 disabled:opacity-40">
            {running === 'paypal' ? 'Syncing…' : '🔄 Sync PayPal'}
          </button>
          <button onClick={() => runSync('all')} disabled={!!running}
            className="px-3 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron disabled:opacity-40">
            {running === 'all' ? 'Syncing…' : '⚡ Sync both now'}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}
      {runSummary && (
        <div className="bg-white/5 border border-white/10 text-white/80 px-4 py-3 rounded-xl text-sm">
          <span className="text-white/50 text-xs uppercase tracking-widest font-bold mr-2">Last sync</span>
          {runSummary}
        </div>
      )}

      {/* Totals card — what we bank vs what the processors take */}
      {summary && summary.total.count > 0 && (
        <div className="glass rounded-2xl p-5">
          <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
            <div>
              <p className="text-white/50 text-xs uppercase tracking-widest font-bold">Totals for the current filter</p>
              <p className="text-white/40 text-xs mt-1">
                {summary.total.count} transaction{summary.total.count === 1 ? '' : 's'} across {summary.providers.length} provider{summary.providers.length === 1 ? '' : 's'}.
                Fees eat into what the charity actually receives — the Net column is what hits the bank.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <TotalsTile label="Gross"         pence={summary.total.gross} ccy={summary.total.currency} tone="white" />
            <TotalsTile label="Processor fee" pence={-Math.abs(summary.total.fee)} ccy={summary.total.currency} tone="red" />
            <TotalsTile label="Net (banked)"  pence={summary.total.net} ccy={summary.total.currency} tone="green" />
            {summary.providers.map(p => (
              <TotalsTile
                key={p.provider}
                label={`${p.provider.toUpperCase()} fee`}
                pence={-Math.abs(p.fee)}
                ccy={p.currency}
                tone="red"
                sub={`${p.count} tx · gross ${new Intl.NumberFormat('en-GB',{style:'currency',currency:p.currency||'GBP'}).format(p.gross/100)}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
          {(['', 'stripe', 'sumup', 'paypal'] as const).map(p => (
            <button key={p || 'ALL'} onClick={() => { setProvider(p); setPage(0) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize ${
                provider === p ? 'bg-saffron-gradient text-white' : 'text-white/40 hover:text-white/70'
              }`}>{p || 'All providers'}</button>
          ))}
        </div>

        <select value={accountFilter} onChange={e => { setAccountFilter(e.target.value); setPage(0) }}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-saffron-400/50 min-w-[200px]">
          <option value="">All accounts</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.account_type}: {a.name}</option>
          ))}
        </select>

        <div className="relative">
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="🔍 Search donor, email, ref, last4 …"
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-saffron-400/50 min-w-[280px]" />
          {search && (
            <button onClick={() => { setSearch(''); setPage(0) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-xs" title="Clear search">
              ✕
            </button>
          )}
        </div>

        <input value={kind} onChange={e => { setKind(e.target.value); setPage(0) }}
          placeholder="Kind (charge, refund, payout, …)"
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-saffron-400/50 w-[200px]" />

        <div className="flex gap-2 items-center">
          <label className="text-white/50 text-xs font-bold uppercase tracking-wide">Since</label>
          <input type="date" value={since} onChange={e => { setSince(e.target.value); setPage(0) }}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-saffron-400/50" />
          <label className="text-white/50 text-xs font-bold uppercase tracking-wide">Until</label>
          <input type="date" value={until} onChange={e => { setUntil(e.target.value); setPage(0) }}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-saffron-400/50" />
        </div>

        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-saffron-400/50">
          {[25, 50, 100, 200, 500].map(n => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>

      {/* Quick-range chips + CSV download */}
      <div className="flex gap-2 flex-wrap items-center text-sm">
        <span className="text-white/40 text-xs uppercase tracking-widest font-bold">Quick range:</span>
        {([
          { label: 'This month',  fn: () => { const d = new Date(); const s = new Date(d.getFullYear(), d.getMonth(), 1); setSince(ymd(s)); setUntil(ymd(d)); setPage(0) } },
          { label: 'Last month',  fn: () => { const d = new Date(); const s = new Date(d.getFullYear(), d.getMonth() - 1, 1); const e = new Date(d.getFullYear(), d.getMonth(), 0); setSince(ymd(s)); setUntil(ymd(e)); setPage(0) } },
          { label: 'Last 7 days', fn: () => { const d = new Date(); const s = new Date(d); s.setDate(d.getDate() - 6); setSince(ymd(s)); setUntil(ymd(d)); setPage(0) } },
          { label: 'This year',   fn: () => { const d = new Date(); const s = new Date(d.getFullYear(), 0, 1); setSince(ymd(s)); setUntil(ymd(d)); setPage(0) } },
          { label: 'Last year',   fn: () => { const d = new Date(); const s = new Date(d.getFullYear() - 1, 0, 1); const e = new Date(d.getFullYear() - 1, 11, 31); setSince(ymd(s)); setUntil(ymd(e)); setPage(0) } },
          { label: 'All time',    fn: () => { setSince(''); setUntil(''); setPage(0) } },
        ] as const).map(r => (
          <button key={r.label} onClick={r.fn}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 text-xs font-semibold hover:bg-white/5">
            {r.label}
          </button>
        ))}
        <MonthPicker onPick={(s, e) => { setSince(s); setUntil(e); setPage(0) }} />
        <button onClick={downloadCsv}
          className="ml-auto px-3 py-1.5 rounded-lg border border-saffron-400/40 text-saffron-300 text-xs font-bold hover:bg-saffron-400/10">
          ⬇ Download CSV
        </button>
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 border-b border-white/10">
              <tr className="text-white/60 text-xs uppercase tracking-wide">
                <th onClick={() => toggleSort('date')}       className="px-4 py-3 text-left font-semibold cursor-pointer select-none hover:text-white/80">Date / Time {sortArrow('date')}</th>
                <th onClick={() => toggleSort('provider')}   className="px-4 py-3 text-left font-semibold cursor-pointer select-none hover:text-white/80">Provider {sortArrow('provider')}</th>
                <th onClick={() => toggleSort('account')}    className="px-4 py-3 text-left font-semibold cursor-pointer select-none hover:text-white/80">Account {sortArrow('account')}</th>
                <th onClick={() => toggleSort('kind')}       className="px-4 py-3 text-left font-semibold cursor-pointer select-none hover:text-white/80">Kind {sortArrow('kind')}</th>
                <th onClick={() => toggleSort('amount')}     className="px-4 py-3 text-right font-semibold cursor-pointer select-none hover:text-white/80">Gross {sortArrow('amount')}</th>
                <th className="px-4 py-3 text-right font-semibold">Fee</th>
                <th onClick={() => toggleSort('net')}        className="px-4 py-3 text-right font-semibold cursor-pointer select-none hover:text-white/80">Net {sortArrow('net')}</th>
                <th onClick={() => toggleSort('status')}     className="px-4 py-3 text-left font-semibold cursor-pointer select-none hover:text-white/80">Status {sortArrow('status')}</th>
                <th className="px-4 py-3 text-left font-semibold">Donor / Purpose</th>
                <th className="px-4 py-3 text-center font-semibold">🇬🇧 Gift Aid</th>
                <th className="px-4 py-3 text-left font-semibold">Description</th>
                <th className="px-4 py-3 text-left font-semibold">Ref</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={12} className="px-4 py-12 text-center text-white/40">Loading…</td></tr>}
              {!loading && items.length === 0 && (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-white/40">
                  No transactions. Hit a Sync button to pull from Stripe, SumUp or PayPal.
                </td></tr>
              )}
              {items.map(t => (
                <tr key={t.id} onClick={() => setDetail(t)}
                    className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer">
                  <td className="px-4 py-3 text-white/80 text-xs whitespace-nowrap">{fmtDateTime(t.provider_created_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border capitalize ${PROVIDER_BADGE[t.provider] || 'bg-white/10 text-white/60 border-white/20'}`}>
                      {t.provider}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/80 text-xs whitespace-nowrap" title={t.account_id || ''}>
                    {t.account_name
                      ? <span>🏦 {t.account_name}</span>
                      : <span className="text-white/25">—</span>}
                  </td>
                  <td className="px-4 py-3 text-white/70 text-xs capitalize">{t.kind.replace(/_/g, ' ') || '—'}</td>
                  <td className={`px-4 py-3 text-right font-mono text-sm ${(t.amount_pence || 0) < 0 ? 'text-red-400' : 'text-white'}`}>
                    {fmtMoney(t.amount_pence, t.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-white/50">
                    {t.fee_pence ? fmtMoney(t.fee_pence, t.currency) : '—'}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono text-sm font-bold ${(t.net_pence || 0) < 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {fmtMoney(t.net_pence, t.currency)}
                  </td>
                  <td className="px-4 py-3 text-white/60 text-xs">{t.status || '—'}</td>
                  <td className="px-4 py-3 text-white/80 text-xs max-w-[220px] truncate" title={`${t.contact_name} <${t.contact_email}>`}>
                    {t.contact_name || t.contact_email || t.customer_hint || <em className="text-white/30">—</em>}
                    {t.donation_purpose && <div className="text-[10px] text-white/40 truncate">{t.donation_purpose}</div>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {t.gift_aid_eligible ? (
                      <div className="inline-flex flex-col items-center">
                        <span className="text-blue-300 font-bold text-xs">🇬🇧 Yes</span>
                        {t.gift_aid_amount > 0 && (
                          <span className="text-[10px] text-blue-300/70 font-mono">+{fmtMoney(Math.round(t.gift_aid_amount * 100), t.currency)}</span>
                        )}
                      </div>
                    ) : t.donation_id ? (
                      <span className="text-white/30 text-xs">No</span>
                    ) : (
                      <span className="text-white/15 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-white/70 text-xs max-w-[200px] truncate" title={t.description}>
                    {t.description || <em className="text-white/30">(none)</em>}
                  </td>
                  <td className="px-4 py-3 text-white/40 text-[10px] font-mono" title={t.external_id}>
                    {t.source_ref || t.external_id.slice(-10)}
                  </td>
                </tr>
              ))}
            </tbody>
            {!loading && items.length > 0 && (
              <tfoot className="bg-white/5 border-t border-white/10 text-white/70 text-xs">
                <tr>
                  <td colSpan={6} className="px-4 py-3 font-semibold">
                    Page {page + 1} of {pages} — {total} total
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-green-400">
                    Page net: {fmtMoney(pageTotalPence, items[0]?.currency || 'GBP')}
                  </td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {total > 0 && (
        <div className="flex items-center gap-2 justify-end text-sm">
          <button onClick={() => setPage(0)} disabled={page === 0}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 disabled:opacity-30">« First</button>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 disabled:opacity-30">← Prev</button>
          <span className="text-white/50">
            Page {page + 1} / {pages} · {total} total
          </span>
          <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 disabled:opacity-30">Next →</button>
          <button onClick={() => setPage(pages - 1)} disabled={page >= pages - 1}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 disabled:opacity-30">Last »</button>
        </div>
      )}

      {/* Sync history drawer */}
      {historyOpen && (
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-black">Sync history</h2>
            <button onClick={() => setHistoryOpen(false)} className="text-white/40 hover:text-white text-xl p-1 leading-none">✕</button>
          </div>
          {history.length === 0 ? (
            <p className="text-white/50 text-sm">No runs yet. The nightly cron fires at 02:15 UTC; manual runs also appear here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr className="text-white/60 text-xs uppercase tracking-wide">
                    <th className="px-3 py-2 text-left font-semibold">Started</th>
                    <th className="px-3 py-2 text-left font-semibold">Provider</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Fetched</th>
                    <th className="px-3 py-2 text-right font-semibold">New</th>
                    <th className="px-3 py-2 text-right font-semibold">Updated</th>
                    <th className="px-3 py-2 text-left font-semibold">Trigger</th>
                    <th className="px-3 py-2 text-left font-semibold">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id} className="border-b border-white/5">
                      <td className="px-3 py-2 text-white/80 text-xs whitespace-nowrap">{fmtDateTime(h.started_at)}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold border capitalize ${PROVIDER_BADGE[h.provider] || 'bg-white/10'}`}>
                          {h.provider}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${STATUS_RUN_BADGE[h.status] || ''}`}>{h.status}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-white/70">{h.rows_fetched}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-green-400">{h.rows_inserted}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-white/60">{h.rows_updated}</td>
                      <td className="px-3 py-2 text-white/50 text-xs">{h.triggered_by}</td>
                      <td className="px-3 py-2 text-red-400 text-xs max-w-[240px] truncate" title={h.error_message}>
                        {h.error_message || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Detail slide-over — all the fields the processors give us */}
      {detail && <TxnDetail txn={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

function TxnDetail({ txn, onClose }: { txn: Txn; onClose: () => void }) {
  function money(pence: number): string {
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: txn.currency || 'GBP' }).format((pence || 0) / 100) }
    catch { return `${((pence || 0) / 100).toFixed(2)} ${txn.currency || 'GBP'}` }
  }
  function when(iso: string): string {
    if (!iso) return '—'
    try { return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
  }
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/60 z-40" />
      <div className="fixed right-0 top-0 h-full w-full sm:max-w-xl bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
        <div className="px-6 py-5 border-b border-white/5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white/40 text-xs uppercase tracking-widest font-bold">{txn.provider} · {txn.kind || '—'}</p>
            <h2 className="text-white font-black text-2xl mt-1 font-mono">{money(txn.amount_pence)}</h2>
            <p className="text-white/50 text-xs mt-1">{when(txn.provider_created_at)}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl p-1">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-sm">
          <Section title="Money">
            <KV label="Gross" value={money(txn.amount_pence)} />
            <KV label="Fee"   value={txn.fee_pence ? money(txn.fee_pence) : '—'} tone={txn.fee_pence ? 'red' : undefined} />
            <KV label="Net"   value={money(txn.net_pence)} tone="green" />
            <KV label="Status" value={txn.status || '—'} />
            {txn.refunded && <KV label="Refunded" value={money(txn.refund_amount_pence)} tone="red" />}
            {txn.disputed && <KV label="Disputed" value="⚠ Yes" tone="red" />}
          </Section>

          <Section title="Donor">
            <KV label="Name"  value={txn.customer_name || txn.contact_name || '—'} />
            <KV label="Email" value={txn.customer_email || txn.contact_email || '—'} />
            <KV label="Phone" value={txn.customer_phone || '—'} />
            <KV label="Billing postcode" value={txn.billing_postcode || '—'} />
            <KV label="Billing country"  value={txn.billing_country || '—'} />
          </Section>

          <Section title="Payment method">
            <KV label="Type"    value={txn.payment_method_type || '—'} />
            <KV label="Card"    value={txn.card_brand ? `${txn.card_brand} ${txn.card_last4 ? '•••• ' + txn.card_last4 : ''}` : '—'} />
            <KV label="Card country" value={txn.card_country || '—'} />
            <KV label="Card funding" value={txn.card_funding || '—'} />
          </Section>

          <Section title="Account & settlement">
            <KV label="Finance account" value={txn.account_name ? `🏦 ${txn.account_name}` : '—'} />
            <KV label="Funds available" value={when(txn.available_at)} />
            <KV label="Payout ref"      value={txn.payout_ref || '—'} />
            <KV label="Statement descriptor" value={txn.statement_descriptor || '—'} />
          </Section>

          <Section title="Linked donation">
            <KV label="Donation"  value={txn.donation_id ? txn.donation_id.slice(0, 8) + '…' : '—'} />
            <KV label="Purpose"   value={txn.donation_purpose || '—'} />
            <KV label="Gift Aid"  value={txn.gift_aid_eligible ? `🇬🇧 Yes +${money(Math.round(txn.gift_aid_amount * 100))}` : 'No'} tone={txn.gift_aid_eligible ? 'blue' : undefined} />
          </Section>

          <Section title="References">
            <KV label="External id" value={txn.external_id} mono />
            <KV label="Source ref"  value={txn.source_ref || '—'} mono />
            <KV label="Description" value={txn.description || '—'} />
            {txn.receipt_url && (
              <KV label="Receipt" value={
                <a href={txn.receipt_url} target="_blank" rel="noreferrer" className="text-saffron-300 hover:underline">Open in provider ↗</a>
              } />
            )}
          </Section>
        </div>
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/3 p-4">
      <p className="text-white/50 text-[10px] uppercase tracking-widest font-bold mb-3">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function KV({ label, value, tone, mono }: { label: string; value: React.ReactNode; tone?: 'red' | 'green' | 'blue'; mono?: boolean }) {
  const toneCls = tone === 'red' ? 'text-red-300' : tone === 'green' ? 'text-green-300' : tone === 'blue' ? 'text-blue-300' : 'text-white/90'
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-white/50">{label}</span>
      <span className={`${toneCls} text-right max-w-[60%] break-words ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function MonthPicker({ onPick }: { onPick: (since: string, until: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="flex gap-1 items-center">
      <label className="text-white/40 text-xs">Jump to month:</label>
      <input type="month" value={value}
        onChange={e => {
          const v = e.target.value
          setValue(v)
          if (!v) return
          const [y, m] = v.split('-').map(Number)
          const s = new Date(y, m - 1, 1)
          const en = new Date(y, m, 0)
          onPick(ymd(s), ymd(en))
        }}
        className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-saffron-400/50" />
    </div>
  )
}

function TotalsTile({ label, pence, ccy, tone, sub }: { label: string; pence: number; ccy: string; tone: 'white' | 'red' | 'green'; sub?: string }) {
  const amount = (pence || 0) / 100
  let formatted: string
  try {
    formatted = new Intl.NumberFormat('en-GB', { style: 'currency', currency: ccy || 'GBP' }).format(amount)
  } catch {
    formatted = `${amount.toFixed(2)} ${ccy || 'GBP'}`
  }
  const toneCls = tone === 'red'   ? 'text-red-400'
                : tone === 'green' ? 'text-green-400'
                : 'text-white'
  return (
    <div className="rounded-xl border border-white/10 bg-white/3 px-4 py-3">
      <p className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-1">{label}</p>
      <p className={`font-mono text-xl font-black ${toneCls}`}>{formatted}</p>
      {sub && <p className="text-white/40 text-[10px] mt-0.5 truncate" title={sub}>{sub}</p>}
    </div>
  )
}
