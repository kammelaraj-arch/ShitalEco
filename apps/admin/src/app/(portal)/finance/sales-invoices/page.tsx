'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'
import { Pagination } from '@/components/ui/Pagination'
import { AccountPicker } from '@/components/ui/AccountPicker'

interface InvoiceLine {
  id?: string
  description: string
  nominal_code_id?: string | null
  nominal_code: string
  quantity: number
  unit_price: number
  vat_rate: number
  vat_code: string
  line_net?: number
  line_vat?: number
  line_total?: number
}

interface Invoice {
  id: string
  invoice_number: string
  branch_id: string
  customer_contact_id: string | null
  customer_name: string
  status: string
  invoice_date: string
  due_date: string | null
  currency: string
  subtotal: number
  vat_total: number
  total: number
  paid_total: number
  notes: string
  reference: string
  billing_address: string
  created_by: string
  sent_at: string | null
  paid_at: string | null
  voided_at: string | null
  created_at: string
  updated_at: string
  lines?: InvoiceLine[]
}

interface Branch { branch_id: string; name: string; is_active?: boolean }
interface NominalCode { id: string; code: string; name: string; type: string; vat_code: string; vat_rate: number }

const STATUS_BADGE: Record<string, string> = {
  DRAFT:     'bg-white/10 text-white/60 border-white/20',
  SENT:      'bg-blue-500/15 text-blue-300 border-blue-500/30',
  PART_PAID: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  PAID:      'bg-green-500/15 text-green-300 border-green-500/30',
  VOID:      'bg-red-500/15 text-red-300 border-red-500/30',
}

const VAT_CODES = ['OUT_OF_SCOPE', 'STANDARD', 'REDUCED', 'ZERO', 'EXEMPT', 'REVERSE_CHARGE']

function fmtMoney(n: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n || 0)
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso }
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-[11px] font-semibold uppercase tracking-wide mb-1'

export default function SalesInvoicesPage() {
  const [items, setItems]         = useState<Invoice[]>([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [page, setPage]           = useState(1)
  const [perPage, setPerPage]     = useState(20)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('')
  const [branches, setBranches]   = useState<Branch[]>([])
  const [codes, setCodes]         = useState<NominalCode[]>([])
  const [showForm, setShowForm]   = useState(false)
  const [detail, setDetail]       = useState<Invoice | null>(null)
  const [actioning, setActioning] = useState('')

  useEffect(() => {
    apiFetch<{ branches: Branch[] }>('/branches')
      .then(d => setBranches((d.branches || []).filter(b => b.is_active !== false)))
      .catch(() => setBranches([]))
    apiFetch<{ items: NominalCode[] }>('/admin/nominal-codes?type=INCOME&active=true&per_page=200')
      .then(d => setCodes(d.items || []))
      .catch(() => setCodes([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) })
      if (statusFilter) qs.set('status', statusFilter)
      if (search.trim()) qs.set('search', search.trim())
      const d = await apiFetch<{ items: Invoice[]; total: number }>(`/admin/sales-invoices?${qs}`)
      setItems(d.items || [])
      setTotal(d.total || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoices')
    } finally {
      setLoading(false)
    }
  }, [page, perPage, statusFilter, search])

  useEffect(() => { load() }, [load])

  async function refreshDetail(id: string) {
    try {
      const d = await apiFetch<Invoice>(`/admin/sales-invoices/${id}`)
      setDetail(d)
    } catch { /* non-fatal */ }
  }

  async function action(id: string, verb: 'send' | 'pay' | 'void' | 'delete') {
    if (verb === 'delete' && !window.confirm('Delete this DRAFT invoice?')) return
    if (verb === 'void' && !window.confirm('Void this invoice?')) return
    setActioning(id + verb)
    try {
      if (verb === 'delete') {
        await apiFetch(`/admin/sales-invoices/${id}`, { method: 'DELETE' })
        setDetail(null)
      } else {
        await apiFetch(`/admin/sales-invoices/${id}/${verb}`, { method: 'POST' })
        await refreshDetail(id)
      }
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : `Failed to ${verb}`)
    } finally {
      setActioning('')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Sales Invoices</h1>
          <p className="text-white/40 mt-1">Raise invoices to customers, track payment, post to nominal codes.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ New Invoice</button>
      </div>

      {/* Filters */}
      <div className="glass rounded-2xl p-4 flex flex-wrap gap-3 items-center">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search invoice number, customer, reference…"
          className="flex-1 min-w-[220px] bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-saffron-400/50"
        />
        <select value={statusFilter} onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none">
          <option value="">All statuses</option>
          {['DRAFT','SENT','PART_PAID','PAID','VOID'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Table */}
      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="overflow-x-auto"><table className="w-full">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-xs font-semibold uppercase tracking-wider">
              <th className="text-left px-4 py-3">Invoice #</th>
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-left px-4 py-3">Branch</th>
              <th className="text-left px-4 py-3">Issued</th>
              <th className="text-left px-4 py-3">Due</th>
              <th className="text-right px-4 py-3">Total</th>
              <th className="text-center px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (<tr><td colSpan={7} className="px-4 py-10 text-center text-white/30 text-sm">Loading…</td></tr>)}
            {!loading && items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-white/30 text-sm">No invoices yet. Click + New Invoice to raise one.</td></tr>
            )}
            {items.map((inv, i) => (
              <motion.tr key={inv.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                onClick={() => { setDetail(inv); refreshDetail(inv.id) }}
                className="border-b border-white/5 hover:bg-white/3 cursor-pointer transition-colors">
                <td className="px-4 py-3 text-white font-mono text-sm font-bold">{inv.invoice_number}</td>
                <td className="px-4 py-3 text-white/80 text-sm">{inv.customer_name || '—'}</td>
                <td className="px-4 py-3 text-white/50 text-xs">{inv.branch_id}</td>
                <td className="px-4 py-3 text-white/60 text-sm font-mono">{fmtDate(inv.invoice_date)}</td>
                <td className="px-4 py-3 text-white/60 text-sm font-mono">{fmtDate(inv.due_date)}</td>
                <td className="px-4 py-3 text-right text-white font-mono text-sm font-bold">{fmtMoney(inv.total, inv.currency)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${STATUS_BADGE[inv.status] || 'bg-white/10 text-white/60 border-white/20'}`}>{inv.status}</span>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table></div>
        <Pagination page={page} pageSize={perPage} total={total} onPageChange={setPage} onPageSizeChange={setPerPage} />
      </div>

      <CreateForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); load() }}
        branches={branches}
        codes={codes}
      />

      <DetailDrawer
        inv={detail}
        onClose={() => setDetail(null)}
        onAction={action}
        actioning={actioning}
      />
    </div>
  )
}

// ─── Create form (slide-over) ────────────────────────────────────────────────

function CreateForm({ open, onClose, onSaved, branches, codes }: {
  open: boolean; onClose: () => void; onSaved: () => void
  branches: Branch[]; codes: NominalCode[]
}) {
  const [branchId, setBranchId] = useState('main')
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null)
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0])
  const [due, setDue] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<InvoiceLine[]>([
    { description: '', nominal_code_id: null, nominal_code: '', quantity: 1, unit_price: 0, vat_rate: 0, vat_code: 'OUT_OF_SCOPE' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setBranchId('main'); setCustomer(null); setInvoiceDate(new Date().toISOString().split('T')[0])
    setDue(''); setReference(''); setNotes('')
    setLines([{ description: '', nominal_code_id: null, nominal_code: '', quantity: 1, unit_price: 0, vat_rate: 0, vat_code: 'OUT_OF_SCOPE' }])
    setError('')
  }

  function setLine(idx: number, patch: Partial<InvoiceLine>) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l))
  }

  function addLine() {
    setLines(prev => [...prev, { description: '', nominal_code_id: null, nominal_code: '', quantity: 1, unit_price: 0, vat_rate: 0, vat_code: 'OUT_OF_SCOPE' }])
  }

  function removeLine(idx: number) {
    setLines(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)
  }

  function pickCode(idx: number, codeId: string) {
    const c = codes.find(x => x.id === codeId)
    setLine(idx, c
      ? { nominal_code_id: c.id, nominal_code: c.code, vat_code: c.vat_code, vat_rate: c.vat_rate }
      : { nominal_code_id: null, nominal_code: '' }
    )
  }

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0)
  const vatTotal = lines.reduce((s, l) => s + ((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)) * (Number(l.vat_rate) || 0) / 100, 0)

  async function submit() {
    if (!customer) { setError('Pick a customer from CRM Accounts'); return }
    if (lines.some(l => !l.description.trim() || l.quantity <= 0)) {
      setError('Every line needs a description and quantity > 0'); return
    }
    setSaving(true); setError('')
    try {
      await apiFetch('/admin/sales-invoices', {
        method: 'POST',
        body: JSON.stringify({
          branch_id: branchId,
          customer_account_id: customer.id,
          customer_name: customer.name,
          invoice_date: invoiceDate, due_date: due,
          reference, notes, lines,
        }),
      })
      reset(); onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create invoice')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} className="fixed inset-0 bg-black/60 z-40" />
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="fixed right-0 top-0 h-full w-full sm:max-w-[720px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-white font-black text-lg">New Sales Invoice</h2>
              <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Branch</label>
                  <select value={branchId} onChange={e => setBranchId(e.target.value)} className={inp}>
                    {branches.length === 0 && <option value="main">main</option>}
                    {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Reference</label>
                  <input value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. Hall hire — Sat" className={inp} />
                </div>
              </div>

              <div>
                <label className={lbl}>Customer * <span className="text-white/40 font-normal normal-case">(from CRM Accounts)</span></label>
                <AccountPicker accountType="customer" value={customer} onChange={setCustomer}
                  placeholder="Search CRM customers…" required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Invoice date</label>
                  <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className={inp} />
                </div>
                <div>
                  <label className={lbl}>Due date</label>
                  <input type="date" value={due} onChange={e => setDue(e.target.value)} className={inp} />
                </div>
              </div>

              <div>
                <label className={lbl}>Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${inp} resize-none`} />
              </div>

              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <label className={lbl}>Lines</label>
                  <button onClick={addLine} className="text-xs text-saffron-300 hover:text-saffron-200">+ Add line</button>
                </div>
                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={i} className="bg-white/3 border border-white/5 rounded-xl p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <input value={l.description} onChange={e => setLine(i, { description: e.target.value })}
                          placeholder={`Line ${i + 1} description`} className={`${inp} flex-1`} />
                        <button onClick={() => removeLine(i)} disabled={lines.length === 1}
                          className="text-white/40 hover:text-red-400 disabled:opacity-30 text-lg w-9 h-9 flex items-center justify-center">✕</button>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        <select value={l.nominal_code_id || ''} onChange={e => pickCode(i, e.target.value)} className={`${inp} col-span-2 text-xs`}>
                          <option value="">Nominal code…</option>
                          {codes.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                        </select>
                        <input type="number" step="0.001" min="0" value={l.quantity}
                          onChange={e => setLine(i, { quantity: Number(e.target.value) })}
                          placeholder="Qty" className={inp} />
                        <input type="number" step="0.01" min="0" value={l.unit_price}
                          onChange={e => setLine(i, { unit_price: Number(e.target.value) })}
                          placeholder="Unit £" className={inp} />
                        <select value={l.vat_code} onChange={e => {
                          const vc = e.target.value
                          const rate = vc === 'STANDARD' ? 20 : vc === 'REDUCED' ? 5 : 0
                          setLine(i, { vat_code: vc, vat_rate: rate })
                        }} className={`${inp} text-xs`}>
                          {VAT_CODES.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </div>
                      <div className="flex justify-between text-xs text-white/50">
                        <span>Net £{((l.quantity || 0) * (l.unit_price || 0)).toFixed(2)} · VAT @ {l.vat_rate}%</span>
                        <span className="font-mono text-white/80">
                          £{(((l.quantity || 0) * (l.unit_price || 0)) * (1 + (l.vat_rate || 0) / 100)).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-white/5 pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-white/60"><span>Subtotal</span><span className="font-mono">£{subtotal.toFixed(2)}</span></div>
                <div className="flex justify-between text-white/60"><span>VAT</span><span className="font-mono">£{vatTotal.toFixed(2)}</span></div>
                <div className="flex justify-between text-white font-black text-base pt-1"><span>Total</span><span className="font-mono">£{(subtotal + vatTotal).toFixed(2)}</span></div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-white/5 flex gap-3">
              <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
              <button onClick={submit} disabled={saving} className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                {saving ? 'Creating…' : 'Create as DRAFT'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─── Detail drawer ───────────────────────────────────────────────────────────

function DetailDrawer({ inv, onClose, onAction, actioning }: {
  inv: Invoice | null; onClose: () => void
  onAction: (id: string, verb: 'send' | 'pay' | 'void' | 'delete') => void
  actioning: string
}) {
  if (!inv) return null
  const can = {
    send: inv.status === 'DRAFT',
    pay:  inv.status === 'SENT' || inv.status === 'PART_PAID',
    void: inv.status !== 'PAID' && inv.status !== 'VOID',
    del:  inv.status === 'DRAFT',
  }
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="fixed inset-0 bg-black/60 z-40" />
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed right-0 top-0 h-full w-full sm:max-w-[640px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div>
            <h2 className="text-white font-black text-lg font-mono">{inv.invoice_number}</h2>
            <p className="text-white/40 text-xs mt-0.5">{inv.customer_name} · {inv.branch_id}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${STATUS_BADGE[inv.status] || 'bg-white/10 text-white/60 border-white/20'}`}>{inv.status}</span>
            <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-white/40 text-xs">Invoice date</p><p className="text-white font-mono">{fmtDate(inv.invoice_date)}</p></div>
            <div><p className="text-white/40 text-xs">Due</p><p className="text-white font-mono">{fmtDate(inv.due_date)}</p></div>
            <div><p className="text-white/40 text-xs">Reference</p><p className="text-white/80">{inv.reference || '—'}</p></div>
            <div><p className="text-white/40 text-xs">Created by</p><p className="text-white/80 text-xs truncate">{inv.created_by || '—'}</p></div>
          </div>

          {inv.notes && (
            <div>
              <p className="text-white/40 text-xs mb-1">Notes</p>
              <p className="text-white/70 text-sm whitespace-pre-wrap">{inv.notes}</p>
            </div>
          )}

          <div>
            <p className="text-white/40 text-xs uppercase tracking-wide mb-2">Lines</p>
            <div className="border border-white/5 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-white/3 text-white/40 text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">#</th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-left px-3 py-2">Nominal</th>
                    <th className="text-right px-3 py-2">Qty</th>
                    <th className="text-right px-3 py-2">Unit</th>
                    <th className="text-right px-3 py-2">VAT</th>
                    <th className="text-right px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(inv.lines || []).map(l => (
                    <tr key={l.id} className="border-t border-white/5 text-white/70">
                      <td className="px-3 py-2 font-mono text-white/40">{(inv.lines || []).indexOf(l) + 1}</td>
                      <td className="px-3 py-2">{l.description}</td>
                      <td className="px-3 py-2 font-mono text-xs">{l.nominal_code || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{Number(l.quantity).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtMoney(Number(l.unit_price), inv.currency)}</td>
                      <td className="px-3 py-2 text-right text-xs">{l.vat_code} ({l.vat_rate}%)</td>
                      <td className="px-3 py-2 text-right font-mono text-white font-bold">{fmtMoney(Number(l.line_total), inv.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border-t border-white/5 pt-3 space-y-1 text-sm">
            <div className="flex justify-between text-white/60"><span>Subtotal</span><span className="font-mono">{fmtMoney(inv.subtotal, inv.currency)}</span></div>
            <div className="flex justify-between text-white/60"><span>VAT</span><span className="font-mono">{fmtMoney(inv.vat_total, inv.currency)}</span></div>
            <div className="flex justify-between text-white font-black text-base pt-1"><span>Total</span><span className="font-mono">{fmtMoney(inv.total, inv.currency)}</span></div>
            {inv.paid_total > 0 && (
              <div className="flex justify-between text-green-300"><span>Paid</span><span className="font-mono">{fmtMoney(inv.paid_total, inv.currency)}</span></div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/5 flex flex-wrap gap-2">
          {can.del && (
            <button onClick={() => onAction(inv.id, 'delete')} disabled={!!actioning}
              className="px-4 py-2.5 rounded-xl border border-red-500/30 text-red-300 text-sm font-semibold disabled:opacity-40">
              Delete
            </button>
          )}
          {can.void && (
            <button onClick={() => onAction(inv.id, 'void')} disabled={!!actioning}
              className="px-4 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-semibold disabled:opacity-40">
              {actioning === inv.id + 'void' ? 'Voiding…' : 'Void'}
            </button>
          )}
          <div className="flex-1" />
          {can.send && (
            <button onClick={() => onAction(inv.id, 'send')} disabled={!!actioning}
              className="px-5 py-2.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-200 text-sm font-bold disabled:opacity-40">
              {actioning === inv.id + 'send' ? 'Sending…' : 'Mark Sent'}
            </button>
          )}
          {can.pay && (
            <button onClick={() => onAction(inv.id, 'pay')} disabled={!!actioning}
              className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white text-sm font-black disabled:opacity-40">
              {actioning === inv.id + 'pay' ? 'Marking…' : 'Mark Paid'}
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
