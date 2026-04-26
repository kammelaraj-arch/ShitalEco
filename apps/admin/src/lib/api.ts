/**
 * Centralised API helper — reads the JWT from localStorage and adds
 * Authorization headers automatically.  All admin pages should import from here.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1'

export function getToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('shital_access_token') || ''
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
  timeoutMs = 15000,
): Promise<T> {
  const MAX_RETRIES = 3
  const RETRYABLE = new Set([502, 503, 504])

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(`${API_BASE}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...authHeaders(),
          ...(init?.headers ?? {}),
        },
      })
    } catch (err: unknown) {
      clearTimeout(timer)
      if (err instanceof Error && err.name === 'AbortError') {
        if (attempt < MAX_RETRIES) { await _sleep(1000 * 2 ** attempt); continue }
        throw new Error('Request timed out — please try again')
      }
      throw err
    }
    clearTimeout(timer)

    if (res.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('shital_access_token')
        window.location.replace('/admin/login')
      }
      throw new Error('Session expired. Please log in again.')
    }

    if (res.ok) return res.json() as Promise<T>

    // Auto-retry on gateway/timeout errors
    if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES) {
      await _sleep(1000 * 2 ** attempt)
      continue
    }

    let msg = ''
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      try { const j = await res.json(); msg = j.detail || j.message || JSON.stringify(j) } catch { /* ignore */ }
    }
    if (!msg) {
      if (res.status === 502 || res.status === 503) msg = 'Server is temporarily unavailable — please try again in a moment'
      else if (res.status === 504) msg = 'Request timed out — please try again'
      else { const t = await res.text().catch(() => ''); msg = t.replace(/<[^>]+>/g, '').trim().slice(0, 200) || `HTTP ${res.status}` }
    }
    throw new Error(msg)
  }
  throw new Error('Server is temporarily unavailable — please try again in a moment')
}

function _sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
