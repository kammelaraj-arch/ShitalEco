'use client'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'

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

      {/* ── Quick actions ─────────────────────────────────────────────── */}
      <div className="glass rounded-2xl p-6 space-y-4">
        <h2 className="text-white font-bold text-lg">🚀 Quick Actions</h2>
        <p className="text-white/40 text-xs">
          The big buttons. Use <em>Force-recreate prod</em> if Promote-to-Prod has silently failed
          (the recurring &quot;container up X days ago&quot; bug).
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
