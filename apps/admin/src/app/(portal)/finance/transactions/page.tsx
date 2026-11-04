'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

type Provider = 'stripe' | 'sumup'

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
}

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
}

const STATUS_RUN_BADGE: Record<string, string> = {
  running: 'bg-white/10 text-white/70 border-white/20',
  ok:      'bg-green-500/20 text-green-300 border-green-500/30',
  error:   'bg-red-500/20 text-red-300 border-red-500/30',
  skipped: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
}

export default function TransactionsPage() {
  const [items, setItems] = useState<Txn[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [provider, setProvider] = useState<Provider | ''>('')
  const [kind, setKind] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 100

  const [history, setHistory] = useState<SyncRun[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [running, setRunning] = useState<Provider | 'all' | ''>('')
  const [runSummary, setRunSummary] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) })
      if (provider) qs.set('provider', provider)
      if (kind) qs.set('kind', kind)
      if (since) qs.set('since', since)
      if (until) qs.set('until', until)
      const data = await apiFetch<{ total: number; items: Txn[] }>(`/admin/finance/transactions?${qs}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }, [provider, kind, since, until, page])

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

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
          {(['', 'stripe', 'sumup'] as const).map(p => (
            <button key={p || 'ALL'} onClick={() => { setProvider(p); setPage(0) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize ${
                provider === p ? 'bg-saffron-gradient text-white' : 'text-white/40 hover:text-white/70'
              }`}>{p || 'All providers'}</button>
          ))}
        </div>

        <input value={kind} onChange={e => { setKind(e.target.value); setPage(0) }}
          placeholder="Kind (charge, refund, payout, …)"
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-saffron-400/50 w-[260px]" />

        <div className="flex gap-2 items-center">
          <label className="text-white/50 text-xs font-bold uppercase tracking-wide">Since</label>
          <input type="date" value={since} onChange={e => { setSince(e.target.value); setPage(0) }}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-saffron-400/50" />
          <label className="text-white/50 text-xs font-bold uppercase tracking-wide">Until</label>
          <input type="date" value={until} onChange={e => { setUntil(e.target.value); setPage(0) }}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-saffron-400/50" />
        </div>
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 border-b border-white/10">
              <tr className="text-white/60 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-semibold">Date / Time</th>
                <th className="px-4 py-3 text-left font-semibold">Provider</th>
                <th className="px-4 py-3 text-left font-semibold">Kind</th>
                <th className="px-4 py-3 text-right font-semibold">Gross</th>
                <th className="px-4 py-3 text-right font-semibold">Fee</th>
                <th className="px-4 py-3 text-right font-semibold">Net</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Description</th>
                <th className="px-4 py-3 text-left font-semibold">Ref</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="px-4 py-12 text-center text-white/40">Loading…</td></tr>}
              {!loading && items.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-white/40">
                  No transactions. Hit &quot;Sync both now&quot; to pull from Stripe + SumUp.
                </td></tr>
              )}
              {items.map(t => (
                <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-white/80 text-xs whitespace-nowrap">{fmtDateTime(t.provider_created_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border capitalize ${PROVIDER_BADGE[t.provider] || 'bg-white/10 text-white/60 border-white/20'}`}>
                      {t.provider}
                    </span>
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
                  <td className="px-4 py-3 text-white/70 text-xs max-w-[260px] truncate" title={t.description}>
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
                  <td colSpan={5} className="px-4 py-3 font-semibold">
                    Page {page + 1} of {pages} — {total} total
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-green-400">
                    Page net: {fmtMoney(pageTotalPence, items[0]?.currency || 'GBP')}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="flex items-center gap-2 justify-end text-sm">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 disabled:opacity-30">← Prev</button>
          <span className="text-white/50">Page {page + 1} / {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 disabled:opacity-30">Next →</button>
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
    </div>
  )
}
