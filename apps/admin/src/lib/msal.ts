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
  // Falls back to window.location.origin + '/auth-callback'.
  const redirectUri = (config as any).redirect_uri || `${window.location.origin}/auth-callback`
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

  // Poll until the popup navigates back to our redirect URI with id_token in hash
  const idToken = await new Promise<string>((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        if (!popup || popup.closed) {
          clearInterval(timer)
          reject(new Error('Sign-in popup was closed before completing.'))
          return
        }
        const hash = popup.location.hash
        if (hash && hash.includes('id_token=')) {
          clearInterval(timer)
          popup.close()
          const params = new URLSearchParams(hash.substring(1))
          const token = params.get('id_token')
          if (token) resolve(token)
          else reject(new Error('No id_token in redirect response.'))
        }
        if (hash && hash.includes('error=')) {
          clearInterval(timer)
          popup.close()
          const params = new URLSearchParams(hash.substring(1))
          reject(new Error(params.get('error_description') || params.get('error') || 'Azure AD error'))
        }
      } catch {
        // Cross-origin — keep polling until popup returns to our origin
      }
    }, 400)

    // Timeout after 3 minutes
    setTimeout(() => { clearInterval(timer); popup?.close(); reject(new Error('Sign-in timed out.')) }, 180_000)
  })

  // Exchange id_token with backend
  const res = await fetch(`${API}/auth/azure/verify-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Authentication failed' }))
    throw new Error(err.detail || 'Authentication failed')
  }

  return res.json() as Promise<ShitalAuthResult>
}

export async function signOutMicrosoft(): Promise<void> {
  // Nothing to clean up — no MSAL state
}
