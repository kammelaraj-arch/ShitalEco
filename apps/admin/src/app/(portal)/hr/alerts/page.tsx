'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Alert {
  employee_id: string
  employee_name: string
  employee_number: string
  branch_id: string
  job_title: string
  kind: string
  severity: 'red' | 'amber' | 'green'
  due_in_days: number | null
  ref_date: string | null
  message: string
}

interface AlertResponse {
  alerts: Alert[]
  count: number
  by_severity: { red: number; amber: number; green: number }
  generated_at: string
}

interface Branch { branch_id: string; name: string; is_active?: boolean }

const KIND_LABELS: Record<string, string> = {
  visa_expiry:        '🛂 Visa expiry',
  share_code_expiry:  '🔑 RTW share code expiry',
  dbs_expiry:         '🛡 DBS expiry',
  dbs_missing:        '🛡 DBS missing',
  rtw_missing:        '⚖ Right-to-work missing',
  probation_ending:   '⏰ Probation ending',
  contract_ending:    '📜 Contract ending',
  missing_ni:         '🔢 NI number missing',
  missing_tax_code:   '🧾 Tax code missing',
  missing_next_of_kin: '👥 Next-of-kin missing',
}

const SEV_BG: Record<string, string> = {
  red:   'bg-red-500/10 border-red-500/30',
  amber: 'bg-amber-500/10 border-amber-500/30',
  green: 'bg-green-500/10 border-green-500/30',
}

const SEV_TEXT: Record<string, string> = {
  red:   'text-red-300',
  amber: 'text-amber-300',
  green: 'text-green-300',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso }
}

export default function HRAlertsPage() {
  const [data, setData] = useState<AlertResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [branchId, setBranchId] = useState('')
  const [includeGreen, setIncludeGreen] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [kindFilter, setKindFilter] = useState('')

  useEffect(() => {
    apiFetch<{ branches: Branch[] }>('/branches')
      .then(d => setBranches((d.branches || []).filter(b => b.is_active !== false)))
      .catch(() => setBranches([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams()
      if (branchId) qs.set('branch_id', branchId)
      if (includeGreen) qs.set('include_green', 'true')
      const d = await apiFetch<AlertResponse>(`/hr/alerts?${qs}`)
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }, [branchId, includeGreen])

  useEffect(() => { load() }, [load])

  const alerts = (data?.alerts || []).filter(a => !kindFilter || a.kind === kindFilter)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-white">HR Alerts</h1>
        <p className="text-white/40 mt-1">Compliance-critical reminders: visa/DBS/RTW expiry, probation reviews, missing payroll fields.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Tile label="Urgent (red)"    value={String(data?.by_severity.red   ?? 0)} color="red" />
        <Tile label="Warning (amber)" value={String(data?.by_severity.amber ?? 0)} color="amber" />
        <Tile label="Ok (green)"      value={String(data?.by_severity.green ?? 0)} color="green" />
      </div>

      <div className="glass rounded-2xl p-4 flex flex-wrap gap-3 items-center">
        <select value={branchId} onChange={e => setBranchId(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none">
          <option value="">All branches</option>
          {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
        </select>
        <select value={kindFilter} onChange={e => setKindFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none">
          <option value="">All alert types</option>
          {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer select-none px-3 py-2.5 rounded-xl border border-white/10 hover:bg-white/5">
          <input type="checkbox" checked={includeGreen} onChange={e => setIncludeGreen(e.target.checked)}
            className="w-4 h-4 accent-saffron-500" />
          <span>Include green (informational)</span>
        </label>
        <button onClick={load}
          className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/10">
          ↻ Refresh
        </button>
        <div className="flex-1" />
        {data && <span className="text-white/30 text-xs">Generated {new Date(data.generated_at).toLocaleString('en-GB')}</span>}
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="space-y-2">
        {loading && <div className="text-center py-10 text-white/30">Loading alerts…</div>}
        {!loading && alerts.length === 0 && (
          <div className="glass rounded-2xl p-8 text-center text-white/40">
            ✓ No compliance alerts. Everything is on track.
          </div>
        )}
        {alerts.map((a, i) => (
          <motion.div key={a.employee_id + a.kind + i}
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}
            className={`rounded-2xl border p-4 ${SEV_BG[a.severity]}`}>
            <div className="flex items-start gap-4 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-black uppercase px-2 py-0.5 rounded-full border ${SEV_BG[a.severity]} ${SEV_TEXT[a.severity]}`}>
                    {a.severity}
                  </span>
                  <span className="text-white font-bold text-sm">{a.employee_name}</span>
                  {a.employee_number && <span className="text-white/40 text-xs font-mono">[{a.employee_number}]</span>}
                  {a.job_title && <span className="text-white/40 text-xs">· {a.job_title}</span>}
                  <span className="text-white/40 text-xs">· {a.branch_id}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white/70 text-sm">{KIND_LABELS[a.kind] || a.kind}</span>
                  <span className="text-white/50 text-sm">— {a.message}</span>
                </div>
              </div>
              {a.ref_date && (
                <div className="text-right">
                  <p className="text-white/40 text-[10px] uppercase">Date</p>
                  <p className="text-white/80 font-mono text-xs">{fmtDate(a.ref_date)}</p>
                </div>
              )}
              {a.due_in_days !== null && (
                <div className="text-right">
                  <p className="text-white/40 text-[10px] uppercase">{a.due_in_days < 0 ? 'Overdue by' : 'Due in'}</p>
                  <p className={`font-mono text-sm font-bold ${SEV_TEXT[a.severity]}`}>
                    {Math.abs(a.due_in_days)} day{Math.abs(a.due_in_days) === 1 ? '' : 's'}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function Tile({ label, value, color }: { label: string; value: string; color: 'red' | 'amber' | 'green' }) {
  const bg = color === 'red' ? 'from-red-600 to-rose-500' : color === 'amber' ? 'from-amber-600 to-orange-500' : 'from-green-600 to-emerald-500'
  return (
    <div className="glass rounded-2xl p-5 relative overflow-hidden">
      <div className={`absolute top-0 right-0 w-24 h-24 rounded-full bg-gradient-to-br ${bg} opacity-10 blur-xl`} />
      <p className="text-white/50 text-xs font-medium mb-1 uppercase tracking-wide">{label}</p>
      <p className="text-4xl font-black text-white">{value}</p>
    </div>
  )
}
