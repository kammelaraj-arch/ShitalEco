'use client'
/**
 * /auth-callback — Azure AD popup redirect target.
 *
 * Microsoft redirects the popup window here with the id_token in the URL
 * fragment. We extract it and postMessage it back to window.opener so the
 * parent receives it regardless of whether parent and popup share an origin
 * (parent on shital.org.uk + popup on admin.shital.org.uk hit cross-origin
 * SecurityError on the old hash-polling path and login appeared to hang).
 *
 * The matching listener lives in apps/admin/src/lib/msal.ts.
 */
import { useEffect } from 'react'

export default function AuthCallbackPage() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash || ''
    if (!hash) return
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
    const idToken = params.get('id_token')
    const err     = params.get('error')
    const errDesc = params.get('error_description')

    // Wildcard target — opener may be on a different subdomain. The id_token
    // is short-lived and validated server-side before any session is issued,
    // so the cross-origin exposure is acceptable here.
    const send = (payload: Record<string, unknown>) => {
      try { window.opener?.postMessage({ type: 'shital-auth', ...payload }, '*') } catch { /* opener gone */ }
    }

    if (idToken) send({ id_token: idToken })
    else if (err || errDesc) send({ error: errDesc || err || 'Azure AD error' })

    // Self-close so the user doesn't see a stranded "Completing sign-in…"
    // window after the parent has resolved. Tiny delay flushes postMessage first.
    setTimeout(() => { try { window.close() } catch { /* ignore */ } }, 100)
  }, [])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0a0404', fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{ textAlign: 'center', color: '#fff' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔐</div>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)' }}>
          Completing sign-in…
        </p>
      </div>
    </div>
  )
}
