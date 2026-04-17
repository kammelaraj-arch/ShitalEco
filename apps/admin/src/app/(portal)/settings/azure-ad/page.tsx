'use client'
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

interface AzureConfig {
  client_id: string
  authority: string
  tenant_id: string
  scopes: string[]
  enabled: boolean
}

// ─── Status card ──────────────────────────────────────────────────────────────

function StatusCard({ config }: { config: AzureConfig | null }) {
  if (!config) return null

  if (config.enabled) {
    return (
      <div className="flex items-start gap-4 p-4 rounded-2xl bg-green-500/10 border border-green-500/20">
        <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center text-xl flex-shrink-0">✅</div>
        <div>
          <p className="text-green-400 font-bold text-sm">Azure AD SSO is Active</p>
          <p className="text-white/40 text-xs mt-0.5">
            Users can sign in with their Microsoft 365 accounts. Tenant: <span className="font-mono">{config.tenant_id}</span>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-4 p-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/20">
      <div className="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center text-xl flex-shrink-0">⚠️</div>
      <div>
        <p className="text-yellow-400 font-bold text-sm">Azure AD SSO Not Configured</p>
        <p className="text-white/40 text-xs mt-0.5">
          Set <span className="font-mono">MS_CLIENT_ID</span>, <span className="font-mono">MS_CLIENT_SECRET</span>, and <span className="font-mono">MS_TENANT_ID</span> in your server <span className="font-mono">.env</span> to enable Microsoft sign-in.
        </p>
      </div>
    </div>
  )
}

// ─── Config row ───────────────────────────────────────────────────────────────

function ConfigRow({ label, value, mono = false, secret = false }: {
  label: string; value: string; mono?: boolean; secret?: boolean
}) {
  const [show, setShow] = useState(false)
  const display = secret && !show ? '••••••••••••••••' : (value || '—')

  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <span className="text-white/50 text-sm font-medium w-48 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className={`flex-1 text-sm truncate ${value ? 'text-white' : 'text-white/20'} ${mono ? 'font-mono text-xs' : ''}`}>
          {display}
        </span>
        {secret && value && (
          <button onClick={() => setShow(s => !s)} className="text-white/30 hover:text-white/60 text-xs transition-colors flex-shrink-0">
            {show ? 'Hide' : 'Show'}
          </button>
        )}
        {!value && (
          <span className="text-xs text-red-400/70 flex-shrink-0">Not set</span>
        )}
        {value && (
          <span className="text-xs text-green-400/70 flex-shrink-0">✓</span>
        )}
      </div>
    </div>
  )
}

// ─── Step card ────────────────────────────────────────────────────────────────

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row gap-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-amber-600 to-orange-500 flex items-center justify-center text-white font-black text-sm shadow-lg mt-0.5">
        {n}
      </div>
      <div className="flex-1">
        <h4 className="text-white font-bold text-sm mb-1">{title}</h4>
        <div className="text-white/45 text-xs leading-relaxed space-y-1">{children}</div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AzureAdSettingsPage() {
  const [config, setConfig] = useState<AzureConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    fetch(`${API}/auth/azure/config`)
      .then(r => r.json())
      .then(d => setConfig(d))
      .catch(() => setConfig(null))
      .finally(() => setLoading(false))
  }, [])

  async function testSignIn() {
    setTesting(true)
    setTestResult(null)
    try {
      const { signInWithMicrosoft } = await import('@/lib/msal')
      const data = await signInWithMicrosoft()
      setTestResult(`✅ Success! Signed in as ${data.user.name} (${data.user.email}) with role ${data.user.role}`)
    } catch (e: any) {
      setTestResult(`❌ ${e.message}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-8 animate-fade-in max-w-3xl">

      {/* Header */}
      <div>
        <h1 className="text-3xl font-black text-white">🔷 Azure AD / Microsoft 365</h1>
        <p className="text-white/40 mt-1">Single Sign-On configuration for staff using their Microsoft 365 accounts</p>
      </div>

      {/* Status */}
      {loading ? (
        <div className="text-white/30 text-sm">Loading configuration…</div>
      ) : (
        <StatusCard config={config} />
      )}

      {/* Current config values */}
      <div className="glass rounded-2xl p-6">
        <h3 className="text-white font-black text-base mb-4">Current Configuration</h3>
        <div className="text-white/30 text-xs mb-4">
          These values are read from the server <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded">.env</span> file. Restart the backend after changing them.
        </div>
        {config ? (
          <div>
            <ConfigRow label="Client ID (MS_CLIENT_ID)" value={config.client_id} mono />
            <ConfigRow label="Tenant ID (MS_TENANT_ID)" value={config.tenant_id} mono />
            <ConfigRow label="Authority URL" value={config.authority} mono />
            <ConfigRow label="Client Secret" value="[set in .env]" secret />
            <ConfigRow label="Scopes" value={config.scopes?.join(', ')} />
            <ConfigRow label="SSO Enabled" value={config.enabled ? 'Yes' : 'No'} />
          </div>
        ) : (
          <p className="text-white/20 text-sm">Could not load config</p>
        )}
      </div>

      {/* Test SSO */}
      {config?.enabled && (
        <div className="glass rounded-2xl p-6">
          <h3 className="text-white font-black text-base mb-2">Test Sign-In</h3>
          <p className="text-white/40 text-xs mb-4">
            Click to open the Microsoft sign-in popup and verify the full SSO flow works end-to-end.
          </p>
          {testResult && (
            <div className={`mb-4 p-3 rounded-xl text-sm ${testResult.startsWith('✅') ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
              {testResult}
            </div>
          )}
          <button
            onClick={testSignIn}
            disabled={testing}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-white transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
            style={{ background: '#2563eb', boxShadow: '0 4px 16px rgba(37,99,235,0.4)' }}
          >
            <MicrosoftLogo />
            {testing ? 'Opening Microsoft sign-in…' : 'Test Sign in with Microsoft'}
          </button>
        </div>
      )}

      {/* Setup guide */}
      <div className="glass rounded-2xl p-6">
        <h3 className="text-white font-black text-base mb-5">Setup Guide</h3>
        <div className="space-y-6">
          <Step n={1} title="Register an App in Azure AD">
            <p>Go to <span className="text-white/70">portal.azure.com</span> → Azure Active Directory → App Registrations → New Registration.</p>
            <p>Name: <span className="font-mono bg-white/5 px-1 rounded">Shital Temple ERP</span> | Accounts: <span className="font-mono bg-white/5 px-1 rounded">Single tenant</span></p>
            <p>Redirect URI: <span className="font-mono bg-white/5 px-1 rounded">Single-page application (SPA)</span> → <span className="font-mono bg-white/5 px-1 rounded">https://your-admin.domain.com/login</span></p>
          </Step>

          <Step n={2} title="Copy the Application (client) ID and Directory (tenant) ID">
            <p>From the app Overview page, copy:</p>
            <ul className="list-disc list-inside space-y-1 mt-1">
              <li><span className="font-mono bg-white/5 px-1 rounded">Application (client) ID</span> → set as <span className="font-mono text-orange-400">MS_CLIENT_ID</span></li>
              <li><span className="font-mono bg-white/5 px-1 rounded">Directory (tenant) ID</span> → set as <span className="font-mono text-orange-400">MS_TENANT_ID</span></li>
            </ul>
          </Step>

          <Step n={3} title="Create a Client Secret">
            <p>App Registration → Certificates & secrets → New client secret → Copy the <span className="text-white/70">Value</span> (shown only once).</p>
            <p>Set as <span className="font-mono text-orange-400">MS_CLIENT_SECRET</span> in <span className="font-mono bg-white/5 px-1 rounded">.env</span></p>
          </Step>

          <Step n={4} title="Add API Permissions">
            <p>API Permissions → Add permission → Microsoft Graph → Delegated:</p>
            <ul className="list-disc list-inside space-y-1 mt-1">
              <li><span className="font-mono bg-white/5 px-1 rounded">openid</span></li>
              <li><span className="font-mono bg-white/5 px-1 rounded">profile</span></li>
              <li><span className="font-mono bg-white/5 px-1 rounded">email</span></li>
              <li><span className="font-mono bg-white/5 px-1 rounded">User.Read</span></li>
            </ul>
            <p className="mt-1">Click <span className="text-white/70">Grant admin consent</span>.</p>
          </Step>

          <Step n={5} title="Update .env and restart the backend">
            <div className="bg-black/30 rounded-xl p-3 font-mono text-xs text-green-400 leading-relaxed mt-1">
              <p>MS_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</p>
              <p>MS_CLIENT_SECRET=your-secret-value</p>
              <p>MS_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</p>
            </div>
          </Step>

          <Step n={6} title="Role Mapping">
            <p>New Azure AD users are created with role <span className="font-mono bg-white/5 px-1 rounded">STAFF</span> by default.</p>
            <p>Existing staff who already have an account are linked automatically by email. Their role in Shital is unchanged.</p>
            <p>Change roles from <span className="text-white/70">Settings → Users & Roles</span>.</p>
          </Step>
        </div>
      </div>

      {/* Env reference */}
      <div className="glass rounded-2xl p-6">
        <h3 className="text-white font-black text-base mb-3">Backend API Endpoints</h3>
        <div className="space-y-2">
          {[
            { method: 'GET',  path: '/api/v1/auth/azure/config',        desc: 'Returns MSAL config (client ID, authority, scopes)' },
            { method: 'POST', path: '/api/v1/auth/azure/verify-token',  desc: 'Validates MS ID token, creates/links user, returns JWT' },
            { method: 'GET',  path: '/api/v1/auth/azure/login',         desc: 'Server-side redirect to Microsoft login (alternative flow)' },
            { method: 'GET',  path: '/api/v1/auth/azure/callback',      desc: 'OAuth2 callback — exchanges code for tokens' },
          ].map(e => (
            <div key={e.path} className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
              <span className={`flex-shrink-0 text-xs font-black px-2 py-0.5 rounded-md ${e.method === 'GET' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>
                {e.method}
              </span>
              <span className="font-mono text-xs text-white/60 flex-shrink-0">{e.path}</span>
              <span className="text-white/35 text-xs">{e.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
      <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
    </svg>
  )
}
