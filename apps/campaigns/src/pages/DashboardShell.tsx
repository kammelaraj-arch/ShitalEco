import { ReactNode } from 'react'
import { useAuth, type Screen } from '../store'

const NAV: { label: string; screen: Screen }[] = [
  { label: 'Dashboard',      screen: 'dashboard' },
  { label: 'Audiences',      screen: 'audiences' },
  { label: 'Templates',      screen: 'templates' },
  { label: 'Campaigns',      screen: 'campaigns' },
  { label: 'Deliverability', screen: 'deliverability' },
]

export function DashboardShell({ children }: { children: ReactNode }) {
  const screen   = useAuth((s) => s.screen)
  const setScreen = useAuth((s) => s.setScreen)
  const email    = useAuth((s) => s.email)
  const logout   = useAuth((s) => s.logout)

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-white/10 bg-black/20 p-4 hidden md:block">
        <div className="font-black text-lg mb-6 tracking-wide">SHITAL<br/><span className="text-yellow-500">Campaigns</span></div>
        <nav className="space-y-1">
          {NAV.map(item => (
            <button key={item.screen}
              onClick={() => setScreen(item.screen)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                screen === item.screen ? 'bg-yellow-500/10 text-yellow-400' : 'hover:bg-white/5'
              }`}>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="flex-1 min-w-0">
        <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/10">
          <h1 className="font-bold capitalize">{screen}</h1>
          <div className="flex items-center gap-3 text-xs opacity-70">
            <span>{email}</span>
            <button onClick={logout} className="underline hover:opacity-100">Sign out</button>
          </div>
        </header>
        {children}
      </main>
    </div>
  )
}
