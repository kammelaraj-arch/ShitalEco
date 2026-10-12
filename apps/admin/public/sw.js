// Minimal service worker for Shital App PWA installability. Chrome / Edge /
// Brave only mark a site "installable" (and only then fire
// `beforeinstallprompt` + show the address-bar install icon) once a service
// worker with a `fetch` handler is registered.
//
// We don't actually cache anything — Next.js's static export + nginx already
// handle revalidation, and the admin changes often enough that stale caching
// would cause confusing "why am I still seeing yesterday's build" bugs.
// Keeping the fetch handler as a pure network pass-through means the browser
// treats us as a PWA while behaving identically to a plain page.

self.addEventListener('install', (event) => {
  // Take over as soon as possible — no "waiting" state.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  // Pure pass-through: let the network handle everything. Required to be here
  // (not just the listener) for Chrome to consider the page installable.
  event.respondWith(fetch(event.request))
})
