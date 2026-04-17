'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

const PATH_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  ai: 'Digital Brain',
  functions: 'Function Registry',
  finance: 'Accounts',
  journal: 'Journal',
  donations: 'Donations',
  'gift-aid': 'Gift Aid',
  budgets: 'Budgets',
  hr: 'HR',
  leave: 'Leave',
  timesheets: 'Timesheets',
  payroll: 'Payroll',
  assets: 'Assets',
  bookings: 'Bookings',
  documents: 'Documents',
  compliance: 'Compliance',
  audit: 'Audit Log',
  kiosk: 'Kiosk',
  services: 'Services',
  items: 'Catalog Items',
  orders: 'Orders',
  'terminal-devices': 'Terminal Devices',
  settings: 'Settings',
  branding: 'Branding',
  'email-templates': 'Email Templates',
  branches: 'Branches',
  users: 'Users & Roles',
  'azure-ad': 'Azure AD / SSO',
}

export function Breadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  // Don't show on top-level pages (dashboard, finance, hr, etc.)
  if (segments.length <= 1) return null

  const crumbs = segments.map((seg, i) => {
    const href = '/' + segments.slice(0, i + 1).join('/')
    const label = PATH_LABELS[seg] ?? (seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' '))
    const isLast = i === segments.length - 1
    return { href, label, isLast }
  })

  return (
    <nav className="flex items-center gap-1 text-xs mb-5 flex-wrap" aria-label="Breadcrumb">
      <Link href="/dashboard" className="transition-colors" style={{ color: 'rgba(255,255,255,0.3)' }}
        onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.6)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}
      >
        Home
      </Link>
      {crumbs.map(({ href, label, isLast }) => (
        <span key={href} className="flex items-center gap-1">
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>/</span>
          {isLast ? (
            <span className="font-medium" style={{ color: 'rgba(255,255,255,0.55)' }}>{label}</span>
          ) : (
            <Link href={href} className="transition-colors" style={{ color: 'rgba(255,255,255,0.3)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.6)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}
            >
              {label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}
