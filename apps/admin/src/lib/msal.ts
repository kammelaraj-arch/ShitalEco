/**
 * Microsoft / Azure AD sign-in for the Admin Portal.
 *
 * Uses a manual popup + hash polling instead of @azure/msal-browser, so it
 * works over plain HTTP (window.crypto is not required).
 *
 * Config is fetched at runtime from GET /api/v1/auth/azure/config.
 */

const API = process.env.NEXT_PUBLIC_API_URL || '/api/v1'

export interface AzureConfig {
  client_id: string
  authority: string
  tenant_id: string
  scopes: string[]
  enabled: boolean
}

// ── Runtime config ────────────────────────────────────────────────────────────

let _azureConfig: AzureConfig | null = null

export async function getAzureConfig(): Promise<AzureConfig> {
  if (_azureConfig) return _azureConfig
  try {
    const res = await fetch(`${API}/auth/azure/config`, { signal: AbortSignal.timeout(15000) })
    const data = await res.json()
    _azureConfig = data as AzureConfig
    return _azureConfig
  } catch {
    return { client_id: '', authority: '', tenant_id: '', scopes: [], enabled: false }
  }
}

// Invalidate cached config (call after updating keys in admin)
export function invalidateAzureConfig() { _azureConfig = null }

// ── Auth result ───────────────────────────────────────────────────────────────

export interface ShitalAuthResult {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  user: {
    id: string
    email: string
    name: string
    role: string
    branch_id: string | null
    auth_provider: string
  }
}

// ── Sign-in with Microsoft (popup, no MSAL / no window.crypto) ───────────────

export async function signInWithMicrosoft(): Promise<ShitalAuthResult> {
  const config = await getAzureConfig()
  if (!config.enabled || !config.client_id) {
    throw new Error('Azure AD SSO is not configured. Add MS_CLIENT_ID and MS_TENANT_ID in Admin → API Keys.')
  }

  // Use admin-configured redirect URI (MS_REDIRECT_URI secret) so it matches
  // exactly what's registered in Azure AD app registration.
  //
  // Fallback must include the /admin basePath — the Next.js admin app is
  // served under /admin/* (next.config.mjs: basePath:'/admin', trailingSlash:
  // true), so /auth-callback without that prefix doesn't resolve and nginx
  // bounces the popup to /admin/login/, looking like an infinite sign-in loop.
  const redirectUri = (config as any).redirect_uri || `${window.location.origin}/admin/auth-callback/`
  // Use Date.now() as nonce — avoids window.crypto which is HTTPS-only
  const nonce = String(Date.now())
  const scope = encodeURIComponent('openid profile email')
  const authUrl = [
    `${config.authority}/oauth2/v2.0/authorize`,
    `?client_id=${config.client_id}`,
    `&response_type=id_token`,
    `&redirect_uri=${encodeURIComponent(redirectUri)}`,
    `&scope=${scope}`,
    `&response_mode=fragment`,
    `&nonce=${nonce}`,
    `&prompt=select_account`,
  ].join('')

  const width = 520, height = 640
  const left = window.screenX + (window.innerWidth - width) / 2
  const top  = window.screenY + (window.innerHeight - height) / 2
  const popup = window.open(authUrl, 'AzureAD', `width=${width},height=${height},left=${left},top=${top}`)

  if (!popup) throw new Error('Popup was blocked. Please allow popups for this site.')

  // Get the id_token back from the popup. Two channels run in parallel:
  //
  //   (a) postMessage from the auth-callback page — works regardless of
  //       host/subdomain mismatch (parent on shital.org.uk, popup on
  //       admin.shital.org.uk hit a SecurityError on the polling path
  //       and login appeared to hang silently).
  //
  //   (b) location.hash polling — fallback for the case where the popup
  //       is on the SAME origin as the parent (the polling works) AND
  //       the auth-callback page somehow didn't run its postMessage
  //       (e.g. extension blocking, navigation error). Belt & braces.
  //
  // We accept whichever arrives first. The popup self-closes on either path.
  const idToken = await new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      clearInterval(timer)
      clearTimeout(timeoutId)
    }

    const onMessage = (ev: MessageEvent) => {
      // Ignore messages from anywhere except our popup. Don't restrict by
      // origin — the popup may be on a different subdomain (admin.* vs root).
      if (ev.source !== popup) return
      const data = ev.data as { type?: string; id_token?: string; error?: string } | null
      if (!data || data.type !== 'shital-auth') return
      cleanup()
      try { popup?.close() } catch { /* ignore */ }
      if (data.error) reject(new Error(data.error))
      else if (data.id_token) resolve(data.id_token)
      else reject(new Error('No id_token in postMessage response.'))
    }
    window.addEventListener('message', onMessage)

    const timer = setInterval(() => {
      try {
        if (!popup || popup.closed) {
          cleanup()
          reject(new Error('Sign-in popup was closed before completing.'))
          return
        }
        const hash = popup.location.hash
        if (hash && hash.includes('id_token=')) {
          cleanup()
          popup.close()
          const params = new URLSearchParams(hash.substring(1))
          const token = params.get('id_token')
          if (token) resolve(token)
          else reject(new Error('No id_token in redirect response.'))
        }
        if (hash && hash.includes('error=')) {
          cleanup()
          popup.close()
          const params = new URLSearchParams(hash.substring(1))
          reject(new Error(params.get('error_description') || params.get('error') || 'Azure AD error'))
        }
      } catch {
        // Cross-origin SecurityError. The postMessage channel above is the
        // primary delivery path — keep polling silently in case the popup
        // navigates back to our origin.
      }
    }, 400)

    const timeoutId = setTimeout(() => {
      cleanup()
      popup?.close()
      reject(new Error('Sign-in timed out.'))
    }, 180_000)
  })

  // Exchange id_token with backend
  const res = await fetch(`${API}/auth/azure/verify-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let detail = 'Authentication failed'
    try {
      const j = JSON.parse(text)
      detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch { detail = text || `HTTP ${res.status}` }
    throw new Error(detail)
  }

  return res.json() as Promise<ShitalAuthResult>
}

export async function signOutMicrosoft(): Promise<void> {
  // Nothing to clean up — no MSAL state
}
