import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type Screen = 'donate' | 'processing' | 'tap' | 'confirmation' | 'admin'
export type ReaderProvider = 'stripe_terminal' | 'sumup' | 'clover' | ''

export interface GiftAidData {
  firstName: string
  surname: string
  houseNum: string
  postcode: string
  email: string
}

export interface DonationState {
  screen: Screen
  amount: number
  branchId: string

  // Card reader — provider determines which payment flow is used
  readerProvider: ReaderProvider
  stripeReaderId: string
  stripeReaderLabel: string
  sumupReaderId: string          // SumUp Solo serial number
  sumupReaderApiId: string       // SumUp reader API id (used in checkout push URL)
  cloverDeviceId: string         // Clover Flex device ID

  orderId: string | null
  orderRef: string | null
  paymentIntentId: string | null  // Stripe: payment intent ID; SumUp: checkout ID
  clientSecret: string | null

  // Gift Aid — collected on kiosk before card tap, cleared after record call
  pendingGiftAid: GiftAidData | null

  // Device feature flags (set on login, persisted)
  showMonthlyGiving: boolean
  enableGiftAid: boolean
  tapAndGo: boolean
  donateTitle: string
  monthlyGivingText: string
  monthlyGivingAmount: number

  // Persistent login — survives reboots; cleared only by explicit logout
  isDeviceLoggedIn: boolean
  loggedInName: string
  loggedInUsername: string  // raw username used to login, for refresh-config calls

  _hasHydrated: boolean
  setHasHydrated: (v: boolean) => void

  setScreen: (screen: Screen) => void
  setAmount: (amount: number) => void
  setBranchId: (id: string) => void
  setReader: (readerId: string, label: string, provider?: ReaderProvider, sumupSerial?: string, sumupApiId?: string, cloverDeviceId?: string) => void
  setDeviceFlags: (flags: { showMonthlyGiving: boolean; enableGiftAid: boolean; tapAndGo: boolean; donateTitle: string; monthlyGivingText: string; monthlyGivingAmount: number }) => void
  setOrderResult: (orderId: string, ref: string, piId: string, secret: string) => void
  setDeviceLoggedIn: (loggedIn: boolean, name: string, username?: string) => void
  setPendingGiftAid: (data: GiftAidData | null) => void
  reset: () => void
}

export const useDonationStore = create<DonationState>()(
  persist(
    (set) => ({
      screen: 'donate',
      amount: 0,
      branchId: 'main',
      readerProvider: '',
      stripeReaderId: '',
      stripeReaderLabel: 'Temple Card Reader',
      sumupReaderId: '',
      sumupReaderApiId: '',
      cloverDeviceId: '',
      orderId: null,
      orderRef: null,
      paymentIntentId: null,
      clientSecret: null,
      pendingGiftAid: null,

      showMonthlyGiving: false,
      enableGiftAid: false,
      tapAndGo: true,
      donateTitle: 'Tap & Donate',
      monthlyGivingText: 'Make a big impact from just £5/month',
      monthlyGivingAmount: 5,

      isDeviceLoggedIn: false,
      loggedInName: '',
      loggedInUsername: '',

      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),

      setScreen: (screen) => set({ screen }),
      setAmount: (amount) => set({ amount }),
      setBranchId: (branchId) => set({ branchId }),
      setReader: (stripeReaderId, stripeReaderLabel, readerProvider = '', sumupReaderId = '', sumupReaderApiId = '', cloverDeviceId = '') =>
        set({ stripeReaderId, stripeReaderLabel, readerProvider, sumupReaderId, sumupReaderApiId, cloverDeviceId }),
      setDeviceFlags: (flags) => set(flags),
      setDeviceLoggedIn: (isDeviceLoggedIn, loggedInName, username) => set({
        isDeviceLoggedIn, loggedInName,
        ...(username !== undefined ? { loggedInUsername: username } : {}),
      }),
      setOrderResult: (orderId, orderRef, paymentIntentId, clientSecret) =>
        set({ orderId, orderRef, paymentIntentId, clientSecret }),
      setPendingGiftAid: (pendingGiftAid) => set({ pendingGiftAid }),
      reset: () =>
        set({
          screen: 'donate',
          amount: 0,
          orderId: null,
          orderRef: null,
          paymentIntentId: null,
          clientSecret: null,
          pendingGiftAid: null,
        }),
    }),
    {
      name: 'shital-quick-donation-config',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        branchId: state.branchId,
        readerProvider: state.readerProvider,
        stripeReaderId: state.stripeReaderId,
        stripeReaderLabel: state.stripeReaderLabel,
        sumupReaderId: state.sumupReaderId,
        sumupReaderApiId: state.sumupReaderApiId,
        cloverDeviceId: state.cloverDeviceId,
        showMonthlyGiving: state.showMonthlyGiving,
        enableGiftAid: state.enableGiftAid,
        tapAndGo: state.tapAndGo,
        donateTitle: state.donateTitle,
        monthlyGivingText: state.monthlyGivingText,
        monthlyGivingAmount: state.monthlyGivingAmount,
        isDeviceLoggedIn: state.isDeviceLoggedIn,
        loggedInName: state.loggedInName,
        loggedInUsername: state.loggedInUsername,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)
