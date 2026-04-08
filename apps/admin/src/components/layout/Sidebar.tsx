'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { clsx } from 'clsx'
import { useBranding } from '@/lib/branding'

const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard',         icon: '🏗️', label: 'Dashboard' },
      { href: '/ai',                icon: '🧠', label: 'Digital Brain' },
      { href: '/ai/functions',      icon: '⚙️', label: 'Function Registry' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/finance',           icon: '💰', label: 'Accounts' },
      { href: '/finance/journal',   icon: '📒', label: 'Journal' },
      { href: '/finance/recurring', icon: '🔄', label: 'Recurring Payments' },
      { href: '/donations',         icon: '🙏', label: 'Donations' },
      { href: '/gift-aid',          icon: '🇬🇧', label: 'Gift Aid' },
      { href: '/budgets',           icon: '📊', label: 'Budgets' },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/hr',                icon: '👥', label: 'Employees' },
      { href: '/hr/leave',          icon: '🌴', label: 'Leave' },
      { href: '/hr/timesheets',     icon: '⏱️', label: 'Timesheets' },
      { href: '/payroll',           icon: '💷', label: 'Payroll' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/assets',            icon: '🏗️', label: 'Assets' },
      { href: '/bookings',          icon: '📅', label: 'Bookings' },
      { href: '/documents',         icon: '📁', label: 'Documents' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { href: '/compliance',        icon: '⚖️', label: 'Compliance' },
      { href: '/audit',             icon: '🔍', label: 'Audit Log' },
    ],
  },
  {
    label: 'Kiosk',
    items: [
      { href: '/kiosk/projects',    icon: '🏗️', label: 'Projects' },
      { href: '/kiosk/services',    icon: '🛕', label: 'Services' },
      { href: '/kiosk/items',       icon: '📦', label: 'Catalog Items' },
      { href: '/kiosk/orders',      icon: '🧾', label: 'Orders' },
      { href: '/terminal-devices',  icon: '💳', label: 'Terminal Devices' },
    ],
  },
  {
    label: 'Smart Screen',
    items: [
      { href: '/screen',            icon: '📺', label: 'Screen Profiles' },
      { href: '/screen/content',    icon: '🎬', label: 'Content Library' },
      { href: '/screen/playlists',  icon: '▶️', label: 'Playlists' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/settings/branding',         icon: '🎨', label: 'Branding' },
      { href: '/settings/email-templates',  icon: '📧', label: 'Email Templates' },
      { href: '/settings/branches',         icon: '🌿', label: 'Branches' },
      { href: '/settings/users',            icon: '🔐', label: 'Users & Roles' },
      { href: '/settings/azure-ad',         icon: '🔷', label: 'Azure AD / SSO' },
      { href: '/settings/address-lookup',   icon: '📮', label: 'Address Lookup' },
      { href: '/settings/api-keys',         icon: '🔑', label: 'API Keys' },
    ],
  },
]

interface SidebarProps {
  open?: boolean
  onClose?: () => void
}

export function Sidebar({ open = true, onClose }: SidebarProps) {
  const pathname = usePathname()
  const { branding } = useBranding()

  return (
    <aside
      className={clsx(
        'w-64 h-screen flex-shrink-0 flex flex-col',
        // Desktop: sticky in flow; Mobile: fixed overlay with slide transition
        'fixed md:sticky top-0 left-0 z-50 md:z-auto',
        'transition-transform duration-300 ease-in-out',
        open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      )}
      style={{
        background: 'linear-gradient(180deg,#180a0a 0%,#0d0404 100%)',
        borderRight: '1px solid rgba(185,28,28,0.2)',
      }}
    >
      {/* Logo / Brand */}
      <div
        className="px-5 py-5 flex-shrink-0 flex items-center gap-3"
        style={{ borderBottom: '1px solid rgba(185,28,28,0.15)' }}
      >
        {branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.logoUrl}
            alt={branding.orgName}
            className="h-10 w-10 rounded-xl object-contain flex-shrink-0"
            style={{ background: 'rgba(185,28,28,0.15)', padding: '2px' }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xl flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}
          >
            🛕
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-white font-black text-base leading-none truncate">{branding.orgName}</p>
          <p className="text-white/40 text-xs mt-0.5">{branding.orgSubtitle}</p>
        </div>
        {/* Mobile close button */}
        <button
          className="md:hidden w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white transition-colors flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.06)' }}
          onClick={onClose}
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-5">
            <p className="text-white/20 text-[10px] font-semibold uppercase tracking-widest px-3 mb-1.5">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                return (
                  <li key={item.href}>
                    <Link href={item.href}>
                      <motion.div
                        whileHover={{ x: 2 }}
                        whileTap={{ scale: 0.98 }}
                        className={clsx(
                          'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all',
                          isActive ? 'text-white' : 'text-white/45 hover:text-white/80 hover:bg-white/5'
                        )}
                        style={isActive ? {
                          background: 'rgba(185,28,28,0.18)',
                          border: '1px solid rgba(185,28,28,0.28)',
                        } : {}}
                      >
                        <span className="text-lg leading-none">{item.icon}</span>
                        <span className="font-medium text-sm flex-1">{item.label}</span>
                        {isActive && (
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#E01010' }} />
                        )}
                      </motion.div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User profile footer */}
      <div className="px-4 py-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(185,28,28,0.15)' }}>
        <div className="flex items-center gap-3 px-2">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-black text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}
          >
            A
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold truncate">Admin User</p>
            <p className="text-white/30 text-xs truncate">SUPER_ADMIN</p>
          </div>
          <Link href="/settings/branding" className="text-white/30 hover:text-white/60 text-sm transition-colors" title="Branding Settings">
            🎨
          </Link>
        </div>
      </div>
    </aside>
  )
}
