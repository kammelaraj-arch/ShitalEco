import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'

export function ConfirmationPage() {
  const { orderResult, contactInfo, giftAidDeclaration, total, giftAidTotal, items, reset } = useStore()
  const [countdown, setCountdown] = useState(60)

  const boost = giftAidTotal * 0.25
  const templeReceives = total + (giftAidDeclaration?.agreed ? boost : 0)

  useEffect(() => {
    if (countdown <= 0) { reset(); return }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  return (
    <div className="max-w-lg mx-auto px-4 py-10 text-center">
      {/* Animated success */}
      <motion.div
        initial={{ scale: 0, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="text-8xl mb-4 inline-block"
      >
        🕉
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <h1 className="text-2xl font-black text-gray-900 mb-2">Jay Shri Krishna! 🙏</h1>
        <p className="text-gray-500 mb-6">
          {contactInfo?.name ? `Thank you, ${contactInfo.name.split(' ')[0]}!` : 'Thank you for your kind donation!'}
        </p>
      </motion.div>

      {/* Receipt card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="bg-white rounded-2xl p-5 text-left shadow-sm border border-gray-100 mb-6 space-y-3"
      >
        {orderResult?.order_ref && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Reference</span>
            <span className="font-black text-gray-900">{orderResult.order_ref}</span>
          </div>
        )}

        {items.map((item) => (
          <div key={item.id} className="flex justify-between text-sm text-gray-600">
            <span className="truncate mr-2">{item.name} × {item.quantity}</span>
            <span className="font-semibold">£{item.totalPrice.toFixed(2)}</span>
          </div>
        ))}

        <div className="border-t border-dashed border-gray-100 pt-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">You paid</span>
            <span className="font-bold text-gray-900">£{total.toFixed(2)}</span>
          </div>
          {giftAidDeclaration?.agreed && boost > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>Gift Aid (HMRC adds)</span>
              <span className="font-bold">+£{boost.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold">
            <span className="text-gray-900">Temple receives</span>
            <span className="text-green-700 text-base">£{templeReceives.toFixed(2)}</span>
          </div>
        </div>

        {contactInfo?.email && (
          <div className="bg-blue-50 rounded-xl px-3 py-2 text-xs text-blue-700 flex items-center gap-2">
            <span>📧</span>
            <span>Receipt sent to <strong>{contactInfo.email}</strong></span>
          </div>
        )}
      </motion.div>

      {giftAidDeclaration?.agreed && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="bg-green-50 rounded-2xl p-4 mb-6 text-left"
        >
          <p className="text-sm font-bold text-green-800 mb-1">🇬🇧 Gift Aid Confirmed</p>
          <p className="text-xs text-green-600">
            Your declaration has been recorded. HMRC will add £{boost.toFixed(2)} to your donation.
          </p>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9 }}
        className="space-y-3"
      >
        <button
          onClick={reset}
          className="w-full py-4 rounded-2xl text-white font-black text-base shadow-lg"
          style={{ background: 'linear-gradient(135deg,#FF9933,#FF6600)' }}
        >
          Make Another Donation
        </button>

        <p className="text-xs text-gray-400">
          This page will refresh automatically in {countdown}s
        </p>
      </motion.div>

      {/* Footer note */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.1 }}
        className="text-xs text-gray-400 mt-8"
      >
        Shital Shirdi Sai Baba Temple · Registered Charity · London, UK
      </motion.p>
    </div>
  )
}
