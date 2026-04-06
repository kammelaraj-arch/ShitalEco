'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface PurposeLine {
  purpose: string
  count: number
  total: string
  gift_aid: string
}

interface DonationSummary {
  from_date: string
  to_date: string
  total_donations: string
  total_gift_aid: string
  total_value: string
  by_purpose: PurposeLine[]
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

const PURPOSES = ['General', 'Building Fund', 'Education', 'Food Bank', 'Festival', 'Specific']

export default function DonationsPage() {
  const [summary, setSummary] = useState<DonationSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const today = new Date().toISOString().slice(0, 10)
  const firstOfYear = `${new Date().getFullYear()}-01-01`
  const [fromDate, setFromDate] = useState(firstOfYear)
  const [toDate, setToDate] = useState(today)

  const [form, setForm] = useState({
    amount: '',
    purpose: 'General',
    payment_provider: 'cash',
    payment_ref: '',
    gift_aid_declaration_id: '',
  })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await apiFetch<DonationSummary>(
        `/finance/reports/donations?from_date=${fromDate}&to_date=${toDate}`
      )
      setSummary(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load donations')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  useEffect(() => { load() }, [load])

  async function submit() {
    if (!form.amount || parseFloat(form.amount) <= 0) { setFormError('Enter a valid amount'); return }
    if (!form.purpose.trim()) { setFormError('Purpose is required'); return }
    setSaving(true); setFormError('')
    try {
      // DonationInput requires: amount (string), purpose, payment_provider, idempotency_key
      await apiFetch('/finance/donations', {
        method: 'POST',
        body: JSON.stringify({
          amount: parseFloat(form.amount).toFixed(2),
          purpose: form.purpose,
          payment_provider: form.payment_provider,
          payment_ref: form.payment_ref,
          gift_aid_declaration_id: form.gift_aid_declaration_id,
          idempotency_key: crypto.randomUUID(),
        }),
      })
      setShowForm(false)
      setForm({ amount: '', purpose: 'General', payment_provider: 'cash', payment_ref: '', gift_aid_declaration_id: '' })
      load()
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to save donation')
    } finally {
      setSaving(false)
    }
  }

  const totalAmount = summary ? parseFloat(summary.total_donations || '0') : 0
  const totalGiftAid = summary ? parseFloat(summary.total_gift_aid || '0') : 0
  const byPurpose = summary?.by_purpose || []

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Donations</h1>
          <p className="text-white/40 mt-1">Track and manage all temple donations</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ New Donation</button>
      </div>

      {/* Date range filter */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className={lbl}>From Date</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={inp + ' w-44'} />
        </div>
        <div>
          <label className={lbl}>To Date</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={inp + ' w-44'} />
        </div>
        <button onClick={load} className="px-5 py-3 rounded-xl text-white text-sm font-bold transition-all hover:opacity-90"
          style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
          Apply
        </button>
        <button onClick={() => { setFromDate('2020-01-01'); setToDate(today) }}
          className="px-4 py-3 rounded-xl border border-white/10 text-white/50 text-sm font-semibold hover:bg-white/5 transition-all">
          All Time
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Donations', value: byPurpose.reduce((s, r) => s + r.count, 0).toString(), icon: '🙏', color: 'from-amber-600 to-orange-500' },
          { label: 'Total Amount', value: `£${totalAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, icon: '💰', color: 'from-green-600 to-emerald-500' },
          { label: 'Gift Aid Reclaimed', value: `£${totalGiftAid.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, icon: '🇬🇧', color: 'from-blue-600 to-indigo-500' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="glass rounded-2xl p-5 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-24 h-24 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-lg mb-3`}>{s.icon}</div>
            <p className="text-white/50 text-xs font-medium mb-1">{s.label}</p>
            <p className="text-3xl font-black text-white">{loading ? '—' : s.value}</p>
          </motion.div>
        ))}
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Breakdown by purpose table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="glass rounded-2xl overflow-hidden border border-temple-border">
        {loading ? (
          <div className="text-center py-20 text-white/30">Loading donations…</div>
        ) : byPurpose.length === 0 ? (
          <div className="text-center py-20 text-white/30">
            <p className="text-4xl mb-3">🙏</p>
            <p className="font-medium">No donations recorded yet.</p>
            <p className="text-xs mt-1">Click &quot;New Donation&quot; to add the first one.</p>
          </div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Purpose', 'Count', 'Total Amount', 'Gift Aid Uplift'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byPurpose.map((row, i) => (
                <motion.tr key={row.purpose} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                  className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-4 py-4 text-white font-medium">{row.purpose}</td>
                  <td className="px-4 py-4 text-white/60 text-sm">{row.count}</td>
                  <td className="px-4 py-4 font-mono font-bold text-saffron-400">
                    £{parseFloat(row.total).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-4">
                    {parseFloat(row.gift_aid) > 0 ? (
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
                        +£{parseFloat(row.gift_aid).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-xs text-white/20">—</span>
                    )}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table></div>
        )}
      </motion.div>

      {/* Slide-over form */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full max-w-[520px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">New Donation</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {formError && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{formError}</div>}
                <div>
                  <label className={lbl}>Amount (£) *</label>
                  <input type="number" min="0.01" step="0.01" value={form.amount}
                    onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                    placeholder="0.00" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Purpose *</label>
                  <select value={form.purpose} onChange={e => setForm(p => ({ ...p, purpose: e.target.value }))} className={inp}>
                    {PURPOSES.map(pu => <option key={pu} value={pu}>{pu}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Payment Method</label>
                  <select value={form.payment_provider} onChange={e => setForm(p => ({ ...p, payment_provider: e.target.value }))} className={inp}>
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cheque">Cheque</option>
                    <option value="online">Online</option>
                  </select>
                </div>
                <div>
                  <label className={lbl}>Payment Reference</label>
                  <input value={form.payment_ref} onChange={e => setForm(p => ({ ...p, payment_ref: e.target.value }))}
                    placeholder="e.g. cheque no. or transaction ID" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Gift Aid Declaration ID <span className="normal-case font-normal text-white/30">(optional)</span></label>
                  <input value={form.gift_aid_declaration_id} onChange={e => setForm(p => ({ ...p, gift_aid_declaration_id: e.target.value }))}
                    placeholder="Leave blank if not applicable" className={inp} />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={submit} disabled={saving}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {saving ? 'Saving…' : 'Record Donation'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
