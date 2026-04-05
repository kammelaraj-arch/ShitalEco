'use client'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { AuthGuard } from '@/components/AuthGuard'
import { BrandingProvider } from '@/lib/branding'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  return (
    <BrandingProvider>
      <AuthGuard>
        <div className="flex h-screen overflow-hidden" style={{ background: '#0a0404' }}>
          {/* Mobile backdrop */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 md:hidden"
              style={{ background: 'rgba(0,0,0,0.6)' }}
              onClick={() => setSidebarOpen(false)}
            />
          )}

          <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

          <main className="flex-1 overflow-y-auto min-w-0 flex flex-col" style={{ overflowX: 'clip' }}>
            {/* Mobile top bar */}
            <div
              className="md:hidden flex items-center gap-3 px-4 py-3 flex-shrink-0 sticky top-0 z-30"
              style={{ background: '#180a0a', borderBottom: '1px solid rgba(185,28,28,0.2)' }}
            >
              <button
                onClick={() => setSidebarOpen(true)}
                className="text-white/60 hover:text-white transition-colors"
                style={{ fontSize: 22, lineHeight: 1 }}
                aria-label="Open menu"
              >
                ☰
              </button>
              <span className="text-white font-black text-sm">Shital Admin</span>
            </div>

            <div className="flex-1 p-4 md:p-8">
              <Breadcrumbs />
              {children}
            </div>
          </main>
        </div>
      </AuthGuard>
    </BrandingProvider>
  )
}
