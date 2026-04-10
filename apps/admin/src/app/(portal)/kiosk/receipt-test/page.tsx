'use client'
import { useState } from 'react'

// ── Sample data for the test receipt ──────────────────────────────────────────
const SAMPLE = {
  orderRef: 'TEST-0000',
  date: new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }),
  branchName: 'Shital Wembley',
  donorName: 'Test Donor',
  items: [
    { name: 'General Donation',      quantity: 1, total: 10.00 },
    { name: 'Prasad',                quantity: 2, total: 10.00 },
    { name: 'Mandir Seva',           quantity: 1, total: 21.00 },
  ],
  total: 41.00,
  charityNumber: '1234567',
  giftAid: false,
}

const PRINT_WIDTH = 80 // mm

// ─────────────────────────────────────────────────────────────────────────────
export default function ReceiptTestPage() {
  const [donor, setDonor]   = useState(SAMPLE.donorName)
  const [branch, setBranch] = useState(SAMPLE.branchName)
  const [giftAid, setGiftAid] = useState(false)
  const giftAidAmount = (SAMPLE.total * 0.25).toFixed(2)

  function handlePrint() {
    window.print()
  }

  return (
    <div className="max-w-2xl space-y-6">

      {/* ── Print-only stylesheet ──────────────────────────────────────── */}
      <style>{`
        @media screen { .receipt-print { display: none; } }
        @media print {
          body * { visibility: hidden !important; }
          .receipt-print,
          .receipt-print * { visibility: visible !important; }
          .receipt-print {
            position: fixed !important;
            top: 0 !important; left: 0 !important;
            width: ${PRINT_WIDTH}mm !important;
            padding: 6mm !important;
            background: white !important;
            font-family: 'Courier New', monospace !important;
            font-size: 10pt !important;
            color: black !important;
          }
        }
      `}</style>

      {/* ── Page header ───────────────────────────────────────────────── */}
      <div>
        <h1 className="text-white font-black text-2xl">Receipt Printer Test</h1>
        <p className="text-white/40 text-sm mt-1">
          Preview the receipt format and send a test print to verify your printer.
        </p>
      </div>

      {/* ── Controls ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <p className="text-white/60 text-xs font-bold uppercase tracking-widest">Test Receipt Data</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-white/40 text-xs mb-1.5">Donor Name</label>
            <input
              value={donor}
              onChange={e => setDonor(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-500/40"
            />
          </div>
          <div>
            <label className="block text-white/40 text-xs mb-1.5">Branch</label>
            <input
              value={branch}
              onChange={e => setBranch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-500/40"
            />
          </div>
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={giftAid} onChange={e => setGiftAid(e.target.checked)}
            className="w-4 h-4 accent-amber-500" />
          <span className="text-white/60 text-sm">Include Gift Aid (adds 25% declaration to receipt)</span>
        </label>
      </div>

      {/* ── On-screen receipt preview ──────────────────────────────────── */}
      <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <p className="text-white/60 text-xs font-bold uppercase tracking-widest mb-4">Receipt Preview (80mm thermal)</p>

        {/* Receipt card */}
        <div className="mx-auto bg-white rounded-xl shadow-2xl overflow-hidden" style={{ maxWidth: 320, fontFamily: "'Courier New', monospace" }}>
          <ReceiptContent donor={donor} branch={branch} giftAid={giftAid} giftAidAmount={giftAidAmount} />
        </div>
      </div>

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handlePrint}
          className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-white font-black text-sm transition-all active:scale-95"
          style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)', boxShadow: '0 4px 14px rgba(185,28,28,0.35)' }}
        >
          🖨 Print Test Receipt
        </button>
        <p className="text-white/30 text-xs self-center">
          Make sure the receipt printer is connected and set as the default printer before printing.
        </p>
      </div>

      {/* ── Tips ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-5 space-y-3" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)' }}>
        <p className="text-amber-400 text-xs font-bold uppercase tracking-widest">Printer Setup Tips</p>
        <ul className="text-white/50 text-sm space-y-1.5 list-disc list-inside">
          <li>Set paper size to <strong className="text-white/70">80mm × Roll</strong> in printer preferences</li>
          <li>Set margins to <strong className="text-white/70">0mm</strong> (borderless / no margins)</li>
          <li>Font: <strong className="text-white/70">Courier New 10pt</strong> — already set in the receipt</li>
          <li>Disable headers/footers in the browser print dialog</li>
          <li>On Chrome/Edge: click <em className="text-white/60">More settings → Paper size → Manage custom sizes</em></li>
        </ul>
      </div>

      {/* ── Hidden receipt for printing ───────────────────────────────── */}
      <div className="receipt-print">
        <ReceiptContent donor={donor} branch={branch} giftAid={giftAid} giftAidAmount={giftAidAmount} forPrint />
      </div>
    </div>
  )
}

// ── Shared receipt component (screen preview + actual print) ─────────────────

interface ReceiptProps {
  donor: string
  branch: string
  giftAid: boolean
  giftAidAmount: string
  forPrint?: boolean
}

function ReceiptContent({ donor, branch, giftAid, giftAidAmount, forPrint }: ReceiptProps) {
  const now = new Date()
  const dateStr = now.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const fs = forPrint ? {} : { fontSize: 11 }
  const hr  = { borderTop: '1px dashed #000', margin: '6px 0' }
  const row = { display: 'flex', justifyContent: 'space-between', marginBottom: 3 } as React.CSSProperties

  return (
    <div style={{ padding: '10px 10px 14px', color: '#000', lineHeight: 1.4, ...fs }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: forPrint ? 16 : 15, fontWeight: 900, letterSpacing: 1 }}>🕉 Shital Temple</div>
        <div style={{ fontSize: forPrint ? 10 : 10 }}>{branch} · Registered UK Charity</div>
        <div style={{ fontSize: 9, marginTop: 2, color: '#555' }}>{dateStr}</div>
      </div>

      <div style={hr} />

      {/* Order ref */}
      <div style={{ textAlign: 'center', margin: '6px 0' }}>
        <div style={{ fontSize: 9, color: '#555' }}>ORDER REFERENCE</div>
        <div style={{ fontSize: forPrint ? 13 : 12, fontWeight: 900, letterSpacing: 2 }}>{SAMPLE.orderRef}</div>
      </div>

      <div style={hr} />

      {/* Items */}
      <div style={{ margin: '6px 0' }}>
        {SAMPLE.items.map((item, i) => (
          <div key={i} style={row}>
            <span>{item.name} x{item.quantity}</span>
            <span style={{ fontWeight: 700 }}>£{item.total.toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Total */}
      <div style={{ borderTop: '2px solid #000', paddingTop: 5, marginBottom: 8 }}>
        <div style={{ ...row, fontSize: forPrint ? 14 : 13, fontWeight: 900 }}>
          <span>TOTAL</span>
          <span>£{SAMPLE.total.toFixed(2)}</span>
        </div>
        <div style={{ fontSize: 9, textAlign: 'right', color: '#555' }}>CARD PAYMENT</div>
      </div>

      {/* Donor */}
      {donor && (
        <div style={{ fontSize: 9, marginBottom: 6 }}>Donor: <strong>{donor}</strong></div>
      )}

      {/* Gift Aid */}
      {giftAid && (
        <>
          <div style={hr} />
          <div style={{ fontSize: 9, margin: '6px 0' }}>
            <div style={{ fontWeight: 900, marginBottom: 2 }}>GIFT AID DECLARATION</div>
            <div>I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital Gains Tax than the amount of Gift Aid claimed on all my donations, it is my responsibility to pay any difference.</div>
            <div style={{ marginTop: 3 }}>Gift Aid reclaimed: <strong>£{giftAidAmount}</strong></div>
          </div>
        </>
      )}

      <div style={hr} />

      {/* Footer */}
      <div style={{ textAlign: 'center', fontSize: 9, color: '#444', marginTop: 6 }}>
        <div style={{ fontWeight: 900, marginBottom: 2 }}>Thank you for your generous donation 🙏</div>
        <div>Jay Shri Krishna</div>
        <div style={{ marginTop: 4, color: '#777' }}>Registered Charity No. {SAMPLE.charityNumber}</div>
        <div style={{ color: '#777' }}>This receipt is your donation record.</div>
        <div style={{ marginTop: 4 }}>kiosk.shital.org.uk</div>
      </div>
    </div>
  )
}
