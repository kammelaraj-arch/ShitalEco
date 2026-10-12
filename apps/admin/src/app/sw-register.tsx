'use client'

// Service worker registration — required for Chrome / Edge / Brave to treat
// the admin as an installable PWA and fire `beforeinstallprompt`. Registered
// at the app root so every page triggers registration once; the browser
// de-dupes repeat registrations by scope.

import { useEffect } from 'react'

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    // basePath is /admin — SW file is served at /admin/sw.js and its scope
    // must stay within /admin/ (that's what we claim at install time).
    navigator.serviceWorker
      .register('/admin/sw.js', { scope: '/admin/' })
      .catch(() => {
        // Non-fatal: install prompt won't fire, but the app still works.
      })
  }, [])
  return null
}
