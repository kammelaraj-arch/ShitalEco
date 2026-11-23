import { useAuth } from './store'
import { LoginPage } from './pages/LoginPage'
import { DashboardShell } from './pages/DashboardShell'
import { AudiencesPage } from './pages/AudiencesPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { CampaignsPage } from './pages/CampaignsPage'
import { DeliverabilityPage } from './pages/DeliverabilityPage'

export default function App() {
  const token = useAuth((s) => s.token)
  const screen = useAuth((s) => s.screen)

  if (!token) return <LoginPage />

  const page =
    screen === 'audiences'      ? <AudiencesPage /> :
    screen === 'templates'      ? <TemplatesPage /> :
    screen === 'campaigns'      ? <CampaignsPage /> :
    screen === 'deliverability' ? <DeliverabilityPage /> :
    /* default */                 <DashboardOverview />

  return <DashboardShell>{page}</DashboardShell>
}

function DashboardOverview() {
  const setScreen = useAuth((s) => s.setScreen)
  const tiles: { label: string; blurb: string; to: Parameters<typeof setScreen>[0] }[] = [
    { label: 'Audiences',       blurb: 'Saved donor segments — SQL over contacts, donations, RGs.',  to: 'audiences' },
    { label: 'Templates',       blurb: 'Email, SMS and WhatsApp templates with merge variables.',    to: 'templates' },
    { label: 'Campaigns',       blurb: 'Compose, schedule and send to a selected audience.',         to: 'campaigns' },
    { label: 'Deliverability',  blurb: 'Bounce rate, opens, clicks, unsubscribes — by channel.',     to: 'deliverability' },
  ]
  return (
    <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-4xl">
      {tiles.map(t => (
        <button key={t.label} onClick={() => setScreen(t.to)}
          className="text-left rounded-xl p-5 border border-white/10 bg-white/5 hover:bg-white/10 transition-colors">
          <div className="font-bold text-lg">{t.label}</div>
          <div className="text-sm opacity-70 mt-1">{t.blurb}</div>
        </button>
      ))}
    </div>
  )
}
