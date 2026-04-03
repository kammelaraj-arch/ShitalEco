'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { clsx } from 'clsx'

const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', icon: '🏗️', label: 'Dashboard' },
      { href: '/ai', icon: '🧠', label: 'Digital Brain' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/finance', icon: '💰', label: 'Accounts' },
      { href: '/finance/journal', icon: '📒', label: 'Journal' },
      { href: '/donations', icon: '🙏', label: 'Donations' },
      { href: '/gift-aid', icon: '🇬🇧', label: 'Gift Aid' },
      { href: '/budgets', icon: '📊', label: 'Budgets' },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/hr', icon: '👥', label: 'Employees' },
      { href: '/hr/leave', icon: '🌴', label: 'Leave' },
      { href: '/hr/timesheets', icon: '⏱️', label: 'Timesheets' },
      { href: '/payroll', icon: '💷', label: 'Payroll' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/assets', icon: '🏗️', label: 'Assets' },
      { href: '/bookings', icon: '📅', label: 'Bookings' },
      { href: '/documents', icon: '📁', label: 'Documents' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { href: '/compliance', icon: '⚖️', label: 'Compliance' },
      { href: '/audit', icon: '🔍', label: 'Audit Log' },
    ],
  },
  {
    label: 'Kiosk',
    items: [
      { href: '/kiosk/services',  icon: '🛕', label: 'Services' },
      { href: '/kiosk/orders',    icon: '🧾', label: 'Orders' },
      { href: '/terminal-devices', icon: '💳', label: 'Terminal Devices' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/settings/branches', icon: '🌿', label: 'Branches' },
      { href: '/settings/users', icon: '🔐', label: 'Users & Roles' },
      { href: '/settings/azure-ad', icon: '🔷', label: 'Azure AD / SSO' },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 h-screen flex-shrink-0 glass border-r border-temple-border flex flex-col sticky top-0 overflow-hidden">
      {/* Logo */}
      <div className="px-6 py-6 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-saffron-gradient flex items-center justify-center text-xl shadow-saffron">
            🕉️
          </div>
          <div>
            <p className="text-white font-black text-base leading-none">Shital</p>
            <p className="text-white/40 text-xs">Admin Portal</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-6">
            <p className="text-white/25 text-[10px] font-semibold uppercase tracking-widest px-3 mb-2">
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
                          isActive
                            ? 'bg-saffron-400/15 text-saffron-400 border border-saffron-400/20'
                            : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                        )}
                      >
                        <span className="text-lg">{item.icon}</span>
                        <span className="font-medium text-sm">{item.label}</span>
                        {isActive && (
                          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-saffron-400" />
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

      {/* User profile */}
      <div className="px-4 py-4 border-t border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3 px-2">
          <div className="w-9 h-9 rounded-full bg-saffron-gradient flex items-center justify-center text-sm font-bold text-white">
            A
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold truncate">Admin User</p>
            <p className="text-white/30 text-xs truncate">SUPER_ADMIN</p>
          </div>
          <button className="text-white/30 hover:text-white/60 text-sm transition-colors">⚙️</button>
        </div>
      </div>
    </aside>
  )
}