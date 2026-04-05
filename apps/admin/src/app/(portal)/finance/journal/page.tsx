'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Account {
  id: string
  code: string
  name: string
  type: string
  balance: string
}

interface TrialBalanceEntry {
  account: string
  dr: number
  cr: number
}

interface TrialBalance {
  entries: TrialBalanceEntry[]
  total_dr: number
  total_cr: number
  balanced: boolean
}

interface JournalForm {
  description: string
  debit_account_id: string
  credit_account_id: string
  amount: string
  reference: string
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

const TYPE_COLORS: Record<string, string> = {
  ASSET: 'text-green-400 bg-green-500/15 border-green-500/30',
  LIABILITY: 'text-red-400 bg-red-500/15 border-red-500/30',
  EQUITY: 'text-blue-400 bg-blue-500/15 border-blue-500/30',
  INCOME: 'text-orange-400 bg-orange-500/15 border-orange-500/30',
  EXPENSE: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30',
}

export default function JournalPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [tb, setTb] = useState<TrialBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const [form, setForm] = useState<JournalForm>({
    description: '', debit_account_id: '', credit_account_id: '', amount: '', reference: '',
  })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [accsData, tbData] = await Promise.all([
        apiFetch<{ accounts: Account[] }>('/finance/accounts'),
        apiFetch<TrialBalance>('/finance/trial-balance'),
      ])
      setAccounts(accsData.accounts || [])
      setTb(tbData)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function postJournal() {
    if (!form.description || !form.debit_account_id || !form.credit_account_id || !form.amount) {
      setFormError('All fields except reference are required'); return
    }
    setSaving(true); setFormError('')
    try {
      await apiFetch('/finance/journal', {
        method: 'POST',
        body: JSON.stringify({
          description: form.description,
          debit_account_id: form.debit_account_id,
          credit_account_id: form.credit_account_id,
          amount: parseFloat(form.amount),
          reference: form.reference || undefined,
        }),
      })
      setShowForm(false)
      setForm({ description: '', debit_account_id: '', credit_account_id: '', amount: '', reference: '' })
      setSuccessMsg('Journal entry posted successfully')
      setTimeout(() => setSuccessMsg(''), 4000)
      load()
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to post journal entry')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Journal Entries</h1>
          <p className="text-white/40 mt-1">Double-entry bookkeeping ledger</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ Post Journal Entry</button>
      </div>

      {successMsg && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-xl text-sm">
          {successMsg}
        </motion.div>
      )}
      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Trial Balance summary */}
      {tb && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Total Debits', value: tb.total_dr, color: 'from-red-600 to-rose-500', icon: '📤' },
            { label: 'Total Credits', value: tb.total_cr, color: 'from-green-600 to-emerald-500', icon: '📥' },
            { label: 'Balance Status', value: tb.balanced ? 'Balanced ✓' : 'Unbalanced ✗', color: tb.balanced ? 'from-blue-600 to-indigo-500' : 'from-red-600 to-rose-500', icon: '⚖️', isText: true },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
              className="glass rounded-2xl p-5 relative overflow-hidden">
              <div className={`absolute top-0 right-0 w-24 h-24 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-lg mb-3`}>{s.icon}</div>
              <p className="text-white/50 text-xs font-medium mb-1">{s.label}</p>
              <p className="text-2xl font-black text-white">
                {s.isText ? s.value : `£${Number(s.value).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`}
              </p>
            </motion.div>
          ))}
        </div>
      )}

      {/* Account balances table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="glass rounded-2xl overflow-hidden border border-temple-border">
        <div className="px-5 py-4 border-b border-white/5">
          <h2 className="text-white font-bold">Account Balances</h2>
          <p className="text-white/40 text-xs mt-0.5">Current ledger positions from trial balance</p>
        </div>
        {loading ? (
          <div className="text-center py-16 text-white/30">Loading ledger…</div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-16 text-white/30">
            <p className="text-4xl mb-3">📒</p>
            <p>No accounts found. Post a journal entry to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Code', 'Account Name', 'Type', 'Balance'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc, i) => (
                <motion.tr key={acc.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                  className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-4 py-4">
                    <code className="text-saffron-400/80 text-xs bg-saffron-400/10 px-2 py-1 rounded">{acc.code}</code>
                  </td>
                  <td className="px-4 py-4 text-white font-medium">{acc.name}</td>
                  <td className="px-4 py-4">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${TYPE_COLORS[acc.type] || 'text-white/40 bg-white/5 border-white/10'}`}>
                      {acc.type}
                    </span>
                  </td>
                  <td className="px-4 py-4 font-mono font-bold text-white text-right">
                    £{parseFloat(acc.balance || '0').toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table></div>
        )}
      </motion.div>

      {/* Slide-over: Post Journal Entry */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full max-w-[520px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">Post Journal Entry</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {formError && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{formError}</div>}
                <div>
                  <label className={lbl}>Description *</label>
                  <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="e.g. Donation received from Patel family" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Debit Account *</label>
                  <select value={form.debit_account_id} onChange={e => setForm(p => ({ ...p, debit_account_id: e.target.value }))} className={inp}>
                    <option value="">Select account…</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Credit Account *</label>
                  <select value={form.credit_account_id} onChange={e => setForm(p => ({ ...p, credit_account_id: e.target.value }))} className={inp}>
                    <option value="">Select account…</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Amount (£) *</label>
                    <input type="number" min="0.01" step="0.01" value={form.amount}
                      onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                      placeholder="0.00" className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Reference</label>
                    <input value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))}
                      placeholder="REF-001" className={inp} />
                  </div>
                </div>
                <div className="bg-white/3 rounded-xl p-4 border border-white/5">
                  <p className="text-white/40 text-xs">Every journal entry debits one account and credits another by the same amount, keeping the ledger balanced.</p>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={postJournal} disabled={saving}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {saving ? 'Posting…' : 'Post Entry'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
