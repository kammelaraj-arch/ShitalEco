import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Screen = 'login' | 'dashboard' | 'audiences' | 'templates' | 'campaigns' | 'deliverability'

interface AuthState {
  token: string
  email: string
  role: string
  screen: Screen
  setAuth: (token: string, email: string, role: string) => void
  logout: () => void
  setScreen: (s: Screen) => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: '',
      email: '',
      role: '',
      screen: 'login',
      setAuth: (token, email, role) => set({ token, email, role, screen: 'dashboard' }),
      logout: () => set({ token: '', email: '', role: '', screen: 'login' }),
      setScreen: (screen) => set({ screen }),
    }),
    { name: 'campaigns:auth' }
  )
)
