import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Shital — Business Portal',
  description: 'Internal business portal for SHITAL (UK Charity No. 1138530)',
  manifest: '/manifest.json',
  // Apple doesn't honour `web_app_manifest`'s `name` for the home-screen
  // label — set these explicitly so iOS installs show "Shital App" too.
  appleWebApp: {
    capable: true,
    title: 'Shital App',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/icons/shital-192.svg', type: 'image/svg+xml' },
      { url: '/icons/shital-512.svg', type: 'image/svg+xml', sizes: '512x512' },
    ],
    apple: [{ url: '/icons/shital-512.svg' }],
  },
}

// Dark theme-colour so the Android status bar matches the admin's dark
// background instead of flashing white on cold-start.
export const viewport: Viewport = {
  themeColor: '#0a0a12',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
