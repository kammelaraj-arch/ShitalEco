'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Account {
  id: string
  code: string
  name: string
  type: string
  balance: string
  currency: string
  is_active: boolean
}

interface TrialBalance {
  entries: { account: string; dr: number; cr: number }[]
  total_dr: number
  total_cr: number
  balanced: boolean
  as_at: string
}

interface JournalEntry {
  description: string
  debit_account_id: string
  credit_account_id: string
  amount: number
  reference?: string
}

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ASSET:     { bg: 'bg-green-500/15', text: 'text-green-400',  border: 'border-green-500/30' },
  LIABILITY: { bg: 'bg-red-500/15',   text: 'text-red-400',    border: 'border-red-500/30' },
  EQUITY:    { bg: 'bg-blue-500/15',  text: 'text-blue-400',   border: 'border-blue-500/30' },
  INCOME:    { bg: 'bg-orange-500/15',text: 'text-orange-400', border: 'border-orange-500/30' },
  EXPENSE:   { bg: 'bg-yellow-500/15',text: 'text-yellow-400', border: 'border-yellow-500/30' },
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const label = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FinancePage() {
  const [tab, setTab] = useState<'accounts' | 'trial-balance' | 'reports'>('accounts')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [tb, setTb] = useState<TrialBalance | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showJournal, setShowJournal] = useState(false)

  // ── Journal form ────────────────────────────────────────────────────────
  const [jForm, setJForm] = useState<JournalEntry>({
    description: '', debit_account_id: '', credit_account_id: '', amount: 0, reference: '',
  })
  const [jSaving, setJSaving] = useState(false)
  const [jError, setJError] = useState('')

  const loadAccounts = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await apiFetch<{ accounts: Account[] }>('/finance/accounts')
      setAccounts(data.accounts || [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load accounts')
    } finally { setLoading(false) }
  }, [])

  const loadTrialBalance = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await apiFetch<TrialBalance>('/finance/trial-balance')
      setTb(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load trial balance')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (tab === 'accounts') loadAccounts()
    else if (tab === 'trial-balance') loadTrialBalance()
  }, [tab, loadAccounts, loadTrialBalance])

  async function postJournal() {
    if (!jForm.description || !jForm.debit_account_id || !jForm.credit_account_id || !jForm.amount) {
      setJError('All fields required'); return
    }
    setJSaving(true); setJError('')
    try {
      await apiFetch('/finance/journal', {
        method: 'POST',
        body: JSON.stringify(jForm),
      })
      setShowJournal(false)
      setJForm({ description: '', debit_account_id: '', credit_account_id: '', amount: 0, reference: '' })
      if (tab === 'accounts') loadAccounts()
    } catch (e: unknown) {
      setJError(e instanceof Error ? e.message : 'Failed to post journal')
    } finally { setJSaving(false) }
  }

  // Group accounts by type for summary cards
  const grouped = accounts.reduce<Record<string, Account[]>>((acc, a) => {
    acc[a.type] = acc[a.type] || []; acc[a.type].push(a); return acc
  }, {})

  const totalAssets   = (grouped.ASSET || []).reduce((s, a) => s + parseFloat(a.balance || '0'), 0)
  const totalIncome   = (grouped.INCOME || []).reduce((s, a) => s + parseFloat(a.balance || '0'), 0)
  const totalExpense  = (grouped.EXPENSE || []).reduce((s, a) => s + parseFloat(a.balance || '0'), 0)
  const surplus       = totalIncome - totalExpense

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Finance</h1>
          <p className="text-white/40 mt-1">Double-entry accounting · Gift Aid · Reporting</p>
        </div>
        <button onClick={() => setShowJournal(true)} className="btn-primary">+ Post Journal</button>
      </div>

      {/* Summary cards — only when accounts loaded */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Assets', value: totalAssets, color: 'from-green-600 to-emerald-500', icon: '🏦' },
            { label: 'Total Income', value: totalIncome, color: 'from-amber-600 to-orange-500', icon: '💰' },
            { label: 'Total Expenses', value: totalExpense, color: 'from-red-600 to-rose-500', icon: '💸' },
            { label: 'Net Surplus', value: surplus, color: surplus >= 0 ? 'from-blue-600 to-indigo-500' : 'from-red-600 to-rose-500', icon: '⚖️' },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              className="glass rounded-2xl p-5 relative overflow-hidden">
              <div className={`absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-base mb-3`}>{s.icon}</div>
              <p className="text-white/50 text-xs font-medium mb-1">{s.label}</p>
              <p className="text-2xl font-black text-white">
                £{Math.abs(s.value).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
              </p>
            </motion.div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit">
        {(['accounts', 'trial-balance', 'reports'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all capitalize ${
              tab === t ? 'bg-saffron-gradient text-white shadow-saffron' : 'text-white/50 hover:text-white/80'
            }`}>
            {t.replace('-', ' ')}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Accounts tab */}
      {tab === 'accounts' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl overflow-hidden border border-temple-border">
          {loading ? (
            <div className="text-center py-16 text-white/30">Loading accounts…</div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-16 text-white/30">
              <p className="text-4xl mb-3">🏦</p>
              <p>No accounts set up yet.</p>
              <p className="text-xs mt-1">Use the journal to create double-entry transactions.</p>
            </div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Code', 'Account Name', 'Type', 'Balance', ''].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts.map((acc, i) => {
                  const tc = TYPE_COLORS[acc.type] || { bg: 'bg-white/5', text: 'text-white/40', border: 'border-white/10' }
                  return (
                    <motion.tr key={acc.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                      className="border-b border-white/5 hover:bg-white/3 transition-colors">
                      <td className="px-5 py-4">
                        <code className="text-saffron-400/80 text-xs bg-saffron-400/10 px-2 py-1 rounded">{acc.code}</code>
                      </td>
                      <td className="px-5 py-4 text-white font-medium">{acc.name}</td>
                      <td className="px-5 py-4">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${tc.bg} ${tc.text} ${tc.border}`}>
                          {acc.type}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right font-mono font-bold text-white">
                        £{parseFloat(acc.balance || '0').toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className={`text-xs px-2 py-0.5 rounded ${acc.is_active ? 'text-green-400' : 'text-white/20'}`}>
                          {acc.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table></div>
          )}
        </motion.div>
      )}

      {/* Trial Balance tab */}
      {tab === 'trial-balance' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6">
          {loading ? (
            <div className="text-center py-16 text-white/30">Loading trial balance…</div>
          ) : !tb ? (
            <div className="text-center py-16 text-white/30">
              <p className="text-4xl mb-3">⚖️</p>
              <p>No trial balance data available.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-white font-bold text-xl">Trial Balance</h2>
                <p className="text-white/40 text-sm">As at {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
              <div className="overflow-x-auto"><table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left pb-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Account</th>
                    <th className="text-right pb-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Debit (DR)</th>
                    <th className="text-right pb-3 text-white/40 text-xs font-semibold uppercase tracking-wider">Credit (CR)</th>
                  </tr>
                </thead>
                <tbody>
                  {(tb.entries || []).map((e, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-2.5 text-white text-sm">{e.account}</td>
                      <td className="py-2.5 text-right font-mono text-sm text-white/70">
                        {e.dr > 0 ? `£${e.dr.toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td className="py-2.5 text-right font-mono text-sm text-white/70">
                        {e.cr > 0 ? `£${e.cr.toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-white/20">
                    <td className="font-bold text-white pt-3">Total</td>
                    <td className="text-right font-black text-saffron-400 pt-3 font-mono">
                      £{(tb.total_dr || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="text-right font-black text-saffron-400 pt-3 font-mono">
                      £{(tb.total_cr || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <div className={`mt-4 flex items-center gap-2 text-sm ${tb.balanced ? 'text-green-400' : 'text-red-400'}`}>
                <span>{tb.balanced ? '✓' : '✗'}</span>
                <span className="font-semibold">{tb.balanced ? 'Trial balance is balanced' : 'Trial balance is NOT balanced'}</span>
              </div>
            </>
          )}
        </motion.div>
      )}

      {/* Reports tab */}
      {tab === 'reports' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 gap-5">
          {[
            { title: 'Income & Expenditure', desc: 'Revenue vs expenses for any period', icon: '📊', href: '/finance/journal' },
            { title: 'Donation Report', desc: 'Breakdown by donor, purpose and period', icon: '🙏', href: '/donations' },
            { title: 'Gift Aid Claim', desc: 'Generate HMRC Gift Aid schedule', icon: '🇬🇧', href: '/gift-aid' },
            { title: 'Cash Flow', desc: 'Monthly cash position analysis', icon: '💧', href: '#' },
          ].map((r) => (
            <a key={r.title} href={r.href}
              className="glass rounded-2xl p-6 cursor-pointer hover:border-saffron-400/30 transition-all group border border-temple-border">
              <div className="text-3xl mb-3">{r.icon}</div>
              <h3 className="text-white font-bold text-lg">{r.title}</h3>
              <p className="text-white/40 text-sm mt-1">{r.desc}</p>
              <span className="mt-4 inline-block text-saffron-400 text-sm font-medium group-hover:text-saffron-300">
                Open Report →
              </span>
            </a>
          ))}
        </motion.div>
      )}

      {/* Post Journal slide-over */}
      <AnimatePresence>
        {showJournal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowJournal(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full max-w-[460px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">Post Journal Entry</h2>
                <button onClick={() => setShowJournal(false)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {jError && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{jError}</div>}
                <div>
                  <label className={label}>Description *</label>
                  <input value={jForm.description} onChange={e => setJForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="e.g. Donation received from Patel family" className={inp} />
                </div>
                <div>
                  <label className={label}>Debit Account ID *</label>
                  <select value={jForm.debit_account_id} onChange={e => setJForm(p => ({ ...p, debit_account_id: e.target.value }))} className={inp}>
                    <option value="">Select account…</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Credit Account ID *</label>
                  <select value={jForm.credit_account_id} onChange={e => setJForm(p => ({ ...p, credit_account_id: e.target.value }))} className={inp}>
                    <option value="">Select account…</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Amount (£) *</label>
                    <input type="number" min="0.01" step="0.01" value={jForm.amount || ''}
                      onChange={e => setJForm(p => ({ ...p, amount: parseFloat(e.target.value) || 0 }))} className={inp} />
                  </div>
                  <div>
                    <label className={label}>Reference</label>
                    <input value={jForm.reference || ''} onChange={e => setJForm(p => ({ ...p, reference: e.target.value }))}
                      placeholder="REF-001" className={inp} />
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowJournal(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={postJournal} disabled={jSaving}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {jSaving ? 'Posting…' : 'Post Entry'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
