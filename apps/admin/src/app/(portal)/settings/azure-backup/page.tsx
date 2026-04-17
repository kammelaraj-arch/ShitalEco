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

  useEffect(() => {
    fetch(`${API}/settings/azure-backup`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(r => r.json())
      .then(d => { setStatus(d); setContainer(d.container || 'shitaleco-backups') })
      .catch(() => {})
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
    </div>
  )
}
