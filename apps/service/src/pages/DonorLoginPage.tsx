import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'

const API = (import.meta.env.VITE_API_URL as string) || '/api/v1'

interface Provider { provider: string; label: string }

const PROVIDER_ICON: Record<string, string> = {
  google: '🔴', facebook: '🔵', apple: '', microsoft: '🟦', linkedin: '💼', twitter: '𝕏',
}

export function DonorLoginPage() {
  const { setScreen, setDonor, donorPrefill, setDonorPrefill } = useStore()
  const [providers, setProviders] = useState<Provider[]>([])
  // If the donor arrived from the post-donation "save my details" prompt, we
  // already know their name + email — seed the form and start in register mode.
  const [mode, setMode] = useState<'login' | 'register'>(donorPrefill ? 'register' : 'login')
  const [email, setEmail] = useState(donorPrefill?.email || '')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState(donorPrefill?.firstName || '')
  const [surname, setSurname] = useState(donorPrefill?.surname || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API}/auth/donor/providers`).then(r => r.json())
      .then(d => setProviders(d.providers || [])).catch(() => {})
    // Consume the prefill once so it doesn't linger for a later visit.
    if (donorPrefill) setDonorPrefill(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function social(p: string) {
    const back = encodeURIComponent(window.location.origin + window.location.pathname)
    window.location.href = `${API}/auth/donor/${p}/login?redirect=${back}`
  }

  async function submit() {
    setError('')
    if (!email.includes('@')) { setError('Please enter a valid email.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setBusy(true)
    try {
      const path = mode === 'register' ? 'register' : 'login'
      const body = mode === 'register'
        ? { email, password, first_name: firstName, surname }
        : { email, password }
      const r = await fetch(`${API}/auth/donor/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Sign in failed')
      setDonor(d.token, `${firstName} ${surname}`.trim(), d.email)
      setScreen('my-giving')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed. Please try again.')
    } finally { setBusy(false) }
  }

  const inp = 'w-full px-4 py-3 rounded-xl text-sm bg-white/5 border border-white/10 text-ivory-100 outline-none focus:border-saffron-400/50'

  return (
    <div className="max-w-md mx-auto px-4 py-8">
      <button onClick={() => setScreen('browse')} className="text-sm font-medium mb-6" style={{ color: 'rgba(255,248,220,0.4)' }}>← Back</button>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-6">
        <div className="text-4xl mb-2">🙏</div>
        <h1 className="font-display font-bold text-2xl text-gold-400">Sign in to My Giving</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,248,220,0.5)' }}>See your donations & manage monthly support</p>
      </motion.div>

      {providers.length > 0 && (
        <div className="space-y-2 mb-5">
          {providers.map(p => (
            <button key={p.provider} onClick={() => social(p.provider)}
              className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition active:scale-[0.99]"
              style={{ background: 'rgba(255,255,255,0.06)', color: '#FFF8DC', border: '1px solid rgba(255,255,255,0.15)' }}>
              <span>{PROVIDER_ICON[p.provider] || '🔑'}</span> Continue with {p.label}
            </button>
          ))}
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs" style={{ color: 'rgba(255,248,220,0.3)' }}>or with email</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>
        </div>
      )}

      <div className="space-y-3">
        {mode === 'register' && (
          <div className="flex gap-2">
            <input className={inp} placeholder="First name" value={firstName} onChange={e => setFirstName(e.target.value)} />
            <input className={inp} placeholder="Surname" value={surname} onChange={e => setSurname(e.target.value)} />
          </div>
        )}
        <input className={inp} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <input className={inp} type="password" placeholder="Password (8+ characters)" value={password}
          onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
        {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}
        <button onClick={submit} disabled={busy}
          className="w-full py-3.5 rounded-xl font-black text-base disabled:opacity-50 transition active:scale-[0.99]"
          style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
          {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
        </button>
        <p className="text-center text-xs" style={{ color: 'rgba(255,248,220,0.5)' }}>
          {mode === 'login' ? "New here? " : 'Have an account? '}
          <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}
            className="font-bold" style={{ color: '#D4AF37' }}>
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
