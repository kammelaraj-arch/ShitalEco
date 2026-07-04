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

const API = process.env.NEXT_PUBLIC_API_URL || '/api/v1'

function saveSession(data: any) {
  localStorage.setItem('shital_access_token', data.access_token)
  localStorage.setItem('shital_refresh_token', data.refresh_token)
  localStorage.setItem('shital_user', JSON.stringify(data.user))
  document.cookie = 'shital_token=1; path=/; max-age=86400; samesite=lax'
}

export default function AuthCallbackPage() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash || ''
    if (!hash) return
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
    const idToken = params.get('id_token')
    const err     = params.get('error')
    const errDesc = params.get('error_description')

    // Popup flow (desktop): an opener exists → post the token back and close.
    // Redirect flow (mobile): no usable opener → finish sign-in in THIS tab.
    const hasOpener = !!window.opener && window.opener !== window

    if (hasOpener) {
      // Wildcard target — opener may be on a different subdomain. The id_token
      // is short-lived and validated server-side before a session is issued.
      const send = (payload: Record<string, unknown>) => {
        try { window.opener?.postMessage({ type: 'shital-auth', ...payload }, '*') } catch { /* opener gone */ }
      }
      if (idToken) send({ id_token: idToken })
      else if (err || errDesc) send({ error: errDesc || err || 'Azure AD error' })
      // Self-close so the user doesn't see a stranded "Completing sign-in…"
      // window after the parent has resolved. Tiny delay flushes postMessage.
      setTimeout(() => { try { window.close() } catch { /* ignore */ } }, 100)
      return
    }

    // ── Same-tab redirect flow ──────────────────────────────────────────────
    if (err || errDesc) {
      window.location.replace(`/admin/login/?error=${encodeURIComponent(errDesc || err || 'Azure AD error')}`)
      return
    }
    if (!idToken) {
      window.location.replace('/admin/login/')
      return
    }
    // Exchange the id_token for a Shital session, store it, go to the dashboard.
    fetch(`${API}/auth/azure/verify-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken }),
    })
      .then(async r => {
        if (!r.ok) {
          const t = await r.text().catch(() => '')
          let detail = `HTTP ${r.status}`
          try { const j = JSON.parse(t); detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail) } catch { detail = t || detail }
          throw new Error(detail)
        }
        return r.json()
      })
      .then(data => { saveSession(data); window.location.replace('/admin/dashboard') })
      .catch(e => { window.location.replace(`/admin/login/?error=${encodeURIComponent(e?.message || 'Sign-in failed')}`) })
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
