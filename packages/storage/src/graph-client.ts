import { Client, type AuthenticationProvider } from '@microsoft/microsoft-graph-client'
import { ClientSecretCredential } from '@azure/identity'
import { env } from '@shital/config'
import { createContextLogger } from '@shital/config'

const log = createContextLogger({ module: 'graph-client' })

/**
 * Build a Graph client with a caller-supplied access token (e.g. delegated user token
 * obtained via MSAL / NextAuth).
 */
export function getGraphClient(accessToken: string): Client {
  const authProvider: AuthenticationProvider = {
    getAccessToken: async () => accessToken,
  }
  return Client.initWithMiddleware({ authProvider })
}

interface CachedAppClient {
  client: Client
  expiresAt: number // epoch ms
}

let cachedAppClient: CachedAppClient | null = null

// Token lifetime: 55 minutes (Azure AD tokens last 60 min; we refresh 5 min early)
const APP_TOKEN_CACHE_MS = 55 * 60 * 1000

/**
 * Build a Graph client using client-credentials flow (app-level access).
 * Result is cached for 55 minutes then automatically refreshed on next call.
 */
export async function getAppGraphClient(): Promise<Client> {
  const now = Date.now()

  if (cachedAppClient !== null && now < cachedAppClient.expiresAt) {
    return cachedAppClient.client
  }

  const credential = new ClientSecretCredential(
    env.MS_TENANT_ID,
    env.MS_CLIENT_ID,
    env.MS_CLIENT_SECRET,
  )

  // Eagerly fetch a token so we can verify credentials are valid and prime the cache.
  const tokenResponse = await credential.getToken('https://graph.microsoft.com/.default')

  if (tokenResponse === null) {
    throw new Error('Failed to obtain app-level access token from Azure AD')
  }

  log.info({ expiresOnTimestamp: tokenResponse.expiresOnTimestamp }, 'App Graph token obtained')

  const authProvider: AuthenticationProvider = {
    getAccessToken: async () => {
      const fresh = await credential.getToken('https://graph.microsoft.com/.default')
      if (fresh === null) {
        throw new Error('Failed to refresh app-level access token from Azure AD')
      }
      return fresh.token
    },
  }

  const client = Client.initWithMiddleware({ authProvider })

  cachedAppClient = {
    client,
    expiresAt: now + APP_TOKEN_CACHE_MS,
  }

  return client
}
