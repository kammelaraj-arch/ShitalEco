'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

type AccountType = 'BANK' | 'IN_HOUSE' | 'LOCKER' | 'PAYPAL' | 'SUMUP' | 'STRIPE'
type TxnType = 'DEBIT' | 'CREDIT' | 'FEE' | 'TRANSFER' | 'INTEREST' | 'REFUND' | 'OTHER'

interface BankAccount {
  id: string
  branch_id: string
  name: string
  account_type: AccountType
  parent_account_id: string | null
  bank_name: string
  account_number: string
  sort_code: string
  iban: string
  currency: string
  opening_balance: number
  current_balance: number
  location: string
  holder_name: string
  notes: string
  is_active: boolean
  created_at: string
  updated_at: string
}

interface BankTransaction {
  id: string
  account_id: string
  txn_date: string
  value_date: string | null
  description: string
  counterparty: string
  reference: string
  amount: number
  balance_after: number | null
  currency: string
  txn_type: TxnType
  source: 'MANUAL' | 'CSV_IMPORT' | 'PDF_IMPORT' | 'API'
  reconciled: boolean
  reconciled_with_id: string | null
  notes: string
  created_at: string
}

const ACCOUNT_TYPE_META: Record<AccountType, { label: string; icon: string; color: string }> = {
  BANK:     { label: 'Bank',          icon: '🏦', color: 'from-blue-600 to-cyan-500' },
  IN_HOUSE: { label: 'In-House Cash', icon: '💵', color: 'from-green-600 to-emerald-500' },
  LOCKER:   { label: 'Locker / Safe', icon: '🔒', color: 'from-amber-600 to-orange-500' },
  PAYPAL:   { label: 'PayPal',        icon: '🅿️', color: 'from-blue-500 to-indigo-600' },
  SUMUP:    { label: 'SumUp',         icon: '💳', color: 'from-cyan-600 to-teal-500' },
  STRIPE:   { label: 'Stripe',        icon: '💼', color: 'from-violet-600 to-purple-500' },
}

const TXN_TYPES: TxnType[] = ['DEBIT', 'CREDIT', 'FEE', 'TRANSFER', 'INTEREST', 'REFUND', 'OTHER']

interface AccountForm {
  name: string
  account_type: AccountType
  parent_account_id: string
  bank_name: string
  account_number: string
  sort_code: string
  iban: string
  currency: string
  opening_balance: string
  location: string
  holder_name: string
  notes: string
  branch_id: string
}

const EMPTY_ACCOUNT: AccountForm = {
  name: '', account_type: 'BANK', parent_account_id: '',
  bank_name: '', account_number: '', sort_code: '', iban: '',
  currency: 'GBP', opening_balance: '0',
  location: '', holder_name: '', notes: '', branch_id: 'main',
}

interface TxnForm {
  txn_date: string
  description: string
  counterparty: string
  reference: string
  amount: string
  direction: 'IN' | 'OUT'
  balance_after: string
  txn_type: TxnType
  notes: string
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const EMPTY_TXN: TxnForm = {
  txn_date: todayISO(), description: '', counterparty: '', reference: '',
  amount: '', direction: 'IN', balance_after: '',
  txn_type: 'OTHER', notes: '',
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

function fmtMoney(n: number, ccy = 'GBP'): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: ccy }).format(n)
  } catch { return `${ccy} ${n.toFixed(2)}` }
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso }
}

export default function BankAccountsPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState<AccountType | ''>('')

  const [showAccountForm, setShowAccountForm] = useState(false)
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null)
  const [accountForm, setAccountForm] = useState<AccountForm>(EMPTY_ACCOUNT)
  const [savingAccount, setSavingAccount] = useState(false)

  const [selectedAccount, setSelectedAccount] = useState<BankAccount | null>(null)
  const [txns, setTxns] = useState<BankTransaction[]>([])
  const [txnTotal, setTxnTotal] = useState(0)
  const [loadingTxns, setLoadingTxns] = useState(false)
  const [txnSearch, setTxnSearch] = useState('')

  const [showTxnForm, setShowTxnForm] = useState(false)
  const [txnForm, setTxnForm] = useState<TxnForm>(EMPTY_TXN)
  const [savingTxn, setSavingTxn] = useState(false)

  const [showImport, setShowImport] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [providerHint, setProviderHint] = useState<'AUTO' | 'PAYPAL' | 'STRIPE' | 'SUMUP' | 'NATWEST' | 'GENERIC'>('AUTO')
  const [importBusy, setImportBusy] = useState(false)
  const [importPreview, setImportPreview] = useState<{
    statement_id: string; detected_provider: string; transaction_count: number
    duplicates_count: number; period_start: string | null; period_end: string | null
    parse_errors: string[]; preview: Array<{
      txn_date: string; description: string; counterparty: string; reference: string
      amount: number; balance_after: number | null; currency: string; txn_type: string
      is_duplicate: boolean
    }>
  } | null>(null)
  const [skipDups, setSkipDups] = useState(true)

  const loadAccounts = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams()
      if (typeFilter) qs.set('account_type', typeFilter)
      const data = await apiFetch<{ items: BankAccount[]; total: number }>(`/admin/bank-accounts?${qs}`)
      setAccounts(data.items || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load accounts')
    } finally { setLoading(false) }
  }, [typeFilter])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  const loadTxns = useCallback(async (accountId: string, search = '') => {
    setLoadingTxns(true)
    try {
      const qs = new URLSearchParams({ limit: '200' })
      if (search.trim()) qs.set('search', search.trim())
      const data = await apiFetch<{ items: BankTransaction[]; total: number }>(
        `/admin/bank-accounts/${accountId}/transactions?${qs}`
      )
      setTxns(data.items || [])
      setTxnTotal(data.total || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load transactions')
    } finally { setLoadingTxns(false) }
  }, [])

  useEffect(() => {
    if (selectedAccount) {
      const t = setTimeout(() => loadTxns(selectedAccount.id, txnSearch), 250)
      return () => clearTimeout(t)
    }
  }, [selectedAccount, txnSearch, loadTxns])

  function openNewAccount() {
    setEditingAccount(null); setAccountForm(EMPTY_ACCOUNT); setShowAccountForm(true); setError('')
  }
  function openEditAccount(a: BankAccount) {
    setEditingAccount(a)
    setAccountForm({
      name: a.name, account_type: a.account_type,
      parent_account_id: a.parent_account_id || '',
      bank_name: a.bank_name, account_number: a.account_number,
      sort_code: a.sort_code, iban: a.iban, currency: a.currency,
      opening_balance: String(a.opening_balance),
      location: a.location, holder_name: a.holder_name,
      notes: a.notes, branch_id: a.branch_id,
    })
    setShowAccountForm(true); setError('')
  }

  async function saveAccount() {
    if (!accountForm.name.trim()) { setError('Name is required'); return }
    setSavingAccount(true)
    try {
      const body = {
        ...accountForm,
        opening_balance: parseFloat(accountForm.opening_balance) || 0,
        parent_account_id: accountForm.parent_account_id || null,
      }
      if (editingAccount) {
        await apiFetch(`/admin/bank-accounts/${editingAccount.id}`, { method: 'PUT', body: JSON.stringify(body) })
      } else {
        await apiFetch('/admin/bank-accounts', { method: 'POST', body: JSON.stringify(body) })
      }
      setShowAccountForm(false)
      await loadAccounts()
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Failed to save'
      try { const p = JSON.parse(msg); if (p?.detail?.errors) msg = p.detail.errors.join(' · ') } catch { /* not JSON */ }
      setError(msg)
    } finally { setSavingAccount(false) }
  }

  async function deactivate(a: BankAccount) {
    if (!confirm(`Deactivate "${a.name}"? (Transactions are preserved; account hidden from default lists.)`)) return
    try {
      await apiFetch(`/admin/bank-accounts/${a.id}`, { method: 'DELETE' })
      if (selectedAccount?.id === a.id) setSelectedAccount(null)
      await loadAccounts()
    } catch { setError('Failed to deactivate') }
  }

  function openNewTxn() {
    setTxnForm({ ...EMPTY_TXN, txn_date: todayISO() })
    setShowTxnForm(true); setError('')
  }

  async function saveTxn() {
    if (!selectedAccount) return
    if (!txnForm.amount || isNaN(parseFloat(txnForm.amount))) { setError('Amount is required'); return }
    setSavingTxn(true)
    try {
      const raw = parseFloat(txnForm.amount)
      const signed = txnForm.direction === 'IN' ? Math.abs(raw) : -Math.abs(raw)
      const body: Record<string, unknown> = {
        txn_date: txnForm.txn_date,
        description: txnForm.description,
        counterparty: txnForm.counterparty,
        reference: txnForm.reference,
        amount: signed,
        currency: selectedAccount.currency,
        txn_type: txnForm.txn_type,
        notes: txnForm.notes,
      }
      if (txnForm.balance_after.trim()) body.balance_after = parseFloat(txnForm.balance_after)
      await apiFetch(`/admin/bank-accounts/${selectedAccount.id}/transactions`, {
        method: 'POST', body: JSON.stringify(body),
      })
      setShowTxnForm(false)
      // Refresh both list (current_balance moved) and txns
      await Promise.all([loadAccounts(), loadTxns(selectedAccount.id, txnSearch)])
      // Also refresh selectedAccount snapshot from latest list
      const refreshed = (await apiFetch<{ account: BankAccount }>(`/admin/bank-accounts/${selectedAccount.id}`)).account
      setSelectedAccount(refreshed)
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Failed to save'
      try { const p = JSON.parse(msg); if (p?.detail?.errors) msg = p.detail.errors.join(' · ') } catch { /* not JSON */ }
      setError(msg)
    } finally { setSavingTxn(false) }
  }

  async function deleteTxn(t: BankTransaction) {
    if (!confirm(`Delete transaction "${t.description || t.reference || fmtMoney(t.amount, t.currency)}"? This cannot be undone.`)) return
    try {
      await apiFetch(`/admin/bank-transactions/${t.id}`, { method: 'DELETE' })
      if (selectedAccount) {
        await Promise.all([loadAccounts(), loadTxns(selectedAccount.id, txnSearch)])
        const refreshed = (await apiFetch<{ account: BankAccount }>(`/admin/bank-accounts/${selectedAccount.id}`)).account
        setSelectedAccount(refreshed)
      }
    } catch { setError('Failed to delete') }
  }

  async function uploadAndPreview() {
    if (!selectedAccount || !importFile) { setError('Pick a CSV file first'); return }
    setImportBusy(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', importFile)
      if (providerHint !== 'AUTO') fd.append('provider_hint', providerHint)
      const token = typeof window !== 'undefined' ? (localStorage.getItem('shital_access_token') || '') : ''
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api/v1'}/admin/bank-accounts/${selectedAccount.id}/import`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg = data?.detail?.errors?.length ? data.detail.errors.join(' · ') : (data?.detail || `Upload failed: ${r.status}`)
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
      }
      setImportPreview(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally { setImportBusy(false) }
  }

  async function commitImport() {
    if (!selectedAccount || !importFile || !importPreview) return
    setImportBusy(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', importFile)
      fd.append('statement_id', importPreview.statement_id)
      fd.append('skip_duplicates', skipDups ? 'true' : 'false')
      const token = typeof window !== 'undefined' ? (localStorage.getItem('shital_access_token') || '') : ''
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || '/api/v1'}/admin/bank-accounts/${selectedAccount.id}/import/commit`,
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        },
      )
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg = data?.detail?.errors?.length ? data.detail.errors.join(' · ') : (data?.detail || `Commit failed: ${r.status}`)
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
      }
      // Refresh
      await Promise.all([loadAccounts(), loadTxns(selectedAccount.id, txnSearch)])
      const refreshed = (await apiFetch<{ account: BankAccount }>(`/admin/bank-accounts/${selectedAccount.id}`)).account
      setSelectedAccount(refreshed)
      setImportPreview(null)
      setImportFile(null)
      setShowImport(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Commit failed')
    } finally { setImportBusy(false) }
  }

  // Aggregates
  const totalsByType: Partial<Record<AccountType, { count: number; balance: number }>> = {}
  for (const a of accounts) {
    if (!a.is_active) continue
    const slot = totalsByType[a.account_type] ?? { count: 0, balance: 0 }
    slot.count++
    slot.balance += a.current_balance
    totalsByType[a.account_type] = slot
  }
  const totalCash = Object.values(totalsByType).reduce((acc, s) => acc + (s?.balance ?? 0), 0)

  // Hierarchical tree: top-level accounts first, then children indented
  const topLevel = accounts.filter(a => !a.parent_account_id)
  const childrenOf = (id: string) => accounts.filter(a => a.parent_account_id === id)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Bank &amp; Cash</h1>
          <p className="text-white/40 mt-1">Real-world money locations: bank accounts, in-house cash, lockers, PayPal/Stripe/SumUp</p>
        </div>
        <button onClick={openNewAccount}
          className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90">
          + New Account
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br from-saffron-400 to-amber-400 opacity-10 blur-xl" />
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-saffron-400 to-amber-400 flex items-center justify-center text-lg mb-3">💰</div>
          <p className="text-white/50 text-xs font-medium">Total Cash on Hand</p>
          <p className="text-3xl font-black text-white mt-1">{loading ? '—' : fmtMoney(totalCash)}</p>
        </motion.div>
        {(['BANK', 'PAYPAL', 'IN_HOUSE'] as AccountType[]).map((t, i) => (
          <motion.div key={t} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: (i + 1) * 0.05 }}
            className="glass rounded-2xl p-5 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br ${ACCOUNT_TYPE_META[t].color} opacity-10 blur-xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${ACCOUNT_TYPE_META[t].color} flex items-center justify-center text-lg mb-3`}>{ACCOUNT_TYPE_META[t].icon}</div>
            <p className="text-white/50 text-xs font-medium">{ACCOUNT_TYPE_META[t].label}</p>
            <p className="text-3xl font-black text-white mt-1">
              {loading ? '—' : fmtMoney(totalsByType[t]?.balance ?? 0)}
            </p>
            <p className="text-white/40 text-xs mt-0.5">{totalsByType[t]?.count ?? 0} account{(totalsByType[t]?.count ?? 0) === 1 ? '' : 's'}</p>
          </motion.div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1 flex-wrap">
          <button onClick={() => setTypeFilter('')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              typeFilter === '' ? 'bg-saffron-gradient text-white shadow' : 'text-white/40 hover:text-white/70'
            }`}>All</button>
          {(Object.keys(ACCOUNT_TYPE_META) as AccountType[]).map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                typeFilter === t ? 'bg-saffron-gradient text-white shadow' : 'text-white/40 hover:text-white/70'
              }`}>
              {ACCOUNT_TYPE_META[t].icon} {ACCOUNT_TYPE_META[t].label}
            </button>
          ))}
        </div>
      </div>

      {/* Accounts table */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 border-b border-white/10">
              <tr className="text-white/60 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-semibold">Name</th>
                <th className="px-4 py-3 text-left font-semibold">Type</th>
                <th className="px-4 py-3 text-left font-semibold">Bank / Location</th>
                <th className="px-4 py-3 text-left font-semibold">Account</th>
                <th className="px-4 py-3 text-right font-semibold">Balance</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold w-24"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-white/40">Loading…</td></tr>
              )}
              {!loading && accounts.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-white/40">
                  No accounts yet — click <strong>+ New Account</strong> to add the first one.
                </td></tr>
              )}
              {!loading && topLevel.flatMap(parent => [
                <AccountRow key={parent.id} acct={parent} indent={0}
                  selected={selectedAccount?.id === parent.id}
                  onSelect={() => setSelectedAccount(parent)}
                  onEdit={() => openEditAccount(parent)}
                  onDeactivate={() => deactivate(parent)} />,
                ...childrenOf(parent.id).map(child =>
                  <AccountRow key={child.id} acct={child} indent={1}
                    selected={selectedAccount?.id === child.id}
                    onSelect={() => setSelectedAccount(child)}
                    onEdit={() => openEditAccount(child)}
                    onDeactivate={() => deactivate(child)} />
                ),
              ])}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected account detail + transactions */}
      {selectedAccount && (
        <div className="glass rounded-2xl p-5">
          <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
            <div>
              <p className="text-white/40 text-xs uppercase tracking-wide">{ACCOUNT_TYPE_META[selectedAccount.account_type].label}</p>
              <h2 className="text-2xl font-black text-white">{selectedAccount.name}</h2>
              <p className="text-white/60 text-sm mt-1">
                {selectedAccount.bank_name && <>{selectedAccount.bank_name} · </>}
                {selectedAccount.account_number && <>A/C {selectedAccount.account_number} · </>}
                {selectedAccount.sort_code && <>Sort {selectedAccount.sort_code}</>}
              </p>
            </div>
            <div className="text-right">
              <p className="text-white/40 text-xs uppercase tracking-wide">Current Balance</p>
              <p className="text-3xl font-black text-saffron-300">{fmtMoney(selectedAccount.current_balance, selectedAccount.currency)}</p>
              <p className="text-white/40 text-xs">Opening: {fmtMoney(selectedAccount.opening_balance, selectedAccount.currency)} · {txnTotal} txn{txnTotal === 1 ? '' : 's'}</p>
            </div>
          </div>

          <div className="flex gap-3 flex-wrap items-center mb-4">
            <button onClick={openNewTxn}
              className="px-4 py-2 rounded-xl bg-saffron-gradient text-white font-semibold text-sm">
              + Add Transaction
            </button>
            <button onClick={() => setShowImport(true)}
              className="px-4 py-2 rounded-xl border border-saffron-400/40 text-saffron-300 font-semibold text-sm hover:bg-saffron-400/10">
              📥 Import CSV
            </button>
            <span className="text-white/40 text-xs italic">PDF import coming in PR 3</span>
            <input value={txnSearch} onChange={e => setTxnSearch(e.target.value)}
              placeholder="Search description, counterparty, reference…"
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-white/30 outline-none focus:border-saffron-400/50 flex-1 min-w-[240px]" />
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/5">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr className="text-white/60 text-xs uppercase tracking-wide">
                  <th className="px-3 py-2 text-left font-semibold">Date</th>
                  <th className="px-3 py-2 text-left font-semibold">Description</th>
                  <th className="px-3 py-2 text-left font-semibold">Counterparty</th>
                  <th className="px-3 py-2 text-left font-semibold">Type</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                  <th className="px-3 py-2 text-right font-semibold">Balance</th>
                  <th className="px-3 py-2 text-left font-semibold">Source</th>
                  <th className="px-3 py-2 text-left font-semibold w-12"></th>
                </tr>
              </thead>
              <tbody>
                {loadingTxns && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-white/40">Loading…</td></tr>
                )}
                {!loadingTxns && txns.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-white/40">No transactions yet</td></tr>
                )}
                {txns.map(t => (
                  <tr key={t.id} className="border-t border-white/5 hover:bg-white/2.5">
                    <td className="px-3 py-2 text-white/80 whitespace-nowrap">{fmtDate(t.txn_date)}</td>
                    <td className="px-3 py-2 text-white/90">
                      {t.description}
                      {t.reference && <span className="text-white/40 text-xs ml-2">· {t.reference}</span>}
                    </td>
                    <td className="px-3 py-2 text-white/70">{t.counterparty || '—'}</td>
                    <td className="px-3 py-2 text-white/60 text-xs">{t.txn_type}</td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${t.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {t.amount >= 0 ? '+' : ''}{fmtMoney(t.amount, t.currency)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-white/70">
                      {t.balance_after !== null ? fmtMoney(t.balance_after, t.currency) : '—'}
                    </td>
                    <td className="px-3 py-2 text-white/50 text-xs">{t.source}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => deleteTxn(t)} className="text-red-400/60 hover:text-red-400 text-xs">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Account form slide-over */}
      <AnimatePresence>
        {showAccountForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowAccountForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-[520px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editingAccount ? 'Edit Account' : 'New Account'}</h2>
                <button onClick={() => setShowAccountForm(false)} className="text-white/40 hover:text-white text-xl p-1">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div>
                  <label className={lbl}>Account Type *</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(ACCOUNT_TYPE_META) as AccountType[]).map(t => (
                      <button key={t} type="button" onClick={() => setAccountForm(p => ({ ...p, account_type: t }))}
                        className="px-3 py-2.5 rounded-xl text-xs font-semibold transition-all"
                        style={{
                          background: accountForm.account_type === t
                            ? 'linear-gradient(135deg,rgba(212,175,55,0.25),rgba(212,175,55,0.12))'
                            : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${accountForm.account_type === t ? '#D4AF37' : 'rgba(255,255,255,0.1)'}`,
                          color: accountForm.account_type === t ? '#FFD980' : 'rgba(255,255,255,0.7)',
                        }}>
                        <span className="block text-base mb-0.5">{ACCOUNT_TYPE_META[t].icon}</span>
                        {ACCOUNT_TYPE_META[t].label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={lbl}>Account Name *</label>
                  <input value={accountForm.name} onChange={e => setAccountForm(p => ({ ...p, name: e.target.value }))} className={inp}
                    placeholder="e.g. NatWest Business Current" />
                </div>

                <div>
                  <label className={lbl}>Parent Account (optional)</label>
                  <select value={accountForm.parent_account_id} onChange={e => setAccountForm(p => ({ ...p, parent_account_id: e.target.value }))} className={inp}>
                    <option value="">— None (top-level account) —</option>
                    {accounts
                      .filter(a => a.id !== editingAccount?.id && !a.parent_account_id)
                      .map(a => (
                        <option key={a.id} value={a.id}>{ACCOUNT_TYPE_META[a.account_type].icon} {a.name}</option>
                      ))}
                  </select>
                  <p className="text-white/40 text-xs mt-1">Use for sub-accounts (e.g. a savings pot inside a main bank account).</p>
                </div>

                {(accountForm.account_type === 'BANK' || accountForm.account_type === 'PAYPAL' || accountForm.account_type === 'SUMUP' || accountForm.account_type === 'STRIPE') && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>Bank / Provider</label>
                        <input value={accountForm.bank_name} onChange={e => setAccountForm(p => ({ ...p, bank_name: e.target.value }))} className={inp} placeholder="e.g. NatWest" />
                      </div>
                      <div>
                        <label className={lbl}>Account Holder</label>
                        <input value={accountForm.holder_name} onChange={e => setAccountForm(p => ({ ...p, holder_name: e.target.value }))} className={inp} placeholder="e.g. SHITAL" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>Account Number</label>
                        <input value={accountForm.account_number} onChange={e => setAccountForm(p => ({ ...p, account_number: e.target.value }))} className={inp} placeholder="20232403" />
                      </div>
                      <div>
                        <label className={lbl}>Sort Code</label>
                        <input value={accountForm.sort_code} onChange={e => setAccountForm(p => ({ ...p, sort_code: e.target.value }))} className={inp} placeholder="60-11-18" />
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>IBAN (optional)</label>
                      <input value={accountForm.iban} onChange={e => setAccountForm(p => ({ ...p, iban: e.target.value.toUpperCase() }))} className={inp + ' uppercase'} placeholder="GB00 BANK 0000 0000 0000 00" />
                    </div>
                  </>
                )}

                {(accountForm.account_type === 'IN_HOUSE' || accountForm.account_type === 'LOCKER') && (
                  <div>
                    <label className={lbl}>Location *</label>
                    <input value={accountForm.location} onChange={e => setAccountForm(p => ({ ...p, location: e.target.value }))} className={inp}
                      placeholder="e.g. Wembley temple back office, top safe" />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Currency</label>
                    <select value={accountForm.currency} onChange={e => setAccountForm(p => ({ ...p, currency: e.target.value }))} className={inp}>
                      {['GBP', 'USD', 'EUR', 'INR'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Opening Balance</label>
                    <input type="number" step="0.01" value={accountForm.opening_balance}
                      onChange={e => setAccountForm(p => ({ ...p, opening_balance: e.target.value }))}
                      className={inp} placeholder="0.00" />
                  </div>
                </div>

                <div>
                  <label className={lbl}>Branch</label>
                  <select value={accountForm.branch_id} onChange={e => setAccountForm(p => ({ ...p, branch_id: e.target.value }))} className={inp}>
                    {['main', 'wembley', 'wembley_main'].map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                <div>
                  <label className={lbl}>Notes</label>
                  <textarea value={accountForm.notes} onChange={e => setAccountForm(p => ({ ...p, notes: e.target.value }))} rows={3} className={inp + ' resize-none'} />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowAccountForm(false)} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={saveAccount} disabled={savingAccount}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {savingAccount ? 'Saving…' : editingAccount ? 'Save Changes' : 'Create Account'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Transaction form modal */}
      <AnimatePresence>
        {showTxnForm && selectedAccount && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowTxnForm(false)} className="fixed inset-0 bg-black/70" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-temple-deep border border-white/10 rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <h3 className="text-white font-black text-lg mb-4">Add Transaction · {selectedAccount.name}</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Date *</label>
                    <input type="date" value={txnForm.txn_date} onChange={e => setTxnForm(p => ({ ...p, txn_date: e.target.value }))} className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Type</label>
                    <select value={txnForm.txn_type} onChange={e => setTxnForm(p => ({ ...p, txn_type: e.target.value as TxnType }))} className={inp}>
                      {TXN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={lbl}>Direction *</label>
                  <div className="flex gap-2">
                    {(['IN', 'OUT'] as const).map(d => (
                      <button key={d} type="button" onClick={() => setTxnForm(p => ({ ...p, direction: d }))}
                        className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all"
                        style={{
                          background: txnForm.direction === d
                            ? (d === 'IN' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)')
                            : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${txnForm.direction === d ? (d === 'IN' ? '#22c55e' : '#ef4444') : 'rgba(255,255,255,0.1)'}`,
                          color: txnForm.direction === d ? (d === 'IN' ? '#4ade80' : '#fca5a5') : 'rgba(255,255,255,0.6)',
                        }}>
                        {d === 'IN' ? '↓ Money In (Credit)' : '↑ Money Out (Debit)'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Amount * ({selectedAccount.currency})</label>
                    <input type="number" step="0.01" value={txnForm.amount} onChange={e => setTxnForm(p => ({ ...p, amount: e.target.value }))} className={inp} placeholder="100.00" />
                  </div>
                  <div>
                    <label className={lbl}>Balance After (optional)</label>
                    <input type="number" step="0.01" value={txnForm.balance_after} onChange={e => setTxnForm(p => ({ ...p, balance_after: e.target.value }))} className={inp} placeholder="from statement" />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Description</label>
                  <input value={txnForm.description} onChange={e => setTxnForm(p => ({ ...p, description: e.target.value }))} className={inp} placeholder="e.g. Donation from J. Smith" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Counterparty</label>
                    <input value={txnForm.counterparty} onChange={e => setTxnForm(p => ({ ...p, counterparty: e.target.value }))} className={inp} placeholder="Other party name" />
                  </div>
                  <div>
                    <label className={lbl}>Reference</label>
                    <input value={txnForm.reference} onChange={e => setTxnForm(p => ({ ...p, reference: e.target.value }))} className={inp} placeholder="Bank reference / FP id" />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Notes</label>
                  <textarea value={txnForm.notes} onChange={e => setTxnForm(p => ({ ...p, notes: e.target.value }))} rows={2} className={inp + ' resize-none'} />
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowTxnForm(false)} className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm font-semibold">Cancel</button>
                <button onClick={saveTxn} disabled={savingTxn}
                  className="flex-[2] py-2.5 rounded-xl bg-saffron-gradient text-white text-sm font-black disabled:opacity-40">
                  {savingTxn ? 'Saving…' : 'Add Transaction'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* CSV import modal */}
      <AnimatePresence>
        {showImport && selectedAccount && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-6 overflow-y-auto">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { if (!importBusy) { setShowImport(false); setImportPreview(null); setImportFile(null) } }}
              className="fixed inset-0 bg-black/70" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-temple-deep border border-white/10 rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-white font-black text-lg">Import CSV statement</h2>
                  <p className="text-white/50 text-xs mt-1">Account: <strong>{selectedAccount.name}</strong> · {selectedAccount.bank_name || ACCOUNT_TYPE_META[selectedAccount.account_type].label}</p>
                </div>
                <button onClick={() => { if (!importBusy) { setShowImport(false); setImportPreview(null); setImportFile(null) } }}
                  className="text-white/40 hover:text-white text-xl">✕</button>
              </div>

              {!importPreview && (
                <>
                  <div className="space-y-3">
                    <div>
                      <label className={lbl}>CSV file *</label>
                      <input type="file" accept=".csv,text/csv,text/plain"
                        onChange={e => setImportFile(e.target.files?.[0] ?? null)}
                        className="block w-full text-sm text-white/70 file:mr-3 file:px-4 file:py-2 file:rounded-xl file:border-0 file:bg-saffron-gradient file:text-white file:font-bold file:text-xs file:cursor-pointer cursor-pointer" />
                      <p className="text-white/40 text-xs mt-1">PayPal / SumUp / Stripe / NatWest / generic UK bank. 10 MB max.</p>
                    </div>
                    <div>
                      <label className={lbl}>Provider hint</label>
                      <select value={providerHint} onChange={e => setProviderHint(e.target.value as typeof providerHint)} className={inp}>
                        <option value="AUTO">Auto-detect (recommended)</option>
                        <option value="PAYPAL">PayPal</option>
                        <option value="STRIPE">Stripe</option>
                        <option value="SUMUP">SumUp</option>
                        <option value="NATWEST">NatWest</option>
                        <option value="GENERIC">Generic UK bank</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-3 mt-5">
                    <button onClick={() => { setShowImport(false); setImportFile(null) }}
                      className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm font-semibold">Cancel</button>
                    <button onClick={uploadAndPreview} disabled={importBusy || !importFile}
                      className="flex-[2] py-2.5 rounded-xl bg-saffron-gradient text-white text-sm font-black disabled:opacity-40">
                      {importBusy ? 'Parsing…' : 'Upload & Preview'}
                    </button>
                  </div>
                </>
              )}

              {importPreview && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    <Stat label="Provider" value={importPreview.detected_provider} />
                    <Stat label="Transactions" value={String(importPreview.transaction_count)} />
                    <Stat label="Duplicates" value={String(importPreview.duplicates_count)} tone={importPreview.duplicates_count > 0 ? 'warn' : undefined} />
                    <Stat label="Period" value={importPreview.period_start && importPreview.period_end ? `${importPreview.period_start} → ${importPreview.period_end}` : '—'} />
                  </div>

                  {importPreview.parse_errors.length > 0 && (
                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 mb-4 text-xs text-amber-200">
                      <p className="font-bold mb-1">{importPreview.parse_errors.length} row(s) failed to parse — review before commit:</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {importPreview.parse_errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                        {importPreview.parse_errors.length > 5 && <li>…and {importPreview.parse_errors.length - 5} more</li>}
                      </ul>
                    </div>
                  )}

                  <p className="text-white/50 text-xs uppercase tracking-wide font-bold mb-2">Preview (first 50)</p>
                  <div className="rounded-xl border border-white/5 overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-white/5 sticky top-0">
                        <tr className="text-white/60 text-[10px] uppercase tracking-wide">
                          <th className="px-2 py-1.5 text-left">Date</th>
                          <th className="px-2 py-1.5 text-left">Description</th>
                          <th className="px-2 py-1.5 text-left">Reference</th>
                          <th className="px-2 py-1.5 text-right">Amount</th>
                          <th className="px-2 py-1.5"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.preview.map((p, i) => (
                          <tr key={i} className={`border-t border-white/5 ${p.is_duplicate ? 'opacity-50' : ''}`}>
                            <td className="px-2 py-1 whitespace-nowrap text-white/80">{p.txn_date}</td>
                            <td className="px-2 py-1 text-white/70">{p.description}</td>
                            <td className="px-2 py-1 text-white/40 font-mono">{p.reference || '—'}</td>
                            <td className={`px-2 py-1 text-right font-mono font-bold ${p.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {p.amount >= 0 ? '+' : ''}{p.amount.toFixed(2)}
                            </td>
                            <td className="px-2 py-1">
                              {p.is_duplicate && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">DUP</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <label className="flex items-center gap-2 mt-4 cursor-pointer">
                    <input type="checkbox" checked={skipDups} onChange={e => setSkipDups(e.target.checked)}
                      className="w-4 h-4 rounded accent-saffron-400" />
                    <span className="text-white/70 text-sm">Skip duplicates on commit (recommended)</span>
                  </label>

                  <div className="flex gap-3 mt-5">
                    <button onClick={() => { setImportPreview(null) }}
                      className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm font-semibold">← Back</button>
                    <button onClick={commitImport} disabled={importBusy}
                      className="flex-[2] py-2.5 rounded-xl bg-saffron-gradient text-white text-sm font-black disabled:opacity-40">
                      {importBusy ? 'Committing…' : `Commit ${importPreview.transaction_count - (skipDups ? importPreview.duplicates_count : 0)} transactions`}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-xl bg-white/3 border border-white/5 px-3 py-2">
      <p className="text-white/40 text-[10px] uppercase tracking-wide font-bold">{label}</p>
      <p className={`text-sm font-bold ${tone === 'warn' ? 'text-amber-300' : 'text-white'}`}>{value}</p>
    </div>
  )
}

interface RowProps {
  acct: BankAccount
  indent: number
  selected: boolean
  onSelect: () => void
  onEdit: () => void
  onDeactivate: () => void
}

function AccountRow({ acct, indent, selected, onSelect, onEdit, onDeactivate }: RowProps) {
  const meta = ACCOUNT_TYPE_META[acct.account_type]
  return (
    <tr onClick={onSelect}
      className={`border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors ${selected ? 'bg-saffron-400/10' : ''} ${!acct.is_active ? 'opacity-50' : ''}`}>
      <td className="px-4 py-3 text-white font-semibold">
        <span style={{ paddingLeft: `${indent * 16}px` }} className="inline-flex items-center gap-2">
          {indent > 0 && <span className="text-white/30">↳</span>}
          {meta.icon} {acct.name}
        </span>
      </td>
      <td className="px-4 py-3 text-white/70 text-xs">{meta.label}</td>
      <td className="px-4 py-3 text-white/60">
        {acct.bank_name || acct.location || '—'}
      </td>
      <td className="px-4 py-3 text-white/60 font-mono text-xs">
        {acct.account_number ? <>{acct.account_number}{acct.sort_code && ` · ${acct.sort_code}`}</> : '—'}
      </td>
      <td className="px-4 py-3 text-right font-mono font-bold text-white">{fmtMoney(acct.current_balance, acct.currency)}</td>
      <td className="px-4 py-3">
        {acct.is_active
          ? <span className="px-2 py-0.5 rounded-full text-xs font-bold border bg-green-500/20 text-green-400 border-green-500/30">Active</span>
          : <span className="px-2 py-0.5 rounded-full text-xs font-bold border bg-white/10 text-white/40 border-white/20">Inactive</span>}
      </td>
      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
        <div className="flex gap-1">
          <button onClick={onEdit} className="text-white/40 hover:text-white text-xs px-2 py-1">Edit</button>
          {acct.is_active && <button onClick={onDeactivate} className="text-red-400/60 hover:text-red-400 text-xs px-2 py-1">✕</button>}
        </div>
      </td>
    </tr>
  )
}
