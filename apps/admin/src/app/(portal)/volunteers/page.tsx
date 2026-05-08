'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface VolunteerSummary {
  id: string
  reference_number: string
  first_names: string
  last_name: string
  email: string
  mobile: string
  phone: string
  age_range: string
  branch_id: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  created_at: string
  reviewed_at: string | null
  has_criminal_record: boolean
  has_health_restrictions: boolean
}

interface VolunteerDetail extends VolunteerSummary {
  title: string
  address: string; postcode: string
  ec_title: string; ec_full_name: string; ec_email: string
  ec_mobile: string; ec_phone: string; ec_address: string; ec_postcode: string
  health_notes: string
  criminal_record_details: string
  ref1_title: string; ref1_first_names: string; ref1_last_name: string
  ref1_address: string; ref1_postcode: string
  ref1_mobile: string; ref1_phone: string; ref1_email: string
  ref2_title: string; ref2_first_names: string; ref2_last_name: string
  ref2_address: string; ref2_postcode: string
  ref2_mobile: string; ref2_phone: string; ref2_email: string
  skills: Record<string, string[]>
  skills_other_text: string
  availability: Record<string, Record<string, string>>
  availability_pattern: string
  declaration_signed_at: string | null
  confidentiality_agreed: boolean
  marketing_consent: boolean
  rejection_reason: string
}

const STATUS_BADGE: Record<string, string> = {
  PENDING:  'bg-amber-500/20 text-amber-400 border-amber-500/30',
  APPROVED: 'bg-green-500/20 text-green-400 border-green-500/30',
  REJECTED: 'bg-red-500/20 text-red-400 border-red-500/30',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

export default function VolunteersPage() {
  const [items, setItems] = useState<VolunteerSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<VolunteerDetail | null>(null)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [reviewing, setReviewing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams()
      if (statusFilter) qs.set('status_filter', statusFilter)
      if (search.trim()) qs.set('search', search.trim())
      qs.set('limit', '100')
      const data = await apiFetch<{ items: VolunteerSummary[]; total: number }>(`/admin/volunteers?${qs}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load volunteers')
    } finally { setLoading(false) }
  }, [statusFilter, search])

  useEffect(() => { load() }, [load])

  const openDetail = async (id: string) => {
    setError('')
    try {
      const data = await apiFetch<{ volunteer: VolunteerDetail }>(`/admin/volunteers/${id}`)
      setSelected(data.volunteer)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load detail')
    }
  }

  const approve = async () => {
    if (!selected) return
    setReviewing(true)
    try {
      await apiFetch(`/admin/volunteers/${selected.id}/approve`, { method: 'POST' })
      setSelected(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve')
    } finally { setReviewing(false) }
  }

  const reject = async () => {
    if (!selected) return
    if (!rejectReason.trim()) { setError('Please provide a rejection reason'); return }
    setReviewing(true)
    try {
      await apiFetch(`/admin/volunteers/${selected.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ rejection_reason: rejectReason.trim() }),
      })
      setShowRejectModal(false)
      setRejectReason('')
      setSelected(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject')
    } finally { setReviewing(false) }
  }

  const pendingCount = statusFilter === 'PENDING' ? total : items.filter(i => i.status === 'PENDING').length
  const stats = {
    pending:  items.filter(i => i.status === 'PENDING').length,
    approved: items.filter(i => i.status === 'APPROVED').length,
    rejected: items.filter(i => i.status === 'REJECTED').length,
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Volunteers</h1>
          <p className="text-white/40 mt-1">Online volunteer registrations awaiting trustee review</p>
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Awaiting Review', value: pendingCount, icon: '⏳', color: 'from-amber-600 to-orange-500' },
          { label: 'Approved',        value: stats.approved, icon: '✓', color: 'from-green-600 to-emerald-500' },
          { label: 'Rejected',        value: stats.rejected, icon: '✗', color: 'from-red-600 to-rose-500' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="glass rounded-2xl p-5 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-lg mb-3`}>{s.icon}</div>
            <p className="text-white/50 text-xs font-medium">{s.label}</p>
            <p className="text-3xl font-black text-white mt-1">{loading ? '—' : s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
          {(['PENDING', 'APPROVED', 'REJECTED', ''] as const).map(v => (
            <button key={v || 'ALL'} onClick={() => setStatusFilter(v)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize ${
                statusFilter === v
                  ? 'bg-saffron-gradient text-white shadow'
                  : 'text-white/40 hover:text-white/70'
              }`}>
              {v.toLowerCase() || 'all'}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, or reference…"
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-white/30 outline-none focus:border-saffron-400/50 w-full sm:w-80" />
      </div>

      {/* Table */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 border-b border-white/10">
              <tr className="text-white/60 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-semibold">Reference</th>
                <th className="px-4 py-3 text-left font-semibold">Name</th>
                <th className="px-4 py-3 text-left font-semibold">Email</th>
                <th className="px-4 py-3 text-left font-semibold">Mobile</th>
                <th className="px-4 py-3 text-left font-semibold">Branch</th>
                <th className="px-4 py-3 text-left font-semibold">Submitted</th>
                <th className="px-4 py-3 text-left font-semibold">Flags</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-white/40">Loading…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-white/40">No volunteers found</td></tr>
              )}
              {items.map(v => (
                <tr key={v.id} onClick={() => openDetail(v.id)}
                  className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors">
                  <td className="px-4 py-3 text-white/70 font-mono text-xs">{v.reference_number}</td>
                  <td className="px-4 py-3 text-white font-semibold">{v.first_names} {v.last_name}</td>
                  <td className="px-4 py-3 text-white/60">{v.email}</td>
                  <td className="px-4 py-3 text-white/60">{v.mobile || v.phone || '—'}</td>
                  <td className="px-4 py-3 text-white/60 capitalize">{v.branch_id}</td>
                  <td className="px-4 py-3 text-white/50">{fmtDate(v.created_at)}</td>
                  <td className="px-4 py-3 text-xs">
                    <div className="flex gap-1.5">
                      {v.has_criminal_record && (
                        <span title="Has declared criminal record" className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">CR</span>
                      )}
                      {v.has_health_restrictions && (
                        <span title="Has health restrictions" className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">H</span>
                      )}
                      {!v.has_criminal_record && !v.has_health_restrictions && (
                        <span className="text-white/30">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold border ${STATUS_BADGE[v.status]}`}>
                      {v.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail slide-over */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelected(null)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-2xl bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-white/5 flex items-start justify-between">
                <div>
                  <p className="text-white/40 text-xs font-mono">{selected.reference_number}</p>
                  <h2 className="text-white font-black text-xl mt-0.5">{selected.first_names} {selected.last_name}</h2>
                  <span className={`mt-2 inline-block px-2 py-0.5 rounded-full text-xs font-bold border ${STATUS_BADGE[selected.status]}`}>
                    {selected.status}
                  </span>
                </div>
                <button onClick={() => setSelected(null)} className="text-white/40 hover:text-white text-xl p-1">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-6 text-sm">

                <DetailGrid title="Contact" rows={[
                  ['Title', selected.title],
                  ['Email', selected.email],
                  ['Mobile', selected.mobile],
                  ['Phone', selected.phone],
                  ['Age range', selected.age_range],
                  ['Address', selected.address],
                  ['Postcode', selected.postcode],
                  ['Branch', selected.branch_id],
                ]} />

                <DetailGrid title="Emergency Contact" rows={[
                  ['Name', `${selected.ec_title} ${selected.ec_full_name}`.trim()],
                  ['Email', selected.ec_email],
                  ['Mobile', selected.ec_mobile],
                  ['Phone', selected.ec_phone],
                  ['Address', selected.ec_address],
                  ['Postcode', selected.ec_postcode],
                ]} />

                {selected.has_health_restrictions && (
                  <Note title="Health Notes" tone="info">{selected.health_notes || '(no detail provided)'}</Note>
                )}

                {selected.has_criminal_record && (
                  <Note title="Criminal-Record Declaration" tone="warn">
                    {selected.criminal_record_details || '(no detail provided)'}
                  </Note>
                )}

                <DetailGrid title="Referee 1" rows={[
                  ['Name', `${selected.ref1_title} ${selected.ref1_first_names} ${selected.ref1_last_name}`.trim()],
                  ['Email', selected.ref1_email],
                  ['Mobile', selected.ref1_mobile],
                  ['Phone', selected.ref1_phone],
                  ['Address', selected.ref1_address],
                  ['Postcode', selected.ref1_postcode],
                ]} />

                <DetailGrid title="Referee 2" rows={[
                  ['Name', `${selected.ref2_title} ${selected.ref2_first_names} ${selected.ref2_last_name}`.trim()],
                  ['Email', selected.ref2_email],
                  ['Mobile', selected.ref2_mobile],
                  ['Phone', selected.ref2_phone],
                  ['Address', selected.ref2_address],
                  ['Postcode', selected.ref2_postcode],
                ]} />

                <div>
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Skills</p>
                  {Object.keys(selected.skills).length === 0 && !selected.skills_other_text && (
                    <p className="text-white/30 text-xs">— None selected —</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {Object.entries(selected.skills).flatMap(([cat, opts]) =>
                      opts.map(o => (
                        <span key={`${cat}-${o}`} className="px-2 py-1 rounded-full text-xs bg-saffron-400/15 text-saffron-300 border border-saffron-400/25">
                          {cat}: {o}
                        </span>
                      ))
                    )}
                  </div>
                  {selected.skills_other_text && (
                    <p className="text-white/70 text-xs italic">{selected.skills_other_text}</p>
                  )}
                </div>

                <div>
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Availability {selected.availability_pattern && `(${selected.availability_pattern})`}</p>
                  {Object.keys(selected.availability).length === 0 && (
                    <p className="text-white/30 text-xs">— Not specified —</p>
                  )}
                  <div className="space-y-1">
                    {Object.entries(selected.availability).map(([day, slots]) => (
                      <p key={day} className="text-xs text-white/70">
                        <span className="capitalize font-semibold text-white/90">{day}:</span>{' '}
                        {Object.entries(slots).map(([slot, time]) => `${slot} ${time}`).join(' · ')}
                      </p>
                    ))}
                  </div>
                </div>

                <DetailGrid title="Consents" rows={[
                  ['Activity declaration', selected.declaration_signed_at ? `Signed ${fmtDate(selected.declaration_signed_at)}` : '✗ Missing'],
                  ['Confidentiality NDA', selected.confidentiality_agreed ? '✓ Agreed' : '✗ Not agreed'],
                  ['Marketing consent', selected.marketing_consent ? '✓ Yes' : 'No'],
                ]} />

                {selected.status === 'REJECTED' && selected.rejection_reason && (
                  <Note title="Rejection Reason" tone="warn">{selected.rejection_reason}</Note>
                )}
              </div>
              {selected.status === 'PENDING' && (
                <div className="px-4 sm:px-6 py-4 border-t border-white/5 flex gap-3">
                  <button onClick={() => { setShowRejectModal(true); setRejectReason('') }} disabled={reviewing}
                    className="flex-1 py-3 rounded-xl border border-red-500/30 text-red-400 font-semibold text-sm disabled:opacity-40 hover:bg-red-500/10">
                    Reject
                  </button>
                  <button onClick={approve} disabled={reviewing}
                    className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                    {reviewing ? 'Approving…' : 'Approve as Volunteer'}
                  </button>
                </div>
              )}
            </motion.div>

            {showRejectModal && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
                <div className="fixed inset-0 bg-black/70" onClick={() => setShowRejectModal(false)} />
                <div className="relative bg-temple-deep border border-white/10 rounded-2xl p-6 max-w-md w-full">
                  <h3 className="text-white font-black text-lg mb-3">Reject Application</h3>
                  <p className="text-white/60 text-xs mb-3">
                    Internal note for the audit trail — not sent to the applicant.
                  </p>
                  <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={4}
                    placeholder="Reason for rejection…"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-red-400/50 resize-none mb-4" />
                  <div className="flex gap-3">
                    <button onClick={() => setShowRejectModal(false)}
                      className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm font-semibold">
                      Cancel
                    </button>
                    <button onClick={reject} disabled={reviewing || !rejectReason.trim()}
                      className="flex-[2] py-2.5 rounded-xl bg-red-500/80 text-white text-sm font-black disabled:opacity-40 hover:bg-red-500">
                      {reviewing ? 'Rejecting…' : 'Confirm Reject'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function DetailGrid({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  const visible = rows.filter(([, v]) => v && v !== ' ')
  if (visible.length === 0) return null
  return (
    <div>
      <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">{title}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {visible.map(([k, v]) => (
          <div key={k} className="contents">
            <span className="text-white/40">{k}</span>
            <span className="text-white/85 break-words">{v || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Note({ title, tone, children }: { title: string; tone: 'info' | 'warn'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    info: 'bg-blue-500/10 border-blue-500/25 text-blue-200',
    warn: 'bg-red-500/10 border-red-500/25 text-red-200',
  }
  return (
    <div className={`rounded-xl border px-4 py-3 ${tones[tone]}`}>
      <p className="text-xs font-bold uppercase tracking-wide mb-1.5">{title}</p>
      <p className="text-xs leading-relaxed whitespace-pre-wrap">{children}</p>
    </div>
  )
}
