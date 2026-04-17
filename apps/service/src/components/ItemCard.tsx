import { motion } from 'framer-motion'
import { useStore, type Language } from '../store'

interface Item {
  id: string
  name: string
  name_gu?: string
  name_hi?: string
  name_te?: string
  name_ta?: string
  name_pa?: string
  name_mr?: string
  name_bn?: string
  name_kn?: string
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

interface ItemCardProps {
  item: Item
  category?: string
}

export function ItemCard({ item, category }: ItemCardProps) {
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
      whileHover={{ y: -2 }}
      className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 flex flex-col"
    >
      {/* Image / Emoji */}
      <div className="relative aspect-[4/3] bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center overflow-hidden">
        {item.image_url && !item.image_url.startsWith('data:') ? (
          <img src={item.image_url} alt={displayName} className="w-full h-full object-cover" />
        ) : (
          <span className="text-5xl">{item.emoji || '🕉'}</span>
        )}
        {item.gift_aid_eligible && (
          <span className="absolute top-2 left-2 bg-green-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide">
            Gift Aid
          </span>
        )}
        {outOfStock && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <span className="text-sm font-bold text-gray-500">Out of Stock</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col flex-1 gap-1.5">
        <p className="font-bold text-gray-900 text-sm leading-snug line-clamp-2">{displayName}</p>
        {item.description && (
          <p className="text-xs text-gray-400 leading-snug line-clamp-2">{item.description}</p>
        )}

        <div className="mt-auto pt-2 flex items-center justify-between gap-2">
          <div>
            <span className="font-black text-base text-gray-900">£{item.price.toFixed(2)}</span>
            {item.unit && <span className="text-xs text-gray-400 ml-1">{item.unit}</span>}
          </div>

          {inBasket ? (
            <span className="text-xs font-bold text-green-600 bg-green-50 px-2.5 py-1.5 rounded-xl">
              ✓ In Basket ({inBasket.quantity})
            </span>
          ) : (
            <button
              onClick={handleAdd}
              disabled={outOfStock}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-white text-xs font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: outOfStock ? '#ccc' : 'linear-gradient(135deg,#FF9933,#FF6600)' }}
            >
              <span>Add</span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
