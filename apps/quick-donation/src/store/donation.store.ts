import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type Screen = 'donate' | 'processing' | 'tap' | 'confirmation' | 'admin' | 'project-tiers' | 'project-contact'
export type ReaderProvider = 'stripe_terminal' | 'sumup' | 'clover' | ''
export type DonationMode = 'quick' | 'project'
export interface LinkedProject { id: string; name: string }

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

  // The kiosk_devices.id this kiosk is logged in as. Set from the login
  // response, sent on every /quick-donation/record so donations carry
  // per-device attribution for the Incoming Funds dashboard. Empty when
  // logged in via a legacy account with no kiosk_devices row.
  kioskDeviceId: string

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
  confirmationText: string
  kioskTheme: string
  orgLogoUrl: string
  orgName: string
  bgColor: string

  // Persistent login — survives reboots; cleared only by explicit logout
  isDeviceLoggedIn: boolean
  loggedInName: string
  loggedInUsername: string  // raw username used to login, for refresh-config calls

  // Server-controlled config version. Stored at login / refresh-config and
  // compared against the value the heartbeat returns. Mismatch means the
  // admin changed the device config in the portal since this client last
  // pulled, so the client fires one /refresh-config call and updates. Until
  // then the cached reader + flags are trusted — no per-donation lookup.
  profileVersion: number

  // Project donation mode (set by admin per-device).
  //   'quick'   → existing tap-and-go amount tiles (unchanged)
  //   'project' → new 9-tile category grid → tier picker → contact form
  donationMode: DonationMode
  linkedProjects: LinkedProject[]       // resolved from linked_project_ids
  guptDaanEnabled: boolean               // show the anonymous tile?
  enabledTiles: string[]                 // ordered tile ids; [] = use default
  // Which category the donor tapped on the project start screen
  // (brick / sqft / material / volunt / services / business / general /
  // gupt / any) — picks which tier list ProjectTiersScreen shows.
  pickedCategory: string

  // Editable tier catalog sent by the backend at login time. Shape:
  //   { brick:    [{label, price, sub, image_url, featured, order}, ...],
  //     sqft:     [...], ... }
  // Empty / missing category → ProjectTiersScreen uses its hardcoded
  // defaults for that category. null = no profile attached, defaults
  // used everywhere (zero-config kiosk still works out of the box).
  tierProfile: { id: string; name: string; config: Record<string, Array<{
    label: string; price: number; sub?: string; image_url?: string;
    featured?: boolean; order?: number
  }>> } | null

  _hasHydrated: boolean
  setHasHydrated: (v: boolean) => void

  setScreen: (screen: Screen) => void
  setAmount: (amount: number) => void
  setBranchId: (id: string) => void
  setReader: (readerId: string, label: string, provider?: ReaderProvider, sumupSerial?: string, sumupApiId?: string, cloverDeviceId?: string) => void
  setKioskDeviceId: (id: string) => void
  setProfileVersion: (v: number) => void
  setDonationMode: (mode: DonationMode, projects: LinkedProject[], guptDaanEnabled: boolean, enabledTiles: string[]) => void
  setPickedCategory: (cat: string) => void
  setTierProfile: (p: DonationState['tierProfile']) => void
  setDeviceFlags: (flags: { showMonthlyGiving: boolean; enableGiftAid: boolean; tapAndGo: boolean; donateTitle: string; monthlyGivingText: string; monthlyGivingAmount: number; confirmationText: string; kioskTheme: string; orgLogoUrl: string; orgName: string; bgColor: string }) => void
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
      kioskDeviceId: '',
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
      confirmationText: '',
      kioskTheme: 'saffron',
      orgLogoUrl: '',
      orgName: '',
      bgColor: '',

      isDeviceLoggedIn: false,
      loggedInName: '',
      loggedInUsername: '',
      profileVersion: 0,

      donationMode: 'quick',
      linkedProjects: [],
      guptDaanEnabled: false,
      enabledTiles: [],
      pickedCategory: '',
      tierProfile: null,

      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),

      setScreen: (screen) => set({ screen }),
      setAmount: (amount) => set({ amount }),
      setBranchId: (branchId) => set({ branchId }),
      setReader: (stripeReaderId, stripeReaderLabel, readerProvider = '', sumupReaderId = '', sumupReaderApiId = '', cloverDeviceId = '') =>
        set({ stripeReaderId, stripeReaderLabel, readerProvider, sumupReaderId, sumupReaderApiId, cloverDeviceId }),
      setKioskDeviceId: (kioskDeviceId) => set({ kioskDeviceId }),
      setProfileVersion: (profileVersion) => set({ profileVersion }),
      setDonationMode: (donationMode, linkedProjects, guptDaanEnabled, enabledTiles) =>
        set({ donationMode, linkedProjects, guptDaanEnabled, enabledTiles }),
      setPickedCategory: (pickedCategory) => set({ pickedCategory }),
      setTierProfile: (tierProfile) => set({ tierProfile }),
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
        kioskDeviceId: state.kioskDeviceId,
        showMonthlyGiving: state.showMonthlyGiving,
        enableGiftAid: state.enableGiftAid,
        tapAndGo: state.tapAndGo,
        donateTitle: state.donateTitle,
        monthlyGivingText: state.monthlyGivingText,
        monthlyGivingAmount: state.monthlyGivingAmount,
        confirmationText: state.confirmationText,
        kioskTheme: state.kioskTheme,
        orgLogoUrl: state.orgLogoUrl,
        orgName: state.orgName,
        bgColor: state.bgColor,
        isDeviceLoggedIn: state.isDeviceLoggedIn,
        loggedInName: state.loggedInName,
        loggedInUsername: state.loggedInUsername,
        profileVersion: state.profileVersion,
        donationMode: state.donationMode,
        linkedProjects: state.linkedProjects,
        guptDaanEnabled: state.guptDaanEnabled,
        enabledTiles: state.enabledTiles,
        tierProfile: state.tierProfile,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)
