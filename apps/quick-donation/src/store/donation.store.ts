import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type Screen = 'idle' | 'donate' | 'processing' | 'tap' | 'confirmation' | 'admin'

export interface DonationState {
  screen: Screen
  amount: number
  branchId: string
  stripeReaderId: string
  stripeReaderLabel: string
  orderId: string | null
  orderRef: string | null
  paymentIntentId: string | null
  clientSecret: string | null

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

  setScreen: (screen: Screen) => void
  setAmount: (amount: number) => void
  setBranchId: (id: string) => void
  setReader: (readerId: string, label: string) => void
  setDeviceFlags: (flags: { showMonthlyGiving: boolean; enableGiftAid: boolean; tapAndGo: boolean; donateTitle: string; monthlyGivingText: string; monthlyGivingAmount: number }) => void
  setOrderResult: (orderId: string, ref: string, piId: string, secret: string) => void
  setDeviceLoggedIn: (loggedIn: boolean, name: string) => void
  reset: () => void
}

export const useDonationStore = create<DonationState>()(
  persist(
    (set) => ({
      screen: 'donate',
      amount: 0,
      branchId: 'main',
      stripeReaderId: '',
      stripeReaderLabel: 'Temple WisePOS E',
      orderId: null,
      orderRef: null,
      paymentIntentId: null,
      clientSecret: null,

      showMonthlyGiving: false,
      enableGiftAid: false,
      tapAndGo: true,
      donateTitle: 'Tap & Donate',
      monthlyGivingText: 'Make a big impact from just £5/month',
      monthlyGivingAmount: 5,

      isDeviceLoggedIn: false,
      loggedInName: '',

      setScreen: (screen) => set({ screen }),
      setAmount: (amount) => set({ amount }),
      setBranchId: (branchId) => set({ branchId }),
      setReader: (stripeReaderId, stripeReaderLabel) => set({ stripeReaderId, stripeReaderLabel }),
      setDeviceFlags: (flags) => set(flags),
      setDeviceLoggedIn: (isDeviceLoggedIn, loggedInName) => set({ isDeviceLoggedIn, loggedInName }),
      setOrderResult: (orderId, orderRef, paymentIntentId, clientSecret) =>
        set({ orderId, orderRef, paymentIntentId, clientSecret }),
      reset: () =>
        set({
          screen: 'donate',
          amount: 0,
          orderId: null,
          orderRef: null,
          paymentIntentId: null,
          clientSecret: null,
        }),
    }),
    {
      name: 'shital-quick-donation-config',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        branchId: state.branchId,
        stripeReaderId: state.stripeReaderId,
        stripeReaderLabel: state.stripeReaderLabel,
        showMonthlyGiving: state.showMonthlyGiving,
        enableGiftAid: state.enableGiftAid,
        tapAndGo: state.tapAndGo,
        donateTitle: state.donateTitle,
        monthlyGivingText: state.monthlyGivingText,
        monthlyGivingAmount: state.monthlyGivingAmount,
        isDeviceLoggedIn: state.isDeviceLoggedIn,
        loggedInName: state.loggedInName,
      }),
    }
  )
)
