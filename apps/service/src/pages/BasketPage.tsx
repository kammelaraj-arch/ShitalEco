import { motion, AnimatePresence } from 'framer-motion'
import { useStore, t } from '../store'

export function BasketPage() {
  const { language, items, removeItem, updateQty, total, giftAidTotal, setScreen, clearBasket } = useStore()

  if (items.length === 0) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 text-center">
        <div className="text-7xl mb-4">🛒</div>
        <h2 className="text-xl font-black text-gray-900 mb-2">Your basket is empty</h2>
        <p className="text-gray-400 mb-6">Add items from the catalogue to get started</p>
        <button
          onClick={() => setScreen('browse')}
          className="px-6 py-3 rounded-2xl text-white font-bold"
          style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)' }}
        >
          Browse Items
        </button>
      </div>
    )
  }

  const boostAmount = giftAidTotal * 0.25

  return (
    <div className="max-w-2xl mx-auto px-4 py-5 pb-32">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-black text-gray-900">{t('basket', language)}</h1>
          <p className="text-sm text-gray-400">{items.length} {t('items', language)}</p>
        </div>
        <button
          onClick={() => { clearBasket(); setScreen('browse') }}
          className="text-sm text-red-400 hover:text-red-600 font-medium"
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
              className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 text-sm leading-snug truncate">{item.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  £{item.unitPrice.toFixed(2)} each
                  {item.giftAidEligible && (
                    <span className="ml-2 text-green-600 font-semibold">· Gift Aid ✓</span>
                  )}
                </p>
              </div>

              {/* Quantity controls */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => updateQty(item.id, item.quantity - 1)}
                  className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-red-50 hover:text-red-500 flex items-center justify-center font-bold text-gray-600 transition-colors"
                >−</button>
                <span className="w-6 text-center font-bold text-gray-900 text-sm">{item.quantity}</span>
                <button
                  onClick={() => updateQty(item.id, item.quantity + 1)}
                  className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-green-50 hover:text-green-600 flex items-center justify-center font-bold text-gray-600 transition-colors"
                >+</button>
              </div>

              <p className="font-black text-gray-900 text-base w-16 text-right flex-shrink-0">
                £{item.totalPrice.toFixed(2)}
              </p>

              <button
                onClick={() => removeItem(item.id)}
                className="text-gray-300 hover:text-red-400 transition-colors ml-1"
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
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-5 space-y-3">
        <div className="flex justify-between text-sm text-gray-500">
          <span>Subtotal</span>
          <span className="font-semibold text-gray-700">£{total.toFixed(2)}</span>
        </div>
        {giftAidTotal > 0 && (
          <div className="flex justify-between text-sm text-green-600">
            <span>Gift Aid boost (HMRC +25%)</span>
            <span className="font-bold">+£{boostAmount.toFixed(2)}</span>
          </div>
        )}
        <div className="border-t border-dashed border-gray-100 pt-3 flex justify-between">
          <span className="font-bold text-gray-900">Total you pay</span>
          <span className="font-black text-xl text-gray-900">£{total.toFixed(2)}</span>
        </div>
        {giftAidTotal > 0 && (
          <div className="bg-green-50 rounded-xl px-3 py-2 text-xs text-green-700">
            🎁 HMRC will add <strong>£{boostAmount.toFixed(2)}</strong> to your donation at no extra cost to you.
          </div>
        )}
      </div>

      {/* PayPal note */}
      <div className="bg-blue-50 rounded-xl px-4 py-3 mb-5 flex items-center gap-3">
        <span className="text-2xl">🔒</span>
        <div>
          <p className="text-sm font-semibold text-blue-800">Secure PayPal Checkout</p>
          <p className="text-xs text-blue-600">Pay safely with your PayPal account or card. Your details are never stored.</p>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <button
          onClick={() => setScreen('contact')}
          className="w-full py-4 rounded-2xl text-white font-black text-base shadow-lg active:scale-[0.99] transition-transform"
          style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)' }}
        >
          Continue to Checkout →
        </button>
        <button
          onClick={() => setScreen('browse')}
          className="w-full py-3.5 rounded-2xl border-2 border-gray-200 text-gray-600 font-bold text-sm hover:bg-gray-50"
        >
          ← Continue Shopping
        </button>
      </div>
    </div>
  )
}
