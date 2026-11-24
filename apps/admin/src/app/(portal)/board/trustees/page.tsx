'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

// Role is just a string now — the DB-backed board_roles registry is the
// source of truth (admins manage it from Settings → Users & Roles → Board
// Roles). The trustee form fetches the active list at render time so a
// newly-added role surfaces without a redeploy. The badge colour falls
// back to a neutral grey for any code not in BUILTIN_BADGES (i.e. any
// role added after this file was last shipped).
type Role = string

interface BoardRole {
  id: string
  code: string
  label: string
  category: 'MAIN_BOARD' | 'LMC' | 'NON_OFFICER' | string
  sort_order: number
  is_active: boolean
}

interface Trustee {
  id: string
  user_id: string | null
  full_name: string
  email: string
  role: Role
  phone: string
  address: string
  postcode: string
  term_start: string | null
  term_end: string | null
  notes: string
  is_active: boolean
  created_at: string
  updated_at: string
}

interface Form {
  full_name: string
  email: string
  role: Role
  phone: string
  address: string
  postcode: string
  term_start: string
  term_end: string
  notes: string
}

const EMPTY: Form = {
  full_name: '', email: '', role: 'TRUSTEE',
  phone: '', address: '', postcode: '',
  term_start: '', term_end: '', notes: '',
}

// Visual hints for the badge column — fallback is a neutral pill, so
// admin-added roles still render correctly even before this file knows
// about them.
const BUILTIN_BADGES: Record<string, string> = {
  CHAIR:               'bg-saffron-400/20 text-saffron-300 border-saffron-400/30',
  TREASURER:           'bg-green-500/20 text-green-400 border-green-500/30',
  SECRETARY:           'bg-blue-500/20 text-blue-400 border-blue-500/30',
  CEO:                 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  TRUSTEE:             'bg-white/10 text-white/70 border-white/20',
  LMC_CHAIR:           'bg-saffron-400/10 text-saffron-200 border-saffron-400/20',
  LMC_TREASURER:       'bg-green-500/10 text-green-300/80 border-green-500/20',
  LMC_MEMBER:          'bg-white/5 text-white/50 border-white/10',
  EXTERNAL_CONTRACTOR: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  TEMP_WORKER:         'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',
}

const CATEGORY_LABELS: Record<string, string> = {
  MAIN_BOARD:  'Main Board',
  LMC:         'Local Management Committee',
  NON_OFFICER: 'Non-Officer',
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso }
}

export default function TrusteesPage() {
  const [items, setItems] = useState<Trustee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('')

  const [editing, setEditing] = useState<Trustee | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  // DB-backed board roles registry. Was hardcoded — now lives in the
  // board_roles table and is managed from Settings → Users & Roles.
  const [roles, setRoles] = useState<BoardRole[]>([])

  useEffect(() => {
    apiFetch<{ items: BoardRole[] }>('/admin/board/roles?active=true')
      .then(d => setRoles((d.items || []).sort((a, b) => a.sort_order - b.sort_order)))
      .catch(() => {})
  }, [])

  const rolesByCategory = roles.reduce<Record<string, BoardRole[]>>((acc, r) => {
    (acc[r.category] ||= []).push(r)
    return acc
  }, {})

  function roleLabel(code: string): string {
    return roles.find(r => r.code === code)?.label || code
  }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ limit: '500' })
      qs.set('is_active', showInactive ? 'false' : 'true')
      if (search.trim()) qs.set('search', search.trim())
      const data = await apiFetch<{ items: Trustee[]; total: number }>(`/admin/board/trustees?${qs}`)
      setItems(data.items || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trustees')
    } finally { setLoading(false) }
  }, [showInactive, search])

  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  function openNew() {
    setEditing(null); setForm(EMPTY); setShowForm(true); setError('')
  }
  function openEdit(t: Trustee) {
    setEditing(t)
    setForm({
      full_name: t.full_name, email: t.email, role: t.role,
      phone: t.phone, address: t.address, postcode: t.postcode,
      term_start: t.term_start ? t.term_start.slice(0, 10) : '',
      term_end: t.term_end ? t.term_end.slice(0, 10) : '',
      notes: t.notes,
    })
    setShowForm(true); setError('')
  }

  async function save() {
    if (!form.full_name.trim()) { setError('Full name is required'); return }
    if (!form.email.trim() || !form.email.includes('@')) { setError('Valid email required'); return }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        role: form.role,
        phone: form.phone, address: form.address, postcode: form.postcode,
        notes: form.notes,
      }
      if (form.term_start) body.term_start = form.term_start
      if (form.term_end) body.term_end = form.term_end
      if (editing) {
        await apiFetch(`/admin/board/trustees/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
      } else {
        await apiFetch('/admin/board/trustees', { method: 'POST', body: JSON.stringify(body) })
      }
      setShowForm(false)
      await load()
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Failed to save'
      try { const p = JSON.parse(msg); if (p?.detail?.errors) msg = p.detail.errors.join(' · ') } catch { /* not JSON */ }
      setError(msg)
    } finally { setSaving(false) }
  }

  async function deactivate(t: Trustee) {
    if (!confirm(`Deactivate ${t.full_name}? Their past records (votes, meetings) are preserved for the audit trail.`)) return
    try {
      await apiFetch(`/admin/board/trustees/${t.id}`, { method: 'DELETE' })
      await load()
    } catch { setError('Failed to deactivate') }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Trustees</h1>
          <p className="text-white/40 mt-1">Trustee directory + roles. The board acts collectively — officers execute, the board decides.</p>
        </div>
        <button onClick={openNew}
          className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90">
          + New Trustee
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
          {[{ k: false, l: 'Active' }, { k: true, l: 'Past / Inactive' }].map(o => (
            <button key={String(o.k)} onClick={() => setShowInactive(o.k)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                showInactive === o.k ? 'bg-saffron-gradient text-white shadow' : 'text-white/40 hover:text-white/70'
              }`}>{o.l}</button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-white/30 outline-none focus:border-saffron-400/50 w-full sm:w-80" />
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 border-b border-white/10">
              <tr className="text-white/60 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-semibold">Name</th>
                <th className="px-4 py-3 text-left font-semibold">Role</th>
                <th className="px-4 py-3 text-left font-semibold">Email</th>
                <th className="px-4 py-3 text-left font-semibold">Phone</th>
                <th className="px-4 py-3 text-left font-semibold">Term</th>
                <th className="px-4 py-3 text-left font-semibold w-32"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="px-4 py-12 text-center text-white/40">Loading…</td></tr>}
              {!loading && items.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-white/40">
                  {showInactive ? 'No inactive trustees.' : 'No trustees yet — click + New Trustee to start.'}
                </td></tr>
              )}
              {items.map(t => (
                <tr key={t.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3 text-white font-semibold">{t.full_name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${BUILTIN_BADGES[t.role] || 'bg-white/10 text-white/60 border-white/15'}`}>
                      {roleLabel(t.role)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/70">{t.email}</td>
                  <td className="px-4 py-3 text-white/60">{t.phone || '—'}</td>
                  <td className="px-4 py-3 text-white/60 text-xs">
                    {t.term_start ? fmtDate(t.term_start) : '—'} → {t.term_end ? fmtDate(t.term_end) : 'open'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(t)} className="text-white/50 hover:text-white text-xs">Edit</button>
                      {t.is_active && <button onClick={() => deactivate(t)} className="text-red-400/60 hover:text-red-400 text-xs">Deactivate</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {/* mounted below */}
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-[480px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">{editing ? 'Edit Trustee' : 'New Trustee'}</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl p-1">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div>
                  <label className={lbl}>Role</label>
                  {/* Source of truth: DB-backed board_roles table, fetched
                      on mount. Renders one section per category present in
                      the fetched list. Add/disable roles from
                      Settings → Users & Roles → Board Roles. */}
                  {roles.length === 0 ? (
                    <p className="text-xs text-white/30 mt-2">Loading roles…</p>
                  ) : (
                    ['MAIN_BOARD', 'LMC', 'NON_OFFICER',
                     ...Object.keys(rolesByCategory).filter(c => !['MAIN_BOARD', 'LMC', 'NON_OFFICER'].includes(c))
                    ].map(category => {
                      const rs = rolesByCategory[category]
                      if (!rs || rs.length === 0) return null
                      return (
                        <div key={category} className="mb-3">
                          <p className="text-[10px] uppercase tracking-widest font-bold text-white/30 mb-1.5 mt-1">
                            {CATEGORY_LABELS[category] || category.replace(/_/g, ' ').toLowerCase()}
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            {rs.map(r => (
                              <button key={r.code} type="button" onClick={() => setForm(p => ({ ...p, role: r.code }))}
                                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                                  form.role === r.code ? 'bg-saffron-gradient text-white' : 'bg-white/5 text-white/60 border border-white/10'
                                }`}>{r.label}</button>
                            ))}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
                <div>
                  <label className={lbl}>Full Name *</label>
                  <input value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} className={inp} placeholder="e.g. Mr Bhadra Thaker" />
                </div>
                <div>
                  <label className={lbl}>Email *</label>
                  <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className={inp} placeholder="trustee@example.com" />
                </div>
                <div>
                  <label className={lbl}>Phone</label>
                  <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} className={inp} placeholder="+44 7xxx xxxxxx" />
                </div>
                <div>
                  <label className={lbl}>Address</label>
                  <textarea value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} rows={2} className={inp + ' resize-none'} />
                </div>
                <div>
                  <label className={lbl}>Postcode</label>
                  <input value={form.postcode} onChange={e => setForm(p => ({ ...p, postcode: e.target.value.toUpperCase() }))} className={inp + ' uppercase'} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Term Start</label>
                    <input type="date" value={form.term_start} onChange={e => setForm(p => ({ ...p, term_start: e.target.value }))} className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Term End</label>
                    <input type="date" value={form.term_end} onChange={e => setForm(p => ({ ...p, term_end: e.target.value }))} className={inp} />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Notes</label>
                  <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={3} className={inp + ' resize-none'} placeholder="Standing interests, areas of expertise, etc." />
                </div>
                {editing && <InterestsAndRelatedParties trusteeId={editing.id} />}
                {editing && <InductionPanel trusteeId={editing.id} />}
                {editing && <DBSPanel trusteeId={editing.id} />}
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={save} disabled={saving}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Trustee'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// CC27 — Interests + SORP §9.14 Related Parties tabs on the Trustee form
// ──────────────────────────────────────────────────────────────────────

interface TrusteeInterest {
  id: string; category: string; counterparty: string; description: string
  keywords: string; expires_at: string | null; status: string
  declared_at: string
}
interface TrusteeRelatedParty {
  id: string; related_name: string; relationship: string; notes: string
  declared_at: string
}

const INTEREST_CATEGORIES = [
  'EMPLOYMENT', 'DIRECTORSHIP', 'OWNERSHIP', 'FAMILY',
  'SUPPLIER', 'CUSTOMER', 'TRUSTEE_OTHER', 'VOLUNTEER_OTHER', 'OTHER',
]
const RELATIONSHIPS = [
  'SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'OTHER_FAMILY',
  'BUSINESS_PARTNER', 'COMMON_DIRECTORSHIP', 'TRUSTEE_OF',
  'EMPLOYER', 'OTHER',
]

function InterestsAndRelatedParties({ trusteeId }: { trusteeId: string }) {
  const [tab, setTab] = useState<'interests' | 'related'>('interests')
  const tabBtn = (active: boolean) =>
    'px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ' +
    (active ? 'bg-saffron-400/15 text-saffron-300' : 'text-white/60 hover:text-white/80')
  return (
    <div className="rounded-2xl border border-white/10 bg-white/3 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-white/70 text-xs uppercase tracking-widest font-bold">⚖ Governance register</p>
          <p className="text-white/40 text-[10px]">CC27 interests · SORP §9.14 related parties.</p>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={() => setTab('interests')} className={tabBtn(tab === 'interests')}>Interests</button>
          <button type="button" onClick={() => setTab('related')}   className={tabBtn(tab === 'related')}>Related parties</button>
        </div>
      </div>
      {tab === 'interests' ? (
        <InterestsPanel trusteeId={trusteeId} />
      ) : (
        <RelatedPartiesPanel trusteeId={trusteeId} />
      )}
    </div>
  )
}

function InterestsPanel({ trusteeId }: { trusteeId: string }) {
  const [rows, setRows] = useState<TrusteeInterest[]>([])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState({
    category: 'EMPLOYMENT', counterparty: '', description: '', keywords: '',
    expires_at: '',
  })
  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ interests: TrusteeInterest[] }>(`/admin/board/trustees/${trusteeId}/interests`)
      setRows(r.interests || [])
    } catch { /* quiet */ }
  }, [trusteeId])
  useEffect(() => { void load() }, [load])

  async function add() {
    if (!draft.counterparty.trim()) { alert('Counterparty is required'); return }
    setBusy(true)
    try {
      await apiFetch(`/admin/board/trustees/${trusteeId}/interests`, {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          keywords: draft.keywords.trim() || draft.counterparty.trim(),
          expires_at: draft.expires_at || null,
        }),
      })
      setDraft({ category: 'EMPLOYMENT', counterparty: '', description: '', keywords: '', expires_at: '' })
      setAdding(false)
      await load()
    } finally { setBusy(false) }
  }

  async function withdraw(id: string) {
    if (!confirm('Mark this interest as withdrawn? It stays on the audit log.')) return
    try {
      await apiFetch(`/admin/board/trustees/${trusteeId}/interests/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <div className="space-y-2">
      {!adding ? (
        <button type="button" onClick={() => setAdding(true)}
          className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/80 text-xs font-bold hover:bg-white/10">
          + Declare interest
        </button>
      ) : (
        <div className="rounded-xl border border-saffron-400/30 bg-saffron-400/5 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-white/50 text-[10px] uppercase tracking-widest">Category</label>
              <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mt-1">
                {INTEREST_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="text-white/50 text-[10px] uppercase tracking-widest">Counterparty</label>
              <input value={draft.counterparty} onChange={e => setDraft(d => ({ ...d, counterparty: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mt-1"
                placeholder="Employer / company / family member" />
            </div>
          </div>
          <div>
            <label className="text-white/50 text-[10px] uppercase tracking-widest">Description</label>
            <textarea rows={2} value={draft.description}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mt-1 resize-none"
              placeholder="Role / nature of the relationship." />
          </div>
          <div>
            <label className="text-white/50 text-[10px] uppercase tracking-widest">Keywords (space-separated, used for auto-match)</label>
            <input value={draft.keywords} onChange={e => setDraft(d => ({ ...d, keywords: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mt-1"
              placeholder="Diwali Harrow Thaker-Co" />
          </div>
          <div>
            <label className="text-white/50 text-[10px] uppercase tracking-widest">Expires</label>
            <input type="date" value={draft.expires_at}
              onChange={e => setDraft(d => ({ ...d, expires_at: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mt-1" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={add} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-saffron-gradient text-white text-xs font-black shadow-saffron disabled:opacity-40">
              {busy ? 'Saving…' : 'Save interest'}
            </button>
            <button type="button" onClick={() => setAdding(false)}
              className="px-3 py-1.5 rounded-lg border border-white/15 text-white/60 text-xs font-bold hover:bg-white/5">
              Cancel
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-white/30 text-xs italic">No interests declared.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(r => (
            <li key={r.id} className="flex items-start justify-between gap-2 p-2 rounded-lg bg-white/3 border border-white/5">
              <div className="min-w-0 flex-1">
                <p className="text-white text-xs font-bold">{r.counterparty || '(no counterparty)'}</p>
                <p className="text-white/50 text-[10px] uppercase tracking-widest">
                  {r.category.replace(/_/g, ' ')} · {r.status}
                </p>
                {r.description && <p className="text-white/60 text-xs mt-0.5 line-clamp-2">{r.description}</p>}
              </div>
              {r.status === 'ACTIVE' && (
                <button type="button" onClick={() => withdraw(r.id)}
                  className="text-red-400/60 hover:text-red-400 text-xs">Withdraw</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RelatedPartiesPanel({ trusteeId }: { trusteeId: string }) {
  const [rows, setRows] = useState<TrusteeRelatedParty[]>([])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState({
    related_name: '', relationship: 'SPOUSE', notes: '',
  })
  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ related_parties: TrusteeRelatedParty[] }>(`/admin/board/trustees/${trusteeId}/related-parties`)
      setRows(r.related_parties || [])
    } catch { /* quiet */ }
  }, [trusteeId])
  useEffect(() => { void load() }, [load])

  async function add() {
    if (!draft.related_name.trim()) { alert('Name is required'); return }
    setBusy(true)
    try {
      await apiFetch(`/admin/board/trustees/${trusteeId}/related-parties`, {
        method: 'POST', body: JSON.stringify(draft),
      })
      setDraft({ related_name: '', relationship: 'SPOUSE', notes: '' })
      setAdding(false)
      await load()
    } finally { setBusy(false) }
  }

  async function remove(id: string) {
    if (!confirm('Remove this related party?')) return
    try {
      await apiFetch(`/admin/board/trustees/${trusteeId}/related-parties/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <div className="space-y-2">
      {!adding ? (
        <button type="button" onClick={() => setAdding(true)}
          className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/80 text-xs font-bold hover:bg-white/10">
          + Add related party
        </button>
      ) : (
        <div className="rounded-xl border border-saffron-400/30 bg-saffron-400/5 p-3 space-y-2">
          <div>
            <label className="text-white/50 text-[10px] uppercase tracking-widest">Name</label>
            <input value={draft.related_name} onChange={e => setDraft(d => ({ ...d, related_name: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mt-1"
              placeholder="Mrs Ami Thaker" />
          </div>
          <div>
            <label className="text-white/50 text-[10px] uppercase tracking-widest">Relationship</label>
            <select value={draft.relationship} onChange={e => setDraft(d => ({ ...d, relationship: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mt-1">
              {RELATIONSHIPS.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="text-white/50 text-[10px] uppercase tracking-widest">Notes</label>
            <textarea rows={2} value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mt-1 resize-none" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={add} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-saffron-gradient text-white text-xs font-black shadow-saffron disabled:opacity-40">
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setAdding(false)}
              className="px-3 py-1.5 rounded-lg border border-white/15 text-white/60 text-xs font-bold hover:bg-white/5">
              Cancel
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-white/30 text-xs italic">No related parties declared.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(r => (
            <li key={r.id} className="flex items-start justify-between gap-2 p-2 rounded-lg bg-white/3 border border-white/5">
              <div className="min-w-0 flex-1">
                <p className="text-white text-xs font-bold">{r.related_name}</p>
                <p className="text-white/50 text-[10px] uppercase tracking-widest">{r.relationship.replace(/_/g, ' ')}</p>
                {r.notes && <p className="text-white/60 text-xs mt-0.5 line-clamp-2">{r.notes}</p>}
              </div>
              <button type="button" onClick={() => remove(r.id)}
                className="text-red-400/60 hover:text-red-400 text-xs">✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── CC3 / Governance Code 3.3 — Trustee induction checklist ───────────

interface InductionItem {
  code: string
  title: string
  category: string
  description: string
  sort_order: number
  is_required: boolean
  completed_at: string | null
  completed_by_name: string
  evidence_note: string
}

function InductionPanel({ trusteeId }: { trusteeId: string }) {
  const [items, setItems] = useState<InductionItem[]>([])
  const [pct, setPct] = useState(0)
  const [reqPct, setReqPct] = useState(0)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ items: InductionItem[]; completion_pct: number; required_completion_pct: number }>(
        `/admin/board/trustees/${trusteeId}/induction`,
      )
      setItems(r.items || [])
      setPct(r.completion_pct)
      setReqPct(r.required_completion_pct)
    } catch { /* quiet */ }
  }, [trusteeId])
  useEffect(() => { void load() }, [load])

  async function toggle(item: InductionItem) {
    setBusy(true)
    try {
      if (item.completed_at) {
        await apiFetch(`/admin/board/trustees/${trusteeId}/induction/${item.code}`, { method: 'DELETE' })
      } else {
        const note = window.prompt(`Evidence for "${item.title}" (optional)`, '') || ''
        await apiFetch(`/admin/board/trustees/${trusteeId}/induction/${item.code}`, {
          method: 'PUT', body: JSON.stringify({ evidence_note: note }),
        })
      }
      await load()
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/3 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-white/70 text-xs uppercase tracking-widest font-bold">📋 Induction (CC3)</p>
          <p className="text-white/40 text-[10px]">Governance Code 3.3 — brief every trustee on these.</p>
        </div>
        <div className="text-right">
          <p className="text-white font-black text-lg">{pct.toFixed(0)}%</p>
          <p className="text-white/50 text-[10px]">Required: {reqPct.toFixed(0)}%</p>
        </div>
      </div>
      <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <ul className="space-y-1.5">
        {items.map(it => (
          <li key={it.code} className="flex items-start gap-2 p-2 rounded-lg bg-white/3 border border-white/5">
            <button type="button" onClick={() => toggle(it)} disabled={busy}
              className={'mt-0.5 w-5 h-5 rounded border flex items-center justify-center text-xs font-black transition ' +
                (it.completed_at ? 'bg-emerald-500 border-emerald-400 text-white' : 'border-white/30 text-transparent hover:border-white/50')}>
              {it.completed_at ? '✓' : ''}
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-white text-xs font-bold">
                {it.title}
                {it.is_required && <span className="ml-1 text-red-300 text-[10px]">*</span>}
              </p>
              <p className="text-white/40 text-[10px]">{it.category.replace(/_/g, ' ')}{it.description && ` · ${it.description}`}</p>
              {it.completed_at && (
                <p className="text-emerald-200/80 text-[10px] italic mt-0.5">
                  ✓ {new Date(it.completed_at).toLocaleDateString()}{it.completed_by_name && ` by ${it.completed_by_name}`}
                  {it.evidence_note && ` — ${it.evidence_note}`}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── CC9 — DBS tracking ─────────────────────────────────────────────────

const DBS_TYPES = ['NONE', 'BASIC', 'STANDARD', 'ENHANCED', 'ENHANCED_BARRED']

function DBSPanel({ trusteeId }: { trusteeId: string }) {
  const [form, setForm] = useState({
    dbs_type: 'NONE',
    dbs_reference: '',
    dbs_issued_at: '',
    dbs_valid_until: '',
    dbs_status: 'NOT_REQUIRED',
  })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      // Pull the trustee row via the existing endpoint, if available.
      // Otherwise leave defaults; a save will populate.
      const r = await apiFetch<{ trustee?: Record<string, string | null> }>(`/admin/board/trustees/${trusteeId}`)
      const t = r.trustee || {}
      setForm({
        dbs_type: (t.dbs_type as string) || 'NONE',
        dbs_reference: (t.dbs_reference as string) || '',
        dbs_issued_at: (t.dbs_issued_at as string)?.slice(0, 10) || '',
        dbs_valid_until: (t.dbs_valid_until as string)?.slice(0, 10) || '',
        dbs_status: (t.dbs_status as string) || 'NOT_REQUIRED',
      })
    } catch { /* quiet — endpoint may not exist yet */ }
  }, [trusteeId])
  useEffect(() => { void load() }, [load])

  async function save() {
    setBusy(true)
    try {
      await apiFetch(`/admin/board/trustees/${trusteeId}/dbs`, {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          dbs_issued_at: form.dbs_issued_at || null,
          dbs_valid_until: form.dbs_valid_until || null,
        }),
      })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed — this area is restricted to Safeguarding roles.')
    } finally { setBusy(false) }
  }

  const expiring = form.dbs_valid_until
    ? Math.round((new Date(form.dbs_valid_until).getTime() - Date.now()) / 864e5)
    : null
  const chip =
    form.dbs_type === 'NONE' ? { label: 'Not required', c: 'bg-white/10 text-white/50 border-white/20' }
    : expiring === null ? { label: 'Unknown', c: 'bg-white/10 text-white/50 border-white/20' }
    : expiring < 0 ? { label: 'Expired', c: 'bg-red-500/25 text-red-200 border-red-400/30' }
    : expiring <= 90 ? { label: `Expires in ${expiring}d`, c: 'bg-amber-500/25 text-amber-200 border-amber-400/30' }
    : { label: 'Valid', c: 'bg-emerald-500/25 text-emerald-200 border-emerald-400/30' }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/3 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-white/70 text-xs uppercase tracking-widest font-bold">🔎 DBS (CC9)</p>
          <p className="text-white/40 text-[10px]">Safeguarding — only Chair / Secretary / Safeguarding Lead may edit.</p>
        </div>
        <span className={'px-2 py-0.5 rounded-full text-[10px] font-black border ' + chip.c}>{chip.label}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="block text-white/50 text-[10px] uppercase tracking-widest font-bold">Type</label>
          <select value={form.dbs_type} onChange={e => setForm(f => ({ ...f, dbs_type: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mt-1">
            {DBS_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-white/50 text-[10px] uppercase tracking-widest font-bold">Reference</label>
          <input value={form.dbs_reference} onChange={e => setForm(f => ({ ...f, dbs_reference: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mt-1" />
        </div>
        <div>
          <label className="block text-white/50 text-[10px] uppercase tracking-widest font-bold">Issued</label>
          <input type="date" value={form.dbs_issued_at}
            onChange={e => setForm(f => ({ ...f, dbs_issued_at: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mt-1" />
        </div>
        <div>
          <label className="block text-white/50 text-[10px] uppercase tracking-widest font-bold">Valid until</label>
          <input type="date" value={form.dbs_valid_until}
            onChange={e => setForm(f => ({ ...f, dbs_valid_until: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mt-1" />
        </div>
      </div>
      <button type="button" onClick={save} disabled={busy}
        className="px-3 py-1.5 rounded-lg bg-saffron-gradient text-white text-xs font-black shadow-saffron disabled:opacity-40">
        {busy ? 'Saving…' : 'Save DBS'}
      </button>
    </div>
  )
}
