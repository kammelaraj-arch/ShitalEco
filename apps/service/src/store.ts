import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { type ThemeId, DEFAULT_THEME, applyTheme, getTheme } from './themes'

// Org logo — served same-origin from apps/service/public so it never depends
// on a third-party host. Swap the file (or this path) to rebrand the portal.
export const SHITAL_LOGO_URL = '/logo.png'

export type Screen =
  | 'browse' | 'basket' | 'contact' | 'gift-aid' | 'payment' | 'confirmation' | 'monthly-giving' | 'volunteer' | 'reference'
  | 'donor-login' | 'my-giving' | 'seva' | 'sqft' | 'sqft-classic' | 'donor-wall' | 'darshan'

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
  // Donor-wall recognition (Future Legacy Appeal tiers). Captured on the
  // tier card and passed through PayPal /capture so the backend can
  // populate donor_wall_entries — one row per unit (quantity).
  dedication?: string
  prefix?: string   // '' | 'In memory of' | 'In honour of' | 'Dedicated by'
}

export interface GiftAidDeclaration {
  agreed: boolean
  firstName: string
  surname: string
  postcode: string
  address: string
  uprn: string
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
  uprn?: string
}

export interface OrderResult {
  order_id: string
  order_ref: string
  paypal_order_id: string
  paypal_capture_id?: string
  amount: number
  // Snapshot of basket items at the moment of successful capture, so the
  // ConfirmationPage can render the receipt rows AFTER we've cleared the
  // live basket. Previously the confirmation page read the live `items`
  // array, which forced us to delay basket-clear until the auto-reset
  // timer — leaving the basket badge populated and the basket page
  // showing the just-purchased items if the donor clicked anywhere.
  items?: BasketItem[]
  // Same idea for Gift Aid: snapshot whether the donor declared at
  // capture time, so confirmation still shows "Gift Aid Confirmed" even
  // after we've reset giftAidDeclaration.
  gift_aid_agreed?: boolean
  gift_aid_total?: number
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
  donorToken: string | null   // donor (public) session — separate from staff/admin
  donorName: string
  donorEmail: string
  // Transient prefill for the donor register form, seeded from the contact
  // info a guest already gave at checkout (see the post-donation soft prompt
  // on ConfirmationPage). Never persisted — cleared once the form reads it.
  donorPrefill: { email: string; firstName: string; surname: string } | null

  setScreen: (s: Screen) => void
  setDonor: (token: string | null, name?: string, email?: string) => void
  setDonorPrefill: (p: { email: string; firstName: string; surname: string } | null) => void
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
      donorToken: null,
      donorName: '',
      donorEmail: '',
      donorPrefill: null,

      setScreen: (screen) => set({ screen }),
      setDonor: (donorToken, donorName = '', donorEmail = '') => set({ donorToken, donorName, donorEmail }),
      setDonorPrefill: (donorPrefill) => set({ donorPrefill }),
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
        // persist the donor session so they stay signed in across visits
        donorToken: s.donorToken,
        donorName: s.donorName,
        donorEmail: s.donorEmail,
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
  // ── Tabs ─────────────────────────────────────────────────────────────────
  donate:        { en: 'Donations',        gu: 'દાન',               hi: 'दान',               te: 'దానాలు',       ta: 'நன்கொடைகள்',    pa: 'ਦਾਨ',          mr: 'देणग्या',      bn: 'দান',         kn: 'ದಾನಗಳು'       },
  soft_donation: { en: 'Soft Donations',   gu: 'ઉચિત દાન',          hi: 'वस्तु दान',         te: 'వస్తు దానాలు', ta: 'பொருள் நன்கொடை',pa: 'ਵਸਤੂ ਦਾਨ',     mr: 'वस्तू दान',   bn: 'বস্তু দান',   kn: 'ವಸ್ತು ದಾನ'   },
  project:       { en: 'Projects',         gu: 'પ્રોજેક્ટ',          hi: 'परियोजनाएं',        te: 'ప్రాజెక్టులు', ta: 'திட்டங்கள்',    pa: 'ਪ੍ਰੋਜੈਕਟ',     mr: 'प्रकल्प',     bn: 'প্রকল্প',     kn: 'ಯೋಜನೆಗಳು'    },
  shop:          { en: 'Shop',             gu: 'દુકાન',              hi: 'दुकान',             te: 'దుకాణం',       ta: 'கடை',           pa: 'ਦੁਕਾਨ',         mr: 'दुकान',       bn: 'দোকান',       kn: 'ಅಂಗಡಿ'        },
  sponsorship:   { en: 'Sponsorship',      gu: 'પ્રાયોજન',           hi: 'प्रायोजन',          te: 'స్పాన్సర్‌షిప్', ta: 'ஆதரவு',         pa: 'ਸਪੋਂਸਰਸ਼ਿਪ',  mr: 'प्रायोजन',   bn: 'স্পনসরশিপ',  kn: 'ಪ್ರಾಯೋಜನ'   },
  services:      { en: 'Temple Services',  gu: 'મંદિર સેવા',         hi: 'मंदिर सेवाएं',      te: 'దేవాలయ సేవలు', ta: 'கோயில் சேவை',   pa: 'ਮੰਦਰ ਸੇਵਾਵਾਂ', mr: 'मंदिर सेवा',  bn: 'মন্দির সেবা', kn: 'ದೇವಾಲಯ ಸೇವೆ' },

  // ── Common actions / labels ─────────────────────────────────────────────
  basket:        { en: 'Basket',           gu: 'ટોપલી',              hi: 'टोकरी',             te: 'బాస్కెట్',     ta: 'கூட',           pa: 'ਟੋਕਰੀ',         mr: 'टोपली',       bn: 'ঝুড়ি',       kn: 'ಬುಟ್ಟಿ'       },
  checkout:      { en: 'Pay Now',          gu: 'હવે ચૂકવો',          hi: 'अभी भुगतान करें',  te: 'ఇప్పుడు చెల్లించు', ta: 'இப்போது செலுத்துங்கள்', pa: 'ਹੁਣ ਭੁਗਤਾਨ ਕਰੋ', mr: 'आता पैसे द्या', bn: 'এখনই দিন', kn: 'ಈಗ ಪಾವತಿಸಿ' },
  thank_you:     { en: 'Thank You',        gu: 'આભાર',               hi: 'धन्यवाद',           te: 'ధన్యవాదాలు',   ta: 'நன்றி',         pa: 'ਧੰਨਵਾਦ',        mr: 'धन्यवाद',     bn: 'ধন্যবাদ',    kn: 'ಧನ್ಯವಾದ'     },
  add:           { en: 'Add',              gu: 'ઉમેરો',              hi: 'जोड़ें',            te: 'జోడించు',       ta: 'சேர்',          pa: 'ਜੋੜੋ',          mr: 'जोडा',        bn: 'যোগ করুন',   kn: 'ಸೇರಿಸಿ'      },
  back:          { en: 'Back',             gu: 'પાછળ',               hi: 'वापस',              te: 'వెనక్కి',      ta: 'பின்னால்',      pa: 'ਵਾਪਸ',          mr: 'परत',         bn: 'পিছনে',      kn: 'ಹಿಂದೆ'       },
  total:         { en: 'Total',            gu: 'કુલ',                hi: 'कुल',               te: 'మొత్తం',       ta: 'மொத்தம்',       pa: 'ਕੁੱਲ',          mr: 'एकूण',        bn: 'মোট',        kn: 'ಒಟ್ಟು'       },
  continue:      { en: 'Continue',         gu: 'આગળ વધો',            hi: 'जारी रखें',        te: 'కొనసాగించు',   ta: 'தொடரவும்',      pa: 'ਜਾਰੀ ਰੱਖੋ',    mr: 'पुढे जा',     bn: 'চালিয়ে যান', kn: 'ಮುಂದುವರಿಸಿ' },
  cancel:        { en: 'Cancel',           gu: 'રદ કરો',             hi: 'रद्द करें',        te: 'రద్దు',        ta: 'ரத்து',         pa: 'ਰੱਦ ਕਰੋ',       mr: 'रद्द करा',    bn: 'বাতিল করুন', kn: 'ರದ್ದುಗೊಳಿಸಿ' },
  items:         { en: 'items',            gu: 'વસ્તુ',              hi: 'आइटम',             te: 'వస్తువులు',    ta: 'பொருட்கள்',     pa: 'ਆਈਟਮ',          mr: 'आयटम',        bn: 'আইটেম',      kn: 'ಐಟಂಗಳು'     },
  sign_in:       { en: 'Sign in',          gu: 'સાઇન ઇન',            hi: 'साइन इन',           te: 'సైన్ ఇన్',     ta: 'உள்நுழை',       pa: 'ਸਾਈਨ ਇਨ',       mr: 'साइन इन',     bn: 'সাইন ইন',    kn: 'ಸೈನ್ ಇನ್'   },
  change:        { en: 'Change',           gu: 'બદલો',               hi: 'बदलें',             te: 'మార్చు',       ta: 'மாற்று',        pa: 'ਬਦਲੋ',          mr: 'बदला',        bn: 'পরিবর্তন',   kn: 'ಬದಲಿಸಿ'     },

  // ── Hero ────────────────────────────────────────────────────────────────
  hero_subtitle: { en: 'Donations, sevas & sponsorships — support our temple',
                   gu: 'દાન, સેવા અને પ્રાયોજન — અમારા મંદિરનો આધાર',
                   hi: 'दान, सेवा और प्रायोजन — हमारे मंदिर का सहयोग',
                   te: 'దానాలు, సేవలు మరియు ప్రాయోజనాలు — మా దేవాలయానికి మద్దతు',
                   ta: 'நன்கொடைகள், சேவைகள் மற்றும் ஆதரவு — எங்கள் கோயிலுக்கு துணை',
                   pa: 'ਦਾਨ, ਸੇਵਾ ਅਤੇ ਪ੍ਰਾਯੋਜਨ — ਸਾਡੇ ਮੰਦਰ ਦਾ ਸਹਿਯੋਗ',
                   mr: 'दान, सेवा आणि प्रायोजन — आमच्या मंदिरास सहकार्य',
                   bn: 'দান, সেবা ও স্পনসরশিপ — আমাদের মন্দিরকে সাহায্য',
                   kn: 'ದಾನ, ಸೇವೆ ಮತ್ತು ಪ್ರಾಯೋಜನ — ನಮ್ಮ ದೇವಾಲಯಕ್ಕೆ ಬೆಂಬಲ' },

  // ── Live Darshan ────────────────────────────────────────────────────────
  live:          { en: 'LIVE',             gu: 'લાઇવ',              hi: 'लाइव',              te: 'లైవ్',         ta: 'நேரடி',         pa: 'ਲਾਈਵ',          mr: 'लाइव',        bn: 'লাইভ',       kn: 'ಲೈವ್'        },
  offline:       { en: 'OFFLINE',          gu: 'ઓફલાઇન',             hi: 'ऑफ़लाइन',           te: 'ఆఫ్‌లైన్',     ta: 'ஆஃப்லைன்',     pa: 'ਆਫਲਾਈਨ',        mr: 'ऑफलाइन',      bn: 'অফলাইন',     kn: 'ಆಫ್‌ಲೈನ್'   },
  live_darshan_eyebrow: { en: 'Live · Darshan', gu: 'લાઇવ · દર્શન', hi: 'लाइव · दर्शन',     te: 'లైవ్ · దర్శనం', ta: 'நேரடி · தரிசனம்', pa: 'ਲਾਈਵ · ਦਰਸ਼ਨ', mr: 'लाइव · दर्शन', bn: 'লাইভ · দর্শন', kn: 'ಲೈವ್ · ದರ್ಶನ' },
  live_darshan_title: { en: "Watch Baba's darshan from the temple",
                   gu: 'મંદિરેથી બાબાના દર્શન કરો',
                   hi: 'मंदिर से बाबा के दर्शन करें',
                   te: 'దేవాలయం నుండి బాబా దర్శనం చూడండి',
                   ta: 'கோயிலில் இருந்து பாபா தரிசனத்தை பாருங்கள்',
                   pa: 'ਮੰਦਰ ਤੋਂ ਬਾਬਾ ਦੇ ਦਰਸ਼ਨ ਕਰੋ',
                   mr: 'मंदिरातून बाबांचे दर्शन घ्या',
                   bn: 'মন্দির থেকে বাবার দর্শন করুন',
                   kn: 'ದೇವಾಲಯದಿಂದ ಬಾಬಾರ ದರ್ಶನ ಪಡೆಯಿರಿ' },
  live_darshan_sub: { en: 'Live stream during aarti — a still of Baba when the feed is offline.',
                   gu: 'આરતી દરમિયાન લાઇવ સ્ટ્રીમ — ઓફલાઇન હોય ત્યારે બાબાની છબી.',
                   hi: 'आरती के समय लाइव — ऑफ़लाइन हो तो बाबा की तस्वीर दिखेगी।',
                   te: 'ఆరతి సమయంలో లైవ్ — ఆఫ్‌లైన్‌లో బాబా చిత్రం కనిపిస్తుంది.',
                   ta: 'ஆரத்தி நேரத்தில் நேரடி — ஆஃப்லைனில் பாபாவின் படம் காட்டப்படும்.',
                   pa: 'ਆਰਤੀ ਦੇ ਸਮੇਂ ਲਾਈਵ — ਆਫਲਾਈਨ ਵਿੱਚ ਬਾਬਾ ਦੀ ਤਸਵੀਰ।',
                   mr: 'आरतीवेळी लाइव — ऑफलाइनला बाबांचे चित्र दिसेल.',
                   bn: 'আরতির সময় লাইভ — অফলাইনে বাবার ছবি।',
                   kn: 'ಆರತಿ ಸಮಯದಲ್ಲಿ ಲೈವ್ — ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿ ಬಾಬಾರ ಚಿತ್ರ.' },
  watch:         { en: 'Watch',            gu: 'જુઓ',                hi: 'देखें',             te: 'చూడు',         ta: 'பார்',          pa: 'ਵੇਖੋ',           mr: 'पहा',         bn: 'দেখুন',      kn: 'ನೋಡಿ'       },
  connecting_temple: { en: 'Connecting to the temple…',
                   gu: 'મંદિર સાથે જોડાય છે…',
                   hi: 'मंदिर से जुड़ रहे हैं…',
                   te: 'దేవాలయానికి కనెక్ట్ అవుతోంది…',
                   ta: 'கோயிலுடன் இணைகிறது…',
                   pa: 'ਮੰਦਰ ਨਾਲ ਜੁੜ ਰਿਹਾ ਹੈ…',
                   mr: 'मंदिराशी जोडले जात आहे…',
                   bn: 'মন্দিরের সঙ্গে সংযোগ হচ্ছে…',
                   kn: 'ದೇವಾಲಯಕ್ಕೆ ಸಂಪರ್ಕಿಸಲಾಗುತ್ತಿದೆ…' },
  darshan_offline_title: { en: 'Darshan is not live right now',
                   gu: 'દર્શન અત્યારે લાઇવ નથી',
                   hi: 'दर्शन अभी लाइव नहीं है',
                   te: 'ప్రస్తుతం దర్శనం లైవ్ కాదు',
                   ta: 'தற்போது தரிசனம் நேரடி இல்லை',
                   pa: 'ਦਰਸ਼ਨ ਹੁਣੇ ਲਾਈਵ ਨਹੀਂ ਹਨ',
                   mr: 'दर्शन सध्या लाइव नाही',
                   bn: 'দর্শন এখন লাইভ নয়',
                   kn: 'ದರ್ಶನ ಇದೀಗ ಲೈವ್ ಇಲ್ಲ' },
  darshan_offline_sub: { en: 'Baba is with you. The next aarti stream will appear here automatically — this page re-checks every minute.',
                   gu: 'બાબા સાથે છે. આગામી આરતી અહીં આપમેળે આવશે — આ પેજ દર મિનિટે તપાસ કરે છે.',
                   hi: 'बाबा आपके साथ हैं। अगली आरती यहीं अपने आप आ जाएगी — यह पेज हर मिनट देखता रहता है।',
                   te: 'బాబా మీతో ఉన్నారు. తదుపరి ఆరతి ఇక్కడ స్వయంచాలకంగా కనిపిస్తుంది — ఈ పేజీ ప్రతి నిమిషం తనిఖీ చేస్తుంది.',
                   ta: 'பாபா உங்களுடன் உள்ளார். அடுத்த ஆரத்தி இங்கே தானாகவே வரும் — இந்தப் பக்கம் ஒவ்வொரு நிமிடமும் சரிபார்க்கிறது.',
                   pa: 'ਬਾਬਾ ਤੁਹਾਡੇ ਨਾਲ ਹਨ। ਅਗਲੀ ਆਰਤੀ ਆਪਣੇ ਆਪ ਇੱਥੇ ਆ ਜਾਵੇਗੀ — ਇਹ ਪੇਜ ਹਰ ਮਿੰਟ ਚੈੱਕ ਕਰਦਾ ਹੈ।',
                   mr: 'बाबा तुमच्या सोबत आहेत. पुढील आरती येथेच आपोआप दिसेल — हे पान दर मिनिटाला तपासते.',
                   bn: 'বাবা আপনার সঙ্গে আছেন। পরবর্তী আরতি এখানেই নিজে থেকে দেখা যাবে — এই পেজ প্রতি মিনিটে দেখে।',
                   kn: 'ಬಾಬಾ ನಿಮ್ಮೊಂದಿಗಿದ್ದಾರೆ. ಮುಂದಿನ ಆರತಿ ಇಲ್ಲಿಯೇ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಕಾಣುತ್ತದೆ — ಈ ಪುಟ ಪ್ರತಿ ನಿಮಿಷ ಪರಿಶೀಲಿಸುತ್ತದೆ.' },

  // ── Future Legacy / Donor Wall / Volunteer / Monthly / Custom ──────────
  future_legacy_eyebrow: { en: 'Future Legacy Appeal',
                   gu: 'ભાવિ વારસો અપીલ', hi: 'भावी विरासत अपील', te: 'భవిష్యత్ వారసత్వ విజ్ఞప్తి',
                   ta: 'எதிர்கால மரபு வேண்டுகோள்', pa: 'ਭਵਿੱਖੀ ਵਿਰਾਸਤ ਅਪੀਲ', mr: 'भविष्यातील वारसा आवाहन',
                   bn: 'ভবিষ্যত উত্তরাধিকার আবেদন', kn: 'ಭವಿಷ್ಯದ ಪರಂಪರೆ ಮನವಿ' },
  future_legacy_title: { en: 'Leave your mark — sponsor the build (from £51)',
                   gu: 'તમારો ફાળો છોડો — નિર્માણને સમર્થન (£51થી)',
                   hi: 'अपनी छाप छोड़ें — निर्माण का सहयोग करें (£51 से)',
                   te: 'మీ ఛాప వేయండి — నిర్మాణానికి మద్దతు (£51 నుండి)',
                   ta: 'உங்கள் முத்திரையை பதிக்கவும் — கட்டுமானத்திற்கு ஆதரவு (£51-லிருந்து)',
                   pa: 'ਆਪਣੀ ਛਾਪ ਛੱਡੋ — ਉਸਾਰੀ ਦਾ ਸਹਿਯੋਗ (£51 ਤੋਂ)',
                   mr: 'आपला ठसा ठेवा — बांधकामाला सहकार्य (£51 पासून)',
                   bn: 'আপনার ছাপ রাখুন — নির্মাণে সহায়তা (£51 থেকে)',
                   kn: 'ನಿಮ್ಮ ಮುದ್ರೆ ಬಿಡಿ — ನಿರ್ಮಾಣಕ್ಕೆ ಬೆಂಬಲ (£51 ರಿಂದ)' },
  future_legacy_sub: { en: 'Sponsor a brick, a square foot & more. Your name on our donor wall. Gift Aid +25%.',
                   gu: 'ઈંટ, ચોરસ ફૂટ અને વધુ. તમારૂ નામ અમારી દાતા દિવાલ પર. ગિફ્ટ એઇડ +25%.',
                   hi: 'ईंट, वर्ग फुट और बहुत कुछ। आपका नाम हमारी दानी-दीवार पर। गिफ्ट एड +25%।',
                   te: 'ఇటుక, చదరపు అడుగు & మరిన్ని. మీ పేరు మా దాత గోడపై. గిఫ్ట్ ఎయిడ్ +25%.',
                   ta: 'செங்கல், சதுர அடி மற்றும் மேலும். உங்கள் பெயர் எங்கள் தரிசனச் சுவரில். கிஃப்ட் எய்ட் +25%.',
                   pa: 'ਇੱਟ, ਵਰਗ ਫੁੱਟ ਤੇ ਹੋਰ। ਤੁਹਾਡਾ ਨਾਮ ਸਾਡੀ ਦਾਤਾ-ਦੀਵਾਰ ਉੱਤੇ। ਗਿਫਟ ਏਡ +25%।',
                   mr: 'वीट, चौरस फूट आणि अधिक. आपले नाव आमच्या दाता भिंतीवर. गिफ्ट एड +25%.',
                   bn: 'ইট, বর্গফুট ও আরও। আপনার নাম আমাদের দাতা-দেয়ালে। গিফট এইড +25%।',
                   kn: 'ಇಟ್ಟಿಗೆ, ಚದರ ಅಡಿ ಮತ್ತು ಇನ್ನಷ್ಟು. ನಿಮ್ಮ ಹೆಸರು ನಮ್ಮ ದಾನಿ ಗೋಡೆಯಲ್ಲಿ. ಗಿಫ್ಟ್ ಎಯ್ಡ್ +25%.' },
  sponsor:       { en: 'Sponsor',          gu: 'પ્રાયોજન',           hi: 'प्रायोजन',          te: 'స్పాన్సర్',   ta: 'ஆதரவாளர்',       pa: 'ਪ੍ਰਾਯੋਜਕ',      mr: 'प्रायोजक',    bn: 'স্পনসর',     kn: 'ಪ್ರಾಯೋಜಕ'   },

  donor_wall_title: { en: 'Digital Donor Wall',
                   gu: 'ડિજિટલ દાતા દિવાલ', hi: 'डिजिटल दानी-दीवार', te: 'డిజిటల్ దాత గోడ',
                   ta: 'டிஜிட்டல் தரிசனச் சுவர்', pa: 'ਡਿਜੀਟਲ ਦਾਤਾ ਦੀਵਾਰ',
                   mr: 'डिजिटल दाता भिंत', bn: 'ডিজিটাল দাতা-দেয়াল', kn: 'ಡಿಜಿಟಲ್ ದಾನಿ ಗೋಡೆ' },
  donor_wall_sub: { en: 'See the names of those who have given — grouped by tier.',
                   gu: 'દાતાઓના નામ જુઓ — સ્તર પ્રમાણે.',
                   hi: 'दानकर्ताओं के नाम देखें — स्तर अनुसार।',
                   te: 'దాతల పేర్లను చూడండి — తరగతి వారీగా.',
                   ta: 'கொடுத்தவர்களின் பெயர்களை பாருங்கள் — அடுக்கு வாரியாக.',
                   pa: 'ਦਾਨੀਆਂ ਦੇ ਨਾਮ ਦੇਖੋ — ਪੱਧਰ ਅਨੁਸਾਰ।',
                   mr: 'दात्यांची नावे पहा — स्तरानुसार.',
                   bn: 'দাতাদের নাম দেখুন — স্তর অনুযায়ী।',
                   kn: 'ದಾನಿಗಳ ಹೆಸರುಗಳನ್ನು ನೋಡಿ — ಹಂತದ ಪ್ರಕಾರ.' },
  view_wall:     { en: 'View wall',        gu: 'દિવાલ જુઓ',          hi: 'दीवार देखें',       te: 'గోడ చూడండి',   ta: 'சுவரைக் காண்',   pa: 'ਦੀਵਾਰ ਵੇਖੋ',    mr: 'भिंत पहा',    bn: 'দেয়াল দেখুন', kn: 'ಗೋಡೆ ನೋಡಿ'  },

  week_seva:     { en: '1 hr / week Seva', gu: '1 કલાક/અઠવાડિયું સેવા', hi: '1 घंटा/सप्ताह सेवा',
                   te: 'వారానికి 1 గంట సేవ', ta: 'வாரம் 1 மணி சேவை', pa: '1 ਘੰਟਾ/ਹਫਤਾ ਸੇਵਾ',
                   mr: '1 तास/आठवडा सेवा', bn: '1 ঘণ্টা/সপ্তাহ সেবা', kn: '1 ಗಂಟೆ/ವಾರ ಸೇವೆ' },
  volunteer_title: { en: 'Volunteer with SHITAL',
                   gu: 'SHITAL સાથે સેવક બનો', hi: 'SHITAL के साथ स्वयंसेवक बनें',
                   te: 'SHITAL తో వాలంటీర్', ta: 'SHITAL உடன் தன்னார்வலர்',
                   pa: 'SHITAL ਨਾਲ ਸੇਵਾਦਾਰ', mr: 'SHITAL सह स्वयंसेवक',
                   bn: 'SHITAL-এর সঙ্গে স্বেচ্ছাসেবক', kn: 'SHITAL ಜೊತೆ ಸ್ವಯಂಸೇವಕ' },
  volunteer_sub: { en: 'Give one hour a week. Help with seva, langar, events. Register online — trustees review.',
                   gu: 'અઠવાડિયામાં એક કલાક આપો. સેવા, લંગર, કાર્યક્રમોમાં મદદ કરો. ઓનલાઇન નોંધણી કરો — ટ્રસ્ટી સમીક્ષા કરે છે.',
                   hi: 'सप्ताह में एक घंटा दें। सेवा, लंगर, कार्यक्रमों में मदद करें। ऑनलाइन पंजीकरण करें — ट्रस्टी समीक्षा करेंगे।',
                   te: 'వారంలో ఒక గంట ఇవ్వండి. సేవ, లంగర్, కార్యక్రమాలలో సహాయం చేయండి. ఆన్‌లైన్‌లో నమోదు — ట్రస్టీలు సమీక్షిస్తారు.',
                   ta: 'வாரத்திற்கு ஒரு மணி நேரம் கொடுங்கள். சேவை, லங்கர், நிகழ்வுகளில் உதவுங்கள். ஆன்லைனில் பதிவு செய்யுங்கள் — அறங்காவலர் மதிப்பாய்வு.',
                   pa: 'ਹਫਤੇ ਵਿੱਚ ਇੱਕ ਘੰਟਾ ਦਿਓ। ਸੇਵਾ, ਲੰਗਰ, ਸਮਾਗਮਾਂ ਵਿੱਚ ਮਦਦ ਕਰੋ। ਆਨਲਾਈਨ ਰਜਿਸਟਰ — ਟਰੱਸਟੀ ਸਮੀਖਿਆ।',
                   mr: 'आठवड्यात एक तास द्या. सेवा, लंगर, कार्यक्रमांत मदत करा. ऑनलाइन नोंदणी — विश्वस्त पुनरावलोकन.',
                   bn: 'সপ্তাহে এক ঘণ্টা দিন। সেবা, লঙ্গর, অনুষ্ঠানে সাহায্য করুন। অনলাইনে নিবন্ধন — ট্রাস্টিরা পর্যালোচনা।',
                   kn: 'ವಾರಕ್ಕೊಂದು ಗಂಟೆ ನೀಡಿ. ಸೇವೆ, ಲಂಗರ್, ಕಾರ್ಯಕ್ರಮಗಳಲ್ಲಿ ಸಹಾಯ ಮಾಡಿ. ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ನೋಂದಣಿ — ಟ್ರಸ್ಟಿಗಳು ಪರಿಶೀಲನೆ.' },
  register:      { en: 'Register',         gu: 'નોંધણી',              hi: 'पंजीकरण',           te: 'నమోదు',        ta: 'பதிவு',          pa: 'ਰਜਿਸਟਰ',        mr: 'नोंदणी',      bn: 'নিবন্ধন',    kn: 'ನೋಂದಣಿ'     },

  monthly_eyebrow: { en: 'Monthly Giving', gu: 'માસિક દાન', hi: 'मासिक दान', te: 'నెలవారీ దానం',
                   ta: 'மாதாந்திர கொடை', pa: 'ਮਾਸਿਕ ਦਾਨ', mr: 'मासिक दान',
                   bn: 'মাসিক দান', kn: 'ಮಾಸಿಕ ದಾನ' },
  monthly_title: { en: 'From just £5 / month',
                   gu: 'માત્ર £5 / મહિનાથી', hi: 'सिर्फ £5 / माह से',
                   te: '£5 / నెల నుండి', ta: 'மாதம் £5-லிருந்து',
                   pa: 'ਸਿਰਫ £5 / ਮਹੀਨਾ ਤੋਂ', mr: 'फक्त £5 / महिना पासून',
                   bn: 'মাত্র £5 / মাস থেকে', kn: 'ಕೇವಲ £5 / ತಿಂಗಳು' },
  monthly_sub: { en: 'Set up regular giving via PayPal. Cancel anytime. Gift Aid boosts your impact by 25%.',
                   gu: 'પેપાલ દ્વારા નિયમિત દાન સેટ કરો. ગમે ત્યારે રદ કરો. ગિફ્ટ એઇડ 25% વધારો.',
                   hi: 'पेपाल से नियमित दान सेट करें। कभी भी रद्द करें। गिफ्ट एड 25% बढ़ाता है।',
                   te: 'పేపాల్ ద్వారా క్రమం తప్పకుండా దానం. ఎప్పుడైనా రద్దు. గిఫ్ట్ ఎయిడ్ 25% పెంచుతుంది.',
                   ta: 'பேபாலில் தொடர் கொடை. எப்போது வேண்டுமானாலும் ரத்து. கிஃப்ட் எய்ட் 25% உயர்த்தும்.',
                   pa: 'ਪੇਪਾਲ ਰਾਹੀਂ ਨਿਯਮਤ ਦਾਨ। ਕਦੇ ਵੀ ਰੱਦ ਕਰੋ। ਗਿਫਟ ਏਡ 25% ਵਧਾਉਂਦਾ।',
                   mr: 'पेपालद्वारे नियमित दान. कधीही रद्द करा. गिफ्ट एड 25% वाढवते.',
                   bn: 'পেপ্যাল-এ নিয়মিত দান। যেকোনো সময় বাতিল। গিফট এইড 25% বাড়ায়।',
                   kn: 'ಪೇಪಾಲ್ ಮೂಲಕ ನಿಯಮಿತ ದಾನ. ಯಾವುದೇ ಸಮಯದಲ್ಲಿ ರದ್ದು. ಗಿಫ್ಟ್ ಎಯ್ಡ್ 25% ಹೆಚ್ಚಿಸುತ್ತದೆ.' },
  setup:         { en: 'Set up',           gu: 'સેટ અપ',             hi: 'सेट अप',            te: 'సెట్ అప్',     ta: 'அமைக்க',        pa: 'ਸੈੱਟ ਕਰੋ',      mr: 'सेट अप',      bn: 'সেট আপ',     kn: 'ಸೆಟ್ ಅಪ್'   },

  custom_eyebrow: { en: 'Custom Donation', gu: 'કસ્ટમ દાન', hi: 'कस्टम दान', te: 'కస్టమ్ దానం',
                   ta: 'தனிப்பட்ட நன்கொடை', pa: 'ਕਸਟਮ ਦਾਨ', mr: 'कस्टम दान',
                   bn: 'কাস্টম দান', kn: 'ಕಸ್ಟಮ್ ದಾನ' },
  donate_any_amount: { en: 'Donate any amount',
                   gu: 'કોઈ પણ રકમ દાન કરો', hi: 'कोई भी राशि दान करें',
                   te: 'ఏ మొత్తమైనా దానం చేయండి', ta: 'எந்தத் தொகையையும் கொடுக்கவும்',
                   pa: 'ਕੋਈ ਵੀ ਰਕਮ ਦਾਨ ਕਰੋ', mr: 'कोणतीही रक्कम दान करा',
                   bn: 'যেকোনো পরিমাণ দান করুন', kn: 'ಯಾವುದೇ ಮೊತ್ತವನ್ನು ದಾನ ಮಾಡಿ' },
  enter_amount:  { en: 'Enter amount',     gu: 'રકમ દાખલ કરો',       hi: 'राशि दर्ज करें',   te: 'మొత్తాన్ని నమోదు చేయండి', ta: 'தொகையை உள்ளிடவும்', pa: 'ਰਕਮ ਦਰਜ ਕਰੋ', mr: 'रक्कम प्रविष्ट करा', bn: 'পরিমাণ লিখুন', kn: 'ಮೊತ್ತ ನಮೂದಿಸಿ' },
  donate_action: { en: 'Donate',           gu: 'દાન કરો',            hi: 'दान करें',          te: 'దానం చేయండి',  ta: 'நன்கொடை',       pa: 'ਦਾਨ ਕਰੋ',       mr: 'दान करा',     bn: 'দান করুন',   kn: 'ದಾನ ಮಾಡಿ'   },

  // ── Donor Wall page ─────────────────────────────────────────────────────
  donor_wall_subtitle: { en: 'Future Legacy Appeal · Gratitude from Shital Temple',
                   gu: 'ભાવિ વારસો અપીલ · શિતલ મંદિરનો આભાર',
                   hi: 'भावी विरासत अपील · शितल मंदिर का आभार',
                   te: 'భవిష్యత్ వారసత్వ విజ్ఞప్తి · శిటల్ దేవాలయ కృతజ్ఞత',
                   ta: 'எதிர்கால மரபு · ஷிட்டல் கோயில் நன்றியுடன்',
                   pa: 'ਭਵਿੱਖੀ ਵਿਰਾਸਤ ਅਪੀਲ · ਸ਼ਿਤਲ ਮੰਦਰ ਦਾ ਧੰਨਵਾਦ',
                   mr: 'भविष्यातील वारसा · शितल मंदिराचे आभार',
                   bn: 'ভবিষ্যত উত্তরাধিকার · শিতল মন্দিরের কৃতজ্ঞতা',
                   kn: 'ಭವಿಷ್ಯದ ಪರಂಪರೆ · ಶಿತಲ್ ದೇವಾಲಯದ ಕೃತಜ್ಞತೆ' },
  add_your_name: { en: 'Add your name',    gu: 'તમારૂ નામ ઉમેરો',   hi: 'अपना नाम जोड़ें',  te: 'మీ పేరు జోడించండి', ta: 'உங்கள் பெயரைச் சேர்', pa: 'ਆਪਣਾ ਨਾਮ ਜੋੜੋ', mr: 'आपले नाव जोडा', bn: 'আপনার নাম যোগ করুন', kn: 'ನಿಮ್ಮ ಹೆಸರು ಸೇರಿಸಿ' },
  loading_wall:  { en: 'Loading the wall…', gu: 'દિવાલ લોડ થાય છે…', hi: 'दीवार लोड हो रही है…', te: 'గోడ లోడ్ అవుతోంది…', ta: 'சுவர் ஏற்றப்படுகிறது…', pa: 'ਦੀਵਾਰ ਲੋਡ ਹੋ ਰਹੀ ਹੈ…', mr: 'भिंत लोड होत आहे…', bn: 'দেয়াল লোড হচ্ছে…', kn: 'ಗೋಡೆ ಲೋಡ್ ಆಗುತ್ತಿದೆ…' },

  // ── Branch picker ───────────────────────────────────────────────────────
  any_centres:   { en: 'Any · All Centres', gu: 'કોઈપણ · બધા કેન્દ્રો', hi: 'कोई भी · सभी केंद्र',
                   te: 'ఏదైనా · అన్ని కేంద్రాలు', ta: 'ஏதேனும் · அனைத்து மையங்கள்',
                   pa: 'ਕੋਈ ਵੀ · ਸਾਰੇ ਕੇਂਦਰ', mr: 'कोणतेही · सर्व केंद्रे',
                   bn: 'যেকোনো · সকল কেন্দ্র', kn: 'ಯಾವುದೇ · ಎಲ್ಲಾ ಕೇಂದ್ರಗಳು' },
  temples:       { en: 'Temples',          gu: 'મંદિરો',             hi: 'मंदिर',             te: 'దేవాలయాలు',   ta: 'கோயில்கள்',      pa: 'ਮੰਦਰ',          mr: 'मंदिरे',      bn: 'মন্দিরসমূহ', kn: 'ದೇವಾಲಯಗಳು' },
  centres:       { en: 'Centres',          gu: 'કેન્દ્રો',            hi: 'केंद्र',            te: 'కేంద్రాలు',    ta: 'மையங்கள்',      pa: 'ਕੇਂਦਰ',          mr: 'केंद्रे',     bn: 'কেন্দ্রসমূহ', kn: 'ಕೇಂದ್ರಗಳು'  },
  enter:         { en: 'Enter',            gu: 'પ્રવેશ',              hi: 'प्रवेश',            te: 'ప్రవేశించు',   ta: 'உள்நுழை',       pa: 'ਦਾਖਲ ਹੋਵੋ',     mr: 'प्रवेश करा',  bn: 'প্রবেশ করুন', kn: 'ಪ್ರವೇಶಿಸಿ'  },
  welcome_to:    { en: 'Welcome to',       gu: 'સ્વાગત છે',           hi: 'स्वागत है',         te: 'స్వాగతం',      ta: 'வரவேற்கிறோம்',  pa: 'ਜੀ ਆਇਆਂ ਨੂੰ',    mr: 'स्वागत आहे',  bn: 'স্বাগতম',    kn: 'ಸ್ವಾಗತ'     },

  // ── Future Legacy Appeal (SqFtPageV2) ───────────────────────────────────
  // Hero
  sqft_eyebrow:       { en: 'Future Legacy Appeal',               gu: 'ભાવિ વારસો અપીલ',                 hi: 'भविष्य विरासत अपील',           te: 'భవిష్యత్ వారసత్వ విజ్ఞప్తి',      ta: 'எதிர்கால மரபுரிமை முறையீடு',       pa: 'ਭਵਿੱਖੀ ਵਿਰਾਸਤ ਅਪੀਲ',               mr: 'भविष्यातील वारसा आवाहन',    bn: 'ভবিষ্যৎ উত্তরাধিকার আবেদন',    kn: 'ಭವಿಷ್ಯದ ಪರಂಪರೆ ಮನವಿ' },
  sqft_title:         { en: 'Secure our ground · build our future', gu: 'જમીન સુરક્ષિત કરો · ભવિષ્ય બનાવો', hi: 'भूमि सुरक्षित करें · भविष्य बनाएँ', te: 'భూమిని రక్షించండి · భవిష్యత్తును నిర్మించండి', ta: 'நிலத்தை பாதுகாப்போம் · எதிர்காலத்தை கட்டுவோம்', pa: 'ਸਾਡੀ ਜ਼ਮੀਨ ਸੁਰੱਖਿਅਤ ਕਰੀਏ · ਭਵਿੱਖ ਬਣਾਈਏ', mr: 'जमीन सुरक्षित करू · भविष्य घडवू', bn: 'জমি সুরক্ষিত করুন · ভবিষ্যৎ গড়ুন', kn: 'ನಮ್ಮ ಭೂಮಿಯನ್ನು ಭದ್ರಗೊಳಿಸಿ · ಭವಿಷ್ಯ ನಿರ್ಮಿಸಿ' },
  sqft_subtitle:      { en: 'Pick a category, then a tier — or enter any amount. Every gift is Gift-Aided (+25%).',
                        gu: 'કેટેગરી પસંદ કરો, પછી ટાયર — અથવા કોઈપણ રકમ દાખલ કરો. દરેક દાન Gift-Aided (+25%) છે.',
                        hi: 'एक श्रेणी चुनें, फिर एक टियर — या कोई राशि दर्ज करें। हर दान Gift-Aided (+25%) है।',
                        te: 'ఒక వర్గాన్ని ఎంచుకోండి, ఆపై టైర్ — లేదా ఏ మొత్తాన్నైనా నమోదు చేయండి. ప్రతి దానం Gift-Aided (+25%).',
                        ta: 'வகையைத் தேர்ந்தெடுக்கவும், பின்னர் தரவரிசை — அல்லது எந்த தொகையையும் உள்ளிடவும். ஒவ்வொரு நன்கொடையும் Gift-Aided (+25%).',
                        pa: 'ਇੱਕ ਸ਼੍ਰੇਣੀ ਚੁਣੋ, ਫਿਰ ਟੀਅਰ — ਜਾਂ ਕੋਈ ਵੀ ਰਕਮ ਦਰਜ ਕਰੋ। ਹਰ ਦਾਨ Gift-Aided (+25%).',
                        mr: 'एक श्रेणी निवडा, नंतर एक टियर — किंवा कोणतीही रक्कम प्रविष्ट करा. प्रत्येक दान Gift-Aided (+25%).',
                        bn: 'একটি বিভাগ নির্বাচন করুন, তারপর একটি টিয়ার — অথবা যেকোনো পরিমাণ লিখুন। প্রতিটি দান Gift-Aided (+25%).',
                        kn: 'ಒಂದು ವರ್ಗವನ್ನು ಆಯ್ಕೆಮಾಡಿ, ನಂತರ ಟೈರ್ — ಅಥವಾ ಯಾವುದೇ ಮೊತ್ತವನ್ನು ನಮೂದಿಸಿ. ಪ್ರತಿ ದಾನವೂ Gift-Aided (+25%).' },
  // Level 1 headers
  sqft_choose_tier:   { en: 'Choose a tier',        gu: 'ટાયર પસંદ કરો',           hi: 'एक टियर चुनें',           te: 'టైర్ ఎంచుకోండి',        ta: 'தரவரிசையைத் தேர்ந்தெடுக்கவும்', pa: 'ਟੀਅਰ ਚੁਣੋ',            mr: 'टियर निवडा',         bn: 'একটি টিয়ার নির্বাচন করুন',  kn: 'ಟೈರ್ ಆಯ್ಕೆಮಾಡಿ' },
  sqft_select_offer:  { en: 'Select what you can offer', gu: 'તમે શું આપી શકો તે પસંદ કરો', hi: 'चुनें कि आप क्या दे सकते हैं', te: 'మీరు ఏమి అందించగలరో ఎంచుకోండి', ta: 'நீங்கள் என்ன வழங்க முடியும் என்பதைத் தேர்ந்தெடுக்கவும்', pa: 'ਚੁਣੋ ਕਿ ਤੁਸੀਂ ਕੀ ਪੇਸ਼ ਕਰ ਸਕਦੇ ਹੋ', mr: 'तुम्ही काय देऊ शकता ते निवडा', bn: 'আপনি যা দিতে পারেন তা নির্বাচন করুন', kn: 'ನೀವು ಏನನ್ನು ನೀಡಬಹುದು ಎಂದು ಆಯ್ಕೆಮಾಡಿ' },
  sqft_enter_amount:  { en: 'Enter an amount',      gu: 'રકમ દાખલ કરો',           hi: 'राशि दर्ज करें',          te: 'మొత్తాన్ని నమోదు చేయండి', ta: 'தொகையை உள்ளிடவும்',      pa: 'ਰਕਮ ਦਰਜ ਕਰੋ',           mr: 'रक्कम प्रविष्ट करा',   bn: 'পরিমাণ লিখুন',         kn: 'ಮೊತ್ತವನ್ನು ನಮೂದಿಸಿ' },
  sqft_tap_pledge:    { en: 'Tap to pledge £…',     gu: 'પ્રતિજ્ઞા માટે ટેપ £…',     hi: 'वचन देने के लिए टैप £…',   te: 'ప్రతిజ్ఞకు టాప్ £…',     ta: 'உறுதிமொழிக்கு தட்டவும் £…', pa: 'ਵਚਨ ਦੇਣ ਲਈ ਟੈਪ £…',    mr: 'वचनासाठी टॅप £…',     bn: 'প্রতিশ্রুতির জন্য ট্যাপ £…', kn: 'ಪ್ರತಿಜ್ಞೆಗಾಗಿ ಟ್ಯಾಪ್ £…' },

  // Level 0 category tile names
  cat_brick:          { en: 'Brick',                gu: 'ઈંટ',                     hi: 'ईंट',                    te: 'ఇటుక',                  ta: 'செங்கல்',                pa: 'ਇੱਟ',                   mr: 'वीट',                 bn: 'ইট',                   kn: 'ಇಟ್ಟಿಗೆ' },
  cat_sqft:           { en: 'Square Feet',          gu: 'ચોરસ ફૂટ',                 hi: 'वर्ग फुट',                te: 'చదరపు అడుగులు',          ta: 'சதுர அடி',                pa: 'ਵਰਗ ਫੁੱਟ',              mr: 'चौरस फूट',            bn: 'বর্গফুট',              kn: 'ಚದರ ಅಡಿ' },
  cat_material:       { en: 'Materials',            gu: 'સામગ્રી',                 hi: 'सामग्री',                te: 'సామగ్రి',               ta: 'பொருட்கள்',              pa: 'ਸਮਾਨ',                  mr: 'साहित्य',             bn: 'উপকরণ',                kn: 'ಸಾಮಗ್ರಿ' },
  cat_volunt:         { en: 'Volunteering',         gu: 'સ્વયંસેવક',                hi: 'स्वयंसेवा',               te: 'స్వచ్ఛందసేవ',           ta: 'தன்னார்வத் தொண்டு',       pa: 'ਸਵੈਸੇਵਾ',               mr: 'स्वयंसेवा',           bn: 'স্বেচ্ছাসেবা',          kn: 'ಸ್ವಯಂಸೇವಕ' },
  cat_services:       { en: 'Professional Services', gu: 'વ્યવસાયિક સેવા',          hi: 'व्यावसायिक सेवाएँ',       te: 'వృత్తిపర సేవలు',         ta: 'தொழில்முறை சேவைகள்',     pa: 'ਪੇਸ਼ੇਵਰ ਸੇਵਾਵਾਂ',       mr: 'व्यावसायिक सेवा',     bn: 'পেশাদার পরিষেবা',       kn: 'ವೃತ್ತಿಪರ ಸೇವೆಗಳು' },
  cat_business:       { en: 'Business Sponsorship', gu: 'વ્યવસાય પ્રાયોજન',         hi: 'व्यवसाय प्रायोजन',        te: 'వ్యాపార ప్రాయోజకత్వం',   ta: 'வணிக ஆதரவு',             pa: 'ਕਾਰੋਬਾਰ ਸਪਾਂਸਰਸ਼ਿਪ',    mr: 'व्यवसाय प्रायोजन',    bn: 'ব্যবসা স্পনসরশিপ',     kn: 'ವ್ಯಾಪಾರ ಪ್ರಾಯೋಜನ' },
  cat_general:        { en: 'General Donation',     gu: 'સામાન્ય દાન',              hi: 'सामान्य दान',             te: 'సాధారణ దానం',           ta: 'பொது நன்கொடை',            pa: 'ਆਮ ਦਾਨ',                 mr: 'सामान्य दान',         bn: 'সাধারণ দান',           kn: 'ಸಾಮಾನ್ಯ ದಾನ' },
  cat_any:            { en: 'Any Amount',           gu: 'કોઈપણ રકમ',                hi: 'कोई भी राशि',             te: 'ఏదైనా మొత్తం',           ta: 'எந்த தொகையும்',           pa: 'ਕੋਈ ਵੀ ਰਕਮ',              mr: 'कोणतीही रक्कम',       bn: 'যেকোনো পরিমাণ',         kn: 'ಯಾವುದೇ ಮೊತ್ತ' },

  // Level 0 captions
  cap_brick:          { en: 'Red to Founder · as you wish',          gu: 'લાલથી સ્થાપક · તમારી ઇચ્છા પ્રમાણે',     hi: 'लाल से संस्थापक · जैसा आप चाहें',       te: 'ఎరుపు నుండి స్థాపకుడు · మీ ఇష్టం',         ta: 'சிவப்பு முதல் ஸ்தாபகர் · உங்கள் விருப்பம்',   pa: 'ਲਾਲ ਤੋਂ ਸੰਸਥਾਪਕ · ਤੁਹਾਡੀ ਇੱਛਾ ਅਨੁਸਾਰ',   mr: 'लाल ते संस्थापक · तुमच्या इच्छेनुसार',   bn: 'লাল থেকে প্রতিষ্ঠাতা · আপনার ইচ্ছামতো',  kn: 'ಕೆಂಪು ಇಂದ ಸ್ಥಾಪಕ · ನಿಮ್ಮ ಇಚ್ಛೆಯಂತೆ' },
  cap_sqft:           { en: 'Any size · as you can afford',          gu: 'કોઈપણ કદ · તમે પોષાય તે પ્રમાણે',        hi: 'कोई आकार · जो आप दे सकें',              te: 'ఏ పరిమాణమైనా · మీరు ఇవ్వగలిగినంత',         ta: 'எந்த அளவு · உங்களால் முடிந்த அளவு',          pa: 'ਕੋਈ ਵੀ ਆਕਾਰ · ਜੋ ਤੁਸੀਂ ਦੇ ਸਕੋ',          mr: 'कोणताही आकार · तुम्हाला शक्य तेवढे',    bn: 'যেকোনো আকার · আপনি যত দিতে পারেন',   kn: 'ಯಾವುದೇ ಗಾತ್ರ · ನಿಮಗೆ ಸಾಧ್ಯವಾದಷ್ಟು' },
  cap_material:       { en: 'Help supply the build',                 gu: 'બાંધકામમાં સામગ્રી આપો',                hi: 'निर्माण में सामग्री दें',               te: 'నిర్మాణానికి సామగ్రి ఇవ్వండి',            ta: 'கட்டுமானத்திற்கு பொருட்கள் கொடுக்கவும்',    pa: 'ਉਸਾਰੀ ਲਈ ਸਮਾਨ ਦਿਓ',                    mr: 'बांधकामासाठी साहित्य द्या',             bn: 'নির্মাণে উপকরণ দিন',                   kn: 'ಕಟ್ಟಡಕ್ಕೆ ಸಾಮಗ್ರಿ ನೀಡಿ' },
  cap_volunt:         { en: 'Help supply the build',                 gu: 'બાંધકામમાં સામગ્રી આપો',                hi: 'निर्माण में सामग्री दें',               te: 'నిర్మాణానికి సామగ్రి ఇవ్వండి',            ta: 'கட்டுமானத்திற்கு பொருட்கள் கொடுக்கவும்',    pa: 'ਉਸਾਰੀ ਲਈ ਸਮਾਨ ਦਿਓ',                    mr: 'बांधकामासाठी साहित्य द्या',             bn: 'নির্মাণে উপকরণ দিন',                   kn: 'ಕಟ್ಟಡಕ್ಕೆ ಸಾಮಗ್ರಿ ನೀಡಿ' },
  cap_services:       { en: 'Share your skill or sponsor it',        gu: 'તમારી કુશળતા આપો અથવા પ્રાયોજન કરો',    hi: 'अपना कौशल दें या प्रायोजन करें',        te: 'మీ నైపుణ్యం పంచుకోండి లేదా ప్రాయోజకత్వం చేయండి', ta: 'உங்கள் திறமையைப் பகிரவும் அல்லது ஆதரவு',    pa: 'ਆਪਣਾ ਹੁਨਰ ਸਾਂਝਾ ਕਰੋ ਜਾਂ ਸਪਾਂਸਰ ਕਰੋ',    mr: 'कौशल्य द्या किंवा प्रायोजन करा',        bn: 'আপনার দক্ষতা ভাগ করুন বা স্পনসর করুন',  kn: 'ನಿಮ್ಮ ಕೌಶಲ್ಯ ಹಂಚಿಕೊಳ್ಳಿ ಅಥವಾ ಪ್ರಾಯೋಜಿಸಿ' },
  cap_business:       { en: 'A lasting partnership',                 gu: 'કાયમી ભાગીદારી',                      hi: 'स्थायी साझेदारी',                       te: 'శాశ్వత భాగస్వామ్యం',                      ta: 'நிலையான கூட்டாண்மை',                        pa: 'ਸਥਾਈ ਭਾਈਵਾਲੀ',                          mr: 'कायमस्वरूपी भागीदारी',                 bn: 'স্থায়ী অংশীদারিত্ব',                   kn: 'ಶಾಶ್ವತ ಪಾಲುದಾರಿಕೆ' },
  cap_general:        { en: "Where it's needed most",                gu: 'જ્યાં સૌથી વધુ જરૂરી છે',               hi: 'जहाँ सबसे अधिक आवश्यकता हो',              te: 'ఎక్కడ అత్యవసరమో',                         ta: 'எங்கு மிகவும் தேவையோ',                       pa: 'ਜਿੱਥੇ ਸਭ ਤੋਂ ਵੱਧ ਲੋੜ ਹੈ',              mr: 'जिथे सर्वात जास्त गरज आहे',            bn: 'যেখানে সবচেয়ে বেশি প্রয়োজন',           kn: 'ಹೆಚ್ಚು ಬೇಕಾಗಿರುವಲ್ಲಿ' },
  cap_any:            { en: 'Give what you wish',                    gu: 'જે તમારી ઇચ્છા હોય તે આપો',             hi: 'जो आप चाहें वह दें',                    te: 'మీకు ఇష్టమైనది ఇవ్వండి',                 ta: 'உங்கள் விருப்பப்படி கொடுக்கவும்',           pa: 'ਜੋ ਤੁਸੀਂ ਚਾਹੋ ਦਿਓ',                    mr: 'तुम्हाला पाहिजे ते द्या',               bn: 'যা ইচ্ছা দিন',                          kn: 'ನಿಮಗೆ ಇಷ್ಟವಾದಷ್ಟು ನೀಡಿ' },
}

export function t(key: string, lang: Language): string {
  return T[key]?.[lang] ?? T[key]?.en ?? key
}
