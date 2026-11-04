'use client'
import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { apiFetch } from '@/lib/api'

type DocType = 'INVOICE' | 'PURCHASE_ORDER' | 'RECEIPT' | 'STATEMENT'
type Status = 'DRAFT' | 'APPROVED' | 'PAID' | 'VOID'

interface Invoice {
  id: string
  doc_type: DocType
  doc_number: string
  supplier_name: string
  supplier_email: string
  issued_date: string
  due_date: string
  total_amount: number
  vat_amount: number
  currency: string
  status: Status
  source: string
  attachment_count: number
  created_at: string
}

interface InvoiceAttachment {
  id: string
  filename: string
  content_type: string
  size_bytes: number
  download_url: string
  created_at: string
}

interface InvoiceDetail extends Invoice {
  net_amount: number
  supplier_vat_id: string
  notes: string
  raw_fields: Record<string, unknown>
  source_email_id: string | null
  branch_id: string
  updated_at: string
}

interface EmailIngestMessage {
  id: string
  message_id: string
  from_address: string
  subject: string
  received_at: string
  classification: string
  confidence: number
  status: string
  error_message: string
  model: string
  processed_at: string
}

const DOC_TYPES: { key: DocType | ''; label: string }[] = [
  { key: '',                label: 'All' },
  { key: 'INVOICE',         label: 'Invoices' },
  { key: 'PURCHASE_ORDER',  label: 'Purchase orders' },
  { key: 'RECEIPT',         label: 'Receipts' },
  { key: 'STATEMENT',       label: 'Statements' },
]

const STATUS_BADGE: Record<Status, string> = {
  DRAFT:    'bg-white/10 text-white/70 border-white/20',
  APPROVED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  PAID:     'bg-green-500/20 text-green-400 border-green-500/30',
  VOID:     'bg-white/5 text-white/40 border-white/10',
}

const TYPE_BADGE: Record<DocType, string> = {
  INVOICE:        'bg-saffron-400/20 text-saffron-300 border-saffron-400/30',
  PURCHASE_ORDER: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  RECEIPT:        'bg-green-500/20 text-green-300 border-green-500/30',
  STATEMENT:      'bg-white/10 text-white/60 border-white/20',
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso }
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}

function fmtMoney(amount: number, ccy: string): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: ccy || 'GBP' }).format(amount || 0)
  } catch {
    return `${(amount || 0).toFixed(2)} ${ccy || 'GBP'}`
  }
}

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function InvoicesPage() {
  const [items, setItems] = useState<Invoice[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [docType, setDocType] = useState<DocType | ''>('')
  const [statusFilter, setStatusFilter] = useState<Status | ''>('')
  const [supplierQuery, setSupplierQuery] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 50

  const [detail, setDetail] = useState<InvoiceDetail | null>(null)
  const [detailAttachments, setDetailAttachments] = useState<InvoiceAttachment[]>([])
  const [detailEmail, setDetailEmail] = useState<EmailIngestMessage | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [running, setRunning] = useState(false)
  const [lastRunSummary, setLastRunSummary] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) })
      if (docType) qs.set('doc_type', docType)
      if (statusFilter) qs.set('status', statusFilter)
      if (supplierQuery.trim()) qs.set('supplier', supplierQuery.trim())
      const data = await apiFetch<{ total: number; items: Invoice[] }>(`/admin/finance/invoices?${qs}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoices')
    } finally { setLoading(false) }
  }, [docType, statusFilter, supplierQuery, page])

  useEffect(() => { load() }, [load])

  async function openDetail(inv: Invoice) {
    setDetailLoading(true); setError('')
    try {
      const data = await apiFetch<{ document: InvoiceDetail; attachments: InvoiceAttachment[] }>(
        `/admin/finance/invoices/${inv.id}`,
      )
      setDetail(data.document)
      setDetailAttachments(data.attachments || [])
      // If the record came from email, pull the source message so finance can see what the AI saw.
      if (data.document.source_email_id) {
        try {
          const em = await apiFetch<{ items: EmailIngestMessage[] }>(
            `/admin/finance/email-ingest/messages?limit=1`,
          )
          const match = (em.items || []).find(m => m.id === data.document.source_email_id)
          setDetailEmail(match || null)
        } catch {
          setDetailEmail(null)
        }
      } else {
        setDetailEmail(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load detail')
    } finally { setDetailLoading(false) }
  }

  function closeDetail() {
    setDetail(null); setDetailAttachments([]); setDetailEmail(null)
  }

  async function runIngest() {
    if (!confirm('Fetch new supplier emails now and classify them with the AI?\n\nThis also happens automatically once a day.')) return
    setRunning(true); setError(''); setLastRunSummary('')
    try {
      const r = await apiFetch<{
        status: string; reason?: string; error?: string;
        fetched?: number; classified?: number; records_created?: number;
        skipped_duplicates?: number; errors?: number;
      }>(`/admin/finance/email-ingest/run`, { method: 'POST', body: JSON.stringify({}) })
      if (r.status === 'skipped') {
        setLastRunSummary(`Skipped — ${r.reason || 'provider not configured'}`)
      } else if (r.status === 'error') {
        setLastRunSummary(`Error — ${r.error || 'unknown'}`)
      } else {
        setLastRunSummary(
          `Fetched ${r.fetched || 0}, classified ${r.classified || 0}, ` +
          `records created ${r.records_created || 0}, duplicates skipped ${r.skipped_duplicates || 0}, ` +
          `errors ${r.errors || 0}`,
        )
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ingest failed')
    } finally { setRunning(false) }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize))
  const totalValue = items.reduce((sum, i) => sum + (i.total_amount || 0), 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Invoices &amp; Supplier Documents</h1>
          <p className="text-white/40 mt-1">
            Invoices, purchase orders, receipts, statements — ingested daily from the finance inbox. AI tags each one; finance confirms.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={runIngest} disabled={running}
            className="px-4 py-2 rounded-xl border border-saffron-400/40 text-saffron-300 text-sm font-bold hover:bg-saffron-400/10 disabled:opacity-40">
            {running ? 'Running…' : '📬 Run ingest now'}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}
      {lastRunSummary && (
        <div className="bg-white/5 border border-white/10 text-white/80 px-4 py-3 rounded-xl text-sm">
          <span className="text-white/50 text-xs uppercase tracking-widest font-bold mr-2">Last run</span>
          {lastRunSummary}
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        {/* Type filter */}
        <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
          {DOC_TYPES.map(t => (
            <button key={t.key || 'ALL'} onClick={() => { setDocType(t.key); setPage(0) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                docType === t.key ? 'bg-saffron-gradient text-white' : 'text-white/40 hover:text-white/70'
              }`}>{t.label}</button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
          {(['', 'DRAFT', 'APPROVED', 'PAID', 'VOID'] as const).map(s => (
            <button key={s || 'ALL'} onClick={() => { setStatusFilter(s); setPage(0) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize ${
                statusFilter === s ? 'bg-saffron-gradient text-white' : 'text-white/40 hover:text-white/70'
              }`}>{s.toLowerCase() || 'any status'}</button>
          ))}
        </div>

        {/* Supplier search */}
        <input
          value={supplierQuery}
          onChange={e => { setSupplierQuery(e.target.value); setPage(0) }}
          placeholder="Search supplier name / email…"
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-saffron-400/50 min-w-[260px]"
        />
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 border-b border-white/10">
              <tr className="text-white/60 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-semibold">Type</th>
                <th className="px-4 py-3 text-left font-semibold">Supplier</th>
                <th className="px-4 py-3 text-left font-semibold">Document #</th>
                <th className="px-4 py-3 text-left font-semibold">Issued</th>
                <th className="px-4 py-3 text-left font-semibold">Due</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-4 py-12 text-center text-white/40">Loading…</td></tr>}
              {!loading && items.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-white/40">
                  No invoices match these filters. Try &quot;Run ingest now&quot; above to pull from the inbox.
                </td></tr>
              )}
              {items.map(inv => (
                <tr key={inv.id} onClick={() => openDetail(inv)}
                  className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors">
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${TYPE_BADGE[inv.doc_type]}`}>
                      {inv.doc_type.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white">
                    <div className="font-semibold">{inv.supplier_name || <em className="text-white/40">Unknown</em>}</div>
                    {inv.supplier_email && <div className="text-xs text-white/40">{inv.supplier_email}</div>}
                  </td>
                  <td className="px-4 py-3 text-white/70 font-mono text-xs">{inv.doc_number || '—'}</td>
                  <td className="px-4 py-3 text-white/70 text-xs">{fmtDate(inv.issued_date)}</td>
                  <td className="px-4 py-3 text-white/70 text-xs">{fmtDate(inv.due_date)}</td>
                  <td className="px-4 py-3 text-white font-semibold text-right">{fmtMoney(inv.total_amount, inv.currency)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${STATUS_BADGE[inv.status]}`}>{inv.status}</span>
                  </td>
                  <td className="px-4 py-3 text-white/50 text-xs capitalize">
                    {inv.source}
                    {inv.attachment_count > 0 && <span className="ml-2 text-saffron-400">📎 {inv.attachment_count}</span>}
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
                  <td className="px-4 py-3 text-right font-mono font-bold">
                    This page: {fmtMoney(totalValue, items[0]?.currency || 'GBP')}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center gap-2 justify-end text-sm">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 disabled:opacity-30">← Prev</button>
          <span className="text-white/50">Page {page + 1} / {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 disabled:opacity-30">Next →</button>
        </div>
      )}

      {/* Detail slide-over */}
      <AnimatePresence>
        {detail && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={closeDetail} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-2xl bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${TYPE_BADGE[detail.doc_type]}`}>
                      {detail.doc_type.replace(/_/g, ' ')}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${STATUS_BADGE[detail.status]}`}>{detail.status}</span>
                  </div>
                  <h2 className="text-white font-black text-lg truncate">
                    {detail.supplier_name || 'Unknown supplier'}
                    {detail.doc_number && <span className="text-white/50 font-normal ml-2">· #{detail.doc_number}</span>}
                  </h2>
                </div>
                <button onClick={closeDetail} className="text-white/40 hover:text-white text-xl p-1 leading-none">✕</button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                {detailLoading && <p className="text-white/50 text-sm">Loading…</p>}

                {/* Money */}
                <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
                  <p className="text-white/50 text-xs uppercase tracking-widest font-bold mb-3">Amounts</p>
                  <div className="grid grid-cols-3 gap-3">
                    <KV label="Total"      value={fmtMoney(detail.total_amount, detail.currency)} big />
                    <KV label="Net"        value={fmtMoney(detail.net_amount,   detail.currency)} />
                    <KV label="VAT"        value={fmtMoney(detail.vat_amount,   detail.currency)} />
                  </div>
                </div>

                {/* Dates / IDs */}
                <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
                  <p className="text-white/50 text-xs uppercase tracking-widest font-bold mb-3">Document</p>
                  <div className="grid grid-cols-2 gap-3">
                    <KV label="Issued"          value={fmtDate(detail.issued_date)} />
                    <KV label="Due"             value={fmtDate(detail.due_date)} />
                    <KV label="Supplier email"  value={detail.supplier_email || '—'} />
                    <KV label="Supplier VAT ID" value={detail.supplier_vat_id || '—'} />
                    <KV label="Branch"          value={detail.branch_id} />
                    <KV label="Source"          value={detail.source} />
                  </div>
                  {detail.notes && (
                    <>
                      <p className="text-white/50 text-xs uppercase tracking-widest font-bold mt-4 mb-1">Notes</p>
                      <p className="text-white/80 text-sm whitespace-pre-wrap">{detail.notes}</p>
                    </>
                  )}
                </div>

                {/* Attachments */}
                <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
                  <p className="text-white/50 text-xs uppercase tracking-widest font-bold mb-3">📎 Attachments ({detailAttachments.length})</p>
                  {detailAttachments.length === 0 ? (
                    <p className="text-white/30 text-xs italic">No files attached.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {detailAttachments.map(a => (
                        <li key={a.id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-white/3 text-xs">
                          <a href={a.download_url} target="_blank" rel="noreferrer" className="text-saffron-300 hover:underline truncate">
                            {a.filename}
                          </a>
                          <span className="text-white/40">{a.content_type} · {fmtBytes(a.size_bytes)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Source email */}
                {detailEmail && (
                  <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5">
                    <p className="text-violet-300 text-xs uppercase tracking-widest font-bold mb-3">✨ Source email + AI classification</p>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <KV label="From"           value={detailEmail.from_address} />
                      <KV label="Received"       value={fmtDateTime(detailEmail.received_at)} />
                      <KV label="Classification" value={`${detailEmail.classification} (${Math.round((detailEmail.confidence || 0) * 100)}%)`} />
                      <KV label="Model"          value={detailEmail.model || '—'} />
                    </div>
                    <p className="text-white/50 text-xs uppercase tracking-widest font-bold mt-3 mb-1">Subject</p>
                    <p className="text-white/80 text-sm">{detailEmail.subject}</p>
                  </div>
                )}

                {/* Raw fields */}
                {Object.keys(detail.raw_fields || {}).length > 0 && (
                  <details className="rounded-2xl border border-white/10 bg-white/3 p-5">
                    <summary className="text-white/50 text-xs uppercase tracking-widest font-bold cursor-pointer">
                      Raw extracted fields (for debugging)
                    </summary>
                    <pre className="text-white/60 text-xs mt-3 overflow-auto max-h-64">{JSON.stringify(detail.raw_fields, null, 2)}</pre>
                  </details>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function KV({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <p className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-0.5">{label}</p>
      <p className={big ? 'text-white text-xl font-black' : 'text-white/90 text-sm'}>{value}</p>
    </div>
  )
}
