import { Sidebar } from '@/components/layout/Sidebar'
import { AuthGuard } from '@/components/AuthGuard'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-screen bg-temple-deep overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="min-h-full p-8">{children}</div>
        </main>
      </div>
    </AuthGuard>
  )
}
