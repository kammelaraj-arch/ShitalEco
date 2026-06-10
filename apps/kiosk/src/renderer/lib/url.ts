// Resolves a possibly-relative URL (e.g. "/api/v1/items/xyz/image" returned
// by the backend) against the API origin. In the web build the SPA is loaded
// from the same host as the API so the browser does this automatically, but
// the Electron build loads pages from file:// and the Capacitor Android build
// from https://localhost — both of those resolve "/foo" against the local
// scheme and the image 404s.
const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

export function absUrl(u: string | null | undefined): string {
  if (!u) return ''
  if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:') || u.startsWith('blob:')) return u
  try {
    return new URL(u, API_BASE).toString()
  } catch {
    return u
  }
}
