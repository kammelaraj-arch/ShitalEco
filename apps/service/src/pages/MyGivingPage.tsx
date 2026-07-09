import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'
import { AddressLookup } from '../components/AddressLookup'

const API = (import.meta.env.VITE_API_URL as string) || '/api/v1'

interface Sub { id: string; provider: string; amount: number; frequency: string; status: string; branch_id: string; created_at: string; last_payment_at: string | null }
interface Don { id: string; amount: number; payment_provider: string; purpose: string; status: string; created_at: string }
interface VolApp {
  reference: string; stage: number; status: string; branch_id: string; created_at: string
  has_emergency_contact: boolean; has_references: boolean
  first_names?: string; last_name?: string; email?: string; mobile?: string; phone?: string
  address?: string; postcode?: string; ec_full_name?: string; ec_mobile?: string; ec_phone?: string
}
type VolForm = {
  first_names: string; last_name: string; mobile: string; phone: string
  address: string; postcode: string; ec_full_name: string; ec_mobile: string; ec_phone: string
}

const inp = 'w-full px-3 py-2 rounded-lg text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-gold-400/50'
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
  const [editRef, setEditRef] = useState('')     // reference currently being edited
  const [form, setForm] = useState<VolForm | null>(null)
  const [savingVol, setSavingVol] = useState(false)
  const [volMsg, setVolMsg] = useState('')

  function startEdit(v: VolApp) {
    setVolMsg(''); setEditRef(v.reference)
    setForm({
      first_names: v.first_names || '', last_name: v.last_name || '', mobile: v.mobile || '',
      phone: v.phone || '', address: v.address || '', postcode: v.postcode || '',
      ec_full_name: v.ec_full_name || '', ec_mobile: v.ec_mobile || '', ec_phone: v.ec_phone || '',
    })
  }
  const fset = (k: keyof VolForm, val: string) => setForm(p => p ? { ...p, [k]: val } : p)

  async function saveVol(reference: string) {
    if (!form) return
    setSavingVol(true); setVolMsg('')
    try {
      const res = await fetch(`${API}/auth/donor/volunteer/${reference}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${donorToken}` },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('save failed')
      // Reload volunteering so the card + stage reflect the update.
      const d = await fetch(`${API}/auth/donor/volunteering`, { headers: { Authorization: `Bearer ${donorToken}` } })
        .then(r => r.ok ? r.json() : { applications: [] })
      setVols(d.applications || []); setEditRef(''); setForm(null); setVolMsg('✓ Details updated.')
    } catch { setVolMsg('Could not save — please try again.') }
    finally { setSavingVol(false) }
  }

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

  const [cancelling, setCancelling] = useState('')
  async function cancelSub(id: string) {
    if (!window.confirm('Cancel your monthly gift? No further payments will be taken. You can start again any time.')) return
    setCancelling(id)
    try {
      const r = await fetch(`${API}/auth/donor/giving/${encodeURIComponent(id)}/cancel`, {
        method: 'POST', headers: { Authorization: `Bearer ${donorToken}` },
      })
      if (!r.ok) throw new Error()
      // Reload subscriptions so the status reflects the cancellation.
      const d = await fetch(`${API}/auth/donor/giving`, { headers: { Authorization: `Bearer ${donorToken}` } })
        .then(x => x.ok ? x.json() : { subscriptions: subs })
      setSubs(d.subscriptions || [])
    } catch { setError('Could not cancel just now — please email info@shirdisai.org.uk.') }
    finally { setCancelling('') }
  }

  const fmt = (d: string) => d ? new Date(d).toLocaleDateString('en-GB') : '—'
  const activeSub = subs.find(s => (s.status || '').toUpperCase() === 'ACTIVE')

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 pb-24">
      <div className="flex items-center justify-between mb-8">
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

          <div className="grid md:grid-cols-2 gap-x-8 gap-y-8 items-start">
          {/* ── Left column: My Volunteering ── */}
          <div>
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

                    {/* Submitted details (read-only) */}
                    {editRef !== v.reference && (
                      <div className="mt-3 pt-3 space-y-1 text-xs" style={{ borderTop: '1px solid rgba(212,175,55,0.15)' }}>
                        <p style={{ color: 'rgba(255,248,220,0.7)' }}>
                          <b style={{ color: 'rgba(255,248,220,0.85)' }}>{(v.first_names || '') + ' ' + (v.last_name || '')}</b>
                        </p>
                        {v.email && <p style={{ color: 'rgba(255,248,220,0.5)' }}>✉️ {v.email}</p>}
                        {(v.mobile || v.phone) && <p style={{ color: 'rgba(255,248,220,0.5)' }}>📱 {v.mobile || v.phone}</p>}
                        {(v.address || v.postcode) && <p style={{ color: 'rgba(255,248,220,0.5)' }}>🏠 {[v.address, v.postcode].filter(Boolean).join(', ')}</p>}
                        {v.ec_full_name
                          ? <p style={{ color: 'rgba(255,248,220,0.5)' }}>🆘 {v.ec_full_name} · {v.ec_mobile || v.ec_phone}</p>
                          : <p style={{ color: 'rgba(255,248,220,0.4)' }}>🆘 No emergency contact yet — add one to help at a seva.</p>}
                      </div>
                    )}

                    {/* Edit form */}
                    {editRef === v.reference && form && (
                      <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid rgba(212,175,55,0.15)' }}>
                        <div className="grid grid-cols-2 gap-2">
                          <input className={inp} placeholder="First name" value={form.first_names} onChange={e => fset('first_names', e.target.value)} />
                          <input className={inp} placeholder="Last name" value={form.last_name} onChange={e => fset('last_name', e.target.value)} />
                        </div>
                        <input className={inp} placeholder="Mobile" value={form.mobile} onChange={e => fset('mobile', e.target.value)} />
                        <input className={inp} placeholder="Phone (optional)" value={form.phone} onChange={e => fset('phone', e.target.value)} />
                        <AddressLookup compact postcode={form.postcode} address={form.address}
                          onChange={next => setForm(p => p ? { ...p, postcode: next.postcode, address: next.address } : p)} />
                        <p className="text-[11px] pt-1" style={{ color: 'rgba(212,175,55,0.6)' }}>Emergency contact (unlocks one-day seva)</p>
                        <input className={inp} placeholder="Emergency contact name" value={form.ec_full_name} onChange={e => fset('ec_full_name', e.target.value)} />
                        <div className="grid grid-cols-2 gap-2">
                          <input className={inp} placeholder="Their mobile" value={form.ec_mobile} onChange={e => fset('ec_mobile', e.target.value)} />
                          <input className={inp} placeholder="Their phone" value={form.ec_phone} onChange={e => fset('ec_phone', e.target.value)} />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => saveVol(v.reference)} disabled={savingVol}
                            className="text-xs font-bold px-4 py-1.5 rounded-lg disabled:opacity-50"
                            style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
                            {savingVol ? 'Saving…' : 'Save details'}
                          </button>
                          <button onClick={() => { setEditRef(''); setForm(null) }} className="text-xs font-bold px-3 py-1.5 rounded-lg"
                            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.6)' }}>Cancel</button>
                        </div>
                      </div>
                    )}

                    {editRef !== v.reference && (
                      <div className="flex gap-2 flex-wrap mt-3">
                        <button onClick={() => startEdit(v)} className="text-xs font-bold px-3 py-1.5 rounded-lg"
                          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.75)', border: '1px solid rgba(255,255,255,0.12)' }}>
                          ✏️ Update my details
                        </button>
                        <button onClick={() => setScreen('seva')} className="text-xs font-bold px-3 py-1.5 rounded-lg"
                          style={{ background: 'rgba(212,175,55,0.15)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.3)' }}>
                          🪔 Book a seva slot →
                        </button>
                      </div>
                    )}
                    {volMsg && editRef !== v.reference && <p className="text-xs mt-2" style={{ color: '#4ade80' }}>{volMsg}</p>}
                  </motion.div>
                )
              })}
            </div>
          )}

          </div>
          {/* ── Right column: Monthly support + Recent donations ── */}
          <div>
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>Monthly support</p>
          {subs.length === 0 ? (
            <div className="temple-card p-5 text-center mb-6">
              <p className="text-sm mb-3" style={{ color: 'rgba(255,248,220,0.6)' }}>You don't have a monthly gift yet.</p>
              <button onClick={() => setScreen('monthly-giving')} className="px-5 py-2.5 rounded-xl font-bold text-sm"
                style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>Start monthly giving</button>
            </div>
          ) : (
            <div className="space-y-2 mb-6">
              {subs.map(s => {
                const active = (s.status || '').toUpperCase() === 'ACTIVE'
                return (
                <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="temple-card p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-black text-lg text-gold-400">£{Number(s.amount).toFixed(0)}/{(s.frequency || 'month').toLowerCase()}</p>
                      <p className="text-xs" style={{ color: 'rgba(255,248,220,0.5)' }}>{PROVIDER_LABEL[s.provider] || s.provider} · since {fmt(s.created_at)}</p>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: active ? 'rgba(34,197,94,0.2)' : 'rgba(148,163,184,0.2)',
                               color: active ? '#4ade80' : '#94a3b8' }}>{s.status}</span>
                  </div>
                  {active && (
                    <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                      <button onClick={() => cancelSub(s.id)} disabled={cancelling === s.id}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-50"
                        style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}>
                        {cancelling === s.id ? 'Cancelling…' : 'Cancel my monthly gift'}
                      </button>
                    </div>
                  )}
                </motion.div>
                )
              })}
            </div>
          )}

          {activeSub && (
            <p className="text-xs mb-6" style={{ color: 'rgba(255,248,220,0.4)' }}>
              You can cancel any time using the button above — no further payments will be taken.
              Need help? Email <a href="mailto:info@shirdisai.org.uk" style={{ color: '#D4AF37' }}>info@shirdisai.org.uk</a>.
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
          </div>
          </div>
        </>
      )}
    </div>
  )
}
