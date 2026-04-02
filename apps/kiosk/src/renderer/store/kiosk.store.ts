import { create } from 'zustand'

export type KioskScreen =
  | 'idle'
  | 'language'
  | 'home'
  | 'services'
  | 'service-detail'
  | 'donate'
  | 'basket'
  | 'checkout'
  | 'payment'
  | 'confirmation'
  | 'admin-pin'

export type Language = 'en' | 'gu' | 'hi'

export interface BasketItem {
  id: string
  type: 'SERVICE' | 'DONATION'
  name: string
  nameGu?: string
  nameHi?: string
  quantity: number
  unitPrice: number
  totalPrice: number
  referenceId?: string
}

interface KioskState {
  screen: KioskScreen
  language: Language
  basketId: string | null
  items: BasketItem[]
  orderId: string | null
  orderRef: string | null
  paymentIntent: Record<string, unknown> | null
  idleTimer: number
  branchId: string

  setScreen: (screen: KioskScreen) => void
  setLanguage: (lang: Language) => void
  setBasketId: (id: string) => void
  addItem: (item: Omit<BasketItem, 'id'>) => void
  removeItem: (id: string) => void
  updateQuantity: (id: string, qty: number) => void
  clearBasket: () => void
  setOrderResult: (orderId: string, ref: string, payment: Record<string, unknown>) => void
  resetKiosk: () => void
  get total(): number
  get itemCount(): number
}

export const useKioskStore = create<KioskState>((set, get) => ({
  screen: 'idle',
  language: 'en',
  basketId: null,
  items: [],
  orderId: null,
  orderRef: null,
  paymentIntent: null,
  idleTimer: 120,
  branchId: 'main',

  setScreen: (screen) => set({ screen }),
  setLanguage: (language) => set({ language }),
  setBasketId: (basketId) => set({ basketId }),

  addItem: (item) => set((state) => {
    const existing = state.items.find(
      (i) => i.referenceId === item.referenceId && i.type === item.type
    )
    if (existing) {
      return {
        items: state.items.map((i) =>
          i.id === existing.id
            ? { ...i, quantity: i.quantity + item.quantity, totalPrice: (i.quantity + item.quantity) * i.unitPrice }
            : i
        ),
      }
    }
    return {
      items: [...state.items, { ...item, id: crypto.randomUUID() }],
    }
  }),

  removeItem: (id) => set((state) => ({ items: state.items.filter((i) => i.id !== id) })),

  updateQuantity: (id, qty) => set((state) => ({
    items: qty <= 0
      ? state.items.filter((i) => i.id !== id)
      : state.items.map((i) => i.id === id ? { ...i, quantity: qty, totalPrice: qty * i.unitPrice } : i),
  })),

  clearBasket: () => set({ items: [], basketId: null }),

  setOrderResult: (orderId, orderRef, paymentIntent) => set({ orderId, orderRef, paymentIntent }),

  resetKiosk: () => set({
    screen: 'idle',
    items: [],
    basketId: null,
    orderId: null,
    orderRef: null,
    paymentIntent: null,
  }),

  get total() {
    return get().items.reduce((sum, i) => sum + i.totalPrice, 0)
  },

  get itemCount() {
    return get().items.reduce((sum, i) => sum + i.quantity, 0)
  },
}))

// Translation helper
export const t = (key: string, lang: Language): string => {
  return TRANSLATIONS[key]?.[lang] ?? TRANSLATIONS[key]?.en ?? key
}

const TRANSLATIONS: Record<string, Record<Language, string>> = {
  'touch_to_start': { en: 'Touch to Begin', gu: 'શરૂ કરવા સ્પર્શ કરો', hi: 'शुरू करने के लिए छुएं' },
  'welcome': { en: 'Welcome', gu: 'સ્વાગત છે', hi: 'स्वागत है' },
  'choose_language': { en: 'Choose Language', gu: 'ભાષા પસંદ કરો', hi: 'भाषा चुनें' },
  'home': { en: 'Home', gu: 'ઘર', hi: 'होम' },
  'services': { en: 'Temple Services', gu: 'મંદિર સેવાઓ', hi: 'मंदिर सेवाएं' },
  'donate': { en: 'Make a Donation', gu: 'દાન કરો', hi: 'दान करें' },
  'basket': { en: 'My Basket', gu: 'મારી ટોપલી', hi: 'मेरी टोकरी' },
  'checkout': { en: 'Checkout', gu: 'ચૂકવો', hi: 'चेकआउट' },
  'total': { en: 'Total', gu: 'કુલ', hi: 'कुल' },
  'add_to_basket': { en: 'Add to Basket', gu: 'ટોપલીમાં ઉમેરો', hi: 'टोकरी में जोड़ें' },
  'pay_now': { en: 'Pay Now', gu: 'હમણાં ચૂકવો', hi: 'अभी भुगतान करें' },
  'thank_you': { en: 'Thank You', gu: 'આભાર', hi: 'धन्यवाद' },
  'cancel': { en: 'Cancel', gu: 'રદ કરો', hi: 'रद्द करें' },
  'back': { en: 'Back', gu: 'પાછળ', hi: 'वापस' },
  'puja': { en: 'Puja', gu: 'પૂજા', hi: 'पूजा' },
  'havan': { en: 'Havan', gu: 'હવન', hi: 'हवन' },
  'donation': { en: 'Donation', gu: 'દાન', hi: 'दान' },
  'classes': { en: 'Classes', gu: 'વર્ગ', hi: 'कक्षा' },
  'hall_hire': { en: 'Hall Hire', gu: 'હૉલ ભાડે', hi: 'हॉल किराया' },
  'festival': { en: 'Festival', gu: 'ઉત્સવ', hi: 'उत्सव' },
  'your_order': { en: 'Your Order', gu: 'તમારો ઓર્ડર', hi: 'आपका ऑर्डर' },
  'order_confirmed': { en: 'Order Confirmed!', gu: 'ઓર્ડર પુષ્ટ!', hi: 'ऑर्डर पुष्टि!' },
  'gift_aid': { en: 'Gift Aid (25% extra)', gu: 'ગિફ્ટ એઇડ', hi: 'गिफ्ट एड' },
  'free': { en: 'Free', gu: 'મફત', hi: 'मुफ्त' },
  'per_person': { en: 'per person', gu: 'પ્રતિ વ્યક્તિ', hi: 'प्रति व्यक्ति' },
  'card_payment': { en: 'Pay by Card', gu: 'કાર્ડ દ્વારા ચૂકવો', hi: 'कार्ड से भुगतान' },
  'jay_shri_krishna': { en: 'Jay Shri Krishna 🙏', gu: 'જય શ્રી કૃષ્ણ 🙏', hi: 'जय श्री कृष्ण 🙏' },
}
