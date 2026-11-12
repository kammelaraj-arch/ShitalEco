import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'
import { api, type GivingTier } from '../api'

// PayPal was removed from the Monthly Giving flow at operator request:
// every monthly must go through Stripe Checkout so reconciliation + the
// recurring-giving dashboard have a single source of truth. The old
// PayPal buttons + subscription handlers have been deleted from this
// file; backend PayPal endpoints are left intact for admin cleanup of
// legacy subscriptions.

const DEFAULT_TIERS: GivingTier[] = [
  { id: 'default-5',  amount: 5,  label: 'Lamp Supporter',  description: 'Supports daily lamp lighting at the temple',   frequency: 'MONTH', is_default: false, display_order: 1 },
  { id: 'default-11', amount: 11, label: 'Prasad Patron',   description: 'Provides weekly prasad offering to devotees',  frequency: 'MONTH', is_default: true,  display_order: 2 },
  { id: 'default-21', amount: 21, label: 'Puja Sponsor',    description: 'Sponsors a monthly puja ceremony',             frequency: 'MONTH', is_default: false, display_order: 3 },
  { id: 'default-51', amount: 51, label: 'Festival Friend', description: 'Helps cover special festival and event costs', frequency: 'MONTH', is_default: false, display_order: 4 },
]

export function MonthlyGivingPage() {
  const { branchId, setScreen } = useStore()
  const acctEmail = useStore(s => s.donorEmail)
  const acctName = useStore(s => s.donorName)
  const [tiers, setTiers]           = useState<GivingTier[]>([])
  const [selected, setSelected]     = useState<GivingTier | null>(null)
  const [loading, setLoading]       = useState(true)
  const [stripeEnabled, setStripeEnabled] = useState(false)
  const [stripeBusy, setStripeBusy] = useState(false)

  // Pre-fill donor fields from the signed-in session when available,
  // so a returning donor doesn't have to retype their own name / email
  // on the details step. The strings below only run once on mount.
  const _preName  = acctName || ''
  const _preEmail = acctEmail || ''
  const [firstName, setFirstName]   = useState(() => _preName.split(' ')[0] || '')
  const [surname,   setSurname]     = useState(() => _preName.split(' ').slice(1).join(' ') || '')
  const [donorEmail, setDonorEmail] = useState(() => _preEmail)
  const [donorPhone, setDonorPhone] = useState('')
  const [postcode, setPostcode]     = useState('')
  const [addresses, setAddresses]   = useState<Array<{ formatted: string; uprn: string }>>([])
  const [selectedAddress, setSelectedAddress] = useState('')
  const [lookingUp, setLookingUp]   = useState(false)
  const [addressError, setAddressError] = useState('')

  const [step, setStep]             = useState<'pick' | 'details' | 'done'>('pick')
  const [error, setError]           = useState('')

  const [giftAidDeclared, setGiftAidDeclared] = useState(false)

  const [customAmount, setCustomAmount] = useState('')
  const customAmountValid = (() => {
    const n = parseFloat(customAmount)
    return Number.isFinite(n) && n >= 1 && n <= 1000
  })()
  // The custom amount is the source of truth whenever the donor has typed
  // anything in the custom field. No Set button, no "Other amount" chip —
  // every keystroke of a valid number flows straight into `selected`.
  useEffect(() => {
    if (!customAmount.trim()) return
    if (!customAmountValid) return
    const n = parseFloat(customAmount)
    setSelected({
      id: 'custom',
      amount: n,
      label: 'Custom Monthly Gift',
      description: `£${n.toFixed(2)} every month`,
      frequency: 'MONTH',
      is_default: false,
      display_order: 999,
    })
  }, [customAmount, customAmountValid])
  // The dashed "Other amount" card is gone — this derived flag just marks
  // "is the current selection the custom one" so the tile highlighting stays
  // consistent with how it used to look.
  const customMode = selected?.id === 'custom'

  const detailsValid = firstName.trim().length > 0 && surname.trim().length > 0 && donorEmail.trim().includes('@') && selectedAddress.length > 3

  useEffect(() => {
    Promise.all([
      api.givingTiers().then(d => {
        const tiers = d.tiers.length > 0 ? d.tiers : DEFAULT_TIERS
        setTiers(tiers)
        const def = tiers.find(t => t.is_default) ?? tiers[0]
        if (def) setSelected(def)
      }),
      // Is Stripe recurring available? (enabled only once the webhook secret is set)
      fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/service/stripe/config`)
        .then(r => r.json()).then(c => setStripeEnabled(!!c?.enabled)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  // Returning from the Stripe hosted checkout lands here with
  // ?status=approved&provider=stripe&session_id=cs_live_...
  // Three states the thank-you page can report, in priority order:
  //   active      — /confirm returned ok=true (Stripe settled and we linked)
  //   setting_up  — /confirm returned ok=false (payment still pending at
  //                 Stripe, OR the row hasn't linked yet because the webhook
  //                 is slow) — the 60 s self-heal loop will activate it, so
  //                 reassure the donor instead of claiming "active" when it
  //                 might not be yet.
  //   unknown     — /confirm never answered (offline, network error)
  // We retry /confirm twice (at 3 s and 10 s) because the race between the
  // donor hitting the thank-you page and Stripe's internal processing is
  // tight; after that the fast self-heal loop takes over.
  const [confirmState, setConfirmState] = useState<'pending' | 'active' | 'setting_up' | 'unknown'>('pending')
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('status') !== 'approved') return
    const amt = Number(p.get('amt') || '')
    if (Number.isFinite(amt) && amt > 0) {
      setSelected(s => s ?? {
        id: 'return', amount: amt, label: 'Monthly Gift',
        description: `£${amt.toFixed(2)} every month`, frequency: 'MONTH',
        is_default: false, display_order: 0,
      })
    }
    setStep('done')
    window.history.replaceState(null, '', `${window.location.pathname}?screen=monthly-giving`)

    const sessionId = p.get('session_id') || ''
    if (p.get('provider') !== 'stripe' || !sessionId) {
      // No session id → the webhook / self-heal loop still handles it.
      setConfirmState('setting_up')
      return
    }
    const base = import.meta.env.VITE_API_URL ?? '/api/v1'
    const abort = new AbortController()

    async function tryConfirm(): Promise<boolean> {
      try {
        const r = await fetch(`${base}/service/giving/stripe/confirm`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
          signal: abort.signal,
        })
        const d = await r.json()
        return !!d?.ok
      } catch {
        return false
      }
    }
    (async () => {
      if (await tryConfirm()) { setConfirmState('active'); return }
      await new Promise(r => setTimeout(r, 3000))
      if (abort.signal.aborted) return
      if (await tryConfirm()) { setConfirmState('active'); return }
      await new Promise(r => setTimeout(r, 7000))
      if (abort.signal.aborted) return
      if (await tryConfirm()) { setConfirmState('active'); return }
      // Still not active after ~10 s. The 60 s self-heal loop will catch it.
      setConfirmState('setting_up')
    })()

    return () => abort.abort()
  }, [])

  // Stripe card: go STRAIGHT to Stripe Checkout from the amount step — no
  // on-site details form. Stripe collects name/email/address on its hosted page.
  async function payByStripe() {
    if (!selected) return
    setStripeBusy(true)
    setError('')
    try {
      const r = await fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/service/giving/stripe/create-checkout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(selected.amount), branch_id: branchId,
          tier_label: selected.label || 'Monthly Giving', return_origin: window.location.origin,
          // Pre-fill the donor's details on the Stripe page: use whatever they've
          // typed here, else their signed-in account name/email.
          donor_email: (donorEmail || acctEmail || '').trim(),
          donor_first_name: (firstName || (acctName || '').split(' ')[0] || '').trim(),
          donor_surname: (surname || (acctName || '').split(' ').slice(1).join(' ') || '').trim(),
          donor_phone: donorPhone.trim(),
          // Carry the on-portal Gift Aid answer + address through to the
          // Stripe create-checkout call so the RGS row is stamped with the
          // donor's declared answer at click time. Previously these were
          // captured on the details step and then dropped before Stripe
          // was called — donors who ticked "Gift Aid — I am a UK taxpayer"
          // on the portal and skipped the same question on Stripe's hosted
          // page ended up with gift_aid_declared=false in our DB.
          donor_postcode:    postcode.trim(),
          donor_address:     selectedAddress,
          gift_aid_declared: !!giftAidDeclared,
        }),
      })
      const d = await r.json()
      if (r.ok && d.url) { window.location.href = d.url; return }
      throw new Error(d.detail || 'Could not start card checkout.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start card checkout. Please try again.')
      setStripeBusy(false)
    }
  }

  async function lookupPostcode() {
    setAddressError('')
    if (!postcode.trim()) return
    setLookingUp(true)
    const found = await api.lookupPostcode(postcode)
    setLookingUp(false)
    if (!found.length) setAddressError('No addresses found — check your postcode.')
    else setAddresses(found)
  }

  // "Proceed to Payment" from the details step now goes straight to
  // Stripe Checkout. There's no on-site intermediate step any more.
  async function goToPay() {
    return payByStripe()
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }} className="text-5xl">🕉</motion.div>
        <p className="text-xs tracking-widest uppercase font-semibold" style={{ color: 'rgba(212,175,55,0.5)' }}>Loading…</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg sm:max-w-xl md:max-w-2xl mx-auto px-4 py-6 pb-32">
      <button onClick={() => setScreen('browse')} className="flex items-center gap-2 text-sm font-medium mb-6"
        style={{ color: 'rgba(255,248,220,0.4)' }}>← Back
      </button>

      <div className="text-center mb-6">
        <div className="text-4xl mb-2">🕉</div>
        <h1 className="font-display font-bold text-2xl text-gold-400 mb-1">Monthly Temple Support</h1>
        <p className="text-sm" style={{ color: 'rgba(255,248,220,0.5)' }}>
          Join our family of regular supporters. Cancel anytime.
        </p>
      </div>

      {step === 'pick' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'rgba(212,175,55,0.6)' }}>
            Choose your monthly amount
          </p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {tiers.map(tier => (
              <button key={tier.id} onClick={() => { setCustomAmount(''); setSelected(tier) }}
                className="rounded-2xl p-4 text-left transition-all active:scale-[0.98]"
                style={{
                  background: selected?.id === tier.id && !customMode
                    ? 'linear-gradient(135deg,rgba(212,175,55,0.25),rgba(212,175,55,0.12))'
                    : 'rgba(255,255,255,0.04)',
                  border: `2px solid ${selected?.id === tier.id && !customMode ? '#D4AF37' : 'rgba(255,255,255,0.1)'}`,
                }}>
                {tier.is_default && (
                  <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full mb-2 inline-block"
                    style={{ background: 'rgba(212,175,55,0.2)', color: '#D4AF37' }}>Popular</span>
                )}
                <p className="font-black text-2xl text-gold-400">£{Number(tier.amount).toFixed(0)}</p>
                <p className="text-xs font-bold text-ivory-200 mt-0.5">{tier.label}</p>
                <p className="text-xs mt-1" style={{ color: 'rgba(255,248,220,0.4)' }}>{tier.description}</p>
              </button>
            ))}
          </div>

          {/* Always-visible custom amount field. No "Other amount" chip to
              expand it, no "Set" button to commit it — every keystroke of
              a valid number flows into `selected` via the effect above and
              updates the primary "Pay by Card — £X/month" button below. */}
          <div className="rounded-2xl p-4 mb-4"
            style={{
              background: customMode
                ? 'linear-gradient(135deg,rgba(212,175,55,0.16),rgba(212,175,55,0.08))'
                : 'rgba(212,175,55,0.06)',
              border: `2px ${customMode ? 'solid #D4AF37' : 'dashed rgba(212,175,55,0.3)'}`,
            }}>
            <label className="block text-xs font-bold uppercase tracking-widest mb-2"
              style={{ color: 'rgba(212,175,55,0.9)' }}>
              ✨ Your own amount (£1 – £1,000)
            </label>
            <div className="flex gap-2 items-center">
              <span className="text-2xl font-black text-gold-400">£</span>
              <input type="number" min="1" max="1000" step="0.01"
                inputMode="decimal"
                value={customAmount}
                onChange={e => setCustomAmount(e.target.value)}
                placeholder="e.g. 30"
                className="flex-1 px-3 py-2 rounded-xl text-2xl font-black bg-black/30 border border-white/10 focus:border-saffron-400/50 outline-none text-gold-400 placeholder-white/20" />
            </div>
            {customAmount.trim() && !customAmountValid && (
              <p className="text-xs mt-2" style={{ color: '#fca5a5' }}>
                Please enter an amount between £1 and £1,000.
              </p>
            )}
            {customMode && customAmountValid && (
              <p className="text-xs mt-2" style={{ color: 'rgba(255,248,220,0.6)' }}>
                ✓ £{Number(selected?.amount || 0).toFixed(2)} per month
              </p>
            )}
          </div>

          {/* Monthly Giving is Stripe-only (PayPal removed per operator).
              The donor goes through the details step first so we capture
              name / email / phone / UK address and the Gift Aid
              declaration BEFORE redirecting to Stripe. Earlier this
              button jumped straight to Stripe, which meant Stripe's own
              page was the only place the donor could tick Gift Aid — if
              they skipped it there, the £5 /month we paid to HMRC per
              £100 Gift Aid on their donations was lost. */}
          <button onClick={() => setStep('details')}
            disabled={!selected || (customMode && !customAmountValid)}
            className="w-full py-4 rounded-2xl font-black text-base disabled:opacity-40 transition-all active:scale-[0.99] flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#FFD700,#C5A028)', color: '#3B0000' }}>
            Continue — £{selected ? Number(selected.amount).toFixed(2).replace(/\.00$/, '') : '—'}/month →
          </button>

          {error && (
            <p className="text-sm font-medium rounded-xl px-4 py-3 mt-3"
              style={{ background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.3)' }}>
              {error}
            </p>
          )}

          <p className="text-center text-xs mt-3" style={{ color: 'rgba(255,248,220,0.3)' }}>
            Secure recurring payment · Cancel anytime
          </p>
        </motion.div>
      )}

      {step === 'details' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="temple-card p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(212,175,55,0.6)' }}>Monthly donation</p>
              <p className="font-black text-2xl text-gold-400">£{selected ? Number(selected.amount).toFixed(0) : '—'}/month</p>
              <p className="text-xs text-ivory-200">{selected?.label}</p>
            </div>
            <button onClick={() => setStep('pick')} className="text-xs font-bold" style={{ color: 'rgba(212,175,55,0.6)' }}>Change</button>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>First Name *</label>
              <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                placeholder="First name" className="w-full px-4 py-3 rounded-xl text-sm" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Surname *</label>
              <input type="text" value={surname} onChange={e => setSurname(e.target.value)}
                placeholder="Surname" className="w-full px-4 py-3 rounded-xl text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Email *</label>
            <input type="email" value={donorEmail} onChange={e => setDonorEmail(e.target.value)}
              placeholder="your@email.com" className="w-full px-4 py-3 rounded-xl text-sm" />
            {donorEmail && <p className="text-xs mt-1 ml-1" style={{ color: '#60a5fa' }}>📧 Subscription confirmation sent here</p>}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Phone</label>
            <input type="tel" value={donorPhone} onChange={e => setDonorPhone(e.target.value)}
              placeholder="07123 456789" autoComplete="tel"
              className="w-full px-4 py-3 rounded-xl text-sm" />
            <p className="text-xs mt-1 ml-1" style={{ color: 'rgba(255,248,220,0.4)' }}>Optional</p>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>UK Postcode *</label>
            <div className="flex gap-2">
              <input
                type="text" value={postcode}
                onChange={e => setPostcode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && lookupPostcode()}
                placeholder="e.g. HA9 0BB"
                className="flex-1 px-4 py-3 rounded-xl text-sm uppercase"
              />
              <button onClick={lookupPostcode} disabled={lookingUp}
                className="px-4 py-3 rounded-xl font-bold text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#6B0000' }}>
                {lookingUp ? '…' : 'Find'}
              </button>
            </div>
            {addressError && <p className="text-xs mt-1" style={{ color: '#f87171' }}>{addressError}</p>}
          </div>

          {addresses.length > 0 && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(212,175,55,0.6)' }}>Select Address *</label>
              <select value={selectedAddress} onChange={e => setSelectedAddress(e.target.value)} className="w-full px-4 py-3 rounded-xl text-sm">
                <option value="">— Select your address —</option>
                {addresses.map((a, i) => <option key={i} value={a.formatted}>{a.formatted}</option>)}
              </select>
            </div>
          )}

          {selectedAddress && (
            <div className="px-4 py-3 rounded-xl text-xs font-medium" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80' }}>
              ✓ {selectedAddress}
            </div>
          )}

          <button type="button" onClick={() => setGiftAidDeclared(v => !v)}
            className="w-full text-left rounded-2xl p-4 transition-all"
            style={{
              background: giftAidDeclared
                ? 'linear-gradient(135deg,rgba(34,197,94,0.18),rgba(34,197,94,0.08))'
                : 'rgba(255,255,255,0.04)',
              border: `2px solid ${giftAidDeclared ? '#22C55E' : 'rgba(255,255,255,0.1)'}`,
            }}>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{
                  background: giftAidDeclared ? '#22C55E' : 'rgba(255,255,255,0.05)',
                  border: giftAidDeclared ? 'none' : '2px solid rgba(255,255,255,0.2)',
                  color: 'white',
                }}>
                {giftAidDeclared ? '✓' : ''}
              </div>
              <div className="flex-1">
                <p className="font-bold text-sm text-ivory-100">Add Gift Aid — make my £{selected ? Number(selected.amount).toFixed(0) : '—'} worth £{selected ? (Number(selected.amount) * 1.25).toFixed(2) : '—'}</p>
                <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'rgba(255,248,220,0.55)' }}>
                  I'm a UK taxpayer, this is my own money, and I'd like SHITAL to claim Gift Aid on every monthly donation. I understand if I pay less Income/Capital Gains Tax than the amount of Gift Aid claimed in a year, it's my responsibility to pay the difference.
                </p>
              </div>
            </div>
          </button>

          {error && (
            <p className="text-sm font-medium rounded-xl px-4 py-3"
              style={{ background: 'rgba(198,40,40,0.15)', color: '#f87171', border: '1px solid rgba(198,40,40,0.3)' }}>
              {error}
            </p>
          )}

          <button onClick={goToPay} disabled={!detailsValid}
            className="w-full py-4 rounded-2xl font-black text-base transition-all active:scale-[0.99] disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
            Proceed to Payment →
          </button>
        </motion.div>
      )}

      {step === 'done' && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8 space-y-4">
          <div className="text-6xl">🙏</div>
          <h2 className="font-display font-bold text-2xl text-gold-400">Baba's Blessings, {firstName || 'Friend'}!</h2>

          {/* Honest status. If /confirm came back ok we know Stripe has
              charged + our DB flipped ACTIVE → say "active". Otherwise the
              60 s self-heal loop will activate it, so say "being set up". */}
          {confirmState === 'active' && (
            <p className="text-sm" style={{ color: 'rgba(255,248,220,0.75)' }}>
              Your monthly support of <strong className="text-gold-400">
                £{selected ? Number(selected.amount).toFixed(2).replace(/\.00$/, '') : '—'}/{selected?.frequency.toLowerCase() ?? 'month'}
              </strong> is <span style={{ color: '#86efac' }}>active</span>.
              Baba is grateful.
            </p>
          )}
          {confirmState !== 'active' && (
            <div className="space-y-2">
              <p className="text-sm" style={{ color: 'rgba(255,248,220,0.75)' }}>
                Your monthly support of <strong className="text-gold-400">
                  £{selected ? Number(selected.amount).toFixed(2).replace(/\.00$/, '') : '—'}/month
                </strong> is being set up —
              </p>
              <p className="text-xs" style={{ color: 'rgba(255,248,220,0.55)' }}>
                We're waiting on Stripe to confirm your first charge. This
                usually takes a few seconds. You'll get a confirmation email
                as soon as it goes through — <strong>you don't need to do anything</strong>.
              </p>
            </div>
          )}

          {giftAidDeclared && (
            <div className="rounded-xl mx-auto max-w-xs px-4 py-3 text-xs"
              style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#86efac' }}>
              ✓ Gift Aid declared — SHITAL will reclaim 25p extra for every £1 you give.
            </div>
          )}

          {/* Cancel / pause — Stripe is the biller now, so the PayPal-autopay
              instructions that used to be here no longer apply. Easiest path
              for every donor: one email to us and we stop it. We also link
              Stripe's customer portal (donors can self-serve if they prefer). */}
          <div className="mt-6 mx-auto max-w-md text-left rounded-xl px-4 py-4"
            style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.2)' }}>
            <p className="text-sm font-bold text-gold-400 mb-2">To cancel or change your monthly gift</p>
            <ul className="text-xs space-y-1.5 list-disc list-inside" style={{ color: 'rgba(255,248,220,0.7)' }}>
              <li>Email <a href="mailto:info@shital.org.uk" className="underline text-gold-400">info@shital.org.uk</a>
                  — we'll cancel or adjust it the same day, no questions asked.</li>
              <li>Or reply "unsubscribe" to any email we send you.</li>
            </ul>
            <p className="text-xs mt-3" style={{ color: 'rgba(255,248,220,0.5)' }}>
              Your card is billed by <strong>Stripe</strong> on behalf of SHITAL. Receipts come from
              <em> noreply@shital.org.uk</em>; your bank statement will show <em>SHITAL / Stripe</em>.
            </p>
          </div>

          <div className="flex gap-2 justify-center mt-4">
            <button onClick={() => setScreen('browse')}
              className="px-6 py-3 rounded-xl font-bold text-sm"
              style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
              Return to Temple
            </button>
          </div>
        </motion.div>
      )}
    </div>
  )
}
