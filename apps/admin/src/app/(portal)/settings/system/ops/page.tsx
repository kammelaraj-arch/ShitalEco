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
  db_dump: string
  size_bytes: number
  created_at: string
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
        setTimeout(loadSnapshots, 60_000)
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

      {/* ── Promote DEV → PROD (PIN-gated, snapshots before) ───────────── */}
      <div className="glass rounded-2xl p-6 space-y-3" style={{ border: '1.5px solid rgba(34,197,94,0.3)' }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-white font-bold text-lg">🚀 Promote DEV → PROD</h2>
            <p className="text-white/40 text-xs mt-1">
              Retags the current <code className="bg-white/5 px-1 rounded">:dev</code> image as <code className="bg-white/5 px-1 rounded">:latest</code>,
              takes a DB + image snapshot first (auto-restorable), then restarts prod.
              PIN required.
            </p>
          </div>
          <button onClick={openPromoteDialog}
            className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{ background: 'linear-gradient(135deg,#16A34A,#15803D)', color: '#fff' }}>
            🚀 Promote to Prod
          </button>
        </div>
        {actionMsg && (
          <p className={`text-sm rounded-lg px-3 py-2 ${actionMsg.ok ? 'bg-green-500/15 text-green-300 border border-green-500/30' : 'bg-red-500/15 text-red-300 border border-red-500/30'}`}>
            {actionMsg.text}
          </p>
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
                  <th className="py-2 pr-4">DB dump</th>
                  <th className="py-2 pr-4">Size</th>
                  <th className="py-2 pr-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map(s => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2.5 pr-4 text-white/80 font-mono text-xs">{formatTs(s.id)}</td>
                    <td className="py-2.5 pr-4 text-white/60 font-mono text-xs">{s.git_sha}</td>
                    <td className="py-2.5 pr-4 text-white/40 text-xs truncate max-w-[260px]">{s.db_dump}</td>
                    <td className="py-2.5 pr-4 text-white/60 text-xs">{formatBytes(s.size_bytes)}</td>
                    <td className="py-2.5 pr-4 text-right">
                      <button onClick={() => openRestoreDialog(s)}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-bold hover:bg-amber-500/25">
                        ↩ Restore
                      </button>
                    </td>
                  </tr>
                ))}
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
