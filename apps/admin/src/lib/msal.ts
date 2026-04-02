/**
 * Microsoft Authentication Library (MSAL) configuration for the Shital Admin Portal.
 *
 * Uses @azure/msal-browser for the SPA OAuth2 / OIDC popup flow.
 * Config values are fetched from the backend GET /api/v1/auth/azure/config
 * at runtime so they can be managed in the server .env without a frontend rebuild.
 */

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export interface AzureConfig {
  client_id: string
  authority: string
  tenant_id: string
  scopes: string[]
  enabled: boolean
}

// ─── Runtime config fetch ─────────────────────────────────────────────────────

let _azureConfig: AzureConfig | null = null

export async function getAzureConfig(): Promise<AzureConfig> {
  if (_azureConfig) return _azureConfig
  try {
    const res = await fetch(`${API}/auth/azure/config`)
    const data = await res.json()
    _azureConfig = data as AzureConfig
    return _azureConfig
  } catch {
    return { client_id: '', authority: '', tenant_id: '', scopes: [], enabled: false }
  }
}

// ─── MSAL instance factory (lazy — only created when needed) ─────────────────

let _msalInstance: any = null

export async function getMsalInstance() {
  if (_msalInstance) return _msalInstance

  const config = await getAzureConfig()
  if (!config.enabled || !config.client_id) return null

  // Dynamically import to avoid SSR issues in Next.js
  const { PublicClientApplication, LogLevel } = await import('@azure/msal-browser')

  _msalInstance = new PublicClientApplication({
    auth: {
      clientId: config.client_id,
      authority: config.authority,
      redirectUri: typeof window !== 'undefined' ? window.location.origin : '/',
    },
    cache: {
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: false,
    },
    system: {
      loggerOptions: {
        logLevel: LogLevel.Warning,
        loggerCallback: (level: number, message: string, containsPii: boolean) => {
          if (!containsPii) console.debug('[MSAL]', message)
        },
      },
    },
  })

  await _msalInstance.initialize()
  return _msalInstance
}

// ─── Sign-in with popup ───────────────────────────────────────────────────────

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

export async function signInWithMicrosoft(): Promise<ShitalAuthResult> {
  const msal = await getMsalInstance()
  if (!msal) throw new Error('Azure AD SSO is not configured. Please contact your administrator.')

  const config = await getAzureConfig()

  // Try silent first (existing session)
  let msalResult: any = null
  const accounts = msal.getAllAccounts()

  if (accounts.length > 0) {
    try {
      msalResult = await msal.acquireTokenSilent({
        scopes: config.scopes,
        account: accounts[0],
      })
    } catch {
      // Fall through to popup
    }
  }

  if (!msalResult) {
    msalResult = await msal.loginPopup({
      scopes: config.scopes,
      prompt: 'select_account',
    })
  }

  const idToken: string = msalResult.idToken
  if (!idToken) throw new Error('No ID token received from Microsoft')

  // Exchange with our backend
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
  const msal = await getMsalInstance()
  if (!msal) return
  const accounts = msal.getAllAccounts()
  if (accounts.length > 0) {
    await msal.logoutPopup({ account: accounts[0] }).catch(() => {})
  }
}
