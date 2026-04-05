/**
 * Centralised API helper — reads the JWT from sessionStorage and adds
 * Authorization headers automatically.  All admin pages should import from here.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1'

export function getToken(): string {
  if (typeof window === 'undefined') return ''
  return sessionStorage.getItem('shital_access_token') || ''
}

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}
