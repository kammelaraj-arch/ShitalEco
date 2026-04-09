'use client'
/**
 * /auth-callback — Azure AD popup redirect target.
 * The popup window lands here after Microsoft redirects back with the id_token
 * in the URL fragment. The parent window polls popup.location.hash to extract it.
 * This page just shows a "you may close this" message while polling completes.
 */
export default function AuthCallbackPage() {
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
