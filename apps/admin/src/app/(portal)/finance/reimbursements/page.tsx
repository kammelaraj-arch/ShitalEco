'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'
import { Pagination } from '@/components/ui/Pagination'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Claim {
  id: string
  claimant_type: string
  claimant_id: string | null
  claimant_name: string
  claimant_email: string
  branch_id: string
  amount: number
  currency: string
  category: string
  expense_date: string | null
  description: string
  receipt_mime: string | null
  has_receipt: boolean
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PAID' | string
  manager_id: string | null
  manager_name: string
  reviewed_by_name: string
  reviewed_at: string | null
  review_notes: string
  payment_method: string
  payment_ref: string
  paid_at: string | null
  created_at: string
  updated_at: string
}

interface Branch { branch_id: string; name: string; is_active?: boolean }

const CLAIMANT_TYPES = [
  { id: 'EMPLOYEE', label: 'Employee' },
  { id: 'TRUSTEE',  label: 'Trustee'  },
  { id: 'LMC',      label: 'LMC Member' },
]

const CATEGORIES = [
  'GENERAL', 'TRAVEL', 'MEALS', 'OFFICE_SUPPLIES',
  'EVENT_EXPENSES', 'TEMPLE_SUPPLIES', 'MAINTENANCE',
  'PROFESSIONAL_FEES', 'OTHER',
]

const STATUS_BADGE: Record<string, string> = {
  PENDING_APPROVAL: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  APPROVED:         'bg-green-500/15 text-green-300 border-green-500/30',
  REJECTED:         'bg-red-500/15 text-red-300 border-red-500/30',
  PAID:             'bg-blue-500/15 text-blue-300 border-blue-500/30',
}

function fmtMoney(n: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReimbursementsPage() {
  const [tab, setTab]                 = useState<'mine' | 'manager' | 'all'>('mine')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [items, setItems]             = useState<Claim[]>([])
  const [total, setTotal]             = useState(0)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')
  const [page, setPage]               = useState(1)
  const [perPage, setPerPage]         = useState(20)
  const [showForm, setShowForm]       = useState(false)
  const [detail, setDetail]           = useState<Claim | null>(null)
  const [detailReceipt, setDetailReceipt] = useState<string | null>(null)
  const [branches, setBranches]       = useState<Branch[]>([])
  const [actioning, setActioning]     = useState('')

  useEffect(() => {
    apiFetch<{ branches: Branch[] }>('/branches')
      .then(d => setBranches((d.branches || []).filter(b => b.is_active !== false)))
      .catch(() => setBranches([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ role: tab, page: String(page), per_page: String(perPage) })
      if (statusFilter) qs.set('status', statusFilter)
      const d = await apiFetch<{ items: Claim[]; total: number }>(`/reimbursements?${qs}`)
      setItems(d.items || [])
      setTotal(d.total || 0)
    } catch (e: any) {
      setError(e?.message || 'Failed to load claims')
    } finally {
      setLoading(false)
    }
  }, [tab, page, perPage, statusFilter])

  useEffect(() => { load() }, [load])

  async function openDetail(c: Claim) {
    setDetail(c); setDetailReceipt(null)
    if (c.has_receipt) {
      try {
        const full = await apiFetch<Claim & { receipt_data: string }>(`/reimbursements/${c.id}`)
        setDetailReceipt((full as any).receipt_data || null)
      } catch { /* leave null */ }
    }
  }

  async function doAction(id: string, verb: 'approve' | 'reject' | 'mark-paid', body: any = {}) {
    setActioning(id + ':' + verb)
    try {
      await apiFetch(`/reimbursements/${id}/${verb}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      setDetail(null); load()
    } catch (e: any) {
      setError(e?.message || 'Action failed')
    } finally {
      setActioning('')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">🧾 Reimbursements</h1>
          <p className="text-white/40 mt-1">
            Employees / Trustees / LMC members file expense claims with a receipt photo —
            auto-routes to the assigned manager for approval, then finance marks paid.
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ New Claim</button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
          {(['mine', 'manager', 'all'] as const).map(t => (
            <button key={t}
              onClick={() => { setTab(t); setPage(1) }}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                tab === t ? 'bg-saffron-gradient text-white shadow' : 'text-white/40 hover:text-white/70'
              }`}>
              {t === 'mine' ? 'My Claims' : t === 'manager' ? 'Awaiting My Approval' : 'All'}
            </button>
          ))}
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-white text-sm outline-none">
          <option value="">All statuses</option>
          <option value="PENDING_APPROVAL">Pending approval</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="PAID">Paid</option>
        </select>
        <button onClick={load} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 text-xs hover:bg-white/10">↻ Refresh</button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Table */}
      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        {loading ? (
          <div className="text-center py-16 text-white/30">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-white/30">No claims yet — file one with + New Claim.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr className="text-white/40 text-xs font-bold uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Filed</th>
                  <th className="px-4 py-3 text-left">Claimant</th>
                  <th className="px-4 py-3 text-left">Branch</th>
                  <th className="px-4 py-3 text-left">Category</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Receipt</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(c => (
                  <tr key={c.id} className="border-t border-white/5 hover:bg-white/3 cursor-pointer"
                      onClick={() => openDetail(c)}>
                    <td className="px-4 py-3 text-white/60">{fmtDate(c.created_at)}</td>
                    <td className="px-4 py-3 text-white font-semibold">
                      {c.claimant_name || c.claimant_email || '—'}
                      <p className="text-white/30 text-xs">{c.claimant_type}</p>
                    </td>
                    <td className="px-4 py-3 text-white/60">{c.branch_id}</td>
                    <td className="px-4 py-3 text-white/60 capitalize">{c.category.replace(/_/g, ' ').toLowerCase()}</td>
                    <td className="px-4 py-3 text-right text-white font-bold">{fmtMoney(c.amount, c.currency)}</td>
                    <td className="px-4 py-3 text-white/40">{c.has_receipt ? '📎' : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_BADGE[c.status] || 'bg-white/5 text-white/40 border-white/10'}`}>
                        {c.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button className="text-saffron-300 text-xs font-bold hover:underline">Details →</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          pageSize={perPage}
          total={total}
          disabled={loading}
          onPageChange={p => setPage(p)}
          onPageSizeChange={pp => { setPerPage(pp); setPage(1) }}
        />
      </div>

      {/* New claim slide-over (form + camera/upload) */}
      <AnimatePresence>
        {showForm && (
          <NewClaimModal
            branches={branches}
            onClose={() => setShowForm(false)}
            onSaved={() => { setShowForm(false); load() }}
          />
        )}
      </AnimatePresence>

      {/* Detail slide-over with approve/reject/mark-paid */}
      <AnimatePresence>
        {detail && (
          <ClaimDetailModal
            claim={detail}
            receiptData={detailReceipt}
            actioning={actioning}
            onAction={doAction}
            onClose={() => setDetail(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── New Claim Modal ─────────────────────────────────────────────────────────

function NewClaimModal({ branches, onClose, onSaved }: {
  branches: Branch[]; onClose: () => void; onSaved: () => void
}) {
  const [claimantType, setClaimantType] = useState('EMPLOYEE')
  const [claimantName, setClaimantName] = useState('')
  const [branchId, setBranchId]         = useState(branches[0]?.branch_id || 'main')
  const [amount, setAmount]             = useState('')
  const [category, setCategory]         = useState('GENERAL')
  const [expenseDate, setExpenseDate]   = useState(new Date().toISOString().slice(0, 10))
  const [description, setDescription]   = useState('')
  const [managerName, setManagerName]   = useState('')
  const [receiptDataUrl, setReceiptData] = useState<string | null>(null)
  const [cameraOn, setCameraOn]         = useState(false)
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState('')

  const videoRef  = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  async function startCamera() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },  // rear camera if available
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraOn(true)
    } catch (e: any) {
      setError(`Camera unavailable: ${e?.message || 'permission denied'}`)
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCameraOn(false)
  }

  function snapPhoto() {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    // JPEG at quality 0.85 — readable receipt + reasonable size (~150-300 KB).
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    setReceiptData(dataUrl)
    stopCamera()
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 8 * 1024 * 1024) {
      setError('Receipt must be under 8 MB'); return
    }
    const reader = new FileReader()
    reader.onload = ev => setReceiptData((ev.target?.result as string) || null)
    reader.readAsDataURL(f)
  }

  useEffect(() => () => stopCamera(), [])  // cleanup on unmount

  async function save() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setError('Amount must be greater than 0'); return }
    if (!description.trim()) { setError('Please describe the expense'); return }
    setSaving(true); setError('')
    try {
      // Strip the "data:image/...;base64," prefix off the data URL so the
      // backend gets clean base64. Save the mime separately. This keeps
      // backend storage format consistent regardless of input source.
      let receipt_data: string | null = null
      let receipt_mime: string | null = null
      if (receiptDataUrl) {
        const m = receiptDataUrl.match(/^data:([^;]+);base64,(.+)$/)
        if (m) {
          receipt_mime = m[1]
          receipt_data = m[2]
        }
      }
      await apiFetch('/reimbursements', {
        method: 'POST',
        body: JSON.stringify({
          claimant_type: claimantType,
          claimant_name: claimantName,
          branch_id: branchId,
          amount: amt,
          currency: 'GBP',
          category,
          expense_date: expenseDate,
          description,
          manager_name: managerName,
          receipt_data,
          receipt_mime,
        }),
      })
      onSaved()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
  const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="fixed inset-0 bg-black/60 z-40" />
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed right-0 top-0 h-full w-full sm:max-w-[560px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-white font-black text-lg">New Reimbursement Claim</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Claimant Type</label>
              <select value={claimantType} onChange={e => setClaimantType(e.target.value)} className={inp}>
                {CLAIMANT_TYPES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Branch</label>
              <select value={branchId} onChange={e => setBranchId(e.target.value)} className={inp}>
                {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={lbl}>Claimant Name</label>
            <input value={claimantName} onChange={e => setClaimantName(e.target.value)} className={inp}
              placeholder="Your name (or person you're filing on behalf of)" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Amount £ *</label>
              <input type="number" inputMode="decimal" min="0.01" step="0.01"
                value={amount} onChange={e => setAmount(e.target.value)} className={inp} placeholder="0.00" />
            </div>
            <div>
              <label className={lbl}>Expense Date</label>
              <input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className={inp} />
            </div>
          </div>

          <div>
            <label className={lbl}>Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className={inp}>
              {CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c.replace(/_/g, ' ').toLowerCase()}</option>)}
            </select>
          </div>

          <div>
            <label className={lbl}>Description *</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              rows={3} placeholder="What was this expense for?"
              className={`${inp} resize-none`} />
          </div>

          <div>
            <label className={lbl}>Manager Name (auto-routes for approval)</label>
            <input value={managerName} onChange={e => setManagerName(e.target.value)} className={inp}
              placeholder="e.g. Bhadra Thaker" />
          </div>

          {/* Receipt area — camera or file. */}
          <div className="space-y-2">
            <label className={lbl}>Receipt</label>

            {receiptDataUrl ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={receiptDataUrl} alt="Receipt preview"
                  className="w-full max-h-80 object-contain rounded-xl border border-white/10 bg-black/30" />
                <button onClick={() => setReceiptData(null)}
                  className="absolute top-2 right-2 px-3 py-1 rounded-lg bg-red-500/30 text-red-200 text-xs font-bold border border-red-500/50">
                  Remove
                </button>
              </div>
            ) : cameraOn ? (
              <div className="space-y-2">
                <video ref={videoRef} className="w-full rounded-xl border border-white/10 bg-black" playsInline muted />
                <canvas ref={canvasRef} className="hidden" />
                <div className="flex gap-2">
                  <button onClick={snapPhoto}
                    className="flex-1 py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm">
                    📸 Capture
                  </button>
                  <button onClick={stopCamera}
                    className="px-4 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={startCamera}
                  className="py-4 rounded-xl border border-saffron-400/40 bg-saffron-500/10 text-saffron-200 font-bold text-sm flex items-center justify-center gap-2">
                  📷 Take Photo
                </button>
                <label className="py-4 rounded-xl border border-white/10 bg-white/5 text-white/70 font-bold text-sm flex items-center justify-center gap-2 cursor-pointer">
                  📁 Upload File
                  <input type="file" accept="image/*,application/pdf" onChange={onFile} className="hidden" />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/5 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
            {saving ? 'Submitting…' : 'Submit Claim'}
          </button>
        </div>
      </motion.div>
    </>
  )
}

// ─── Claim Detail Modal ──────────────────────────────────────────────────────

function ClaimDetailModal({ claim, receiptData, actioning, onAction, onClose }: {
  claim: Claim
  receiptData: string | null
  actioning: string
  onAction: (id: string, verb: 'approve' | 'reject' | 'mark-paid', body?: any) => Promise<void>
  onClose: () => void
}) {
  const [notes, setNotes] = useState('')
  const [paymentRef, setPaymentRef] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer')

  // Backend stores raw base64 + mime; reassemble data URL for the <img>.
  const receiptSrc = receiptData ? `data:${claim.receipt_mime || 'image/jpeg'};base64,${receiptData}` : null

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="fixed inset-0 bg-black/60 z-40" />
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed right-0 top-0 h-full w-full sm:max-w-[560px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-white font-black text-lg">Claim Detail</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-white/40 text-xs uppercase">Claimant</span><p className="text-white font-semibold">{claim.claimant_name || claim.claimant_email || '—'} <span className="text-white/40">({claim.claimant_type})</span></p></div>
            <div><span className="text-white/40 text-xs uppercase">Status</span><p><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_BADGE[claim.status] || 'bg-white/5 text-white/40 border-white/10'}`}>{claim.status.replace(/_/g, ' ')}</span></p></div>
            <div><span className="text-white/40 text-xs uppercase">Branch</span><p className="text-white">{claim.branch_id}</p></div>
            <div><span className="text-white/40 text-xs uppercase">Category</span><p className="text-white capitalize">{claim.category.replace(/_/g, ' ').toLowerCase()}</p></div>
            <div><span className="text-white/40 text-xs uppercase">Amount</span><p className="text-white font-black text-base">{fmtMoney(claim.amount, claim.currency)}</p></div>
            <div><span className="text-white/40 text-xs uppercase">Expense Date</span><p className="text-white">{fmtDate(claim.expense_date)}</p></div>
            <div><span className="text-white/40 text-xs uppercase">Filed</span><p className="text-white/70">{fmtDate(claim.created_at)}</p></div>
            <div><span className="text-white/40 text-xs uppercase">Manager</span><p className="text-white/70">{claim.manager_name || '—'}</p></div>
          </div>

          <div>
            <span className="text-white/40 text-xs uppercase">Description</span>
            <p className="text-white whitespace-pre-wrap mt-1">{claim.description || '—'}</p>
          </div>

          {claim.reviewed_at && (
            <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-white/40 text-xs uppercase mb-1">Review</p>
              <p className="text-white/70 text-xs">By <strong className="text-white">{claim.reviewed_by_name}</strong> on {fmtDate(claim.reviewed_at)}</p>
              {claim.review_notes && <p className="text-white/70 text-xs mt-1">{claim.review_notes}</p>}
            </div>
          )}

          {claim.paid_at && (
            <div className="rounded-xl p-3" style={{ background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.30)' }}>
              <p className="text-blue-300 text-xs uppercase mb-1">Paid</p>
              <p className="text-blue-200 text-xs">Via <strong>{claim.payment_method || '—'}</strong> · ref <strong>{claim.payment_ref || '—'}</strong> on {fmtDate(claim.paid_at)}</p>
            </div>
          )}

          {receiptSrc ? (
            <div>
              <span className="text-white/40 text-xs uppercase">Receipt</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={receiptSrc} alt="Receipt" className="w-full max-h-96 object-contain rounded-xl border border-white/10 bg-black/30 mt-2" />
            </div>
          ) : claim.has_receipt ? (
            <p className="text-white/40 text-xs">Loading receipt…</p>
          ) : (
            <p className="text-white/30 text-xs">No receipt attached.</p>
          )}

          {/* Approve / Reject (manager) — only when pending */}
          {claim.status === 'PENDING_APPROVAL' && (
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.20)' }}>
              <p className="text-amber-300 text-xs uppercase font-bold">Manager Review</p>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Optional notes for the claimant…"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs outline-none" />
              <div className="flex gap-2">
                <button onClick={() => onAction(claim.id, 'approve', { notes })}
                  disabled={actioning.startsWith(claim.id)}
                  className="flex-1 py-2 rounded-lg bg-green-500/20 text-green-300 border border-green-500/40 font-bold text-sm disabled:opacity-40">
                  ✓ Approve
                </button>
                <button onClick={() => onAction(claim.id, 'reject', { notes })}
                  disabled={actioning.startsWith(claim.id)}
                  className="flex-1 py-2 rounded-lg bg-red-500/20 text-red-300 border border-red-500/40 font-bold text-sm disabled:opacity-40">
                  ✕ Reject
                </button>
              </div>
            </div>
          )}

          {/* Mark-paid (finance) — only when approved */}
          {claim.status === 'APPROVED' && (
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.20)' }}>
              <p className="text-blue-300 text-xs uppercase font-bold">Mark Paid (Finance)</p>
              <div className="grid grid-cols-2 gap-2">
                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs outline-none">
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Other</option>
                </select>
                <input value={paymentRef} onChange={e => setPaymentRef(e.target.value)}
                  placeholder="Payment reference"
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs outline-none" />
              </div>
              <button onClick={() => onAction(claim.id, 'mark-paid', { method: paymentMethod, reference: paymentRef })}
                disabled={actioning.startsWith(claim.id)}
                className="w-full py-2 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/40 font-bold text-sm disabled:opacity-40">
                💷 Mark Paid
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </>
  )
}
