/**
 * cachedFetch — localStorage-backed stale-while-revalidate fetch.
 *
 * - Returns cached data immediately if fresh (< TTL)
 * - If cache is >80% of TTL, triggers a silent background refresh
 * - If fetch fails, returns stale data rather than throwing
 * - Cache is keyed by URL, stored under "kiosk:cache:<url>"
 */

const DEFAULT_TTL = 24 * 60 * 60 * 1000   // 24 hours
const CACHE_PREFIX = 'kiosk:cache:'

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
    // localStorage full — evict oldest kiosk entries
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX))
      if (keys.length > 0) localStorage.removeItem(keys[0])
      localStorage.setItem(CACHE_PREFIX + url, JSON.stringify({ data, ts: Date.now() }))
    } catch {}
  }
}

function silentRefresh(url: string, timeout: number): void {
  fetch(url, { signal: AbortSignal.timeout(timeout) })
    .then(r => r.json())
    .then(data => writeCache(url, data))
    .catch(() => {})
}

export async function cachedFetch<T>(
  url: string,
  opts?: { ttl?: number; timeout?: number }
): Promise<T> {
  const ttl = opts?.ttl ?? DEFAULT_TTL
  const timeout = opts?.timeout ?? 6000
  const cached = readCache<T>(url)

  if (cached) {
    const age = Date.now() - cached.ts
    if (age < ttl) {
      if (age > ttl * 0.8) silentRefresh(url, timeout)
      return cached.data
    }
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    const data: T = await res.json()
    writeCache(url, data)
    return data
  } catch (err) {
    if (cached) return cached.data  // stale is better than nothing
    throw err
  }
}

/** Remove all kiosk catalog cache entries (call from admin screen to force refresh). */
export function clearKioskCache(): void {
  Object.keys(localStorage)
    .filter(k => k.startsWith(CACHE_PREFIX))
    .forEach(k => localStorage.removeItem(k))
}
