'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const token = sessionStorage.getItem('shital_access_token')
    if (!token) {
      router.replace('/login')
    } else {
      // Keep a cookie so Next.js middleware can also protect server-side
      document.cookie = `shital_token=1; path=/; max-age=3600; SameSite=Lax`
      setReady(true)
    }
  }, [pathname, router])

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: '#0f0f1a' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl"
            style={{ background: 'linear-gradient(135deg, #d97706, #ea580c)' }}>
            🕉️
          </div>
          <p className="text-white/40 text-sm font-medium animate-pulse">Checking session…</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
