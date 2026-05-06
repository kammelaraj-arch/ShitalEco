/**
 * cachedFetch — localStorage-backed stale-while-revalidate fetch for the
 * service portal catalog. Mirrors the kiosk app's implementation so both
 * apps behave consistently.
 *
 * - Returns cached data immediately if fresh (< TTL)
 * - If cache is >80% of TTL, triggers a silent background refresh
 * - If fetch fails, returns stale data rather than throwing
 * - Cache is keyed by URL, stored under "service:cache:<url>"
 * - scheduleDailyCatalogRefresh() invalidates everything at local midnight
 *   so an idle browser tab still sees today's catalog tomorrow morning.
 */

const DEFAULT_TTL = 24 * 60 * 60 * 1000   // 24 hours
const CACHE_PREFIX = 'service:cache:'

interface Entry<T> { data: T; ts: number }

function readCache<T>(url: string): Entry<T> | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + url)
    return raw ? (JSON.parse(raw) as Entry<T>) : null
  } catch {
    return null
  }
}

function writeCache<T>(url: string, data: T): void {
  try {
    localStorage.setItem(CACHE_PREFIX + url, JSON.stringify({ data, ts: Date.now() }))
  } catch {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX))
      if (keys.length > 0) localStorage.removeItem(keys[0])
      localStorage.setItem(CACHE_PREFIX + url, JSON.stringify({ data, ts: Date.now() }))
    } catch { /* full + can't free — give up silently */ }
  }
}

function silentRefresh(url: string, init: RequestInit | undefined, timeout: number): void {
  fetch(url, { ...init, signal: AbortSignal.timeout(timeout) })
    .then(r => r.ok ? r.json() : null)
    .then(data => { if (data !== null) writeCache(url, data) })
    .catch(() => { /* keep stale */ })
}

export async function cachedFetch<T>(
  url: string,
  init?: RequestInit,
  opts?: { ttl?: number; timeout?: number }
): Promise<T | null> {
  const ttl = opts?.ttl ?? DEFAULT_TTL
  const timeout = opts?.timeout ?? 6000
  const cached = readCache<T>(url)

  if (cached) {
    const age = Date.now() - cached.ts
    if (age < ttl) {
      if (age > ttl * 0.8) silentRefresh(url, init, timeout)
      return cached.data
    }
  }

  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) })
    if (!res.ok) return cached?.data ?? null
    const data = (await res.json()) as T
    writeCache(url, data)
    return data
  } catch (err) {
    if (cached) return cached.data  // stale is better than nothing
    throw err
  }
}

export function clearServiceCache(): void {
  Object.keys(localStorage)
    .filter(k => k.startsWith(CACHE_PREFIX))
    .forEach(k => localStorage.removeItem(k))
}

/**
 * Schedule a daily catalog cache invalidation at local midnight.
 * Returns a teardown function (clears the timers).
 */
export function scheduleDailyCatalogRefresh(): () => void {
  let dailyTimer: ReturnType<typeof setInterval> | null = null

  const msUntilNextLocalMidnight = (): number => {
    const now = new Date()
    const next = new Date(now)
    next.setHours(24, 0, 0, 0)
    return next.getTime() - now.getTime()
  }

  const firstTimer = setTimeout(() => {
    clearServiceCache()
    dailyTimer = setInterval(clearServiceCache, 24 * 60 * 60 * 1000)
  }, msUntilNextLocalMidnight())

  return () => {
    clearTimeout(firstTimer)
    if (dailyTimer) clearInterval(dailyTimer)
  }
}
