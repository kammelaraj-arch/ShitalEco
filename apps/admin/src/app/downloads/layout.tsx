// Public layout for /downloads — no AuthGuard, no sidebar. This page needs to
// be reachable before anyone logs in so trustees/volunteers can install the
// Shital App or grab a Kiosk installer from a shared device.

export default function DownloadsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: '#0a0404' }}>
      <header
        className="sticky top-0 z-30 flex items-center gap-3 px-4 md:px-8 py-3"
        style={{ background: '#180a0a', borderBottom: '1px solid rgba(185,28,28,0.2)' }}
      >
        <img src="/admin/icons/shital-192.svg" alt="" width={28} height={28} className="rounded" />
        <span className="text-white font-black text-sm">Shital — Downloads</span>
        <a
          href="/admin/login/"
          className="ml-auto text-xs font-bold text-saffron-300 hover:text-saffron-200 transition-colors"
        >
          Sign in →
        </a>
      </header>
      <main className="p-4 md:p-8 max-w-5xl mx-auto">{children}</main>
    </div>
  )
}
