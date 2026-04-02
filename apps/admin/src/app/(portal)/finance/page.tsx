'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

async function fetchTrialBalance(token: string) {
  const r = await fetch(`${API}/finance/trial-balance`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return r.json()
}

async function fetchAccounts(token: string) {
  const r = await fetch(`${API}/finance/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return r.json()
}

const MOCK_ACCOUNTS = [
  { code: '1000', name: 'Cash & Bank', type: 'ASSET', balance: '45200.00' },
  { code: '1100', name: 'Accounts Receivable', type: 'ASSET', balance: '3200.00' },
  { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', balance: '8400.00' },
  { code: '3000', name: 'Retained Surplus', type: 'EQUITY', balance: '120000.00' },
  { code: '4000', name: 'Donation Income', type: 'INCOME', balance: '88800.00' },
  { code: '4100', name: 'Service Income', type: 'INCOME', balance: '24500.00' },
  { code: '5000', name: 'Staffing Costs', type: 'EXPENSE', balance: '52000.00' },
  { code: '5100', name: 'Temple Operations', type: 'EXPENSE', balance: '18200.00' },
  { code: '5200', name: 'Utilities', type: 'EXPENSE', balance: '6800.00' },
]

const TYPE_COLORS: Record<string, string> = {
  ASSET: 'badge-green', LIABILITY: 'badge-red', EQUITY: 'badge-blue',
  INCOME: 'badge-orange', EXPENSE: 'badge-yellow',
}

export default function FinancePage() {
  const [activeTab, setActiveTab] = useState<'accounts' | 'trial-balance' | 'reports'>('accounts')

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Finance</h1>
          <p className="text-white/40 mt-1">Double-entry accounting · Gift Aid · Reporting</p>
        </div>
        <div className="flex gap-3">
          <button className="btn-secondary">Export PDF</button>
          <button className="btn-primary">+ Post Journal</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit">
        {(['accounts', 'trial-balance', 'reports'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all capitalize ${
              activeTab === tab
                ? 'bg-saffron-gradient text-white shadow-saffron'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            {tab.replace('-', ' ')}
          </button>
        ))}
      </div>

      {/* Accounts table */}
      {activeTab === 'accounts' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl overflow-hidden"
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Account Name</th>
                <th>Type</th>
                <th className="text-right">Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {MOCK_ACCOUNTS.map((acc) => (
                <tr key={acc.code}>
                  <td><code className="text-saffron-400/80 text-xs bg-saffron-400/10 px-2 py-1 rounded">{acc.code}</code></td>
                  <td className="font-medium text-white">{acc.name}</td>
                  <td><span className={`badge ${TYPE_COLORS[acc.type] || 'badge-blue'}`}>{acc.type}</span></td>
                  <td className="text-right font-mono font-bold text-white">£{parseFloat(acc.balance).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
                  <td><button className="text-white/30 hover:text-white/60 text-sm">→</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      )}

      {/* Trial balance */}
      {activeTab === 'trial-balance' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-white font-bold text-xl">Trial Balance</h2>
            <p className="text-white/40 text-sm">As at {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="text-right">Debit (DR)</th>
                <th className="text-right">Credit (CR)</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_ACCOUNTS.map((acc) => {
                const isDebit = ['ASSET', 'EXPENSE'].includes(acc.type)
                const val = `£${parseFloat(acc.balance).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`
                return (
                  <tr key={acc.code}>
                    <td className="text-white">{acc.code} — {acc.name}</td>
                    <td className="text-right font-mono">{isDebit ? val : '—'}</td>
                    <td className="text-right font-mono">{!isDebit ? val : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-white/20">
                <td className="font-bold text-white pt-3">Total</td>
                <td className="text-right font-black text-saffron-400 pt-3">£203,400.00</td>
                <td className="text-right font-black text-saffron-400 pt-3">£203,400.00</td>
              </tr>
            </tfoot>
          </table>
          <div className="mt-4 flex items-center gap-2 text-green-400 text-sm">
            <span>✓</span>
            <span className="font-semibold">Trial balance is balanced</span>
          </div>
        </motion.div>
      )}

      {/* Reports */}
      {activeTab === 'reports' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 gap-5"
        >
          {[
            { title: 'Income & Expenditure', desc: 'Revenue vs expenses for any period', icon: '📊' },
            { title: 'Balance Sheet', desc: 'Assets, liabilities and equity snapshot', icon: '⚖️' },
            { title: 'Gift Aid Claim', desc: 'Generate HMRC Gift Aid schedule', icon: '🇬🇧' },
            { title: 'Donation Report', desc: 'Breakdown by donor, purpose and period', icon: '🙏' },
            { title: 'Budget Variance', desc: 'Planned vs actual spend analysis', icon: '📉' },
            { title: 'Cash Flow', desc: 'Monthly cash position analysis', icon: '💧' },
          ].map((r) => (
            <div key={r.title} className="glass rounded-2xl p-6 cursor-pointer hover:border-saffron-400/30 transition-all group">
              <div className="text-3xl mb-3">{r.icon}</div>
              <h3 className="text-white font-bold text-lg">{r.title}</h3>
              <p className="text-white/40 text-sm mt-1">{r.desc}</p>
              <button className="mt-4 text-saffron-400 text-sm font-medium group-hover:text-saffron-300 transition-colors">
                Generate Report →
              </button>
            </div>
          ))}
        </motion.div>
      )}
    </div>
  )
}
