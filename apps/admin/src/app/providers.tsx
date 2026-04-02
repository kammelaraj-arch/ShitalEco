'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1a0a00',
            color: '#fff',
            border: '1px solid rgba(255,153,51,0.2)',
            borderRadius: '12px',
          },
          success: { iconTheme: { primary: '#FF9933', secondary: '#fff' } },
        }}
      />
    </QueryClientProvider>
  )
}
