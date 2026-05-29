'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, API_BASE, getToken } from '@/lib/api'

interface OpsResult {
  ok: boolean
  action?: string
  stdout?: string
  stderr?: string
  exit_code?: number
  duration_ms?: number
  detail?: string
  triggered_by?: string
  triggered_at?: string
}

interface Snapshot {
  id: string            // 20260506T070000Z
  git_sha: string
  db_dump: string | null
  size_bytes: number
  created_at: string
  has_db?: boolean
  has_images?: boolean
}

interface EnvSummary {
  running?: boolean
  status?: string
  url?: string
  git_sha?: string
  git_sha_short?: string
  build_time?: string
  started_at?: string
}

interface EnvironmentsResponse {
  environments: { dev?: EnvSummary; prod?: EnvSummary }
  error?: string
}

interface VersionInfo {
  git_sha?: string
  git_sha_short?: string
}

interface DeployEvent {
  env?: string
  sha?: string
  short?: string
  status?: string
  message?: string
  at?: string
}

interface KioskHealthRow {
  id: string
  name: string
  device_type: string
  status: string
  branch_code: string
  branch_name: string
  last_seen_at: string | null
  seconds_since_seen: number | null
  health: 'ONLINE' | 'STALE' | 'OFFLINE' | 'INACTIVE'
  reader_label: string | null
  reader_provider: string | null
  reader_status: string | null
  reader_last_seen_at: string | null
}

interface KioskHealthResponse {
  kiosks: KioskHealthRow[]
  summary: { total: number; online: number; stale: number; offline: number; inactive: number }
  now: string
}

function fmtAge(iso?: string) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!t) return iso
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatTs(ts: string) {
  // 20260506T070000Z → 2026-05-06 07:00:00 UTC
  if (!/^\d{8}T\d{6}Z$/.test(ts)) return ts
  return `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(9,11)}:${ts.slice(11,13)}:${ts.slice(13,15)} UTC`
}

const PROD_CONTAINERS = [
  'shitaleco-backend-1', 'shitaleco-admin-1', 'shitaleco-quick-donation-1',
  'shitaleco-kiosk-1', 'shitaleco-screen-1', 'shitaleco-service-1',
  'shitaleco-nginx-1', 'shitaleco-db-1', 'shitaleco-deployer-1', 'shitaleco-backups-1',
]
const DEV_CONTAINERS = [
  'shitaleco-dev-backend-dev-1', 'shitaleco-dev-admin-dev-1',
  'shitaleco-dev-quick-donation-dev-1', 'shitaleco-dev-kiosk-dev-1',
  'shitaleco-dev-screen-dev-1', 'shitaleco-dev-nginx-dev-1', 'shitaleco-dev-db-dev-1',
]
const ALL_CONTAINERS = [...PROD_CONTAINERS, ...DEV_CONTAINERS]

export default function OpsPage() {
  const [busy, setBusy]       = useState(false)
  const [running, setRunning] = useState('')
  const [result, setResult]   = useState<OpsResult | null>(null)

  // Form state (separate per section so they don't fight)
  const [logsContainer, setLogsContainer] = useState(PROD_CONTAINERS[0])
  const [logsTail, setLogsTail]           = useState(100)
  const [inspectContainer, setInspectContainer] = useState(PROD_CONTAINERS[0])
  const [restartContainer, setRestartContainer] = useState(PROD_CONTAINERS[0])
  const [sqlStack, setSqlStack] = useState<'prod' | 'dev'>('prod')
  const [sqlQuery, setSqlQuery] = useState('SELECT COUNT(*) FROM users;')

  // ── Environments (status + deploy actions) ──────────────────────────────
  const [version, setVersion] = useState<VersionInfo | null>(null)
  const [environments, setEnvironments] = useState<EnvironmentsResponse | null>(null)
  const [deploys, setDeploys] = useState<DeployEvent[] | null>(null)

  // ── Kiosk health (Quick Donation + Full Kiosk fleet) ─────────────────────
  const [kiosks, setKiosks]       = useState<KioskHealthResponse | null>(null)
  const [kiosksErr, setKiosksErr] = useState('')

  // ── Promote / Snapshots / Restore ────────────────────────────────────────
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [snapshotsErr, setSnapshotsErr] = useState('')
  const [pinDialog, setPinDialog] = useState<null | {
    title: string
    description: string
    confirmKeyword?: string  // require user to type this string
    onConfirm: (pin: string) => Promise<void>
  }>(null)
  const [pinValue, setPinValue] = useState('')
  const [confirmInput, setConfirmInput] = useState('')
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [pinBusy, setPinBusy] = useState(false)

  const loadSnapshots = useCallback(async () => {
    setSnapshotsErr('')
    try {
      const d = await apiFetch<{ snapshots: Snapshot[]; error?: string }>('/admin/system/snapshots')
      if (d.error) setSnapshotsErr(d.error)
      setSnapshots(d.snapshots ?? [])
    } catch (e) {
      setSnapshotsErr(e instanceof Error ? e.message : 'Failed to load snapshots')
    }
  }, [])

  useEffect(() => { loadSnapshots() }, [loadSnapshots])

  const loadKiosks = useCallback(async () => {
    setKiosksErr('')
    try {
      const d = await apiFetch<KioskHealthResponse>('/admin/system/kiosks/status')
      setKiosks(d)
    } catch (e) {
      setKiosksErr(e instanceof Error ? e.message : 'Failed to load kiosk status')
    }
  }, [])

  useEffect(() => {
    loadKiosks()
    const id = setInterval(loadKiosks, 30_000)
    return () => clearInterval(id)
  }, [loadKiosks])

  const loadEnvs = useCallback(async () => {
    try {
      const [vRes, eRes, dRes] = await Promise.all([
        fetch(`${API_BASE}/admin/system/version`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        fetch(`${API_BASE}/admin/system/environments`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        fetch(`${API_BASE}/admin/system/deploys?limit=10`, { headers: { Authorization: `Bearer ${getToken()}` } }),
      ])
      if (vRes.ok) setVersion(await vRes.json())
      if (eRes.ok) setEnvironments(await eRes.json())
      if (dRes.ok) {
        const d = await dRes.json()
        setDeploys(d.deploys || [])
      }
    } catch {
      // ignore — page still useful without env panel
    }
  }, [])

  useEffect(() => { loadEnvs() }, [loadEnvs])

  function openRedeployDevDialog() {
    setActionMsg(null); setPinValue(''); setConfirmInput('')
    setPinDialog({
      title: '🔄 Re-deploy Dev',
      description:
        'Re-deploy the latest :dev image to dev.shital.org.uk. No DB snapshot is taken (dev only). PIN required.',
      onConfirm: async (pin) => {
        const res = await fetch(`${API_BASE}/admin/system/deploy/dev`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}`, 'X-Admin-Pin': pin },
        })
        const d = await res.json()
        if (!res.ok || !d.ok) throw new Error(d.detail || `Failed (HTTP ${res.status})`)
        setActionMsg({ text: 'Dev deploy triggered. Containers will restart in 1–2 min.', ok: true })
        setTimeout(loadEnvs, 60_000)
      },
    })
  }

  function openPromoteDialog() {
    setActionMsg(null); setPinValue(''); setConfirmInput('')
    setPinDialog({
      title: '🚀 Promote DEV → PROD',
      description:
        'This will retag the current :dev image as :latest, take a DB snapshot, and restart prod containers. ' +
        'A snapshot is saved automatically — you can restore via the Snapshots panel below if anything goes wrong.',
      confirmKeyword: 'PROMOTE',
      onConfirm: async (pin) => {
        const res = await fetch(`${API_BASE}/admin/system/deploy/prod`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}`, 'X-Admin-Pin': pin },
        })
        const d = await res.json()
        if (!res.ok || !d.ok) throw new Error(d.detail || `Failed (HTTP ${res.status})`)
        setActionMsg({ text: 'Promote triggered. Containers will restart in 1–2 min.', ok: true })
        setTimeout(() => { loadSnapshots(); loadEnvs() }, 60_000)
      },
    })
  }

  function openRestoreDialog(snap: Snapshot) {
    setActionMsg(null); setPinValue(''); setConfirmInput('')
    setPinDialog({
      title: `↩ Restore snapshot ${formatTs(snap.id)}`,
      description:
        `This will retag :promote-${snap.id} → :latest, restore the DB from ${snap.db_dump}, and restart prod. ` +
        'Current state is snapshotted as :pre-restore-* first, so this is reversible.',
      confirmKeyword: 'RESTORE',
      onConfirm: async (pin) => {
        const res = await fetch(`${API_BASE}/admin/system/restore/${snap.id}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}`, 'X-Admin-Pin': pin },
        })
        const d = await res.json()
        if (!res.ok || !d.ok) throw new Error(d.detail || `Failed (HTTP ${res.status})`)
        setActionMsg({ text: `Restore to ${formatTs(snap.id)} triggered. Containers will restart in 1–2 min.`, ok: true })
        setTimeout(loadSnapshots, 60_000)
      },
    })
  }

  async function submitPinDialog() {
    if (!pinDialog || pinBusy) return
    if (pinDialog.confirmKeyword && confirmInput.trim() !== pinDialog.confirmKeyword) {
      setActionMsg({ text: `Type "${pinDialog.confirmKeyword}" exactly to confirm`, ok: false })
      return
    }
    if (!pinValue) {
      setActionMsg({ text: 'Enter your admin PIN', ok: false })
      return
    }
    setPinBusy(true); setActionMsg(null)
    try {
      await pinDialog.onConfirm(pinValue)
      setPinDialog(null)
    } catch (e) {
      setActionMsg({ text: e instanceof Error ? e.message : 'Action failed', ok: false })
    } finally {
      setPinBusy(false)
    }
  }

  async function run(action: string, args: Record<string, unknown> = {}) {
    if (busy) return
    setBusy(true); setRunning(action); setResult(null)
    try {
      const data = await apiFetch<OpsResult>('/admin/system/ops/run', {
        method: 'POST',
        body: JSON.stringify({ action, args }),
      })
      setResult(data)
    } catch (e: unknown) {
      setResult({ ok: false, detail: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setBusy(false); setRunning('')
    }
  }

  function confirmFirst(msg: string, fn: () => void) {
    return () => { if (confirm(msg)) fn() }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div>
        <h1 className="text-3xl font-black text-white">🛠️ System Ops</h1>
        <p className="text-white/40 mt-1">
          Diagnostic + maintenance actions on the live VPS. Replaces SSH for routine ops.
          All actions are audited to <code className="bg-white/5 px-1 rounded text-xs">/var/log/shital-ops.log</code>.
        </p>
      </div>

      {/* ── Environments (Dev & Prod status + deploy actions) ──────────── */}
      <div className="glass rounded-2xl p-6 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🚀</span>
            <div>
              <h2 className="text-white font-bold text-lg">Environments</h2>
              <p className="text-white/40 text-xs">
                Push to <span className="font-mono">main</span> auto-deploys to Dev. Click "Promote to Prod" to release.
                Promote takes a DB snapshot first (see panel below); Re-deploy Dev does not.
              </p>
            </div>
          </div>
          <button onClick={loadEnvs}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 text-xs hover:bg-white/10">
            ↻ Refresh
          </button>
        </div>

        {actionMsg && (
          <p className={`text-sm rounded-lg px-3 py-2 ${actionMsg.ok ? 'bg-green-500/15 text-green-300 border border-green-500/30' : 'bg-red-500/15 text-red-300 border border-red-500/30'}`}>
            {actionMsg.text}
          </p>
        )}

        {environments?.error && (
          <p className="text-red-400 text-xs">{environments.error}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(['dev', 'prod'] as const).map(env => {
            const e = environments?.environments?.[env]
            const isProd = env === 'prod'
            const sha = e?.git_sha_short || (env === 'prod' ? version?.git_sha_short : '—')
            const fullSha = e?.git_sha || (env === 'prod' ? version?.git_sha : '')
            const built = e?.build_time
            return (
              <div
                key={env}
                className="rounded-xl px-4 py-3 flex flex-col gap-2"
                style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${isProd ? 'rgba(34,197,94,0.25)' : 'rgba(251,146,60,0.25)'}` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{isProd ? '🟢' : '🟠'}</span>
                    <span className="font-black text-white text-sm uppercase tracking-wider">{env}</span>
                    {e?.running ? (
                      <span className="text-[10px] uppercase text-green-400/80">running</span>
                    ) : (
                      <span className="text-[10px] uppercase text-red-400/80">{e?.status || 'down'}</span>
                    )}
                  </div>
                  {e?.url && (
                    <a href={e.url} target="_blank" rel="noreferrer" className="text-xs text-orange-400 hover:underline">
                      {e.url.replace(/^https?:\/\//, '')} ↗
                    </a>
                  )}
                </div>
                <div className="text-xs text-white/60 font-mono space-y-0.5">
                  <div>
                    Commit:{' '}
                    {fullSha ? (
                      <a
                        href={`https://github.com/kammelaraj-arch/ShitalEco/commit/${fullSha}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-orange-400 hover:underline"
                      >
                        {sha}
                      </a>
                    ) : (
                      <span className="text-white/30">unknown</span>
                    )}
                  </div>
                  {built && built !== 'unknown' && (
                    <div className="text-white/40">Built {fmtAge(built)}</div>
                  )}
                  {e?.started_at && (
                    <div className="text-white/40">Container up {fmtAge(e.started_at)}</div>
                  )}
                </div>
                <button
                  onClick={isProd ? openPromoteDialog : openRedeployDevDialog}
                  className="mt-1 px-4 py-2 rounded-xl font-black text-sm text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: isProd
                      ? 'linear-gradient(135deg, #16a34a, #15803d)'
                      : 'linear-gradient(135deg, #d97706, #ea580c)',
                    boxShadow: isProd
                      ? '0 4px 16px rgba(22,163,74,0.35)'
                      : '0 4px 16px rgba(217,119,6,0.35)',
                  }}
                >
                  {isProd ? '🚀 Promote to Prod' : '🔄 Re-deploy Dev'}
                </button>
              </div>
            )
          })}
        </div>

        {deploys && deploys.length > 0 && (
          <div className="mt-2">
            <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Recent deploys</p>
            <div className="space-y-1 text-xs font-mono">
              {deploys.slice(0, 6).map((d, i) => (
                <div key={i} className="flex items-center gap-3 py-1 px-2 rounded" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <span className={d.status === 'success' ? 'text-green-400' : 'text-red-400'}>
                    {d.status === 'success' ? '✓' : '↩'}
                  </span>
                  <span className={`text-[10px] uppercase tracking-wider ${d.env === 'prod' ? 'text-green-400/80' : 'text-orange-400/80'}`}>
                    {d.env || '?'}
                  </span>
                  {d.sha && (
                    <a
                      href={`https://github.com/kammelaraj-arch/ShitalEco/commit/${d.sha}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-orange-400 hover:underline"
                    >
                      {d.short || d.sha.slice(0, 7)}
                    </a>
                  )}
                  <span className="text-white/40 flex-shrink-0">{fmtAge(d.at)}</span>
                  <span className="text-white/60 truncate">{d.message || ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Kiosk fleet health (Quick Donation + Full Kiosk) ─────────────── */}
      <div className="glass rounded-2xl p-6 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📟</span>
            <div>
              <h2 className="text-white font-bold text-lg">Kiosks</h2>
              <p className="text-white/40 text-xs">
                Live status of every configured kiosk + paired card reader.
                <span className="text-green-400/80"> ONLINE</span> = seen ≤ 5 min,
                <span className="text-amber-400/80"> STALE</span> = ≤ 60 min,
                <span className="text-red-400/80"> OFFLINE</span> = longer / never.
                Auto-refreshes every 30 s.
              </p>
            </div>
          </div>
          <button onClick={loadKiosks}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 text-xs hover:bg-white/10">
            ↻ Refresh
          </button>
        </div>

        {kiosksErr && (
          <p className="text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{kiosksErr}</p>
        )}

        {kiosks && (
          <div className="flex gap-2 flex-wrap text-xs font-mono">
            <span className="px-2 py-1 rounded bg-white/5 border border-white/10 text-white/70">Total {kiosks.summary.total}</span>
            <span className="px-2 py-1 rounded bg-green-500/15 border border-green-500/30 text-green-300">● Online {kiosks.summary.online}</span>
            <span className="px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300">● Stale {kiosks.summary.stale}</span>
            <span className="px-2 py-1 rounded bg-red-500/15 border border-red-500/30 text-red-300">● Offline {kiosks.summary.offline}</span>
            {kiosks.summary.inactive > 0 && (
              <span className="px-2 py-1 rounded bg-white/5 border border-white/10 text-white/40">○ Inactive {kiosks.summary.inactive}</span>
            )}
          </div>
        )}

        {kiosks && kiosks.kiosks.length === 0 && !kiosksErr && (
          <p className="text-white/40 text-sm">No kiosk devices configured yet.</p>
        )}

        {kiosks && kiosks.kiosks.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-white/40 text-xs uppercase tracking-wider">
                <tr className="text-left border-b border-white/10">
                  <th className="py-2 pr-4">Health</th>
                  <th className="py-2 pr-4">Device</th>
                  <th className="py-2 pr-4">Branch</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Last seen</th>
                  <th className="py-2 pr-4">Card reader</th>
                </tr>
              </thead>
              <tbody className="text-white/80">
                {kiosks.kiosks.map(k => {
                  const tone =
                    k.health === 'ONLINE'  ? 'bg-green-500/15 border-green-500/30 text-green-300' :
                    k.health === 'STALE'   ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' :
                    k.health === 'INACTIVE'? 'bg-white/5 border-white/10 text-white/40' :
                                             'bg-red-500/15 border-red-500/30 text-red-300'
                  const readerTone =
                    k.reader_status === 'online' ? 'text-green-400' :
                    k.reader_status === 'busy'   ? 'text-amber-400' :
                    k.reader_status === 'offline'? 'text-red-400'   :
                                                   'text-white/40'
                  return (
                    <tr key={k.id} className="border-b border-white/5">
                      <td className="py-2 pr-4">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${tone}`}>
                          ● {k.health}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-medium">{k.name || <span className="text-white/30 font-mono text-xs">{k.id.slice(0, 8)}</span>}</td>
                      <td className="py-2 pr-4 text-white/60">{k.branch_name}</td>
                      <td className="py-2 pr-4 text-white/60 text-xs">{k.device_type || '—'}</td>
                      <td className="py-2 pr-4 text-white/60 text-xs">
                        {k.last_seen_at ? fmtAge(k.last_seen_at) : <span className="text-white/30">never</span>}
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        {k.reader_label ? (
                          <div className="flex items-center gap-2">
                            <span className={readerTone}>●</span>
                            <span className="text-white/70">{k.reader_label}</span>
                            {k.reader_provider && (
                              <span className="text-white/30 text-[10px] uppercase">{k.reader_provider.replace('stripe_terminal', 'stripe')}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-white/30">unpaired</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Snapshots / Restore ─────────────────────────────────────────── */}
      <div className="glass rounded-2xl p-6 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-white font-bold text-lg">📸 Promote Snapshots</h2>
            <p className="text-white/40 text-xs mt-1">
              Each promote saves a DB dump + tags the about-to-be-replaced images as <code className="bg-white/5 px-1 rounded">:promote-&lt;ts&gt;</code>.
              Last 10 are kept. Restore is PIN-gated and reversible.
            </p>
          </div>
          <button onClick={loadSnapshots} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 text-xs hover:bg-white/10">
            ↻ Refresh
          </button>
        </div>
        {snapshotsErr && (
          <p className="text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{snapshotsErr}</p>
        )}
        {snapshots.length === 0 && !snapshotsErr ? (
          <p className="text-white/40 text-sm">No snapshots yet. The first promote-to-prod will create one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-white/40 text-xs uppercase tracking-wider">
                <tr className="text-left border-b border-white/10">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Commit</th>
                  <th className="py-2 pr-4">Contents</th>
                  <th className="py-2 pr-4">Size</th>
                  <th className="py-2 pr-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map(s => {
                  const hasDb     = s.has_db     ?? !!s.db_dump
                  const hasImages = s.has_images ?? !!s.git_sha
                  return (
                    <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2.5 pr-4 text-white/80 font-mono text-xs">{formatTs(s.id)}</td>
                      <td className="py-2.5 pr-4 text-white/60 font-mono text-xs">{s.git_sha || '—'}</td>
                      <td className="py-2.5 pr-4 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-bold ${
                            hasDb ? 'bg-green-500/15 text-green-300 border-green-500/30'
                                  : 'bg-red-500/15 text-red-300 border-red-500/30'
                          }`}>{hasDb ? '✓ DB' : '✗ no DB'}</span>
                          <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-bold ${
                            hasImages ? 'bg-green-500/15 text-green-300 border-green-500/30'
                                      : 'bg-white/10 text-white/40 border-white/20'
                          }`}>{hasImages ? '✓ Images' : '✗ no images'}</span>
                          {s.db_dump && (
                            <span className="text-white/30 font-mono truncate max-w-[200px]" title={s.db_dump}>{s.db_dump}</span>
                          )}
                        </div>
                        {!hasDb && hasImages && (
                          <p className="text-amber-300/80 text-[10px] mt-1">⚠ DB dump missing — restore will be images-only (no DB rollback)</p>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-white/60 text-xs">{s.size_bytes > 0 ? formatBytes(s.size_bytes) : '—'}</td>
                      <td className="py-2.5 pr-4 text-right">
                        <button onClick={() => openRestoreDialog(s)} disabled={!hasDb && !hasImages}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-bold hover:bg-amber-500/25 disabled:opacity-30 disabled:cursor-not-allowed">
                          ↩ Restore
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── PIN dialog ───────────────────────────────────────────────────── */}
      {pinDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !pinBusy && setPinDialog(null)}>
          <div className="w-full max-w-md bg-[#1a0a0a] border border-white/10 rounded-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-white text-lg font-bold">{pinDialog.title}</h3>
            <p className="text-white/60 text-sm">{pinDialog.description}</p>
            {pinDialog.confirmKeyword && (
              <div>
                <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">
                  Type <code className="bg-white/5 px-1 rounded">{pinDialog.confirmKeyword}</code> to confirm
                </label>
                <input type="text" value={confirmInput} onChange={e => setConfirmInput(e.target.value)}
                  autoFocus
                  placeholder={pinDialog.confirmKeyword}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-amber-500/50" />
              </div>
            )}
            <div>
              <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Admin PIN</label>
              <input type="password" inputMode="numeric" autoComplete="off"
                value={pinValue} onChange={e => setPinValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitPinDialog()}
                placeholder="••••"
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-amber-500/50 font-mono tracking-widest" />
            </div>
            {actionMsg && !actionMsg.ok && (
              <p className="text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{actionMsg.text}</p>
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={() => setPinDialog(null)} disabled={pinBusy}
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 text-sm font-bold disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submitPinDialog} disabled={pinBusy}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
                {pinBusy ? '⏳ working…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick actions ─────────────────────────────────────────────── */}
      <div className="glass rounded-2xl p-6 space-y-4">
        <h2 className="text-white font-bold text-lg">🚀 Quick Actions</h2>
        <p className="text-white/40 text-xs">
          The big buttons. Use <em>Force-recreate prod</em> if Promote-to-Prod has silently failed
          (the recurring &quot;container up X days ago&quot; bug).
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <ActionBtn label="🔄 Force catalog refresh"
            onClick={async () => {
              if (busy) return
              setBusy(true); setRunning('force_catalog_refresh'); setResult(null)
              try {
                const data = await apiFetch<{ version: string }>('/items/catalog/refresh', { method: 'POST' })
                setResult({ ok: true, stdout: `Catalog version bumped to ${data.version}\nAll service-portal + kiosk clients will reload catalog on next page-load.` })
              } catch (e: unknown) {
                setResult({ ok: false, detail: e instanceof Error ? e.message : 'Failed' })
              } finally { setBusy(false); setRunning('') }
            }}
            running={running === 'force_catalog_refresh'} />
          <ActionBtn label="📋 List containers"
            onClick={() => run('list_containers')}
            running={running === 'list_containers'} />
          <ActionBtn label="💾 Disk usage"
            onClick={() => run('disk_usage')}
            running={running === 'disk_usage'} />
          <ActionBtn label="🔐 GHCR login test"
            onClick={() => run('ghcr_login_test')}
            running={running === 'ghcr_login_test'} />

          <ActionBtn label="⬇️ Pull DEV images"
            onClick={() => run('pull_images', { target: 'dev' })}
            running={running === 'pull_images'} />
          <ActionBtn label="🔄 Force-recreate DEV"
            warn onClick={confirmFirst(
              'Force-recreate ALL dev containers. ~30s downtime on dev. Continue?',
              () => run('recreate_stack', { target: 'dev' }))}
            running={running === 'recreate_stack'} />
          <div />

          <ActionBtn label="⬇️ Pull PROD images"
            onClick={() => run('pull_images', { target: 'prod' })}
            running={running === 'pull_images'} />
          <ActionBtn label="🔄 Force-recreate PROD"
            danger onClick={confirmFirst(
              'Force-recreate ALL prod containers. ~30s downtime. Continue?',
              () => run('recreate_stack', { target: 'prod' }))}
            running={running === 'recreate_stack'} />
          <div />
        </div>
      </div>

      {/* ── Container inspector ──────────────────────────────────────── */}
      <div className="glass rounded-2xl p-6 space-y-4">
        <h2 className="text-white font-bold text-lg">📦 Container Inspector</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Logs */}
          <div className="space-y-2">
            <p className="text-white/60 text-xs font-bold uppercase">Logs</p>
            <select value={logsContainer} onChange={e => setLogsContainer(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm">
              {ALL_CONTAINERS.map(c => <option key={c}>{c}</option>)}
            </select>
            <input type="number" value={logsTail} onChange={e => setLogsTail(Number(e.target.value))}
              min={10} max={5000} step={50}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm" />
            <button onClick={() => run('container_logs', { container: logsContainer, tail: logsTail })}
              className="w-full px-3 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold">
              View last {logsTail}
            </button>
          </div>

          {/* Inspect */}
          <div className="space-y-2">
            <p className="text-white/60 text-xs font-bold uppercase">Inspect</p>
            <select value={inspectContainer} onChange={e => setInspectContainer(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm">
              {ALL_CONTAINERS.map(c => <option key={c}>{c}</option>)}
            </select>
            <p className="text-white/30 text-xs">Image SHA, status, env vars (incl. GIT_SHA)</p>
            <button onClick={() => run('container_inspect', { container: inspectContainer })}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-bold hover:bg-white/10">
              Inspect
            </button>
          </div>

          {/* Restart */}
          <div className="space-y-2">
            <p className="text-white/60 text-xs font-bold uppercase">Restart</p>
            <select value={restartContainer} onChange={e => setRestartContainer(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm">
              {ALL_CONTAINERS.map(c => <option key={c}>{c}</option>)}
            </select>
            <p className="text-white/30 text-xs">Re-runs the same image. ~10s downtime for that container.</p>
            <button onClick={confirmFirst(
              `Restart ${restartContainer}? Brief downtime.`,
              () => run('restart_container', { container: restartContainer }))}
              className="w-full px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-sm font-bold hover:bg-amber-500/30">
              ⚠️ Restart
            </button>
          </div>
        </div>
      </div>

      {/* ── Read-only SQL ────────────────────────────────────────────── */}
      <div className="glass rounded-2xl p-6 space-y-3">
        <h2 className="text-white font-bold text-lg">🗄️ Read-only SQL</h2>
        <p className="text-white/40 text-xs">SELECT/EXPLAIN/WITH/SHOW/\d only — write statements are rejected.</p>
        <div className="flex gap-2">
          <select value={sqlStack} onChange={e => setSqlStack(e.target.value as 'prod' | 'dev')}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm">
            <option value="prod">prod</option>
            <option value="dev">dev</option>
          </select>
          <button onClick={() => run('psql_select', { stack: sqlStack, query: sqlQuery })}
            className="px-4 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold flex-shrink-0">
            Run query
          </button>
        </div>
        <textarea value={sqlQuery} onChange={e => setSqlQuery(e.target.value)}
          rows={4} placeholder="SELECT … FROM …;"
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-mono" />
      </div>

      {/* ── Output ──────────────────────────────────────────────────── */}
      {(busy || result) && (
        <div className="glass rounded-2xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-bold text-lg">
              {busy ? `⏳ Running ${running}…` : '📤 Output'}
            </h2>
            {result?.duration_ms !== undefined && (
              <span className="text-white/40 text-xs">
                {result.duration_ms}ms · exit {result.exit_code}
              </span>
            )}
          </div>
          {result?.detail && (
            <p className="text-red-300 text-sm">{result.detail}</p>
          )}
          {result?.stdout && (
            <pre className="bg-black/40 rounded-lg p-3 text-xs text-white/80 overflow-x-auto whitespace-pre-wrap max-h-96">
              {result.stdout}
            </pre>
          )}
          {result?.stderr && (
            <>
              <p className="text-red-300 text-xs uppercase tracking-wider">stderr</p>
              <pre className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-300 overflow-x-auto whitespace-pre-wrap max-h-48">
                {result.stderr}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ActionBtn({
  label, onClick, running, warn, danger,
}: {
  label: string; onClick: () => void; running: boolean
  warn?: boolean; danger?: boolean
}) {
  let cls = 'bg-white/5 border border-white/10 text-white hover:bg-white/10'
  if (warn)   cls = 'bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
  if (danger) cls = 'bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30'
  return (
    <button onClick={onClick} disabled={running}
      className={`px-4 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50 ${cls}`}>
      {running ? '⏳ running…' : label}
    </button>
  )
}
