'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface GiftAidConfig {
  org_name: string
  hmrc_ref: string
  authorized_official: string
  payee_account: string
  enabled: boolean
}

interface Declaration {
  id: string
  donor_name: string
  donor_email: string
  address: string
  postcode: string
  is_valid: boolean
  created_at: string
  total_donations: number
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

export default function GiftAidPage() {
  const [tab, setTab] = useState<'config' | 'declarations' | 'submit'>('config')

  // Config state
  const [config, setConfig] = useState<GiftAidConfig>({ org_name: '', hmrc_ref: '', authorized_official: '', payee_account: '', enabled: false })
  const [configLoading, setConfigLoading] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)
  const [configMsg, setConfigMsg] = useState('')

  // Declarations state
  const [declarations, setDeclarations] = useState<Declaration[]>([])
  const [declLoading, setDeclLoading] = useState(false)
  const [declError, setDeclError] = useState('')

  // Submit state
  const [fromDate, setFromDate] = useState('2024-04-06')
  const [toDate, setToDate] = useState('2025-04-05')
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<string>('')
  const [submitError, setSubmitError] = useState('')

  const loadConfig = useCallback(async () => {
    setConfigLoading(true)
    try {
      const data = await apiFetch<GiftAidConfig>('/gift-aid/config')
      setConfig(data)
    } catch {
      // config may not exist yet
    } finally {
      setConfigLoading(false)
    }
  }, [])

  const loadDeclarations = useCallback(async () => {
    setDeclLoading(true); setDeclError('')
    try {
      const data = await apiFetch<{ declarations: Declaration[] }>('/gift-aid/declarations?limit=100')
      setDeclarations(data.declarations || [])
    } catch (e: unknown) {
      setDeclError(e instanceof Error ? e.message : 'Failed to load declarations')
    } finally {
      setDeclLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'config') loadConfig()
    else if (tab === 'declarations') loadDeclarations()
  }, [tab, loadConfig, loadDeclarations])

  async function saveConfig() {
    setConfigSaving(true); setConfigMsg('')
    try {
      await apiFetch('/gift-aid/config', { method: 'POST', body: JSON.stringify(config) })
      setConfigMsg('Saved successfully')
    } catch (e: unknown) {
      setConfigMsg(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setConfigSaving(false)
    }
  }

  async function submitToHmrc() {
    setSubmitting(true); setSubmitResult(''); setSubmitError('')
    try {
      const res = await apiFetch<unknown>('/gift-aid/submit-to-hmrc', {
        method: 'POST',
        body: JSON.stringify({ from_date: fromDate, to_date: toDate }),
      })
      setSubmitResult(JSON.stringify(res, null, 2))
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-white">Gift Aid</h1>
        <p className="text-white/40 mt-1">HMRC Gift Aid declarations and submissions</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit">
        {(['config', 'declarations', 'submit'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all capitalize ${
              tab === t ? 'bg-saffron-gradient text-white shadow-saffron' : 'text-white/50 hover:text-white/80'
            }`}>
            {t === 'submit' ? 'Submit to HMRC' : t}
          </button>
        ))}
      </div>

      {/* Config tab */}
      {tab === 'config' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6 space-y-4 max-w-2xl">
          {configLoading ? (
            <div className="text-center py-10 text-white/30">Loading config…</div>
          ) : (
            <>
              <h2 className="text-white font-bold text-lg mb-2">Organisation Configuration</h2>
              <div>
                <label className={lbl}>Organisation Name</label>
                <input value={config.org_name} onChange={e => setConfig(p => ({ ...p, org_name: e.target.value }))} className={inp} />
              </div>
              <div>
                <label className={lbl}>HMRC Reference</label>
                <input value={config.hmrc_ref} onChange={e => setConfig(p => ({ ...p, hmrc_ref: e.target.value }))} className={inp} placeholder="e.g. AB12345" />
              </div>
              <div>
                <label className={lbl}>Authorised Official</label>
                <input value={config.authorized_official} onChange={e => setConfig(p => ({ ...p, authorized_official: e.target.value }))} className={inp} />
              </div>
              <div>
                <label className={lbl}>Payee Account</label>
                <input value={config.payee_account} onChange={e => setConfig(p => ({ ...p, payee_account: e.target.value }))} className={inp} />
              </div>
              <div className="flex items-center justify-between py-3 px-4 bg-white/5 rounded-xl border border-white/10">
                <div>
                  <p className="text-white text-sm font-medium">Gift Aid Enabled</p>
                  <p className="text-white/40 text-xs mt-0.5">Allow Gift Aid declarations on donations</p>
                </div>
                <button onClick={() => setConfig(p => ({ ...p, enabled: !p.enabled }))}
                  className={`w-12 h-6 rounded-full transition-colors ${config.enabled ? 'bg-saffron-gradient' : 'bg-white/10'}`}>
                  <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform mx-0.5 ${config.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>
              {configMsg && (
                <div className={`px-4 py-3 rounded-xl text-sm border ${configMsg.includes('success') ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
                  {configMsg}
                </div>
              )}
              <button onClick={saveConfig} disabled={configSaving}
                className="w-full py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                {configSaving ? 'Saving…' : 'Save Configuration'}
              </button>
            </>
          )}
        </motion.div>
      )}

      {/* Declarations tab */}
      {tab === 'declarations' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl overflow-hidden border border-temple-border">
          {declError && <div className="m-4 bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{declError}</div>}
          {declLoading ? (
            <div className="text-center py-20 text-white/30">Loading declarations…</div>
          ) : declarations.length === 0 ? (
            <div className="text-center py-20 text-white/30">
              <p className="text-4xl mb-3">🇬🇧</p>
              <p>No declarations found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Donor', 'Email', 'Postcode', 'Total Donations', 'Status', 'Date'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {declarations.map((d, i) => (
                  <motion.tr key={d.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                    className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-4 text-white font-medium">{d.donor_name}</td>
                    <td className="px-4 py-4 text-white/60 text-sm">{d.donor_email}</td>
                    <td className="px-4 py-4 text-white/60 text-sm">{d.postcode}</td>
                    <td className="px-4 py-4 font-mono font-bold text-white">
                      £{Number(d.total_donations).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${d.is_valid ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'}`}>
                        {d.is_valid ? 'Valid' : 'Invalid'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-white/40 text-sm">
                      {new Date(d.created_at).toLocaleDateString('en-GB')}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table></div>
          )}
        </motion.div>
      )}

      {/* Submit tab */}
      {tab === 'submit' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6 space-y-4 max-w-2xl">
          <h2 className="text-white font-bold text-lg">Submit Gift Aid Claim to HMRC</h2>
          <p className="text-white/40 text-sm">Select the tax year date range for the submission.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lbl}>From Date</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>To Date</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={inp} />
            </div>
          </div>
          {submitError && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{submitError}</div>}
          {submitResult && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
              <p className="text-green-400 text-xs font-semibold uppercase tracking-wide mb-2">Submission Result</p>
              <pre className="text-white/70 text-xs overflow-auto max-h-48">{submitResult}</pre>
            </div>
          )}
          <button onClick={submitToHmrc} disabled={submitting}
            className="w-full py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
            {submitting ? 'Submitting…' : 'Submit to HMRC'}
          </button>
        </motion.div>
      )}
    </div>
  )
}
