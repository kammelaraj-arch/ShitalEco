import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'

const API = (import.meta.env.VITE_API_URL as string) || '/api/v1'

interface Sub { id: string; provider: string; amount: number; frequency: string; status: string; branch_id: string; created_at: string; last_payment_at: string | null }
interface Don { id: string; amount: number; payment_provider: string; purpose: string; status: string; created_at: string }

const PROVIDER_LABEL: Record<string, string> = { stripe: '💳 Card', paypal: 'PayPal' }

export function MyGivingPage() {
  const { donorToken, donorName, donorEmail, setDonor, setScreen } = useStore()
  const [subs, setSubs] = useState<Sub[]>([])
  const [dons, setDons] = useState<Don[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!donorToken) { setScreen('donor-login'); return }
    fetch(`${API}/auth/donor/giving`, { headers: { Authorization: `Bearer ${donorToken}` } })
      .then(r => { if (r.status === 401) { setDonor(null); setScreen('donor-login'); throw new Error('signed out') } return r.json() })
      .then(d => { setSubs(d.subscriptions || []); setDons(d.donations || []) })
      .catch(e => { if (e.message !== 'signed out') setError('Could not load your giving.') })
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function logout() { setDonor(null); setScreen('browse') }

  const fmt = (d: string) => d ? new Date(d).toLocaleDateString('en-GB') : '—'
  const activeSub = subs.find(s => (s.status || '').toUpperCase() === 'ACTIVE')

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-24">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl text-gold-400">My Giving</h1>
          <p className="text-sm" style={{ color: 'rgba(255,248,220,0.5)' }}>{donorName || donorEmail}</p>
        </div>
        <button onClick={logout} className="text-xs font-bold px-3 py-1.5 rounded-lg"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.7)', border: '1px solid rgba(255,255,255,0.12)' }}>
          Sign out
        </button>
      </div>

      {loading ? (
        <p className="text-center py-16 text-sm" style={{ color: 'rgba(255,248,220,0.4)' }}>Loading…</p>
      ) : (
        <>
          {error && <p className="text-sm mb-4" style={{ color: '#f87171' }}>{error}</p>}

          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>Monthly support</p>
          {subs.length === 0 ? (
            <div className="temple-card p-5 text-center mb-6">
              <p className="text-sm mb-3" style={{ color: 'rgba(255,248,220,0.6)' }}>You don't have a monthly gift yet.</p>
              <button onClick={() => setScreen('monthly-giving')} className="px-5 py-2.5 rounded-xl font-bold text-sm"
                style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>Start monthly giving</button>
            </div>
          ) : (
            <div className="space-y-2 mb-6">
              {subs.map(s => (
                <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="temple-card p-4 flex items-center justify-between">
                  <div>
                    <p className="font-black text-lg text-gold-400">£{Number(s.amount).toFixed(0)}/{(s.frequency || 'month').toLowerCase()}</p>
                    <p className="text-xs" style={{ color: 'rgba(255,248,220,0.5)' }}>{PROVIDER_LABEL[s.provider] || s.provider} · since {fmt(s.created_at)}</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: (s.status || '').toUpperCase() === 'ACTIVE' ? 'rgba(34,197,94,0.2)' : 'rgba(148,163,184,0.2)',
                             color: (s.status || '').toUpperCase() === 'ACTIVE' ? '#4ade80' : '#94a3b8' }}>{s.status}</span>
                </motion.div>
              ))}
            </div>
          )}

          {activeSub && (
            <p className="text-xs mb-6" style={{ color: 'rgba(255,248,220,0.4)' }}>
              To cancel or change your monthly gift, sign in to your{' '}
              {activeSub.provider === 'stripe' ? 'card provider' : 'PayPal'} account, or email{' '}
              <a href="mailto:info@shirdisai.org.uk" style={{ color: '#D4AF37' }}>info@shirdisai.org.uk</a>.
            </p>
          )}

          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>Recent donations</p>
          {dons.length === 0 ? (
            <p className="text-sm" style={{ color: 'rgba(255,248,220,0.4)' }}>No donations recorded yet.</p>
          ) : (
            <div className="space-y-1.5">
              {dons.map(d => (
                <div key={d.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <span style={{ color: 'rgba(255,248,220,0.8)' }}>{d.purpose || 'Donation'} · {fmt(d.created_at)}</span>
                  <span className="font-bold text-gold-400">£{Number(d.amount).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
