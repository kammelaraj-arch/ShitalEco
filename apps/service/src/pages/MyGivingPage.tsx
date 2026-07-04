import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'

const API = (import.meta.env.VITE_API_URL as string) || '/api/v1'

interface Sub { id: string; provider: string; amount: number; frequency: string; status: string; branch_id: string; created_at: string; last_payment_at: string | null }
interface Don { id: string; amount: number; payment_provider: string; purpose: string; status: string; created_at: string }
interface VolApp { reference: string; stage: number; status: string; branch_id: string; created_at: string; has_emergency_contact: boolean; has_references: boolean }

const PROVIDER_LABEL: Record<string, string> = { stripe: '💳 Card', paypal: 'PayPal' }
const STAGE_META: Record<number, { icon: string; name: string; next: string }> = {
  0: { icon: '🌱', name: 'Registered',     next: 'Add an emergency contact to help at a one-day seva.' },
  1: { icon: '🪔', name: 'One-Day Seva',   next: 'Add 2 references to become a full volunteer.' },
  2: { icon: '⭐', name: 'Full Volunteer', next: "You've completed every step — thank you! 🙏" },
}

export function MyGivingPage() {
  const { donorToken, donorName, donorEmail, setDonor, setScreen } = useStore()
  const [subs, setSubs] = useState<Sub[]>([])
  const [dons, setDons] = useState<Don[]>([])
  const [vols, setVols] = useState<VolApp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!donorToken) { setScreen('donor-login'); return }
    const hdr = { headers: { Authorization: `Bearer ${donorToken}` } }
    fetch(`${API}/auth/donor/giving`, hdr)
      .then(r => { if (r.status === 401) { setDonor(null); setScreen('donor-login'); throw new Error('signed out') } return r.json() })
      .then(d => { setSubs(d.subscriptions || []); setDons(d.donations || []) })
      .catch(e => { if (e.message !== 'signed out') setError('Could not load your account.') })
      .finally(() => setLoading(false))
    fetch(`${API}/auth/donor/volunteering`, hdr)
      .then(r => r.ok ? r.json() : { applications: [] })
      .then(d => setVols(d.applications || []))
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function logout() { setDonor(null); setScreen('browse') }

  const fmt = (d: string) => d ? new Date(d).toLocaleDateString('en-GB') : '—'
  const activeSub = subs.find(s => (s.status || '').toUpperCase() === 'ACTIVE')

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-24">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl text-gold-400">My Account</h1>
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

          {/* ── My Volunteering ── */}
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>My volunteering</p>
          {vols.length === 0 ? (
            <div className="temple-card p-5 text-center mb-6">
              <p className="text-sm mb-3" style={{ color: 'rgba(255,248,220,0.6)' }}>You haven't registered to volunteer yet.</p>
              <button onClick={() => setScreen('volunteer')} className="px-5 py-2.5 rounded-xl font-bold text-sm"
                style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>Volunteer with SHITAL 🤝</button>
            </div>
          ) : (
            <div className="space-y-2 mb-6">
              {vols.map(v => {
                const m = STAGE_META[v.stage] || STAGE_META[0]
                return (
                  <motion.div key={v.reference} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="temple-card p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-gold-400">{m.icon} {m.name}</p>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(212,175,55,0.12)', color: 'rgba(255,248,220,0.6)' }}>{v.reference}</span>
                    </div>
                    <p className="text-xs mt-1.5" style={{ color: 'rgba(255,248,220,0.55)' }}>{m.next}</p>
                    <p className="text-[11px] mt-1" style={{ color: 'rgba(255,248,220,0.35)' }}>{v.branch_id} · since {fmt(v.created_at)}</p>
                    {v.stage < 2 && (
                      <button onClick={() => setScreen('volunteer')} className="mt-3 text-xs font-bold px-3 py-1.5 rounded-lg"
                        style={{ background: 'rgba(212,175,55,0.15)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.3)' }}>
                        Add details to unlock more →
                      </button>
                    )}
                  </motion.div>
                )
              })}
            </div>
          )}

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
