import React, { useState } from 'react'

export interface StaffMenuItem {
  label: string
  emoji: string
  onClick: () => void
}

/**
 * Discreet staff menu — single ⚙️ icon that opens a dropdown of staff
 * actions (theme change, test print, admin login, etc). Used on the
 * HomeScreen and ShopScreen so all staff controls live under one icon.
 */
export function StaffMenu({
  items,
  iconBg = 'rgba(255,255,255,0.15)',
  iconColor,
}: {
  items: StaffMenuItem[]
  iconBg?: string
  iconColor?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Staff menu"
        className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95"
        style={{ background: iconBg, color: iconColor }}>
        <span className="text-base">⚙️</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-xl bg-white border border-gray-200 shadow-lg overflow-hidden">
            {items.map((it, i) => (
              <button
                key={i}
                onClick={() => { setOpen(false); it.onClick() }}
                className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2 border-b border-gray-100 last:border-0">
                <span>{it.emoji}</span>
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
