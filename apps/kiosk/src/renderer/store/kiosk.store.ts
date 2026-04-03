import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type KioskTheme = 'lotus' | 'saffron' | 'royal' | 'peacock' | 'jasmine'

export const THEMES: Record<KioskTheme, {
  name: string; emoji: string; desc: string
  headerBg: string; headerBorder: string; headerText: string; headerSub: string
  logoBg: string; logoText: string
  sidebarFrom: string; sidebarTo: string; sidebarBorder: string
  sidebarText: string; sidebarActiveBg: string; sidebarActiveText: string; sidebarIndicator: string
  mainBg: string; sectionHeaderBg: string; sectionHeaderBorder: string
  sectionTitleColor: string; sectionCountColor: string
  promotedBg: string; promotedBorder: string; promotedTitleColor: string
  basketBarBg: string; basketBarBorder: string; basketBarText: string; basketBarSubText: string
  basketBtn: string; basketBtnHover: string
  langActive: string; langInactive: string
}> = {
  lotus: {
    name: 'Lotus Light', emoji: '🪷', desc: 'Clean & bright',
    headerBg: '#FFFFFF', headerBorder: '#FF9933/30', headerText: '#1C0000', headerSub: '#FF9933',
    logoBg: 'linear-gradient(135deg,#FF9933,#FF6600)', logoText: '#FFFFFF',
    sidebarFrom: '#FFF3E0', sidebarTo: '#FFE0B2', sidebarBorder: '#FF9933/40',
    sidebarText: '#5D2E00', sidebarActiveBg: '#FF9933', sidebarActiveText: '#FFFFFF', sidebarIndicator: '#FF6600',
    mainBg: '#FAFAFA', sectionHeaderBg: '#FFFFFF', sectionHeaderBorder: '#FF9933/20',
    sectionTitleColor: '#1C0000', sectionCountColor: '#FF9933',
    promotedBg: 'linear-gradient(to right,#FFF3E0,#F3E5F5)', promotedBorder: '#CE93D8/40', promotedTitleColor: '#6A1B9A',
    basketBarBg: '#1C0000', basketBarBorder: '#FF9933/40', basketBarText: '#FFFFFF', basketBarSubText: '#FFD700',
    basketBtn: '#FF9933', basketBtnHover: '#FF7700',
    langActive: '#FF9933', langInactive: '#FF9933/50',
  },
  saffron: {
    name: 'Saffron Temple', emoji: '🪔', desc: 'Rich & warm',
    headerBg: '#1C0000', headerBorder: '#FF9933/40', headerText: '#FFD700', headerSub: '#FF9933',
    logoBg: 'linear-gradient(135deg,#FF9933,#FF6600)', logoText: '#FFFFFF',
    sidebarFrom: '#FF9933', sidebarTo: '#E55C00', sidebarBorder: '#FFD700/30',
    sidebarText: '#FFFFFF', sidebarActiveBg: 'rgba(28,0,0,0.3)', sidebarActiveText: '#FFD700', sidebarIndicator: '#FFD700',
    mainBg: '#FFF8EC', sectionHeaderBg: 'rgba(255,255,255,0.6)', sectionHeaderBorder: '#FF9933/20',
    sectionTitleColor: '#1C0000', sectionCountColor: '#FF9933',
    promotedBg: 'linear-gradient(to right,rgba(75,0,130,0.08),rgba(196,30,58,0.08))', promotedBorder: '#C41E3A/20', promotedTitleColor: '#4B0082',
    basketBarBg: '#1C0000', basketBarBorder: '#FF9933/40', basketBarText: '#FFFFFF', basketBarSubText: '#FFD700',
    basketBtn: '#FF9933', basketBtnHover: '#FF7700',
    langActive: '#FF9933', langInactive: '#FF9933/50',
  },
  royal: {
    name: 'Royal Gold', emoji: '👑', desc: 'Majestic & divine',
    headerBg: '#0D0D2B', headerBorder: '#FFD700/30', headerText: '#FFD700', headerSub: '#9B8FE0',
    logoBg: 'linear-gradient(135deg,#FFD700,#FFA500)', logoText: '#0D0D2B',
    sidebarFrom: '#1A1A4E', sidebarTo: '#2D1B69', sidebarBorder: '#FFD700/20',
    sidebarText: '#E0D7FF', sidebarActiveBg: 'rgba(255,215,0,0.15)', sidebarActiveText: '#FFD700', sidebarIndicator: '#FFD700',
    mainBg: '#F8F6FF', sectionHeaderBg: '#FFFFFF', sectionHeaderBorder: '#7C3AED/15',
    sectionTitleColor: '#1A1A4E', sectionCountColor: '#7C3AED',
    promotedBg: 'linear-gradient(to right,#EDE9FE,#FEF3C7)', promotedBorder: '#7C3AED/30', promotedTitleColor: '#5B21B6',
    basketBarBg: '#0D0D2B', basketBarBorder: '#FFD700/30', basketBarText: '#FFFFFF', basketBarSubText: '#FFD700',
    basketBtn: '#FFD700', basketBtnHover: '#FFC200',
    langActive: '#FFD700', langInactive: '#9B8FE0/60',
  },
  peacock: {
    name: 'Peacock Blue', emoji: '🦚', desc: 'Krishna inspired',
    headerBg: '#003333', headerBorder: '#00BCD4/30', headerText: '#80DEEA', headerSub: '#4DD0E1',
    logoBg: 'linear-gradient(135deg,#0097A7,#006064)', logoText: '#FFFFFF',
    sidebarFrom: '#004D40', sidebarTo: '#00695C', sidebarBorder: '#80CBC4/30',
    sidebarText: '#E0F2F1', sidebarActiveBg: 'rgba(0,188,212,0.2)', sidebarActiveText: '#80DEEA', sidebarIndicator: '#FFD700',
    mainBg: '#F0FDFA', sectionHeaderBg: '#FFFFFF', sectionHeaderBorder: '#0097A7/20',
    sectionTitleColor: '#004D40', sectionCountColor: '#0097A7',
    promotedBg: 'linear-gradient(to right,#E0F7FA,#F3E5F5)', promotedBorder: '#0097A7/30', promotedTitleColor: '#00695C',
    basketBarBg: '#003333', basketBarBorder: '#00BCD4/30', basketBarText: '#FFFFFF', basketBarSubText: '#80DEEA',
    basketBtn: '#0097A7', basketBtnHover: '#007B83',
    langActive: '#4DD0E1', langInactive: '#4DD0E1/40',
  },
  jasmine: {
    name: 'Jasmine Breeze', emoji: '🌸', desc: 'Soft & serene',
    headerBg: '#FFF9F0', headerBorder: '#FFCC80/50', headerText: '#4E342E', headerSub: '#FF8F00',
    logoBg: 'linear-gradient(135deg,#FFCA28,#FF8F00)', logoText: '#FFFFFF',
    sidebarFrom: '#FFF8E1', sidebarTo: '#FFECB3', sidebarBorder: '#FFCA28/40',
    sidebarText: '#5D4037', sidebarActiveBg: '#FFCA28', sidebarActiveText: '#4E342E', sidebarIndicator: '#FF8F00',
    mainBg: '#FFFEF7', sectionHeaderBg: 'rgba(255,255,255,0.9)', sectionHeaderBorder: '#FFCA28/30',
    sectionTitleColor: '#4E342E', sectionCountColor: '#FF8F00',
    promotedBg: 'linear-gradient(to right,#FFF9C4,#FCE4EC)', promotedBorder: '#F48FB1/30', promotedTitleColor: '#AD1457',
    basketBarBg: '#4E342E', basketBarBorder: '#FFCA28/40', basketBarText: '#FFFFFF', basketBarSubText: '#FFCA28',
    basketBtn: '#FF8F00', basketBtnHover: '#E65100',
    langActive: '#FF8F00', langInactive: '#FF8F00/40',
  },
}

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
  | 'soft-donation'
  | 'project-donation'
  | 'shop'
  | 'gift-aid'
  | 'receipt'

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
  giftAidEligible?: boolean
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
  theme: KioskTheme

  // Device config
  cardProvider: 'stripe_terminal' | 'square' | 'cash'
  stripeReaderId: string
  stripeReaderLabel: string
  squareDeviceId: string
  squareDeviceName: string

  giftAidDeclaration: {
    agreed: boolean
    fullName: string
    postcode: string
    address: string
    contactEmail: string
    contactPhone: string
  } | null

  // Set to true when gift aid screen is done so checkout auto-proceeds to payment
  pendingPayment: boolean

  setGiftAidDeclaration: (decl: KioskState['giftAidDeclaration']) => void
  setPendingPayment: (v: boolean) => void
  setScreen: (screen: KioskScreen) => void
  setLanguage: (lang: Language) => void
  setTheme: (theme: KioskTheme) => void
  setCardDevice: (
    provider: 'stripe_terminal' | 'square' | 'cash',
    deviceId: string,
    deviceLabel: string
  ) => void
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

export const useKioskStore = create<KioskState>()(
  persist(
    (set, get) => ({
  screen: 'idle',
  language: 'en',
  basketId: null,
  items: [],
  orderId: null,
  orderRef: null,
  paymentIntent: null,
  idleTimer: 120,
  branchId: 'main',
  theme: 'lotus',
  giftAidDeclaration: null,
  pendingPayment: false,
  cardProvider: 'stripe_terminal',
  stripeReaderId: 'tmr_Gcuz1QQB6nzqMs',
  stripeReaderLabel: 'Temple WisePOS E',
  squareDeviceId: '',
  squareDeviceName: '',

  setGiftAidDeclaration: (giftAidDeclaration) => set({ giftAidDeclaration }),
  setPendingPayment: (pendingPayment) => set({ pendingPayment }),
  setScreen: (screen) => set({ screen }),
  setLanguage: (language) => set({ language }),
  setTheme: (theme) => set({ theme }),
  setCardDevice: (provider, deviceId, deviceLabel) => set(
    provider === 'stripe_terminal'
      ? { cardProvider: provider, stripeReaderId: deviceId, stripeReaderLabel: deviceLabel }
      : provider === 'square'
      ? { cardProvider: provider, squareDeviceId: deviceId, squareDeviceName: deviceLabel }
      : { cardProvider: provider }
  ),
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
    giftAidDeclaration: null,
    pendingPayment: false,
  }),

  get total() {
    return get().items.reduce((sum, i) => sum + i.totalPrice, 0)
  },

  get itemCount() {
    return get().items.reduce((sum, i) => sum + i.quantity, 0)
  },
    }),
    {
      name: 'shital-kiosk-config',
      storage: createJSONStorage(() => localStorage),
      // Only persist device config + theme — never basket/order state
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        cardProvider: state.cardProvider,
        stripeReaderId: state.stripeReaderId,
        stripeReaderLabel: state.stripeReaderLabel,
        squareDeviceId: state.squareDeviceId,
        squareDeviceName: state.squareDeviceName,
        branchId: state.branchId,
      }),
    }
  )
)

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
