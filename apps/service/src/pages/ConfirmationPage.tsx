import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'

export function ConfirmationPage() {
  const { orderResult, contactInfo, reset, donorToken, deviceToken, setScreen, setDonorPrefill } = useStore()
  const [countdown, setCountdown] = useState(60)
  const [promptDismissed, setPromptDismissed] = useState(false)

  // Guest-first: donating never requires an account. But a public web donor who
  // just gave us their name + email is a perfect moment for an OPTIONAL nudge to
  // save their details and track their giving. Never shown on kiosk devices
  // (deviceToken), to anonymous donors, or to someone already signed in.
  const firstName = contactInfo?.firstName || contactInfo?.name?.split(' ')[0] || ''
  const surname   = contactInfo?.surname || contactInfo?.name?.split(' ').slice(1).join(' ') || ''
  const showAccountPrompt =
    !donorToken && !deviceToken && !promptDismissed &&
    !!contactInfo?.email && !contactInfo?.anonymous

  function createAccount() {
    setDonorPrefill({ email: contactInfo?.email || '', firstName, surname })
    setScreen('donor-login')
  }

  // Read from the orderResult snapshot captured at /capture-success time,
  // not from the live store — PaymentPage now calls clearBasket() right
  // after setOrderResult(), so the live `items` array is [] by the time
  // this page mounts. Falling back to the orderResult-stored snapshot
  // (with empty-list defaults) keeps the receipt rendering correct.
  const items          = orderResult?.items ?? []
  const giftAidAgreed  = orderResult?.gift_aid_agreed ?? false
  const giftAidEligible= orderResult?.gift_aid_total ?? 0
  const total          = orderResult?.amount ?? items.reduce((sum, i) => sum + i.totalPrice, 0)

  const boost          = giftAidEligible * 0.25
  const templeReceives = total + (giftAidAgreed ? boost : 0)

  useEffect(() => {
    // Hold the auto-reset while the account nudge is on screen, so a public
    // donor isn't yanked back to Browse mid-decision.
    if (showAccountPrompt) return
    if (countdown <= 0) { reset(); return }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown, showAccountPrompt])

  return (
    <div className="max-w-lg mx-auto px-4 py-10 text-center">
      {/* Animated Om */}
      <motion.div
        initial={{ scale: 0, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="text-8xl mb-4 inline-block"
        style={{ filter: 'drop-shadow(0 0 30px rgba(212,175,55,0.6))' }}
      >
        🕉
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <h1 className="font-display font-bold text-2xl text-gold-400 mb-2">Jay Sai Baba! 🙏</h1>
        <p className="text-sm mb-6" style={{ color: 'rgba(255,248,220,0.55)' }}>
          {contactInfo?.name
            ? `Thank you, ${contactInfo.name.split(' ')[0]}! Your offering has been received.`
            : 'Thank you for your kind offering!'}
        </p>
      </motion.div>

      {/* Receipt card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="temple-card p-5 text-left mb-5 space-y-3"
      >
        {orderResult?.order_ref && (
          <div className="flex justify-between text-sm">
            <span style={{ color: 'rgba(255,248,220,0.45)' }}>Reference</span>
            <span className="font-black text-gold-400">{orderResult.order_ref}</span>
          </div>
        )}
        {orderResult?.paypal_capture_id && (
          <div className="flex justify-between text-sm">
            <span style={{ color: 'rgba(255,248,220,0.45)' }}>PayPal Transaction</span>
            <span className="font-mono text-xs text-ivory-200 break-all text-right">{orderResult.paypal_capture_id}</span>
          </div>
        )}

        {items.map((item) => (
          <div key={item.id} className="flex justify-between text-sm">
            <span className="truncate mr-2" style={{ color: 'rgba(255,248,220,0.6)' }}>
              {item.name} × {item.quantity}
            </span>
            <span className="font-semibold text-ivory-200 price-display">£{item.totalPrice.toFixed(2)}</span>
          </div>
        ))}

        <div className="space-y-2 pt-2" style={{ borderTop: '1px dashed rgba(212,175,55,0.2)' }}>
          <div className="flex justify-between text-sm">
            <span style={{ color: 'rgba(255,248,220,0.45)' }}>You paid</span>
            <span className="font-bold text-ivory-200 price-display">£{total.toFixed(2)}</span>
          </div>
          {giftAidAgreed && boost > 0 && (
            <div className="flex justify-between text-sm" style={{ color: '#4ade80' }}>
              <span>Gift Aid (HMRC adds)</span>
              <span className="font-bold price-display">+£{boost.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold">
            <span className="text-ivory-200">Temple receives</span>
            <span className="text-gold-400 text-base price-display">£{templeReceives.toFixed(2)}</span>
          </div>
        </div>

        {contactInfo?.email && (
          <div className="rounded-xl px-3 py-2 text-xs flex items-center gap-2"
            style={{ background: 'rgba(96,165,250,0.1)', color: '#93c5fd', border: '1px solid rgba(96,165,250,0.2)' }}>
            <span>📧</span>
            <span>Receipt sent to <strong>{contactInfo.email}</strong></span>
          </div>
        )}
      </motion.div>

      {giftAidAgreed && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="rounded-2xl p-4 mb-5 text-left"
          style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(74,222,128,0.2)' }}
        >
          <p className="text-sm font-bold mb-1" style={{ color: '#4ade80' }}>🇬🇧 Gift Aid Confirmed</p>
          <p className="text-xs" style={{ color: 'rgba(74,222,128,0.7)' }}>
            Your declaration has been recorded. HMRC will add £{boost.toFixed(2)} to your donation.
          </p>
        </motion.div>
      )}

      {showAccountPrompt && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.75 }}
          className="rounded-2xl p-5 mb-5 text-left"
          style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)' }}
        >
          <p className="text-sm font-bold mb-1" style={{ color: '#D4AF37' }}>🙏 Track your giving</p>
          <p className="text-xs mb-4" style={{ color: 'rgba(255,248,220,0.6)' }}>
            Save your details to see all your donations, Gift Aid and monthly
            support in one place. Optional — takes a moment.
          </p>
          <div className="flex gap-2">
            <button onClick={createAccount}
              className="flex-1 py-2.5 rounded-xl font-black text-sm active:scale-[0.99]"
              style={{ background: 'linear-gradient(135deg,#D4AF37,#C5A028)', color: '#3B0000' }}>
              Create free account
            </button>
            <button onClick={() => setPromptDismissed(true)}
              className="px-4 py-2.5 rounded-xl font-bold text-sm"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.6)', border: '1px solid rgba(255,255,255,0.12)' }}>
              No thanks
            </button>
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9 }}
        className="space-y-3"
      >
        <button onClick={reset} className="btn-gold">
          Make Another Offering
        </button>

        {!showAccountPrompt && (
          <p className="text-xs" style={{ color: 'rgba(255,248,220,0.25)' }}>
            This page will refresh automatically in {countdown}s
          </p>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.1 }}
        className="mt-8 space-y-1"
      >
        <p className="font-display text-xs" style={{ color: 'rgba(212,175,55,0.3)' }}>
          🕉 Shri Shirdi Saibaba Temple · SHITAL · UK Registered Charity
        </p>
        <p className="text-xs" style={{ color: 'rgba(255,248,220,0.2)' }}>
          By donating you agreed to our{' '}
          <a href="https://shital.org.uk/terms" target="_blank" rel="noopener noreferrer"
            style={{ color: 'rgba(212,175,55,0.4)', textDecoration: 'underline' }}>
            Terms &amp; Conditions
          </a>
          {' '}and{' '}
          <a href="https://shital.org.uk/privacy" target="_blank" rel="noopener noreferrer"
            style={{ color: 'rgba(212,175,55,0.4)', textDecoration: 'underline' }}>
            Privacy Policy
          </a>
        </p>
      </motion.div>
    </div>
  )
}
