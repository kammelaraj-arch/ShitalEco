'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

interface GiftAidConfig {
  hmrc_user_id: string
  hmrc_charity_ref: string
  hmrc_environment: string
  hmrc_credentials_set: boolean
  hmrc_vendor_id: string
  getaddress_api_key_set: boolean
  getaddress_api_key_preview: string
  charity_number: string
}

function EnvBadge({ env }: { env: string }) {
  const isLive = env === 'live'
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border ${
      isLive
        ? 'bg-green-500/20 text-green-300 border-green-500/40'
        : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    }`}>
      <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
      {isLive ? 'LIVE' : 'TEST MODE'}
    </span>
  )
}

function ConfigRow({ label, value, set }: { label: string; value: string; set: boolean }) {
  return (
    <div className="flex items-center justify-between py-3 px-4 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div>
        <p className="text-white/40 text-xs uppercase tracking-wider">{label}</p>
        <p className={`text-sm font-mono mt-0.5 ${set ? 'text-white' : 'text-white/30'}`}>{value}</p>
      </div>
      {set ? (
        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
          ✓ Set
        </span>
      ) : (
        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
          ✗ Missing
        </span>
      )}
    </div>
  )
}

export default function GiftAidSettingsPage() {
  const [config, setConfig] = useState<GiftAidConfig | null>(null)
  const [loading, setLoading] = useState(false)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<GiftAidConfig>('/gift-aid/config')
      setConfig(data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">⚙️ Gift Aid Configuration</h1>
          <p className="text-white/40 mt-1">
            HMRC Charities Online credentials. Day-to-day Gift Aid claims happen on the{' '}
            <Link href="/gift-aid" className="text-saffron-400 hover:underline">Gift Aid page</Link>.
          </p>
        </div>
        {config && <EnvBadge env={config.hmrc_environment || 'test'} />}
      </div>

      <div className="glass rounded-2xl p-6 space-y-5">
        {loading ? (
          <div className="text-center py-10 text-white/30">Loading config…</div>
        ) : config ? (
          <>
            <h2 className="text-white font-bold text-lg">HMRC Credentials</h2>

            <div className="space-y-3">
              <ConfigRow label="Government Gateway User ID"   value={config.hmrc_user_id || '—'}                                               set={!!config.hmrc_user_id} />
              <ConfigRow label="HMRC Password"                 value={config.hmrc_credentials_set ? '••••••••' : 'Not set'}                     set={config.hmrc_credentials_set} />
              <ConfigRow label="Charity HMRC Reference"        value={config.hmrc_charity_ref || '—'}                                          set={!!config.hmrc_charity_ref} />
              <ConfigRow label="Vendor ID"                     value={config.hmrc_vendor_id || '—'}                                            set={!!config.hmrc_vendor_id} />
              <ConfigRow label="Charity Number"                value={config.charity_number || '—'}                                            set={!!config.charity_number} />
              <ConfigRow label="GetAddress.io API Key"         value={config.getaddress_api_key_set ? config.getaddress_api_key_preview : 'Not set'} set={config.getaddress_api_key_set} />
              <ConfigRow label="Submission Environment"        value={(config.hmrc_environment || 'test').toUpperCase()}                       set={true} />
            </div>

            <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
              <p className="text-amber-300 text-sm font-semibold mb-2">How to update credentials</p>
              <p className="text-white/50 text-xs leading-relaxed">
                Set these environment variables on your backend and restart:
              </p>
              <div className="mt-2 space-y-1 font-mono text-xs text-white/40">
                <div>HMRC_GIFT_AID_USER_ID=your-gateway-id</div>
                <div>HMRC_GIFT_AID_PASSWORD=your-gateway-password</div>
                <div>HMRC_GIFT_AID_CHARITY_HMO_REF=AB12345</div>
                <div>HMRC_GIFT_AID_VENDOR_ID=your-vendor-id</div>
                <div>HMRC_GIFT_AID_ENVIRONMENT=test  # or live</div>
              </div>
              <p className="text-white/40 text-xs mt-2">
                Or save them via Admin → API Keys (encrypted in the database).
              </p>
            </div>

            {!config.hmrc_credentials_set && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                <p className="text-red-300 text-sm font-semibold">Credentials not configured</p>
                <p className="text-white/40 text-xs mt-1">
                  HMRC submissions will fail until credentials are set. Register at{' '}
                  <a href="https://www.gov.uk/charity-recognition-hmrc" target="_blank" rel="noopener noreferrer"
                    className="text-saffron-400 underline">gov.uk/charity-recognition-hmrc</a>.
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-10 text-white/30">Failed to load config</div>
        )}
      </div>
    </div>
  )
}
