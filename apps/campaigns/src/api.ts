// Thin fetch wrapper that carries the auth token and surfaces non-200
// responses as thrown Errors with the server's own message when it has one.
//
// Lives alongside the admin app — same backend, same JWT, same cookie
// domain (`.shital.org.uk`) so a logged-in admin can hop between
// admin.shital.org.uk and campaigns.shital.org.uk without a second login
// in the future (Phase 1c wires SSO; for now we re-auth once here).

import { useAuth } from './store'

const API = (import.meta.env.VITE_API_URL as string) || '/api/v1'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = useAuth.getState().token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${API}${path}`, { ...init, headers })
  if (!r.ok) {
    let msg = `${r.status}`
    try {
      const body = await r.json()
      if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch { /* body wasn't JSON */ }
    throw new HttpError(r.status, msg)
  }
  if (r.status === 204) return undefined as unknown as T
  return r.json() as Promise<T>
}

export const api = {
  login: (email: string, password: string) =>
    req<{ access_token: string; user: { email: string; role: string } }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }),
  sendTest: (body: {
    contact_id: string
    template_key?: string
    subject?: string
    html?: string
    text?: string
    variables?: Record<string, unknown>
  }) => req<{ sent: boolean; skipped?: boolean; reason?: string; prefs_url?: string; sent_email_id?: string }>(
    '/marketing/send-test', { method: 'POST', body: JSON.stringify(body) },
  ),
}
