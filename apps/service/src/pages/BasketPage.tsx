import { motion, AnimatePresence } from 'framer-motion'
import { useStore, t, type GiftAidDeclaration } from '../store'

const DECLINED: GiftAidDeclaration = { agreed: false, fullName: '', postcode: '', address: '', contactEmail: '', contactPhone: '' }

export function BasketPage() {
  const { language, items, removeItem, updateQty, total, giftAidTotal, setScreen, clearBasket, setGiftAidDeclaration } = useStore()

  if (items.length === 0) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-7xl mb-5"
        >🛒</motion.div>
        <h2 className="font-display font-bold text-xl text-gold-400 mb-2">Your basket is empty</h2>
        <p className="text-sm mb-8" style={{ color: 'rgba(255,248,220,0.45)' }}>
          Add offerings from the catalogue to get started
        </p>
        <button
          onClick={() => setScreen('browse')}
          className="btn-saffron"
          style={{ width: 'auto', padding: '0.875rem 2rem', display: 'inline-block' }}
        >
          Browse Items
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-5 pb-32">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-display font-bold text-xl text-gold-400">{t('basket', language)}</h1>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(255,248,220,0.45)' }}>
            {items.length} {t('items', language)}
          </p>
        </div>
        <button
          onClick={() => { clearBasket(); setScreen('browse') }}
          className="text-xs font-semibold transition-colors"
          style={{ color: 'rgba(198,40,40,0.7)' }}
        >
          Clear all
        </button>
      </div>

      {/* Items */}
      <div className="space-y-3 mb-5">
        <AnimatePresence mode="popLayout">
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20, height: 0 }}
              className="temple-card p-4 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <p className="font-bold text-ivory-200 text-sm leading-snug truncate">{item.name}</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,248,220,0.4)' }}>
                  £{item.unitPrice.toFixed(2)} each
                  {item.giftAidEligible && (
                    <span className="ml-2" style={{ color: '#4ade80' }}>· Gift Aid ✓</span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => updateQty(item.id, item.quantity - 1)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm transition-colors"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.6)' }}
                >−</button>
                <span className="w-6 text-center font-bold text-ivory-200 text-sm">{item.quantity}</span>
                <button
                  onClick={() => updateQty(item.id, item.quantity + 1)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm transition-colors"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,248,220,0.6)' }}
                >+</button>
              </div>

              <p className="font-black text-gold-400 text-base w-16 text-right flex-shrink-0 price-display">
                £{item.totalPrice.toFixed(2)}
              </p>

              <button
                onClick={() => removeItem(item.id)}
                className="transition-colors ml-1"
                style={{ color: 'rgba(255,248,220,0.2)' }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Summary Card */}
      <div className="temple-card p-5 mb-5 space-y-3">
        <div className="flex justify-between text-sm">
          <span style={{ color: 'rgba(255,248,220,0.5)' }}>Subtotal</span>
          <span className="font-semibold text-ivory-200 price-display">£{total.toFixed(2)}</span>
        </div>
        {giftAidTotal > 0 && (
          <div className="flex justify-between text-sm" style={{ color: '#4ade80' }}>
            <span>🇬🇧 Gift Aid boost (HMRC +25%)</span>
            <span className="font-bold price-display">+£{(giftAidTotal * 0.25).toFixed(2)}</span>
          </div>
        )}
        <div className="pt-3 flex justify-between" style={{ borderTop: '1px dashed rgba(212,175,55,0.2)' }}>
          <span className="font-bold text-ivory-200">Total you pay</span>
          <span className="font-black text-xl text-gold-400 price-display">£{total.toFixed(2)}</span>
        </div>
        {giftAidTotal > 0 && (
          <div className="rounded-xl px-3 py-2 text-xs"
            style={{ background: 'rgba(22,163,74,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}>
            🎁 HMRC adds <strong>£{(giftAidTotal * 0.25).toFixed(2)}</strong> to your donation at no extra cost.
          </div>
        )}
      </div>

      {/* PayPal note */}
      <div className="temple-card px-4 py-3 mb-5 flex items-center gap-3">
        <span className="text-2xl">🔒</span>
        <div>
          <p className="text-sm font-semibold text-gold-400">Secure PayPal Checkout</p>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(255,248,220,0.45)' }}>
            Pay safely with your PayPal account or card. Your details are never stored.
          </p>
        </div>
      </div>

      {/* Actions — Gift Aid two-button pattern */}
      <div className="space-y-3">
        {giftAidTotal > 0 ? (
          <>
            <button
              onClick={() => { setGiftAidDeclaration(null); setScreen('contact') }}
              className="w-full py-4 rounded-2xl font-black text-base active:scale-[0.99] transition-transform"
              style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', color: '#fff', boxShadow: '0 4px 20px rgba(22,163,74,0.35)' }}
            >
              <div className="flex flex-col items-center leading-tight gap-0.5">
                <span className="text-sm font-bold opacity-90">🇬🇧 Boost with Gift Aid — +£{(giftAidTotal * 0.25).toFixed(2)} FREE</span>
                <span className="text-lg font-black">Temple receives £{(total + giftAidTotal * 0.25).toFixed(2)}</span>
              </div>
            </button>
            <button
              onClick={() => { setGiftAidDeclaration(DECLINED); setScreen('contact') }}
              className="btn-ghost"
            >
              Without Gift Aid · Pay £{total.toFixed(2)}
            </button>
          </>
        ) : (
          <button onClick={() => setScreen('contact')} className="btn-gold">
            Continue to Checkout →
          </button>
        )}
        <button
          onClick={() => setScreen('browse')}
          className="w-full py-3 text-sm font-medium transition-colors"
          style={{ color: 'rgba(255,248,220,0.35)' }}
        >
          ← Continue Shopping
        </button>
      </div>
    </div>
  )
}
