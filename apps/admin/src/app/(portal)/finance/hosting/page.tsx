'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

/**
 * Hosting & Infrastructure costs — a focused view of recurring_payments
 * filtered to the IT cost categories. Same backing table as the main
 * Recurring Payments page, just pre-filtered and with a roll-up of
 * monthly + annualised spend so the trustees can see what the running
 * cost of "having the system" is at a glance.
 *
 * Adding a row pre-sets category=HOSTING; everything else is the standard
 * recurring_payments form.
 */

const HOSTING_CATEGORIES = ['HOSTING', 'SOFTWARE', 'DOMAIN', 'PROFESSIONAL'] as const
type HostingCategory = typeof HOSTING_CATEGORIES[number]

const FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL'] as const
type Frequency = typeof FREQUENCIES[number]

// Per-frequency multiplier to convert the row's amount into a monthly figure
// for the roll-up. Daily/weekly aren't in the dropdown since hosting almost
// never bills that way, but the math handles them if they sneak in.
const TO_MONTHLY: Record<string, number> = {
  DAILY: 30, WEEKLY: 4.345, MONTHLY: 1,
  QUARTERLY: 1 / 3, BIANNUAL: 1 / 6, ANNUAL: 1 / 12,
}

const CAT_LABEL: Record<HostingCategory, string> = {
  HOSTING: '🖥️ Hosting',
  SOFTWARE: '🧩 Software / SaaS',
  DOMAIN: '🌐 Domain / DNS',
  PROFESSIONAL: '🧑‍💼 Professional',
}
const CAT_BLURB: Record<HostingCategory, string> = {
  HOSTING:      'Servers, VPS, cloud compute, managed databases, CDN.',
  SOFTWARE:     'SaaS subscriptions — Microsoft 365, SendGrid, Stripe fixed fees, observability.',
  DOMAIN:       'Domain registrations, DNS providers, SSL.',
  PROFESSIONAL: 'Accountancy, payroll bureau, IT support, legal retainer.',
}

interface RecurringPayment {
  id: string; name: string; category: string; is_critical: boolean
  amount: number; currency: string; frequency: string
  start_date: string; end_date: string | null
  day_of_month: number | null; renewal_date: string | null; notice_days: number
  payee: string; reference: string; notes: string
  is_active: boolean; created_at: string; updated_at: string
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-[10px] font-semibold uppercase tracking-wide mb-1'

function fmt(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n || 0)
}
function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function monthlyEquiv(p: RecurringPayment): number {
  const mult = TO_MONTHLY[p.frequency.toUpperCase()] ?? 1
  return Number(p.amount) * mult
}

export default function HostingCostsPage() {
  const [items, setItems] = useState<RecurringPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<RecurringPayment | null>(null)
  const [form, setForm] = useState({
    name: '', category: 'HOSTING' as HostingCategory, payee: '',
    amount: '', currency: 'GBP', frequency: 'MONTHLY' as Frequency,
    renewal_date: '', reference: '', notes: '',
  })
  const [filter, setFilter] = useState<'ALL' | HostingCategory>('ALL')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const all: RecurringPayment[] = []
      for (const c of HOSTING_CATEGORIES) {
        const data = await apiFetch<{ items: RecurringPayment[] }>(`/recurring-payments?category=${c}&active=true`)
        all.push(...(data.items || []))
      }
      setItems(all)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  function openNew() {
    setEditing(null)
    setForm({
      name: '', category: 'HOSTING', payee: '',
      amount: '', currency: 'GBP', frequency: 'MONTHLY',
      renewal_date: '', reference: '', notes: '',
    })
    setShowForm(true)
  }
  function openEdit(p: RecurringPayment) {
    setEditing(p)
    setForm({
      name: p.name, category: (HOSTING_CATEGORIES as readonly string[]).includes(p.category) ? p.category as HostingCategory : 'HOSTING',
      payee: p.payee, amount: String(p.amount), currency: p.currency,
      frequency: (FREQUENCIES as readonly string[]).includes(p.frequency) ? p.frequency as Frequency : 'MONTHLY',
      renewal_date: p.renewal_date || '', reference: p.reference, notes: p.notes,
    })
    setShowForm(true)
  }
  async function save() {
    if (!form.name.trim() || !form.amount) { setError('Name and amount are required'); return }
    try {
      const body = {
        name: form.name.trim(), category: form.category, payee: form.payee.trim(),
        amount: Number(form.amount), currency: form.currency, frequency: form.frequency,
        start_date: editing?.start_date || new Date().toISOString().slice(0, 10),
        renewal_date: form.renewal_date || null,
        reference: form.reference.trim(), notes: form.notes,
        is_critical: false, notice_days: 30,
      }
      if (editing) await apiFetch(`/recurring-payments/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
      else        await apiFetch(`/recurring-payments`, { method: 'POST', body: JSON.stringify(body) })
      setShowForm(false); load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
  }
  async function remove(p: RecurringPayment) {
    if (!confirm(`Remove ${p.name}?`)) return
    try { await apiFetch(`/recurring-payments/${p.id}`, { method: 'DELETE' }); load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed') }
  }

  const filtered = filter === 'ALL' ? items : items.filter(p => p.category === filter)
  const monthlyTotal = items.reduce((a, p) => a + monthlyEquiv(p), 0)
  const annualTotal = monthlyTotal * 12
  const byCategory: Record<string, number> = {}
  for (const p of items) byCategory[p.category] = (byCategory[p.category] || 0) + monthlyEquiv(p)
  const renewalsDue = items
    .filter(p => p.renewal_date && new Date(p.renewal_date) <= new Date(Date.now() + 60 * 86400_000))
    .sort((a, b) => (a.renewal_date || '').localeCompare(b.renewal_date || ''))

  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">🖥️ Hosting & Infrastructure Costs</h1>
          <p className="text-white/40 text-sm mt-1 max-w-2xl">
            Track what it costs to keep the system running — servers, SaaS subscriptions,
            domains, professional services. Backed by the same recurring-payments table as
            the wider <Link href="/finance/recurring" className="text-saffron-300 hover:underline">Bills & Subs</Link> page,
            just filtered to the IT categories.
          </p>
        </div>
        <button onClick={openNew} className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-bold">
          + Add cost line
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Roll-up KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Monthly run-rate" value={fmt(monthlyTotal)} hint={`${items.length} active lines`} />
        <KPI label="Annualised" value={fmt(annualTotal)} hint="× 12 from monthly equiv" />
        <KPI label="Renewals next 60d" value={String(renewalsDue.length)} hint={renewalsDue[0] ? `Next: ${fmtDate(renewalsDue[0].renewal_date)}` : 'None due'} />
        <KPI label="Categories used" value={`${Object.keys(byCategory).length}/${HOSTING_CATEGORIES.length}`} hint="of the IT cost categories" />
      </div>

      {/* Per-category split */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {HOSTING_CATEGORIES.map(c => (
          <button key={c} onClick={() => setFilter(filter === c ? 'ALL' : c)}
            className={`rounded-xl p-3 text-left border transition-colors ${filter === c ? 'bg-saffron-500/15 border-saffron-400/40' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
            <p className="text-white font-semibold text-sm">{CAT_LABEL[c]}</p>
            <p className="text-white/40 text-[10px] mt-0.5">{CAT_BLURB[c]}</p>
            <p className="text-saffron-300 text-lg font-black mt-2">{fmt(byCategory[c] || 0)}<span className="text-white/40 text-xs font-normal"> / month</span></p>
          </button>
        ))}
      </div>

      {/* Renewals warning */}
      {renewalsDue.length > 0 && (
        <div className="rounded-xl p-3 bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm">
          <p className="font-bold mb-1">⏰ {renewalsDue.length} renewal(s) due in the next 60 days</p>
          <ul className="space-y-0.5 text-xs">
            {renewalsDue.slice(0, 5).map(p => (
              <li key={p.id}>
                <span className="font-mono">{fmtDate(p.renewal_date)}</span> · {p.name} · {fmt(Number(p.amount))} {p.currency} / {p.frequency.toLowerCase()}
              </li>
            ))}
            {renewalsDue.length > 5 && <li className="text-white/40">…and {renewalsDue.length - 5} more</li>}
          </ul>
        </div>
      )}

      {/* Table */}
      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="overflow-x-auto"><table className="w-full">
          <thead><tr className="border-b border-white/5 text-white/40 text-xs font-semibold uppercase tracking-wider">
            <th className="text-left px-4 py-3">Service</th>
            <th className="text-left px-4 py-3">Vendor</th>
            <th className="text-left px-4 py-3">Category</th>
            <th className="text-right px-4 py-3">Amount</th>
            <th className="text-left px-4 py-3">Frequency</th>
            <th className="text-right px-4 py-3">Monthly equiv.</th>
            <th className="text-left px-4 py-3">Renewal</th>
            <th className="text-right px-4 py-3">Actions</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-4 py-10 text-center text-white/30 text-sm">Loading…</td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-white/30 text-sm">
                No cost lines yet. Add Vultr / Microsoft 365 / domain / SendGrid etc. to start tracking.
              </td></tr>
            )}
            {filtered.map(p => (
              <tr key={p.id} className="border-b border-white/5 hover:bg-white/3">
                <td className="px-4 py-3 text-white text-sm">{p.name}{p.reference && <p className="text-white/40 text-[10px] font-mono">{p.reference}</p>}</td>
                <td className="px-4 py-3 text-white/70 text-sm">{p.payee || '—'}</td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/60">{p.category}</span>
                </td>
                <td className="px-4 py-3 text-right text-white/80 font-mono text-sm">{fmt(Number(p.amount))}</td>
                <td className="px-4 py-3 text-white/60 text-xs">{p.frequency}</td>
                <td className="px-4 py-3 text-right text-saffron-300 font-mono font-bold text-sm">{fmt(monthlyEquiv(p))}</td>
                <td className="px-4 py-3 text-white/60 text-xs">{fmtDate(p.renewal_date)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => openEdit(p)} className="text-white/40 hover:text-saffron-400 text-xs px-2">Edit</button>
                  <button onClick={() => remove(p)} className="text-red-400 hover:text-red-300 text-xs px-2">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {/* Slide-over form */}
      {showForm && (
        <>
          <div onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
          <div className="fixed right-0 top-0 h-full w-full sm:max-w-[480px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-white font-black text-lg">{editing ? 'Edit cost line' : 'New cost line'}</h2>
              <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className={lbl}>Service / what *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Vultr VPS — production" className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Category</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as HostingCategory }))} className={inp}>
                    {HOSTING_CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Vendor / payee</label>
                  <input value={form.payee} onChange={e => setForm(f => ({ ...f, payee: e.target.value }))}
                    placeholder="Vultr Holdings, LLC" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Amount *</label>
                  <input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className={lbl}>Currency</label>
                  <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} className={inp}>
                    {['GBP', 'EUR', 'USD'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Frequency</label>
                  <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value as Frequency }))} className={inp}>
                    {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Next renewal</label>
                  <input type="date" value={form.renewal_date} onChange={e => setForm(f => ({ ...f, renewal_date: e.target.value }))} className={inp} />
                </div>
              </div>
              <div>
                <label className={lbl}>Reference / account number</label>
                <input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
                  placeholder="account / subscription / invoice prefix" className={inp} />
              </div>
              <div>
                <label className={lbl}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3} className={`${inp} resize-none`} placeholder="e.g. 8 GB VPS, London region. Includes 2 TB bandwidth." />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-white/5 flex gap-3">
              <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
              <button onClick={save} className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm">{editing ? 'Save' : 'Create'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function KPI({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl p-3 bg-white/5 border border-white/10">
      <p className="text-white/40 text-[10px] uppercase tracking-wider">{label}</p>
      <p className="text-xl font-black text-white">{value}</p>
      {hint && <p className="text-white/40 text-xs mt-0.5">{hint}</p>}
    </div>
  )
}
