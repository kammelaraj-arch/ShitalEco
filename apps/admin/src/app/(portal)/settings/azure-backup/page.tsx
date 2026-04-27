'use client'
import { useState, useEffect } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

function token() {
  return typeof window !== 'undefined' ? (localStorage.getItem('shital_access_token') || '') : ''
}

// ── PIN overlay ───────────────────────────────────────────────────────────────

function PinOverlay({ onVerified }: { onVerified: (pin: string) => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function verify() {
    if (pin.length < 4) { setError('PIN must be at least 4 digits'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API}/settings/api-keys/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ pin }),
      })
      const d = await res.json()
      if (d.ok) { onVerified(pin) } else { setError('Incorrect PIN. Default is 1234.') }
    } catch { setError('Unable to verify PIN') }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
      <div className="w-full max-w-xs rounded-2xl p-7 shadow-2xl space-y-5"
        style={{ background: 'rgba(15,15,30,0.98)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="text-center">
          <div className="text-4xl mb-3">🔒</div>
          <h2 className="text-white font-black text-lg">Admin PIN Required</h2>
          <p className="text-white/40 text-xs mt-1">Enter your 4-digit admin PIN to continue</p>
        </div>
        {error && (
          <div className="bg-red-500/15 border border-red-500/20 text-red-400 text-sm px-4 py-2.5 rounded-xl text-center">
            {error}
          </div>
        )}
        <input
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={e => e.key === 'Enter' && verify()}
          placeholder="• • • •"
          autoFocus
          className="w-full text-center text-white text-2xl tracking-[0.5em] rounded-xl px-4 py-3 focus:outline-none"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
        />
        <button
          onClick={verify}
          disabled={loading || pin.length < 4}
          className="w-full py-3 rounded-xl font-black text-sm text-white transition-all disabled:opacity-40 hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg, #d97706, #ea580c)' }}
        >
          {loading ? 'Verifying…' : 'Unlock'}
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type VersionInfo = {
  git_sha: string
  git_sha_short: string
  build_time: string
  branch: string
  now: string
}
type DeployEvent = {
  at: string
  sha: string
  short: string
  branch: string
  status: 'success' | 'rolled_back' | string
  message?: string
}
type BackupBlob = { name: string; size: number; last_modified: string | null; tier?: string }
type RecipientLevel = 'critical' | 'high' | 'medium' | 'digest'
type RecipientRow = { value: string; is_custom: boolean }
type RecipientsResponse = {
  levels: Record<RecipientLevel, RecipientRow>
  defaults: Record<RecipientLevel, string>
}

const LEVEL_META: Record<RecipientLevel, { label: string; description: string; emoji: string }> = {
  critical: { label: 'Critical',      description: 'Site down, backups failing, DB unreachable',                        emoji: '🚨' },
  high:     { label: 'High',          description: 'TLS expiring soon, disk filling, restore-test stale',                emoji: '⚠️' },
  medium:   { label: 'Medium',        description: 'No donations in last 24h (kiosks possibly broken)',                  emoji: '📉' },
  digest:   { label: 'Weekly digest', description: 'All-green status report every Sunday morning',                       emoji: '📰' },
}

type BackupHealth = {
  configured: boolean
  container: string
  status: 'healthy' | 'degraded' | 'unknown'
  reasons?: string[]
  local: { daily_count: number; latest_local: string | null; latest_size: number }
  azure: { latest_blob: string | null; latest_at: string | null; blob_count: number; error?: string }
  log: {
    last_success: { at: string; line: string } | null
    last_failure: { at: string; line: string } | null
    recent_failures: number
  }
}

function fmtBytes(n: number): string {
  if (!n) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtAge(iso: string | null): string {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export default function AzureBackupPage() {
  const [pin, setPin] = useState<string | null>(null)
  const [status, setStatus] = useState<{ connection_string_set: boolean; container: string } | null>(null)
  const [connStr, setConnStr] = useState('')
  const [container, setContainer] = useState('shitaleco-backups')
  const [showConn, setShowConn] = useState(false)
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [health, setHealth] = useState<BackupHealth | null>(null)
  const [blobs, setBlobs] = useState<BackupBlob[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [recipients, setRecipients] = useState<RecipientsResponse | null>(null)
  const [recipDraft, setRecipDraft] = useState<Record<RecipientLevel, string>>({ critical: '', high: '', medium: '', digest: '' })
  const [recipSaving, setRecipSaving] = useState(false)
  const [recipMsg, setRecipMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [version, setVersion] = useState<VersionInfo | null>(null)
  const [deploys, setDeploys] = useState<DeployEvent[] | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [deployMsg, setDeployMsg] = useState<{ text: string; ok: boolean } | null>(null)

  async function loadVersionAndDeploys() {
    try {
      const [vRes, dRes] = await Promise.all([
        fetch(`${API}/admin/system/version`, { headers: { Authorization: `Bearer ${token()}` } }),
        fetch(`${API}/admin/system/deploys?limit=10`, { headers: { Authorization: `Bearer ${token()}` } }),
      ])
      const v: VersionInfo = await vRes.json()
      const d = await dRes.json()
      setVersion(v)
      setDeploys(d.deploys || [])
    } catch {
      // ignore
    }
  }

  async function triggerDeploy() {
    if (!pin) return
    if (!confirm('Deploy the latest main branch to production? Backend will restart.')) return
    setDeploying(true); setDeployMsg(null)
    try {
      const res = await fetch(`${API}/admin/system/trigger-deploy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'X-Admin-Pin': pin },
      })
      const d = await res.json()
      if (d.ok) {
        setDeployMsg({ text: `Deploy triggered. Webhook returned HTTP ${d.deployer_status}. Containers will restart in 1–2 min.`, ok: true })
        // Refresh version + history after a delay
        setTimeout(loadVersionAndDeploys, 90_000)
      } else {
        setDeployMsg({ text: d.detail || 'Deploy trigger failed', ok: false })
      }
    } catch {
      setDeployMsg({ text: 'Network error — could not reach deployer', ok: false })
    } finally {
      setDeploying(false)
    }
  }

  async function loadHealthAndList() {
    setRefreshing(true)
    try {
      const [hRes, bRes] = await Promise.all([
        fetch(`${API}/settings/azure-backup/health`, { headers: { Authorization: `Bearer ${token()}` } }),
        fetch(`${API}/settings/azure-backup/list?limit=50`, { headers: { Authorization: `Bearer ${token()}` } }),
      ])
      const h = await hRes.json()
      const b = await bRes.json()
      setHealth(h)
      setBlobs(b.ok ? (b.blobs || []) : [])
    } catch {
      // ignore — UI shows last-known state
    } finally {
      setRefreshing(false)
    }
  }

  async function loadRecipients() {
    try {
      const res = await fetch(`${API}/settings/monitor-recipients`, { headers: { Authorization: `Bearer ${token()}` } })
      const d: RecipientsResponse = await res.json()
      setRecipients(d)
      setRecipDraft({
        critical: d.levels.critical.value,
        high:     d.levels.high.value,
        medium:   d.levels.medium.value,
        digest:   d.levels.digest.value,
      })
    } catch {
      // ignore — UI shows last-known state
    }
  }

  async function saveRecipients() {
    if (!pin || !recipients) return
    setRecipSaving(true); setRecipMsg(null)
    try {
      const body: Record<string, string> = {}
      for (const lvl of ['critical', 'high', 'medium', 'digest'] as RecipientLevel[]) {
        if (recipDraft[lvl] !== recipients.levels[lvl].value) {
          body[lvl] = recipDraft[lvl]
        }
      }
      if (Object.keys(body).length === 0) {
        setRecipMsg({ text: 'No changes to save.', ok: true })
        setRecipSaving(false)
        return
      }
      const res = await fetch(`${API}/settings/monitor-recipients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, 'X-Admin-Pin': pin },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (d.ok) {
        setRecipMsg({ text: `Saved: ${Object.keys(d.saved || {}).join(', ')}`, ok: true })
        await loadRecipients()
      } else {
        setRecipMsg({ text: d.detail || 'Save failed', ok: false })
      }
    } catch {
      setRecipMsg({ text: 'Network error — please try again', ok: false })
    } finally {
      setRecipSaving(false)
    }
  }

  async function resetRecipientsLevel(level: RecipientLevel) {
    if (!pin) return
    if (!confirm(`Reset ${LEVEL_META[level].label} recipients to defaults?`)) return
    try {
      await fetch(`${API}/settings/monitor-recipients/${level}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}`, 'X-Admin-Pin': pin },
      })
      setRecipMsg({ text: `${LEVEL_META[level].label} reset to defaults.`, ok: true })
      await loadRecipients()
    } catch {
      setRecipMsg({ text: 'Network error', ok: false })
    }
  }

  useEffect(() => {
    fetch(`${API}/settings/azure-backup`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(r => r.json())
      .then(d => { setStatus(d); setContainer(d.container || 'shitaleco-backups') })
      .catch(() => {})
    loadHealthAndList()
    loadRecipients()
    loadVersionAndDeploys()
  }, [])

  async function save() {
    if (!pin) return
    setSaving(true); setMsg(null)
    try {
      const res = await fetch(`${API}/settings/azure-backup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`,
          'X-Admin-Pin': pin,
        },
        body: JSON.stringify({ connection_string: connStr, container }),
      })
      const d = await res.json()
      if (d.ok) {
        setMsg({ text: 'Azure Blob Storage settings saved. Backups will now upload to Azure automatically.', ok: true })
        setStatus(s => s ? { ...s, connection_string_set: true, container } : s)
        setConnStr('')
      } else {
        setMsg({ text: d.detail || 'Save failed', ok: false })
      }
    } catch { setMsg({ text: 'Network error — please try again', ok: false }) }
    finally { setSaving(false) }
  }

  async function testConnection() {
    setTesting(true); setMsg(null)
    try {
      const res = await fetch(`${API}/settings/azure-backup/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
      })
      const d = await res.json()
      setMsg({ text: d.ok ? `✅ ${d.message}` : `❌ ${d.error}`, ok: d.ok })
    } catch { setMsg({ text: '❌ Network error — could not reach server', ok: false }) }
    finally { setTesting(false) }
  }

  async function clear() {
    if (!pin) return
    if (!confirm('Remove Azure Blob Storage credentials? Backups will remain local only.')) return
    setClearing(true); setMsg(null)
    try {
      const res = await fetch(`${API}/settings/azure-backup`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}`, 'X-Admin-Pin': pin },
      })
      const d = await res.json()
      if (d.ok) {
        setMsg({ text: 'Azure credentials removed. Backups will be local only.', ok: true })
        setStatus(s => s ? { ...s, connection_string_set: false } : s)
      } else {
        setMsg({ text: d.detail || 'Clear failed', ok: false })
      }
    } catch { setMsg({ text: 'Network error', ok: false }) }
    finally { setClearing(false) }
  }

  const card = 'rounded-2xl p-6 space-y-4'
  const cardStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }
  const inputStyle = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'white',
  }
  const labelCls = 'block text-xs font-semibold mb-1.5 uppercase tracking-wider text-white/50'

  return (
    <div className="space-y-8 max-w-3xl">
      {!pin && <PinOverlay onVerified={setPin} />}

      <div>
        <h1 className="text-white font-black text-2xl">☁️ Azure Blob Storage Backups</h1>
        <p className="text-white/40 text-sm mt-1">
          Store encrypted daily database backups in Azure Blob Storage for offsite redundancy.
        </p>
      </div>

      {/* Deployed version + Deploy now */}
      {version && (
        <div className={card} style={cardStyle}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🚀</span>
              <div>
                <h2 className="text-white font-bold text-base">Deployed Version</h2>
                <p className="text-white/50 text-xs mt-0.5">
                  Branch: <span className="font-mono text-white/70">{version.branch}</span>
                  {' · '}Commit:{' '}
                  <a
                    href={`https://github.com/kammelaraj-arch/ShitalEco/commit/${version.git_sha}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-orange-400 hover:underline"
                  >
                    {version.git_sha_short}
                  </a>
                  {version.build_time !== 'unknown' && (
                    <>{' · '}Built: <span className="text-white/70">{fmtAge(version.build_time)}</span></>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={triggerDeploy}
              disabled={deploying || !pin}
              className="px-5 py-2.5 rounded-xl font-black text-sm text-white transition-all disabled:opacity-40 hover:scale-[1.02] active:scale-[0.98] whitespace-nowrap"
              style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)', boxShadow: '0 4px 16px rgba(22,163,74,0.35)' }}
            >
              {deploying ? 'Triggering…' : '🚀 Deploy now'}
            </button>
          </div>

          {deployMsg && (
            <div className={`px-4 py-2.5 rounded-xl text-xs mt-3 ${deployMsg.ok ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
              {deployMsg.text}
            </div>
          )}

          {deploys && deploys.length > 0 && (
            <div className="mt-2">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Recent deploys</p>
              <div className="space-y-1 text-xs font-mono">
                {deploys.slice(0, 5).map((d, i) => (
                  <div key={i} className="flex items-center gap-3 py-1 px-2 rounded" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <span className={d.status === 'success' ? 'text-green-400' : d.status === 'rolled_back' ? 'text-red-400' : 'text-white/50'}>
                      {d.status === 'success' ? '✓' : d.status === 'rolled_back' ? '↩' : '?'}
                    </span>
                    <a
                      href={`https://github.com/kammelaraj-arch/ShitalEco/commit/${d.sha}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-orange-400 hover:underline"
                    >
                      {d.short}
                    </a>
                    <span className="text-white/40 flex-shrink-0">{fmtAge(d.at)}</span>
                    <span className="text-white/60 truncate">{d.message || ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Status */}
      {status && (
        <div
          className={`flex items-start gap-4 p-4 rounded-2xl ${status.connection_string_set ? 'bg-green-500/10 border border-green-500/20' : 'bg-yellow-500/10 border border-yellow-500/20'}`}
        >
          <span className="text-2xl mt-0.5">{status.connection_string_set ? '✅' : '⚠️'}</span>
          <div>
            <p className={`font-bold text-sm ${status.connection_string_set ? 'text-green-400' : 'text-yellow-400'}`}>
              {status.connection_string_set ? 'Azure Blob Storage configured' : 'Not configured — backups are local only'}
            </p>
            {status.connection_string_set && (
              <p className="text-white/40 text-xs mt-0.5">
                Container: <span className="font-mono">{status.container}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Feedback */}
      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm ${msg.ok ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {msg.text}
        </div>
      )}

      {/* Health summary */}
      {health && (
        <div className={card} style={cardStyle}>
          <div className="flex items-center justify-between gap-3 pb-1">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{health.status === 'healthy' ? '✅' : health.status === 'degraded' ? '⚠️' : '🩺'}</span>
              <div>
                <h2 className="text-white font-bold text-base">
                  Backup Health —{' '}
                  <span className={
                    health.status === 'healthy' ? 'text-green-400' :
                    health.status === 'degraded' ? 'text-yellow-400' : 'text-white/60'
                  }>
                    {health.status}
                  </span>
                </h2>
                <p className="text-white/40 text-xs">Live snapshot of local + Azure backup state</p>
              </div>
            </div>
            <button
              onClick={loadHealthAndList}
              disabled={refreshing}
              className="text-xs px-3 py-1.5 rounded-lg text-white/70 hover:text-white transition-colors disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {refreshing ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>

          {health.status === 'degraded' && health.reasons && health.reasons.length > 0 && (
            <ul className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 text-sm text-yellow-400 list-disc pl-9 space-y-1">
              {health.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <p className="text-white/40 text-xs uppercase tracking-wide">Local backups</p>
              <p className="text-white font-semibold mt-0.5 text-sm">{health.local.daily_count} files</p>
              <p className="text-white/30 text-xs">
                Latest: {fmtAge(health.local.latest_local)}
                {health.local.latest_size ? ` · ${fmtBytes(health.local.latest_size)}` : ''}
              </p>
            </div>
            <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <p className="text-white/40 text-xs uppercase tracking-wide">Azure blobs</p>
              <p className="text-white font-semibold mt-0.5 text-sm">
                {health.configured ? `${health.azure.blob_count} files` : 'Not configured'}
              </p>
              <p className="text-white/30 text-xs">
                {health.configured ? `Latest: ${fmtAge(health.azure.latest_at)}` : 'Save credentials above'}
              </p>
            </div>
            <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <p className="text-white/40 text-xs uppercase tracking-wide">Recent failures (7d)</p>
              <p className={`font-semibold mt-0.5 text-sm ${health.log.recent_failures > 0 ? 'text-yellow-400' : 'text-white'}`}>
                {health.log.recent_failures}
              </p>
              <p className="text-white/30 text-xs">
                {health.log.last_failure ? `Last fail: ${fmtAge(health.log.last_failure.at)}` : 'No recent failures'}
              </p>
            </div>
          </div>

          {health.azure.error && (
            <p className="text-red-400 text-xs">Azure list error: {health.azure.error}</p>
          )}
        </div>
      )}

      {/* Recent backups in Azure (descending) */}
      {health?.configured && (
        <div className={card} style={cardStyle}>
          <div className="flex items-center justify-between gap-3 pb-1">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📦</span>
              <div>
                <h2 className="text-white font-bold text-base">Recent Backups in Azure</h2>
                <p className="text-white/40 text-xs">
                  Most recent first · container <span className="font-mono">{health.container}</span>
                </p>
              </div>
            </div>
          </div>

          {blobs === null ? (
            <p className="text-white/40 text-sm">Loading…</p>
          ) : blobs.length === 0 ? (
            <p className="text-white/40 text-sm">No blobs yet. Once a backup uploads it will appear here.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-white/40">
                    <th className="px-4 py-2 font-semibold">Name</th>
                    <th className="px-4 py-2 font-semibold">Size</th>
                    <th className="px-4 py-2 font-semibold">Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {blobs.map(b => (
                    <tr key={b.name} className="border-t border-white/5">
                      <td className="px-4 py-2 font-mono text-xs text-white/80 break-all">{b.name}</td>
                      <td className="px-4 py-2 text-white/70 whitespace-nowrap">{fmtBytes(b.size)}</td>
                      <td className="px-4 py-2 text-white/70 whitespace-nowrap" title={b.last_modified || ''}>
                        {fmtAge(b.last_modified)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Config form */}
      <div className={card} style={cardStyle}>
        <div className="flex items-center gap-3 pb-2">
          <span className="text-2xl">🔑</span>
          <div>
            <h2 className="text-white font-bold text-base">Connection Settings</h2>
            <p className="text-white/40 text-xs">Connection string is stored encrypted in the database</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className={labelCls}>Azure Storage Connection String</label>
            <div className="relative">
              <input
                type={showConn ? 'text' : 'password'}
                value={connStr}
                onChange={e => setConnStr(e.target.value)}
                placeholder={status?.connection_string_set ? '••••  (already set — paste new value to replace)' : 'DefaultEndpointsProtocol=https;AccountName=...'}
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none pr-16"
                style={inputStyle}
                onFocus={e => (e.target.style.borderColor = 'rgba(251,146,60,0.5)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
              />
              <button
                type="button"
                onClick={() => setShowConn(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/30 hover:text-white/60 transition-colors"
              >
                {showConn ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="text-white/25 text-xs mt-1.5">
              Found in Azure Portal → Storage Account → Access keys → Connection string
            </p>
          </div>

          <div>
            <label className={labelCls}>Container Name</label>
            <input
              type="text"
              value={container}
              onChange={e => setContainer(e.target.value)}
              placeholder="shitaleco-backups"
              className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
              style={inputStyle}
              onFocus={e => (e.target.style.borderColor = 'rgba(251,146,60,0.5)')}
              onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
            />
            <p className="text-white/25 text-xs mt-1.5">
              The container will be created if it doesn't exist
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={save}
            disabled={saving || (!connStr && !container)}
            className="px-6 py-2.5 rounded-xl font-black text-sm text-white transition-all disabled:opacity-40 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #d97706, #ea580c)', boxShadow: '0 4px 16px rgba(217,119,6,0.3)' }}
          >
            {saving ? 'Saving…' : 'Save & Enable'}
          </button>
          {status?.connection_string_set && (
            <button
              onClick={clear}
              disabled={clearing}
              className="px-5 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-40 hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: 'rgba(185,28,28,0.15)', border: '1px solid rgba(185,28,28,0.3)', color: '#f87171' }}
            >
              {clearing ? 'Removing…' : 'Remove credentials'}
            </button>
          )}
        </div>
      </div>

      {/* How backups work */}
      <div className={card} style={cardStyle}>
        <div className="flex items-center gap-3 pb-1">
          <span className="text-2xl">📅</span>
          <h2 className="text-white font-bold text-base">How Backups Work</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          {[
            { label: 'Daily', value: 'Every day 2:00 AM (London)', sub: '30 days retained' },
            { label: 'Weekly', value: 'Every Sunday', sub: '12 weeks retained' },
            { label: 'Monthly', value: '1st of month', sub: '12 months retained' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <p className="text-white/40 text-xs uppercase tracking-wide">{label}</p>
              <p className="text-white font-semibold mt-0.5 text-sm">{value}</p>
              <p className="text-white/30 text-xs">{sub}</p>
            </div>
          ))}
        </div>
        <p className="text-white/35 text-xs">
          Backups are always saved locally to <span className="font-mono">/opt/shitaleco/backups/</span> first.
          Azure upload is attempted after the local backup succeeds — a failed upload never prevents the local backup.
        </p>
      </div>

      {/* Setup guide */}
      <div className={card} style={cardStyle}>
        <div className="flex items-center gap-3 pb-1">
          <span className="text-2xl">🛠️</span>
          <h2 className="text-white font-bold text-base">Azure Setup Guide</h2>
        </div>
        <ol className="space-y-4">
          {[
            {
              title: 'Create a Storage Account',
              body: 'Azure Portal → Storage Accounts → Create. Choose LRS replication (cheapest). Region: UK South.',
            },
            {
              title: 'Create a container',
              body: 'Inside the Storage Account → Containers → + Container. Name: shitaleco-backups. Access: Private.',
            },
            {
              title: 'Copy the connection string',
              body: 'Storage Account → Access keys → Show keys → copy Connection string for key1.',
            },
            {
              title: 'Paste above and save',
              body: 'Enter the connection string and container name in the form above, then click Save & Enable.',
            },
          ].map((step, i) => (
            <li key={i} className="flex gap-4">
              <span
                className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center font-black text-sm text-white mt-0.5"
                style={{ background: 'linear-gradient(135deg, #d97706, #ea580c)' }}
              >
                {i + 1}
              </span>
              <div>
                <p className="text-white font-semibold text-sm">{step.title}</p>
                <p className="text-white/45 text-xs mt-0.5 leading-relaxed">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Test connection */}
      <div className={card} style={{ background: 'rgba(21,128,61,0.06)', border: '1px solid rgba(21,128,61,0.2)' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧪</span>
            <div>
              <h2 className="text-white font-bold text-base">Test Connection</h2>
              <p className="text-white/45 text-xs">Uploads and deletes a tiny test blob to verify credentials</p>
            </div>
          </div>
          <button
            onClick={testConnection}
            disabled={testing || !status?.connection_string_set}
            className="px-5 py-2.5 rounded-xl font-black text-sm text-white transition-all disabled:opacity-40 hover:scale-[1.02] active:scale-[0.98] whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg, #166534, #15803d)', boxShadow: '0 4px 16px rgba(21,128,61,0.3)' }}
          >
            {testing ? 'Testing…' : 'Test Now'}
          </button>
        </div>
        {!status?.connection_string_set && (
          <p className="text-yellow-400/60 text-xs">Save credentials first before testing.</p>
        )}
        <div className="border-t border-white/5 pt-4 mt-1 space-y-1">
          <p className="text-white/30 text-xs">To run a full backup immediately on the server:</p>
          <code className="block bg-black/40 rounded-xl px-4 py-3 font-mono text-xs text-green-300 whitespace-pre overflow-x-auto">
            bash /opt/shitaleco/infra/backup.sh
          </code>
          <p className="text-white/25 text-xs">
            Logs: <span className="font-mono">/opt/shitaleco/backups/backup.log</span>
          </p>
        </div>
      </div>

      {/* Alert recipients */}
      {recipients && (
        <div className={card} style={cardStyle}>
          <div className="flex items-center gap-3 pb-1">
            <span className="text-2xl">📧</span>
            <div>
              <h2 className="text-white font-bold text-base">Alert Recipients</h2>
              <p className="text-white/40 text-xs">
                Email lists for the infra monitor (runs every 15 min, plus a Sunday digest)
              </p>
            </div>
          </div>

          {recipMsg && (
            <div className={`px-4 py-2.5 rounded-xl text-xs ${recipMsg.ok ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
              {recipMsg.text}
            </div>
          )}

          <div className="space-y-4">
            {(['critical', 'high', 'medium', 'digest'] as RecipientLevel[]).map(lvl => {
              const meta = LEVEL_META[lvl]
              const row = recipients.levels[lvl]
              const dirty = recipDraft[lvl] !== row.value
              return (
                <div key={lvl}>
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{meta.emoji}</span>
                      <label className="text-xs font-semibold uppercase tracking-wider text-white/70">
                        {meta.label}
                      </label>
                      {row.is_custom ? (
                        <span className="text-[10px] uppercase tracking-wider text-orange-400/80">custom</span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wider text-white/30">default</span>
                      )}
                    </div>
                    {row.is_custom && (
                      <button
                        type="button"
                        onClick={() => resetRecipientsLevel(lvl)}
                        className="text-[11px] text-white/40 hover:text-red-400 transition-colors"
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                  <textarea
                    value={recipDraft[lvl]}
                    onChange={e => setRecipDraft(d => ({ ...d, [lvl]: e.target.value }))}
                    rows={2}
                    placeholder="comma-separated emails"
                    className="w-full rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none resize-y"
                    style={{
                      ...inputStyle,
                      borderColor: dirty ? 'rgba(251,146,60,0.5)' : 'rgba(255,255,255,0.1)',
                    }}
                  />
                  <p className="text-white/30 text-xs mt-1">
                    {meta.description}
                    {!row.is_custom && (
                      <span className="text-white/25"> · default: <span className="font-mono">{recipients.defaults[lvl]}</span></span>
                    )}
                  </p>
                </div>
              )
            })}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={saveRecipients}
              disabled={recipSaving}
              className="px-6 py-2.5 rounded-xl font-black text-sm text-white transition-all disabled:opacity-40 hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #d97706, #ea580c)', boxShadow: '0 4px 16px rgba(217,119,6,0.3)' }}
            >
              {recipSaving ? 'Saving…' : 'Save recipients'}
            </button>
            <p className="text-white/30 text-xs">
              Changes apply on the next monitor run (within 15 minutes)
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
