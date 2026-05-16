'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'
import { Pagination } from '@/components/ui/Pagination'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReferenceRequest {
  id: string
  volunteer_id: string
  volunteer_name: string
  volunteer_email: string
  volunteer_status: string
  referee_index: number
  referee_name: string
  referee_email: string
  referee_phone: string
  relationship: string
  request_token: string | null
  status: 'PENDING' | 'SENT' | 'OPENED' | 'RESPONDED' | 'EXPIRED' | 'CANCELLED' | string
  requested_at: string
  sent_at: string | null
  opened_at: string | null
  responded_at: string | null
  expires_at: string | null
  send_count: number
  last_send_error: string
  response_data: Record<string, any>
  notes: string
  created_at: string
  updated_at: string
}

const STATUS_BADGE: Record<string, string> = {
  PENDING:   'bg-amber-500/15 text-amber-300 border-amber-500/30',
  SENT:      'bg-blue-500/15  text-blue-300  border-blue-500/30',
  OPENED:    'bg-purple-500/15 text-purple-300 border-purple-500/30',
  RESPONDED: 'bg-green-500/15 text-green-300 border-green-500/30',
  EXPIRED:   'bg-white/5      text-white/40  border-white/10',
  CANCELLED: 'bg-red-500/15   text-red-300   border-red-500/30',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return iso }
}

export default function VolunteerReferenceRequestsPage() {
  const [items, setItems]     = useState<ReferenceRequest[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [search, setSearch]   = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage]       = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [editing, setEditing] = useState<ReferenceRequest | 'new' | null>(null)
  const [actioning, setActioning] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) })
      if (statusFilter) qs.set('status', statusFilter)
      if (search.trim()) qs.set('search', search.trim())
      const d = await apiFetch<{ items: ReferenceRequest[]; total: number }>(
        `/admin/volunteer-reference-requests?${qs}`)
      setItems(d.items || [])
      setTotal(d.total || 0)
    } catch (e: any) {
      setError(e?.message || 'Failed to load reference requests')
    } finally {
      setLoading(false)
    }
  }, [page, perPage, statusFilter, search])

  useEffect(() => { load() }, [load])

  async function doAction(id: string, verb: 'resend' | 'cancel') {
    setActioning(id + ':' + verb)
    try {
      if (verb === 'cancel') {
        await apiFetch(`/admin/volunteer-reference-requests/${id}`, { method: 'DELETE' })
      } else {
        await apiFetch(`/admin/volunteer-reference-requests/${id}/resend`, {
          method: 'POST',
          body: JSON.stringify({ new_expires_in_days: 30 }),
        })
      }
      load()
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
          <h1 className="text-3xl font-black text-white">📨 Volunteer Reference Requests</h1>
          <p className="text-white/40 mt-1">
            Track every reference request sent to a volunteer's referees. Resend, cancel, or record
            responses received offline.
          </p>
        </div>
        <button onClick={() => setEditing('new')} className="btn-primary">+ New Reference Request</button>
      </div>

      {/* Filters */}
      <div className="glass rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-white text-sm outline-none">
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="SENT">Sent</option>
          <option value="OPENED">Opened</option>
          <option value="RESPONDED">Responded</option>
          <option value="EXPIRED">Expired</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && setPage(1)}
          placeholder="Search volunteer / referee name or email…"
          className="flex-1 min-w-48 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-white text-sm outline-none" />
        <button onClick={load} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 text-xs hover:bg-white/10">↻ Refresh</button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Table */}
      <div className="glass rounded-2xl overflow-hidden border border-temple-border">
        {loading ? (
          <div className="text-center py-16 text-white/30">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-white/30">No reference requests match.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr className="text-white/40 text-xs font-bold uppercase tracking-wider">
                  <th className="px-3 py-3 text-left">Volunteer</th>
                  <th className="px-3 py-3 text-left">Ref</th>
                  <th className="px-3 py-3 text-left">Referee</th>
                  <th className="px-3 py-3 text-left">Email</th>
                  <th className="px-3 py-3 text-left">Status</th>
                  <th className="px-3 py-3 text-left">Sent</th>
                  <th className="px-3 py-3 text-left">Responded</th>
                  <th className="px-3 py-3 text-center"># Sent</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(r => (
                  <tr key={r.id} className="border-t border-white/5 hover:bg-white/3">
                    <td className="px-3 py-2 text-white font-semibold">
                      {r.volunteer_name || '—'}
                      <p className="text-white/30 text-xs">{r.volunteer_email}</p>
                    </td>
                    <td className="px-3 py-2 text-white/40 font-mono">{r.referee_index}</td>
                    <td className="px-3 py-2 text-white">
                      {r.referee_name || '—'}
                      {r.relationship && <p className="text-white/30 text-xs">{r.relationship}</p>}
                    </td>
                    <td className="px-3 py-2 text-white/60 text-xs">{r.referee_email || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_BADGE[r.status] || 'bg-white/5 text-white/40 border-white/10'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-white/60 text-xs">{fmtDate(r.sent_at)}</td>
                    <td className="px-3 py-2 text-white/60 text-xs">{fmtDate(r.responded_at)}</td>
                    <td className="px-3 py-2 text-center text-white/40">{r.send_count}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setEditing(r)}
                        className="px-2 py-1 mr-1 rounded-lg text-xs font-bold bg-white/5 text-white/60 border border-white/10 hover:bg-white/10">
                        Edit
                      </button>
                      {r.status !== 'CANCELLED' && r.status !== 'RESPONDED' && (
                        <button onClick={() => doAction(r.id, 'resend')}
                          disabled={actioning === r.id + ':resend'}
                          className="px-2 py-1 mr-1 rounded-lg text-xs font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 disabled:opacity-40">
                          {actioning === r.id + ':resend' ? '…' : '↻ Resend'}
                        </button>
                      )}
                      {r.status !== 'CANCELLED' && (
                        <button onClick={() => doAction(r.id, 'cancel')}
                          disabled={actioning === r.id + ':cancel'}
                          className="px-2 py-1 rounded-lg text-xs font-bold bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-40">
                          {actioning === r.id + ':cancel' ? '…' : 'Cancel'}
                        </button>
                      )}
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

      <AnimatePresence>
        {editing && (
          <RequestModal
            request={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); load() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Slide-over modal ────────────────────────────────────────────────────────

function RequestModal({ request, onClose, onSaved }: {
  request: ReferenceRequest | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!request
  const [volunteerId, setVolunteerId] = useState(request?.volunteer_id || '')
  const [refereeIndex, setRefereeIndex] = useState(request?.referee_index || 1)
  const [refereeName, setRefereeName] = useState(request?.referee_name || '')
  const [refereeEmail, setRefereeEmail] = useState(request?.referee_email || '')
  const [refereePhone, setRefereePhone] = useState(request?.referee_phone || '')
  const [relationship, setRelationship] = useState(request?.relationship || '')
  const [notes, setNotes] = useState(request?.notes || '')
  const [expiresInDays, setExpiresInDays] = useState(30)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  async function save() {
    if (!isEdit && !volunteerId.trim()) { setError('Volunteer ID is required'); return }
    if (!refereeEmail.trim()) { setError('Referee email is required'); return }
    setSaving(true); setError('')
    try {
      if (isEdit) {
        await apiFetch(`/admin/volunteer-reference-requests/${request!.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            referee_name: refereeName,
            referee_email: refereeEmail,
            referee_phone: refereePhone,
            relationship,
            notes,
          }),
        })
      } else {
        await apiFetch('/admin/volunteer-reference-requests', {
          method: 'POST',
          body: JSON.stringify({
            volunteer_id: volunteerId,
            referee_index: refereeIndex,
            referee_name: refereeName,
            referee_email: refereeEmail,
            referee_phone: refereePhone,
            relationship,
            notes,
            expires_in_days: expiresInDays,
          }),
        })
      }
      onSaved()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-saffron-400/50'
  const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1'

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="fixed inset-0 bg-black/60 z-40" />
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed right-0 top-0 h-full w-full sm:max-w-[520px] bg-temple-deep border-l border-temple-border z-50 flex flex-col">
        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-white font-black text-lg">
            {isEdit ? 'Edit Reference Request' : 'New Reference Request'}
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

          {!isEdit && (
            <>
              <div>
                <label className={lbl}>Volunteer ID *</label>
                <input value={volunteerId} onChange={e => setVolunteerId(e.target.value)} className={`${inp} font-mono`} placeholder="UUID of the volunteer" />
                <p className="text-[10px] text-white/30 mt-1">Find it on the Volunteers list page.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Referee # *</label>
                  <select value={refereeIndex} onChange={e => setRefereeIndex(parseInt(e.target.value))} className={inp}>
                    <option value={1}>1 (primary referee)</option>
                    <option value={2}>2 (secondary referee)</option>
                  </select>
                </div>
                <div>
                  <label className={lbl}>Expires in (days)</label>
                  <input type="number" min={1} max={365} value={expiresInDays} onChange={e => setExpiresInDays(parseInt(e.target.value) || 30)} className={inp} />
                </div>
              </div>
            </>
          )}

          <div>
            <label className={lbl}>Referee Name</label>
            <input value={refereeName} onChange={e => setRefereeName(e.target.value)} className={inp} placeholder="Mrs Jane Smith" />
          </div>
          <div>
            <label className={lbl}>Referee Email *</label>
            <input type="email" value={refereeEmail} onChange={e => setRefereeEmail(e.target.value)} className={inp} placeholder="jane@example.org" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Phone</label>
              <input value={refereePhone} onChange={e => setRefereePhone(e.target.value)} className={inp} placeholder="+44…" />
            </div>
            <div>
              <label className={lbl}>Relationship</label>
              <input value={relationship} onChange={e => setRelationship(e.target.value)} className={inp} placeholder="Manager / colleague / etc." />
            </div>
          </div>
          <div>
            <label className={lbl}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Internal notes about this referee or the request…"
              className={`${inp} resize-none`} />
          </div>

          {isEdit && request && (
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-white/40 text-xs uppercase tracking-widest font-bold">Audit</p>
              <div className="text-xs text-white/60 space-y-0.5">
                <div>Status: <span className="font-bold">{request.status}</span></div>
                <div>Send count: <span className="font-bold">{request.send_count}</span></div>
                <div>Sent at: {fmtDate(request.sent_at)}</div>
                <div>Responded at: {fmtDate(request.responded_at)}</div>
                <div>Expires at: {fmtDate(request.expires_at)}</div>
                {request.last_send_error && <div className="text-red-300">Last send error: {request.last_send_error}</div>}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/5 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
            {saving ? 'Saving…' : 'Save Request'}
          </button>
        </div>
      </motion.div>
    </>
  )
}
