import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useKioskStore, THEMES, KioskTheme } from '../store/kiosk.store'
import { SHOP_ITEMS } from '../data/catalog'
import { StaffMenu } from '../components/StaffMenu'

const FILTERS = ['All', 'Puja', 'Books', 'Murtis', 'Malas', 'Prasad']
const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

// Print a sample receipt — fires the kiosk_print_receipt template (admin-
// editable in Settings → Email Templates) with placeholder data so staff
// can verify the printer + cut position without doing a real transaction.
async function testPrintReceipt() {
  const sampleItems = [
    { name: 'General Donation', qty: 1, total: 11.00 },
    { name: 'Prasad',           qty: 2, total: 5.00 },
    { name: 'Mandir Seva',      qty: 1, total: 21.00 },
  ]
  const itemsHtml = `
    <div style="border-top:1px dashed #000;padding-top:6px;margin-bottom:6px;">
      ${sampleItems.map(i => `
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
          <span>${i.name} x${i.qty}</span><span style="font-weight:700;">£${i.total.toFixed(2)}</span>
        </div>`).join('')}
    </div>`
  const total = sampleItems.reduce((s, i) => s + i.total, 0).toFixed(2)
  try {
    const res = await fetch(`${API_BASE}/kiosk/print-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branch_name: 'Shital Wembley',
        donor_name:  'Test Print',
        order_ref:   'TEST-' + Date.now().toString().slice(-6),
        items_html:  itemsHtml,
        total,
        payment_method: 'TEST RECEIPT',
      }),
    })
    if (!res.ok) throw new Error(`render ${res.status}`)
    const { html } = await res.json()

    // Open a hidden iframe with just the rendered receipt and print it.
    // Avoids dragging the whole kiosk page into the print preview.
    const f = document.createElement('iframe')
    f.style.position = 'fixed'
    f.style.right = '-9999px'
    f.style.bottom = '-9999px'
    f.style.width  = '80mm'
    f.style.height = '0'
    document.body.appendChild(f)
    const doc = f.contentWindow?.document
    if (!doc) return
    doc.open()
    doc.write(`<!doctype html><html><head><style>@page{size:80mm auto;margin:0}body{margin:0}</style></head><body>${html}</body></html>`)
    doc.close()
    setTimeout(() => {
      const win = f.contentWindow
      if (win) {
        try { win.focus(); win.print() } catch { /* ignore */ }
      }
      setTimeout(() => f.remove(), 2000)
    }, 200)
  } catch (e) {
    alert(`Test print failed: ${e instanceof Error ? e.message : 'unknown'}`)
  }
}

function filterItems(items: typeof SHOP_ITEMS, f: string) {
  if (f === 'All') return items
  if (f === 'Puja') return items.filter(i => ['PUJA_ITEMS', 'INCENSE', 'DIYA'].includes(i.category))
  if (f === 'Books') return items.filter(i => i.category === 'BOOKS')
  if (f === 'Murtis') return items.filter(i => i.category === 'MURTIS')
  if (f === 'Malas') return items.filter(i => i.category === 'MALAS')
  if (f === 'Prasad') return items.filter(i => i.category === 'PRASAD')
  return items
}

export function ShopScreen() {
  const { language, setScreen, addItem, items, theme, setTheme } = useKioskStore()
  const th = THEMES[theme]
  // Theme cycler from the gear menu — quick way for staff to flip themes
  // without leaving the Shop screen.
  const themeKeys: KioskTheme[] = ['lotus', 'saffron', 'royal', 'peacock', 'jasmine', 'crimson']
  const cycleTheme = () => {
    const next = themeKeys[(themeKeys.indexOf(theme) + 1) % themeKeys.length]
    setTheme(next)
  }
  const [filter, setFilter] = useState('All')
  const [added, setAdded] = useState<string | null>(null)

  const basketCount = items.reduce((s, i) => s + i.quantity, 0)
  const basketTotal = items.reduce((s, i) => s + i.totalPrice, 0)
  const filtered = filterItems(SHOP_ITEMS, filter)

  const getName = (item: typeof SHOP_ITEMS[0]) =>
    language === 'gu' ? (item.nameGu || item.name) : language === 'hi' ? (item.nameHi || item.name) : item.name

  const handleAdd = (item: typeof SHOP_ITEMS[0]) => {
    addItem({ type: 'SERVICE', name: item.name, quantity: 1, unitPrice: item.price, totalPrice: item.price, referenceId: item.id, giftAidEligible: false })
    setAdded(item.id)
    setTimeout(() => setAdded(null), 1300)
  }

  return (
    <div className="w-full h-full flex flex-col" style={{ background: th.mainBg }}>
      <header className="flex items-center gap-3 px-4 py-3 flex-shrink-0 border-b"
        style={{ background: th.headerBg, borderColor: 'rgba(0,0,0,0.08)' }}>
        <button onClick={() => setScreen('home')} className="px-3 py-2 rounded-xl text-sm font-semibold active:scale-95"
          style={{ color: th.sectionCountColor, background: `${th.langActive}15` }}>← Back</button>
        <div className="flex-1">
          <h1 className="font-black text-lg" style={{ color: th.headerText }}>
            🛍️ {language === 'gu' ? 'મંદિર શૉપ' : language === 'hi' ? 'मंदिर शॉप' : 'Temple Shop'}
          </h1>
          <p className="text-xs opacity-60" style={{ color: th.headerText }}>
            {filtered.length} items available
          </p>
        </div>
        <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-xl">
          <span className="text-gray-500 text-sm">✗</span>
          <span className="text-gray-600 font-bold text-xs">Not Gift Aid</span>
        </div>
        <StaffMenu
          iconBg="white"
          items={[
            { emoji: '🖨️', label: 'Test print receipt',    onClick: testPrintReceipt },
            { emoji: '🎨', label: `Cycle theme (${theme})`, onClick: cycleTheme },
            { emoji: '🔄', label: 'Refresh site',           onClick: () => window.location.reload() },
            { emoji: '🔧', label: 'Admin settings',         onClick: () => setScreen('admin') },
          ]}
        />
        <button onClick={() => setScreen('basket')} className="relative text-white font-bold px-3 py-2 rounded-xl active:scale-95"
          style={{ background: th.basketBtn }}>
          🛒
          {basketCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-yellow-400 text-gray-900 text-xs font-black w-5 h-5 rounded-full flex items-center justify-center">{basketCount}</span>
          )}
        </button>
      </header>

      {/* Filters */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-bold border-2 transition-all"
            style={{ background: filter === f ? th.basketBtn : 'white', color: filter === f ? 'white' : '#6B7280', borderColor: filter === f ? th.basketBtn : '#E5E7EB' }}>
            {f}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth: 'none' }}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filtered.map((item, i) => {
            const isAdded = added === item.id
            return (
              <motion.div key={item.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.025 }}
                className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="h-2 w-full" style={{ background: item.imageColor }} />
                <div className="p-3 flex flex-col items-center">
                  <div className="text-3xl mb-2">{item.emoji}</div>
                  <p className="font-bold text-gray-900 text-sm text-center leading-tight mb-1">{getName(item)}</p>
                  {item.description && <p className="text-gray-400 text-xs text-center mb-1 line-clamp-1">{item.description}</p>}
                  <p className="font-black text-base mb-2" style={{ color: th.sectionCountColor }}>£{item.price.toFixed(2)}</p>
                  <button onClick={() => handleAdd(item)}
                    className="w-full py-2 rounded-xl text-white font-bold text-sm active:scale-95 relative overflow-hidden"
                    style={{ background: `linear-gradient(135deg,${th.basketBtn},${th.basketBtnHover})` }}>
                    <AnimatePresence>
                      {isAdded ? (
                        <motion.span key="added" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          className="absolute inset-0 flex items-center justify-center bg-green-500 text-white">✓ Added</motion.span>
                      ) : <span>+ Add to basket</span>}
                    </AnimatePresence>
                  </button>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      <AnimatePresence>
        {basketCount > 0 && (
          <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }}
            className="flex-shrink-0 flex items-center justify-between px-5 py-3"
            style={{ background: th.basketBarBg, borderTop: `2px solid rgba(255,153,51,0.3)` }}>
            <div>
              <p className="text-xs opacity-60" style={{ color: th.basketBarText }}>{basketCount} items</p>
              <p className="font-black text-lg" style={{ color: th.basketBarSubText }}>£{basketTotal.toFixed(2)}</p>
            </div>
            <button onClick={() => setScreen('basket')} className="text-white font-black px-6 py-2.5 rounded-xl text-sm active:scale-95"
              style={{ background: th.basketBtn }}>View Basket →</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// (Shared StaffMenu lives in ../components/StaffMenu.tsx — used on
// both HomeScreen and here so all staff actions live under one ⚙️ icon.)
