import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, t } from '../store/kiosk.store'

export function BasketScreen() {
  const { language, setScreen, items, removeItem, updateQuantity } = useKioskStore()
  const total = items.reduce((s, i) => s + i.totalPrice, 0)

  return (
    <div className="w-full h-full flex flex-col">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="px-10 pt-8 pb-4 flex items-center justify-between"
      >
        <div>
          <button onClick={() => setScreen('home')} className="text-saffron-400/60 text-lg mb-2 block">← Continue Shopping</button>
          <h1 className="text-4xl font-black text-gold-gradient">{t('basket', language)}</h1>
        </div>
        <span className="text-4xl">🛒</span>
      </motion.div>

      <div className="flex-1 px-10 kiosk-scroll">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <span className="text-7xl">🛒</span>
            <p className="text-white/50 text-2xl font-semibold">Your basket is empty</p>
            <button onClick={() => setScreen('home')}
              className="mt-4 bg-saffron-gradient text-white font-bold text-xl px-10 py-4 rounded-3xl ripple">
              Browse Services
            </button>
          </div>
        ) : (
          <AnimatePresence>
            {items.map((item) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="glass-card rounded-3xl p-6 mb-4 flex items-center gap-5"
              >
                <div className="text-4xl">{item.type === 'DONATION' ? '🙏' : '✨'}</div>
                <div className="flex-1">
                  <p className="text-white font-bold text-xl leading-tight">{item.name}</p>
                  <p className="text-saffron-400/60 text-base">£{item.unitPrice.toFixed(2)} each</p>
                </div>
                {/* Quantity control */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => updateQuantity(item.id, item.quantity - 1)}
                    className="w-12 h-12 rounded-2xl glass-card text-white text-2xl font-bold flex items-center justify-center ripple"
                  >
                    −
                  </button>
                  <span className="text-white font-black text-2xl w-8 text-center">{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.id, item.quantity + 1)}
                    className="w-12 h-12 rounded-2xl glass-card text-white text-2xl font-bold flex items-center justify-center ripple"
                  >
                    +
                  </button>
                </div>
                <div className="text-right min-w-[80px]">
                  <p className="text-white font-black text-2xl">£{item.totalPrice.toFixed(2)}</p>
                </div>
                <button onClick={() => removeItem(item.id)}
                  className="w-12 h-12 rounded-2xl bg-red-500/20 text-red-400 text-xl flex items-center justify-center ripple ml-2">
                  ✕
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Order summary + checkout */}
      {items.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-10 pb-8"
        >
          {/* Summary */}
          <div className="glass-card rounded-3xl p-6 mb-5">
            <div className="flex justify-between items-center mb-3">
              <span className="text-white/60 text-lg">Subtotal ({items.length} items)</span>
              <span className="text-white font-bold text-xl">£{total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center mb-3">
              <span className="text-green-400 text-lg">Gift Aid (if eligible)</span>
              <span className="text-green-400 font-bold text-xl">+£{(total * 0.25).toFixed(2)}</span>
            </div>
            <div className="border-t border-white/10 pt-3 flex justify-between items-center">
              <span className="text-white font-bold text-xl">{t('total', language)}</span>
              <span className="text-white font-black text-3xl">£{total.toFixed(2)}</span>
            </div>
          </div>

          <button
            onClick={() => setScreen('checkout')}
            className="w-full bg-saffron-gradient py-7 rounded-4xl font-black text-3xl text-white shadow-2xl pay-btn-pulse ripple"
          >
            {t('checkout', language)} · £{total.toFixed(2)} →
          </button>
        </motion.div>
      )}
    </div>
  )
}
