'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Donation {
  id: string
  donor_name: string
  amount: number
  purpose: string
  gift_aid_eligible: boolean
  created_at: string
}

interface DonationsResponse {
  donations: Donation[]
  total_amount: number
  total_count: number
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

export default function DonationsPage() {
  const [donations, setDonations] = useState<Donation[]>([])
  const [totalAmount, setTotalAmount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [form, setForm] = useState({
    donor_name: '',
    amount: '',
    purpose: 'General',
    gift_aid_eligible: false,
  })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await apiFetch<DonationsResponse>(
        '/finance/reports/donations?from_date=2020-01-01&to_date=2030-12-31'
      )
      setDonations(data.donations || [])
      setTotalAmount(data.total_amount || 0)
      setTotalCount(data.total_count || 0)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load donations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function submit() {
    if (!form.donor_name || !form.amount) { setFormError('Donor name and amount are required'); return }
    setSaving(true); setFormError('')
    try {
      await apiFetch('/finance/donations', {
        method: 'POST',
        body: JSON.stringify({
          donor_name: form.donor_name,
          amount: parseFloat(form.amount),
          purpose: form.purpose,
          gift_aid_eligible: form.gift_aid_eligible,
          branch_id: 'main',
        }),
      })
      setShowForm(false)
      setForm({ donor_name: '', amount: '', purpose: 'General', gift_aid_eligible: false })
      load()
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to save donation')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Donations</h1>
          <p className="text-white/40 mt-1">Track and manage all temple donations</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ New Donation</button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Total Donations', value: totalCount.toString(), icon: '🙏', color: 'from-amber-600 to-orange-500' },
          { label: 'Total Amount', value: `£${totalAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, icon: '💰', color: 'from-green-600 to-emerald-500' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="glass rounded-2xl p-5 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-24 h-24 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-lg mb-3`}>{s.icon}</div>
            <p className="text-white/50 text-xs font-medium mb-1">{s.label}</p>
            <p className="text-3xl font-black text-white">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="glass rounded-2xl overflow-hidden border border-temple-border">
        {loading ? (
          <div className="text-center py-20 text-white/30">Loading donations…</div>
        ) : donations.length === 0 ? (
          <div className="text-center py-20 text-white/30">
            <p className="text-4xl mb-3">🙏</p>
            <p className="font-medium">No donations recorded yet.</p>
            <p className="text-xs mt-1">Click &quot;New Donation&quot; to add the first one.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Donor', 'Amount', 'Purpose', 'Gift Aid', 'Date'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {donations.map((d, i) => (
                <motion.tr key={d.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                  className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-4 py-4 text-white font-medium">{d.donor_name}</td>
                  <td className="px-4 py-4 font-mono font-bold text-saffron-400">
                    £{Number(d.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-4 text-white/60 text-sm">{d.purpose}</td>
                  <td className="px-4 py-4">
                    {d.gift_aid_eligible ? (
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">Gift Aid</span>
                    ) : (
                      <span className="text-xs text-white/20">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-white/40 text-sm">
                    {new Date(d.created_at).toLocaleDateString('en-GB')}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
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
              className="fixed right-0 top-0 h-full w-[520px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">New Donation</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {formError && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{formError}</div>}
                <div>
                  <label className={lbl}>Donor Name *</label>
                  <input value={form.donor_name} onChange={e => setForm(p => ({ ...p, donor_name: e.target.value }))}
                    placeholder="e.g. Patel Family" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Amount (£) *</label>
                  <input type="number" min="0.01" step="0.01" value={form.amount}
                    onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                    placeholder="0.00" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Purpose</label>
                  <select value={form.purpose} onChange={e => setForm(p => ({ ...p, purpose: e.target.value }))} className={inp}>
                    <option value="General">General</option>
                    <option value="Specific">Specific</option>
                  </select>
                </div>
                <div className="flex items-center justify-between py-3 px-4 bg-white/5 rounded-xl border border-white/10">
                  <div>
                    <p className="text-white text-sm font-medium">Gift Aid Eligible</p>
                    <p className="text-white/40 text-xs mt-0.5">Donor is a UK taxpayer</p>
                  </div>
                  <button onClick={() => setForm(p => ({ ...p, gift_aid_eligible: !p.gift_aid_eligible }))}
                    className={`w-12 h-6 rounded-full transition-colors ${form.gift_aid_eligible ? 'bg-saffron-gradient' : 'bg-white/10'}`}>
                    <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform mx-0.5 ${form.gift_aid_eligible ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
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
