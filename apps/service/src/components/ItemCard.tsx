import { motion } from 'framer-motion'
import { useStore, type Language } from '../store'

interface Item {
  id: string
  name: string
  name_gu?: string; name_hi?: string; name_te?: string; name_ta?: string
  name_pa?: string; name_mr?: string; name_bn?: string; name_kn?: string
  description?: string
  price: number
  emoji?: string
  image_url?: string
  gift_aid_eligible?: boolean
  category?: string
  unit?: string
  stock_qty?: number | null
}

function getLocalName(item: Item, lang: Language): string {
  const map: Record<string, string | undefined> = {
    gu: item.name_gu, hi: item.name_hi, te: item.name_te,
    ta: item.name_ta, pa: item.name_pa, mr: item.name_mr,
    bn: item.name_bn, kn: item.name_kn,
  }
  return (lang !== 'en' && map[lang]) ? map[lang]! : item.name
}

export function ItemCard({ item, category }: { item: Item; category?: string }) {
  const { language, addItem, items } = useStore()
  const displayName = getLocalName(item, language)

  const inBasket = items.find(
    (i) => i.referenceId === item.id || i.referenceId === String(item.id)
  )

  function handleAdd() {
    addItem({
      type: 'DONATION',
      name: item.name,
      nameGu: item.name_gu,
      nameHi: item.name_hi,
      nameTe: item.name_te,
      quantity: 1,
      unitPrice: item.price,
      totalPrice: item.price,
      referenceId: String(item.id),
      giftAidEligible: item.gift_aid_eligible ?? false,
      category,
    })
  }

  const outOfStock = item.stock_qty !== null && item.stock_qty !== undefined && item.stock_qty <= 0

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, boxShadow: '0 0 0 2px #D4AF37, 0 16px 40px rgba(212,175,55,0.35), inset 2px 2px 6px rgba(255,235,180,0.35)' }}
      className="overflow-hidden flex flex-col"
      style={{
        background: 'linear-gradient(160deg, #E8D4A8 0%, #D4B880 40%, #C8A860 100%)',
        border: '2px solid #D4AF37',
        borderRadius: '1.25rem',
        boxShadow: '0 0 0 1px rgba(212,175,55,0.3), inset 2px 2px 6px rgba(255,240,180,0.4), inset -1px -1px 4px rgba(100,65,10,0.25), 0 8px 24px rgba(0,0,0,0.35)',
        transition: 'all 0.25s ease',
      }}
    >
      {/* Arch image niche */}
      <div className="relative mx-2 mt-2 overflow-hidden flex items-center justify-center"
        style={{
          aspectRatio: '1 / 1',
          borderRadius: '50% 50% 0 0 / 38% 38% 0 0',
          background: 'linear-gradient(180deg, rgba(255,240,180,0.6) 0%, rgba(200,160,70,0.3) 100%)',
          boxShadow: 'inset 0 4px 12px rgba(100,65,10,0.2), inset 0 -2px 6px rgba(255,240,180,0.3)',
          border: '1.5px solid rgba(212,175,55,0.5)',
          borderBottom: 'none',
        }}>
        {item.image_url && !item.image_url.startsWith('data:') ? (
          <img src={item.image_url} alt={displayName} className="w-full h-full object-cover" />
        ) : (
          <span className="text-5xl" style={{ filter: 'drop-shadow(0 2px 4px rgba(100,65,10,0.3))' }}>
            {item.emoji || '🕉'}
          </span>
        )}
        {item.gift_aid_eligible && (
          <span className="badge-ga absolute top-2 left-2">Gift Aid</span>
        )}
        {outOfStock && (
          <div className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'rgba(180,120,40,0.75)', borderRadius: 'inherit' }}>
            <span className="text-xs font-bold" style={{ color: 'rgba(255,248,220,0.8)' }}>Out of Stock</span>
          </div>
        )}
      </div>

      {/* Decorative arch base — gold divider with bell */}
      <div className="flex items-center justify-center gap-1.5 py-1 px-4">
        <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(180,130,30,0.5))' }} />
        <span className="text-[10px]" style={{ color: 'rgba(140,90,10,0.6)' }}>🔔</span>
        <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(180,130,30,0.5), transparent)' }} />
      </div>

      {/* Info */}
      <div className="px-3 pb-3 flex flex-col flex-1 gap-1">
        <p className="font-bold text-sm leading-snug line-clamp-2 text-center"
          style={{ color: '#3D1A00', textShadow: '0 1px 0 rgba(255,240,180,0.6)' }}>
          {displayName}
        </p>
        {item.description && (
          <p className="text-xs leading-snug line-clamp-1 text-center"
            style={{ color: 'rgba(80,40,5,0.65)' }}>
            {item.description}
          </p>
        )}

        <div className="mt-auto pt-2 flex items-center justify-between gap-2">
          <div>
            <span className="font-black text-base price-display"
              style={{ color: '#7A4A00', textShadow: '0 1px 0 rgba(255,240,180,0.5)' }}>
              £{item.price.toFixed(2)}
            </span>
            {item.unit && (
              <span className="text-xs ml-1" style={{ color: 'rgba(80,40,5,0.5)' }}>{item.unit}</span>
            )}
          </div>

          {inBasket ? (
            <span className="text-xs font-bold px-2.5 py-1.5 rounded-xl"
              style={{ background: 'rgba(22,163,74,0.2)', color: '#15803d', border: '1px solid rgba(22,163,74,0.3)' }}>
              ✓ {inBasket.quantity}
            </span>
          ) : (
            <button
              onClick={handleAdd}
              disabled={outOfStock}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-black transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: outOfStock
                  ? 'rgba(0,0,0,0.1)'
                  : 'linear-gradient(135deg,#D4AF37,#C5A028)',
                color: outOfStock ? 'rgba(80,40,5,0.3)' : '#3D1A00',
                border: '1px solid rgba(212,175,55,0.6)',
                boxShadow: outOfStock ? 'none' : '0 2px 8px rgba(212,175,55,0.3)',
              }}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
              </svg>
              <span>Add</span>
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
