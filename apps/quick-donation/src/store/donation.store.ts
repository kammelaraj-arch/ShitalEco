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

  setScreen: (screen: Screen) => void
  setAmount: (amount: number) => void
  setBranchId: (id: string) => void
  setReader: (readerId: string, label: string) => void
  setOrderResult: (orderId: string, ref: string, piId: string, secret: string) => void
  reset: () => void
}

export const useDonationStore = create<DonationState>()(
  persist(
    (set) => ({
      screen: 'idle',
      amount: 0,
      branchId: 'main',
      stripeReaderId: '',
      stripeReaderLabel: 'Temple WisePOS E',
      orderId: null,
      orderRef: null,
      paymentIntentId: null,
      clientSecret: null,

      setScreen: (screen) => set({ screen }),
      setAmount: (amount) => set({ amount }),
      setBranchId: (branchId) => set({ branchId }),
      setReader: (stripeReaderId, stripeReaderLabel) => set({ stripeReaderId, stripeReaderLabel }),
      setOrderResult: (orderId, orderRef, paymentIntentId, clientSecret) =>
        set({ orderId, orderRef, paymentIntentId, clientSecret }),
      reset: () =>
        set({
          screen: 'idle',
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
      }),
    }
  )
)
