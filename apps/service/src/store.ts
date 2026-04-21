import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { type ThemeId, DEFAULT_THEME, applyTheme, getTheme } from './themes'

export type Screen =
  | 'browse' | 'basket' | 'contact' | 'gift-aid' | 'payment' | 'confirmation' | 'monthly-giving'

export type Language = 'en' | 'gu' | 'hi' | 'te' | 'ta' | 'pa' | 'mr' | 'bn' | 'kn'

export const LANGUAGE_META: Record<Language, { label: string; name: string; script: string }> = {
  en: { label: 'EN', name: 'English',   script: 'English'   },
  gu: { label: 'ગુ', name: 'Gujarati',  script: 'ગુજરાતી'  },
  hi: { label: 'हि', name: 'Hindi',     script: 'हिन्दी'    },
  te: { label: 'తె', name: 'Telugu',    script: 'తెలుగు'    },
  ta: { label: 'த',  name: 'Tamil',     script: 'தமிழ்'     },
  pa: { label: 'ਪੰ', name: 'Punjabi',   script: 'ਪੰਜਾਬੀ'   },
  mr: { label: 'म',  name: 'Marathi',   script: 'मराठी'     },
  bn: { label: 'বাং', name: 'Bengali',  script: 'বাংলা'     },
  kn: { label: 'ಕ',  name: 'Kannada',   script: 'ಕನ್ನಡ'    },
}

export interface BasketItem {
  id: string
  type: 'SERVICE' | 'DONATION'
  name: string
  nameGu?: string
  nameHi?: string
  nameTe?: string
  nameTa?: string
  namePa?: string
  nameMr?: string
  nameBn?: string
  nameKn?: string
  quantity: number
  unitPrice: number
  totalPrice: number
  referenceId?: string
  giftAidEligible?: boolean
  category?: string
}

export interface GiftAidDeclaration {
  agreed: boolean
  firstName: string
  surname: string
  postcode: string
  address: string
  contactEmail: string
  contactPhone: string
}

export interface ContactInfo {
  name: string
  email: string
  phone: string
  gdprConsent: boolean
  termsConsent: boolean
  anonymous: boolean
  firstName?: string
  surname?: string
  postcode?: string
  address?: string
}

export interface OrderResult {
  order_id: string
  order_ref: string
  paypal_order_id: string
  paypal_capture_id?: string
  amount: number
}

/** Detect branch from hostname subdomain.
 *  mk.shital.org.uk  → 'mk'
 *  wembley.shital.org.uk → 'wembley'
 *  service.shital.org.uk → null  (show picker)
 *  localhost → null  (dev: show picker)
 */
const RESERVED_SUBS = new Set([
  'www', 'service', 'admin', 'kiosk', 'donate', 'screen', 'dev', 'api',
])

export function detectBranchFromHostname(): string | null {
  try {
    const parts = window.location.hostname.split('.')
    // e.g. mk.shital.org.uk → 4 parts; shital.org.uk → 3 parts
    if (parts.length >= 4) {
      const sub = parts[0].toLowerCase()
      if (!RESERVED_SUBS.has(sub)) return sub
    }
  } catch { /* SSR guard */ }
  return null
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

interface ServiceStore {
  screen: Screen
  language: Language
  themeId: ThemeId
  branchId: string
  branchName: string          // human-readable name from DB, e.g. "Wembley Temple"
  branchLocked: boolean       // true when branch comes from subdomain (not user-selected)
  deviceToken: string | null  // set once on first login; persisted so device never re-prompts
  items: BasketItem[]
  basketId: string | null
  giftAidDeclaration: GiftAidDeclaration | null
  contactInfo: ContactInfo | null
  orderResult: OrderResult | null

  setScreen: (s: Screen) => void
  setLanguage: (l: Language) => void
  setTheme: (id: ThemeId) => void
  setBranchId: (id: string) => void
  setBranch: (id: string, name: string, locked?: boolean) => void
  setDeviceToken: (token: string | null) => void
  setBasketId: (id: string) => void
  addItem: (item: Omit<BasketItem, 'id'>) => void
  removeItem: (id: string) => void
  updateQty: (id: string, qty: number) => void
  clearBasket: () => void
  setGiftAidDeclaration: (d: GiftAidDeclaration | null) => void
  setContactInfo: (c: ContactInfo | null) => void
  setOrderResult: (r: OrderResult) => void
  reset: () => void

}

export const useStore = create<ServiceStore>()(
  persist(
    (set, get) => ({
      screen: 'browse',
      language: 'en',
      themeId: DEFAULT_THEME,
      branchId: 'main',
      branchName: '',
      branchLocked: false,
      deviceToken: null,
      items: [],
      basketId: null,
      giftAidDeclaration: null,
      contactInfo: null,
      orderResult: null,

      setScreen: (screen) => set({ screen }),
      setLanguage: (language) => set({ language }),
      setTheme: (themeId) => { applyTheme(getTheme(themeId)); set({ themeId }) },
      setBranchId: (branchId) => set({ branchId }),
      setBranch: (branchId, branchName, locked = false) => set({ branchId, branchName, branchLocked: locked }),
      setDeviceToken: (deviceToken) => set({ deviceToken }),
      setBasketId: (basketId) => set({ basketId }),

      addItem: (item) => set((state) => {
        const existing = state.items.find(
          (i) => i.referenceId === item.referenceId && i.type === item.type
        )
        if (existing) {
          const qty = existing.quantity + item.quantity
          return {
            items: state.items.map((i) =>
              i.id === existing.id
                ? { ...i, quantity: qty, totalPrice: qty * i.unitPrice }
                : i
            ),
          }
        }
        return { items: [...state.items, { ...item, id: genId() }] }
      }),

      removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

      updateQty: (id, qty) => set((s) => ({
        items: qty <= 0
          ? s.items.filter((i) => i.id !== id)
          : s.items.map((i) => i.id === id ? { ...i, quantity: qty, totalPrice: qty * i.unitPrice } : i),
      })),

      clearBasket: () => set({ items: [], basketId: null }),

      setGiftAidDeclaration: (giftAidDeclaration) => set({ giftAidDeclaration }),
      setContactInfo: (contactInfo) => set({ contactInfo }),
      setOrderResult: (orderResult) => set({ orderResult }),

      reset: () => set({
        screen: 'browse',
        items: [],
        basketId: null,
        giftAidDeclaration: null,
        contactInfo: null,
        orderResult: null,
      }),

    }),
    {
      name: 'shital-service-config',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        language: s.language,
        themeId: s.themeId,
        deviceToken: s.deviceToken,
        // persist branch when device is locked (token login or subdomain)
        ...(s.deviceToken ? { branchId: s.branchId, branchName: s.branchName, branchLocked: s.branchLocked } : {}),
      }),
    }
  )
)

export const useTotal = () => useStore(s => s.items.reduce((acc, i) => acc + i.totalPrice, 0))
export const useGiftAidTotal = () => useStore(s => s.items.filter(i => i.giftAidEligible).reduce((acc, i) => acc + i.totalPrice, 0))
export const useItemCount = () => useStore(s => s.items.reduce((acc, i) => acc + i.quantity, 0))

// ── Translations ───────────────────────────────────────────────────────────────

const T: Record<string, Record<Language, string>> = {
  donate:        { en: 'Donations',        gu: 'દાન',               hi: 'दान',               te: 'దానాలు',       ta: 'நன்கொடைகள்',    pa: 'ਦਾਨ',          mr: 'देणग्या',      bn: 'দান',         kn: 'ದಾನಗಳು'       },
  soft_donation: { en: 'Soft Donations',   gu: 'ઉચિત દાન',          hi: 'वस्तु दान',         te: 'వస్తు దానాలు', ta: 'பொருள் நன்கொடை',pa: 'ਵਸਤੂ ਦਾਨ',     mr: 'वस्तू दान',   bn: 'বস্তু দান',   kn: 'ವಸ್ತು ದಾನ'   },
  project:       { en: 'Projects',         gu: 'પ્રોજેક્ટ',          hi: 'परियोजनाएं',        te: 'ప్రాజెక్టులు', ta: 'திட்டங்கள்',    pa: 'ਪ੍ਰੋਜੈਕਟ',     mr: 'प्रकल्प',     bn: 'প্রকল্প',     kn: 'ಯೋಜನೆಗಳು'    },
  shop:          { en: 'Shop',             gu: 'દુકાન',              hi: 'दुकान',             te: 'దుకాణం',       ta: 'கடை',           pa: 'ਦੁਕਾਨ',         mr: 'दुकान',       bn: 'দোকান',       kn: 'ಅಂಗಡಿ'        },
  sponsorship:   { en: 'Sponsorship',      gu: 'પ્રાયોજન',           hi: 'प्रायोजन',          te: 'స్పాన్సర్‌షిప్', ta: 'ஆதரவு',         pa: 'ਸਪੋਂਸਰਸ਼ਿਪ',  mr: 'प्रायोजन',   bn: 'স্পনসরশিপ',  kn: 'ಪ್ರಾಯೋಜನ'   },
  services:      { en: 'Temple Services',  gu: 'મંદિર સેવા',         hi: 'मंदिर सेवाएं',      te: 'దేవాలయ సేవలు', ta: 'கோயில் சேவை',   pa: 'ਮੰਦਰ ਸੇਵਾਵਾਂ', mr: 'मंदिर सेवा',  bn: 'মন্দির সেবা', kn: 'ದೇವಾಲಯ ಸೇವೆ' },
  basket:        { en: 'Basket',           gu: 'ટોપલી',              hi: 'टोकरी',             te: 'బాస్కెట్',     ta: 'கூட',           pa: 'ਟੋਕਰੀ',         mr: 'टोपली',       bn: 'ঝুড়ি',       kn: 'ಬುಟ್ಟಿ'       },
  checkout:      { en: 'Pay Now',          gu: 'હવે ચૂકવો',          hi: 'अभी भुगतान करें',  te: 'ఇప్పుడు చెల్లించు', ta: 'இப்போது செலுத்துங்கள்', pa: 'ਹੁਣ ਭੁਗਤਾਨ ਕਰੋ', mr: 'आता पैसे द्या', bn: 'এখনই দিন', kn: 'ಈಗ ಪಾವತಿಸಿ' },
  thank_you:     { en: 'Thank You',        gu: 'આભાર',               hi: 'धन्यवाद',           te: 'ధన్యవాదాలు',   ta: 'நன்றி',         pa: 'ਧੰਨਵਾਦ',        mr: 'धन्यवाद',     bn: 'ধন্যবাদ',    kn: 'ಧನ್ಯವಾದ'     },
  add:           { en: 'Add',             gu: 'ઉમેરો',              hi: 'जोड़ें',            te: 'జోడించు',       ta: 'சேர்',          pa: 'ਜੋੜੋ',          mr: 'जोडा',        bn: 'যোগ করুন',   kn: 'ಸೇರಿಸಿ'      },
  back:          { en: 'Back',            gu: 'પાછળ',               hi: 'वापस',              te: 'వెనక్కి',      ta: 'பின்னால்',      pa: 'ਵਾਪਸ',          mr: 'परत',         bn: 'পিছনে',      kn: 'ಹಿಂದೆ'       },
  total:         { en: 'Total',           gu: 'કુલ',                hi: 'कुल',               te: 'మొత్తం',       ta: 'மொத்தம்',       pa: 'ਕੁੱਲ',          mr: 'एकूण',        bn: 'মোট',        kn: 'ಒಟ್ಟು'       },
  continue:      { en: 'Continue',        gu: 'આગળ વધો',            hi: 'जारी रखें',        te: 'కొనసాగించు',   ta: 'தொடரவும்',      pa: 'ਜਾਰੀ ਰੱਖੋ',    mr: 'पुढे जा',     bn: 'চালিয়ে যান', kn: 'ಮುಂದುವರಿಸಿ' },
  cancel:        { en: 'Cancel',          gu: 'રદ કરો',             hi: 'रद्द करें',        te: 'రద్దు',        ta: 'ரத்து',         pa: 'ਰੱਦ ਕਰੋ',       mr: 'रद्द करा',    bn: 'বাতিল করুন', kn: 'ರದ್ದುಗೊಳಿಸಿ' },
  items:         { en: 'items',           gu: 'વસ્તુ',              hi: 'आइटम',             te: 'వస్తువులు',    ta: 'பொருட்கள்',     pa: 'ਆਈਟਮ',          mr: 'आयटम',        bn: 'আইটেম',      kn: 'ಐಟಂಗಳು'     },
}

export function t(key: string, lang: Language): string {
  return T[key]?.[lang] ?? T[key]?.en ?? key
}
