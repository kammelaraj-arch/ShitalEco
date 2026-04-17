import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useKioskStore, t } from '../store/kiosk.store'
import { cachedFetch } from '../utils/cachedFetch'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

interface Service {
  id: string
  name: string
  name_gu: string | null
  name_hi: string | null
  description: string | null
  category: string
  price: number
  currency: string
  duration: number | null
  capacity: number | null
}

const CATEGORY_COLORS: Record<string, string> = {
  PUJA:      'from-orange-600 to-amber-500',
  HAVAN:     'from-red-600 to-orange-500',
  CLASS:     'from-green-600 to-emerald-500',
  HALL_HIRE: 'from-purple-600 to-violet-500',
  FESTIVAL:  'from-pink-600 to-rose-500',
  OTHER:     'from-blue-600 to-cyan-500',
}

const CATEGORY_ICONS: Record<string, string> = {
  PUJA: '🪔', HAVAN: '🔥', CLASS: '📚', HALL_HIRE: '🏛️', FESTIVAL: '🎉', OTHER: '✨',
}

export function ServicesScreen() {
  const { language, setScreen, addItem, items } = useKioskStore()
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [added, setAdded] = useState<string | null>(null)
  const itemCount = items.reduce((s, i) => s + i.quantity, 0)
  const total = items.reduce((s, i) => s + i.totalPrice, 0)

  useEffect(() => {
    cachedFetch<{ services: Service[] }>(`${API_BASE}/kiosk/services`)
      .then((d) => { setServices(d.services || []); setLoading(false) })
      .catch(() => { setServices(MOCK_SERVICES); setLoading(false) })
  }, [])

  const categories = ['ALL', ...Array.from(new Set(services.map((s) => s.category)))]

  const filtered = selectedCategory === 'ALL'
    ? services
    : services.filter((s) => s.category === selectedCategory)

  const getServiceName = (s: Service) => {
    if (language === 'gu' && s.name_gu) return s.name_gu
    if (language === 'hi' && s.name_hi) return s.name_hi
    return s.name
  }

  const handleAdd = (service: Service) => {
    addItem({
      type: 'SERVICE',
      name: service.name,
      quantity: 1,
      unitPrice: service.price,
      totalPrice: service.price,
      referenceId: service.id,
    })
    setAdded(service.id)
    setTimeout(() => setAdded(null), 1500)
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="px-10 pt-8 pb-3"
      >
        <div className="flex items-center justify-between">
          <div>
            <button onClick={() => setScreen('home')} className="text-saffron-400/60 text-lg mb-2 block">← Back</button>
            <h1 className="text-4xl font-black text-gold-gradient">{t('services', language)}</h1>
          </div>
          {itemCount > 0 && (
            <button onClick={() => setScreen('basket')}
              className="glass-card rounded-3xl px-5 py-3 flex items-center gap-2 ripple">
              <span className="text-2xl">🛒</span>
              <span className="text-white font-bold">{itemCount} · £{total.toFixed(2)}</span>
            </button>
          )}
        </div>
      </motion.div>

      {/* Category filter pills */}
      <div className="px-10 pb-4 flex gap-3 overflow-x-auto kiosk-scroll flex-shrink-0">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`
              flex-shrink-0 flex items-center gap-2 px-5 py-3 rounded-2xl font-semibold text-lg transition-all ripple
              ${selectedCategory === cat
                ? 'bg-saffron-gradient text-white shadow-lg'
                : 'glass-card text-saffron-300 border-saffron-400/20'}
            `}
          >
            {cat !== 'ALL' && <span>{CATEGORY_ICONS[cat] || '✨'}</span>}
            {cat === 'ALL' ? 'All Services' : t(cat.toLowerCase().replace('_', '_'), language)}
          </button>
        ))}
      </div>

      {/* Services grid */}
      <div className="flex-1 px-10 kiosk-scroll pb-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="text-6xl"
            >
              🕉️
            </motion.div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5">
            {filtered.map((service, i) => (
              <motion.div
                key={service.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className={`
                  relative overflow-hidden rounded-4xl service-card
                  bg-gradient-to-br ${CATEGORY_COLORS[service.category] || CATEGORY_COLORS.OTHER}
                  shadow-xl p-7 flex flex-col justify-between min-h-[200px]
                `}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-white/15 to-transparent pointer-events-none" />

                <div>
                  <div className="text-5xl mb-3">{CATEGORY_ICONS[service.category] || '✨'}</div>
                  <h3 className="text-white font-black text-2xl leading-tight mb-1">
                    {getServiceName(service)}
                  </h3>
                  {service.description && (
                    <p className="text-white/70 text-sm line-clamp-2">{service.description}</p>
                  )}
                  {service.duration && (
                    <p className="text-white/50 text-sm mt-1">⏱ {service.duration} min</p>
                  )}
                </div>

                <div className="flex items-center justify-between mt-4">
                  <div>
                    <p className="text-white/60 text-sm">Price</p>
                    <p className="text-white font-black text-2xl">
                      {service.price === 0 ? t('free', language) : `£${service.price}`}
                    </p>
                  </div>
                  <motion.button
                    onClick={() => handleAdd(service)}
                    whileTap={{ scale: 0.9 }}
                    className={`
                      px-6 py-3 rounded-2xl font-black text-lg transition-all ripple
                      ${added === service.id
                        ? 'bg-green-500 text-white'
                        : 'bg-white text-gray-900 shadow-lg'}
                    `}
                  >
                    {added === service.id ? '✓ Added!' : '+ Add'}
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      {itemCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-10 pb-8"
        >
          <button
            onClick={() => setScreen('basket')}
            className="w-full bg-saffron-gradient py-6 rounded-4xl font-black text-2xl text-white shadow-2xl pay-btn-pulse ripple"
          >
            View Basket — {itemCount} item{itemCount !== 1 ? 's' : ''} · £{total.toFixed(2)}
          </button>
        </motion.div>
      )}
    </div>
  )
}

// Mock data for when API is unavailable
const MOCK_SERVICES: Service[] = [
  { id: '1', name: 'Morning Puja', name_gu: 'સવારની પૂજા', name_hi: 'सुबह की पूजा', description: 'Daily morning worship ceremony', category: 'PUJA', price: 21, currency: 'GBP', duration: 45, capacity: 20 },
  { id: '2', name: 'Satyanarayan Puja', name_gu: 'સત્યનારાયણ પૂજા', name_hi: 'सत्यनारायण पूजा', description: 'Special blessing ceremony', category: 'PUJA', price: 51, currency: 'GBP', duration: 90, capacity: 10 },
  { id: '3', name: 'Havan Ceremony', name_gu: 'હવન', name_hi: 'हवन', description: 'Sacred fire ritual', category: 'HAVAN', price: 101, currency: 'GBP', duration: 120, capacity: 15 },
  { id: '4', name: 'Yoga Class', name_gu: 'યોગ', name_hi: 'योग', description: 'Weekly yoga session', category: 'CLASS', price: 8, currency: 'GBP', duration: 60, capacity: 20 },
  { id: '5', name: 'Hall Hire (Half Day)', name_gu: 'હૉલ ભાડે', name_hi: 'हॉल किराया', description: 'Community hall for 4 hours', category: 'HALL_HIRE', price: 150, currency: 'GBP', duration: 240, capacity: 100 },
  { id: '6', name: 'Navratri Event', name_gu: 'નવરાત્રી', name_hi: 'नवरात्री', description: 'Nine nights of celebration', category: 'FESTIVAL', price: 15, currency: 'GBP', duration: 180, capacity: 200 },
]
