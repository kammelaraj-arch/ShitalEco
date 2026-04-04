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
  | 'idle' | 'language' | 'home' | 'services' | 'service-detail'
  | 'donate' | 'basket' | 'checkout' | 'payment' | 'confirmation'
  | 'admin' | 'admin-pin' | 'soft-donation' | 'project-donation' | 'shop'
  | 'gift-aid' | 'receipt'

export interface EndScreenTemplate {
  icon: string          // e.g. "🕉"
  thankYouLine: string  // e.g. "Jay Shri Krishna 🙏"
  subMessage: string    // optional extra line
}

export type Language = 'en' | 'gu' | 'hi' | 'te' | 'ta' | 'pa' | 'mr' | 'bn' | 'kn'

export const LANGUAGE_META: Record<Language, { label: string; script: string; name: string }> = {
  en: { label: 'EN', script: 'English',    name: 'English'    },
  gu: { label: 'ગુ', script: 'ગુજરાતી',  name: 'Gujarati'   },
  hi: { label: 'हि', script: 'हिन्दी',    name: 'Hindi'      },
  te: { label: 'తె', script: 'తెలుగు',    name: 'Telugu'     },
  ta: { label: 'த',  script: 'தமிழ்',     name: 'Tamil'      },
  pa: { label: 'ਪੰ', script: 'ਪੰਜਾਬੀ',   name: 'Punjabi'    },
  mr: { label: 'म',  script: 'मराठी',     name: 'Marathi'    },
  bn: { label: 'বাং',script: 'বাংলা',     name: 'Bengali'    },
  kn: { label: 'ಕ',  script: 'ಕನ್ನಡ',    name: 'Kannada'    },
}

export interface FormTextConfig {
  noFormHeading: string
  noFormSub: string
  anonymousLabel: string
  anonymousSub: string
  nameLabel: string
  emailLabel: string
  phoneLabel: string
  gdprTitle: string
  gdprText: string
  termsTitle: string
  termsText: string
}

const DEFAULT_FORM_TEXT: FormTextConfig = {
  noFormHeading: 'Your Contact Details',
  noFormSub: 'Provide your details to receive a receipt. All fields are optional unless marked.',
  anonymousLabel: 'Donate Anonymously',
  anonymousSub: 'Your name and contact details will not be recorded.',
  nameLabel: 'Full Name',
  emailLabel: 'Email Address',
  phoneLabel: 'Phone Number',
  gdprTitle: 'Data Protection (GDPR)',
  gdprText: 'Your personal data will be held securely for our records in accordance with UK GDPR. It will not be shared with third parties or used for marketing without your consent.',
  termsTitle: 'Terms & Conditions',
  termsText: 'By proceeding you confirm that your donation is made voluntarily and you agree to our charitable donation terms.',
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
  cardProvider: 'stripe_terminal' | 'square' | 'cash'
  stripeReaderId: string
  stripeReaderLabel: string
  squareDeviceId: string
  squareDeviceName: string
  giftAidDeclaration: {
    agreed: boolean; fullName: string; postcode: string
    address: string; contactEmail: string; contactPhone: string
  } | null
  contactInfo: {
    name: string; email: string; phone: string
    gdprConsent: boolean; termsConsent: boolean; anonymous: boolean
  } | null
  pendingPayment: boolean
  endScreenTemplate: EndScreenTemplate
  setEndScreenTemplate: (t: EndScreenTemplate) => void
  formTextConfig: FormTextConfig
  setFormTextConfig: (c: FormTextConfig) => void
  setGiftAidDeclaration: (decl: KioskState['giftAidDeclaration']) => void
  setContactInfo: (info: KioskState['contactInfo']) => void
  setPendingPayment: (v: boolean) => void
  setScreen: (screen: KioskScreen) => void
  setLanguage: (lang: Language) => void
  setTheme: (theme: KioskTheme) => void
  setBranchId: (id: string) => void
  setCardDevice: (provider: 'stripe_terminal' | 'square' | 'cash', deviceId: string, deviceLabel: string) => void
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
  contactInfo: null,
  pendingPayment: false,
  endScreenTemplate: { icon: '🕉', thankYouLine: 'Jay Shri Krishna 🙏', subMessage: '' },
  setEndScreenTemplate: (endScreenTemplate) => set({ endScreenTemplate }),
  formTextConfig: DEFAULT_FORM_TEXT,
  setFormTextConfig: (formTextConfig) => set({ formTextConfig }),
  cardProvider: 'stripe_terminal',
  stripeReaderId: 'tmr_Gcuz1QQB6nzqMs',
  stripeReaderLabel: 'Temple WisePOS E',
  squareDeviceId: '',
  squareDeviceName: '',
  setGiftAidDeclaration: (giftAidDeclaration) => set({ giftAidDeclaration }),
  setContactInfo: (contactInfo) => set({ contactInfo }),
  setPendingPayment: (pendingPayment) => set({ pendingPayment }),
  setScreen: (screen) => set({ screen }),
  setLanguage: (language) => set({ language }),
  setTheme: (theme) => set({ theme }),
  setBranchId: (branchId) => set({ branchId }),
  setCardDevice: (provider, deviceId, deviceLabel) => set(
    provider === 'stripe_terminal'
      ? { cardProvider: provider, stripeReaderId: deviceId, stripeReaderLabel: deviceLabel }
      : provider === 'square'
      ? { cardProvider: provider, squareDeviceId: deviceId, squareDeviceName: deviceLabel }
      : { cardProvider: provider }
  ),
  setBasketId: (basketId) => set({ basketId }),
  addItem: (item) => set((state) => {
    const existing = state.items.find((i) => i.referenceId === item.referenceId && i.type === item.type)
    if (existing) {
      return { items: state.items.map((i) => i.id === existing.id ? { ...i, quantity: i.quantity + item.quantity, totalPrice: (i.quantity + item.quantity) * i.unitPrice } : i) }
    }
    return { items: [...state.items, { ...item, id: crypto.randomUUID() }] }
  }),
  removeItem: (id) => set((state) => ({ items: state.items.filter((i) => i.id !== id) })),
  updateQuantity: (id, qty) => set((state) => ({
    items: qty <= 0 ? state.items.filter((i) => i.id !== id) : state.items.map((i) => i.id === id ? { ...i, quantity: qty, totalPrice: qty * i.unitPrice } : i),
  })),
  clearBasket: () => set({ items: [], basketId: null }),
  setOrderResult: (orderId, orderRef, paymentIntent) => set({ orderId, orderRef, paymentIntent }),
  resetKiosk: () => set({ screen: 'idle', items: [], basketId: null, orderId: null, orderRef: null, paymentIntent: null, giftAidDeclaration: null, contactInfo: null, pendingPayment: false }),
  get total() { return get().items.reduce((sum, i) => sum + i.totalPrice, 0) },
  get itemCount() { return get().items.reduce((sum, i) => sum + i.quantity, 0) },
    }),
    {
      name: 'shital-kiosk-config',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        cardProvider: state.cardProvider,
        stripeReaderId: state.stripeReaderId,
        stripeReaderLabel: state.stripeReaderLabel,
        squareDeviceId: state.squareDeviceId,
        squareDeviceName: state.squareDeviceName,
        branchId: state.branchId,
        endScreenTemplate: state.endScreenTemplate,
        formTextConfig: state.formTextConfig,
      }),
    }
  )
)

export const t = (key: string, lang: Language): string => {
  return TRANSLATIONS[key]?.[lang] ?? TRANSLATIONS[key]?.en ?? key
}

const TRANSLATIONS: Record<string, Record<Language, string>> = {
  'touch_to_start': { en: 'Touch to Begin',         gu: 'શરૂ કરવા સ્પર્શ કરો', hi: 'शुरू करने के लिए छुएं', te: 'ప్రారంభించడానికి స్పర్శించండి', ta: 'தொடங்க தொடவும்',      pa: 'ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਛੋਹੋ',   mr: 'सुरू करण्यासाठी स्पर्श करा', bn: 'শুরু করতে স্পর্শ করুন', kn: 'ಪ್ರಾರಂಭಿಸಲು ಸ್ಪರ್ಶಿಸಿ' },
  'welcome':        { en: 'Welcome',                 gu: 'સ્વાગત છે',           hi: 'स्वागत है',             te: 'స్వాగతం',                          ta: 'வரவேற்கிறோம்',         pa: 'ਜੀ ਆਇਆਂ ਨੂੰ',          mr: 'स्वागत आहे',                  bn: 'স্বাগতম',                kn: 'ಸ್ವಾಗತ'           },
  'choose_language':{ en: 'Choose Language',         gu: 'ભાષા પસંદ કરો',       hi: 'भाषा चुनें',            te: 'భాష ఎంచుకోండి',                   ta: 'மொழி தேர்ந்தெடுங்கள்', pa: 'ਭਾਸ਼ਾ ਚੁਣੋ',            mr: 'भाषा निवडा',                  bn: 'ভাষা বেছে নিন',          kn: 'ಭಾಷೆ ಆಯ್ಕೆ ಮಾಡಿ'  },
  'home':           { en: 'Home',                    gu: 'ઘર',                  hi: 'होम',                   te: 'హోమ్',                             ta: 'முகப்பு',               pa: 'ਘਰ',                    mr: 'मुख्यपृष्ठ',                  bn: 'হোম',                    kn: 'ಮನೆ'              },
  'services':       { en: 'Temple Services',         gu: 'મંદિર સેવાઓ',          hi: 'मंदिर सेवाएं',          te: 'దేవాలయ సేవలు',                    ta: 'கோயில் சேவைகள்',       pa: 'ਮੰਦਰ ਸੇਵਾਵਾਂ',         mr: 'मंदिर सेवा',                  bn: 'মন্দির সেবা',            kn: 'ದೇವಾಲಯ ಸೇವೆಗಳು' },
  'donate':         { en: 'Make a Donation',         gu: 'દાન કરો',             hi: 'दान करें',              te: 'దానం చేయండి',                     ta: 'நன்கொடை வழங்கவும்',    pa: 'ਦਾਨ ਕਰੋ',               mr: 'देणगी करा',                   bn: 'দান করুন',               kn: 'ದಾನ ಮಾಡಿ'         },
  'basket':         { en: 'My Basket',               gu: 'મારી ટોપલી',          hi: 'मेरी टोकरी',            te: 'నా బాస్కెట్',                     ta: 'என் கூட',               pa: 'ਮੇਰੀ ਟੋਕਰੀ',           mr: 'माझी टोपली',                  bn: 'আমার ঝুড়ি',             kn: 'ನನ್ನ ಬುಟ್ಟಿ'      },
  'checkout':       { en: 'Checkout',                gu: 'ચૂકવો',               hi: 'चेकआउट',               te: 'చెక్అవుట్',                        ta: 'கட்டணம் செலுத்துங்கள்',pa: 'ਭੁਗਤਾਨ ਕਰੋ',            mr: 'चेकआउट',                      bn: 'চেকআউট',                 kn: 'ಚೆಕ್ಔಟ್'          },
  'total':          { en: 'Total',                   gu: 'કુલ',                 hi: 'कुल',                   te: 'మొత్తం',                           ta: 'மொத்தம்',               pa: 'ਕੁੱਲ',                  mr: 'एकूण',                        bn: 'মোট',                    kn: 'ಒಟ್ಟು'            },
  'add_to_basket':  { en: 'Add to Basket',           gu: 'ટોપલીમાં ઉમેરો',      hi: 'टोकरी में जोड़ें',       te: 'బాస్కెట్‌కు జోడించు',             ta: 'கூடையில் சேர்க்கவும்', pa: 'ਟੋਕਰੀ ਵਿੱਚ ਜੋੜੋ',     mr: 'टोपलीत जोडा',                bn: 'ঝুড়িতে যোগ করুন',       kn: 'ಬುಟ್ಟಿಗೆ ಸೇರಿಸಿ'  },
  'pay_now':        { en: 'Pay Now',                 gu: 'હમણાં ચૂકવો',         hi: 'अभी भुगतान करें',       te: 'ఇప్పుడు చెల్లించు',               ta: 'இப்போது செலுத்துங்கள்',pa: 'ਹੁਣੇ ਭੁਗਤਾਨ ਕਰੋ',       mr: 'आता पैसे द्या',               bn: 'এখনই পেমেন্ট করুন',     kn: 'ಈಗ ಪಾವತಿಸಿ'       },
  'thank_you':      { en: 'Thank You',               gu: 'આભાર',                hi: 'धन्यवाद',               te: 'ధన్యవాదాలు',                      ta: 'நன்றி',                 pa: 'ਧੰਨਵਾਦ',                mr: 'धन्यवाद',                     bn: 'ধন্যবাদ',                kn: 'ಧನ್ಯವಾದ'          },
  'cancel':         { en: 'Cancel',                  gu: 'રદ કરો',              hi: 'रद्द करें',             te: 'రద్దు చేయి',                      ta: 'ரத்து செய்யவும்',       pa: 'ਰੱਦ ਕਰੋ',               mr: 'रद्द करा',                    bn: 'বাতিল করুন',             kn: 'ರದ್ದುಗೊಳಿಸಿ'      },
  'back':           { en: 'Back',                    gu: 'પાછળ',                hi: 'वापस',                  te: 'వెనక్కి',                          ta: 'பின்னால்',              pa: 'ਵਾਪਸ',                  mr: 'परत',                         bn: 'পিছনে',                  kn: 'ಹಿಂದೆ'            },
  'jay_shri_krishna':{ en: 'Jay Shri Krishna 🙏',   gu: 'જય શ્રી કૃષ્ણ 🙏',   hi: 'जय श्री कृष्ण 🙏',     te: 'జయ శ్రీ కృష్ణ 🙏',                ta: 'ஜெய் ஸ்ரீ கிருஷ்ணா 🙏', pa: 'ਜੈ ਸ਼੍ਰੀ ਕ੍ਰਿਸ਼ਨ 🙏',   mr: 'जय श्री कृष्ण 🙏',           bn: 'জয় শ্রী কৃষ্ণ 🙏',      kn: 'ಜಯ ಶ್ರೀ ಕೃಷ್ಣ 🙏'  },
}
