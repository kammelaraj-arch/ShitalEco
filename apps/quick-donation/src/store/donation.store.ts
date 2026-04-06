import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type Screen = 'donate' | 'processing' | 'tap' | 'confirmation' | 'admin'

export const DEFAULT_AMOUNT = 5

export interface DonationState {
  screen: Screen
  amount: number
  defaultAmount: number
  branchId: string
  stripeReaderId: string
  stripeReaderLabel: string
  orderId: string | null
  orderRef: string | null
  paymentIntentId: string | null
  clientSecret: string | null

  setScreen: (screen: Screen) => void
  setAmount: (amount: number) => void
  setDefaultAmount: (amount: number) => void
  setBranchId: (id: string) => void
  setReader: (readerId: string, label: string) => void
  setOrderResult: (orderId: string, ref: string, piId: string, secret: string) => void
  reset: () => void
}

export const useDonationStore = create<DonationState>()(
  persist(
    (set, get) => ({
      screen: 'donate',
      amount: 0,
      defaultAmount: DEFAULT_AMOUNT,
      branchId: 'main',
      stripeReaderId: '',
      stripeReaderLabel: 'Temple WisePOS E',
      orderId: null,
      orderRef: null,
      paymentIntentId: null,
      clientSecret: null,

      setScreen: (screen) => set({ screen }),
      setAmount: (amount) => set({ amount }),
      setDefaultAmount: (defaultAmount) => set({ defaultAmount }),
      setBranchId: (branchId) => set({ branchId }),
      setReader: (stripeReaderId, stripeReaderLabel) => set({ stripeReaderId, stripeReaderLabel }),
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
        defaultAmount: state.defaultAmount,
      }),
    }
  )
)
