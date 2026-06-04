'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { UserPicker } from '@/components/ui/UserPicker'
import { AccountPicker } from '@/components/ui/AccountPicker'

// ─── Types (match the backend serialisation) ────────────────────────────────

interface Summary {
  id: string; project_id: string; name: string; description: string
  branch_id: string; goal_amount: number; budget_total: number
  status: string; risk_level: string
  start_date: string | null; end_date: string | null
  parent_project_id: string | null; parent_project_name: string | null
  project_manager_id: string | null; project_manager_name: string | null; project_manager_email: string | null
  business_owner_id: string | null;  business_owner_name: string | null;  business_owner_email: string | null
  tech_owner_id: string | null;      tech_owner_name: string | null;      tech_owner_email: string | null
  actual_cost: number; open_invoices: number
  team_size: number; open_risks: number; activity_count: number
  milestones_total: number; milestones_done: number
  documents_count: number; partners_count: number
  pending_approvals: number; budget_items_total: number
  incoming_funds_attributed: number
  sub_projects: { id: string; name: string; status: string; risk_level: string }[]
}

interface Assignment { id: string; user_id: string; user_name: string; user_email: string; role: string; notes: string; assigned_at: string }
interface Activity   { id: string; actor_email: string; kind: string; title: string; body: string; created_at: string }
interface Milestone  { id: string; title: string; description: string; owner_name: string | null; due_date: string | null; status: string; pct_complete: number }
interface Risk       { id: string; title: string; description: string; likelihood: number; impact: number; risk_score: number; mitigation: string; owner_name: string | null; status: string }
interface Expense    { id: string; spent_on: string; category: string; vendor: string; description: string; amount: number; invoice_ref: string }
interface Invoice    { id: string; vendor: string; invoice_no: string; invoice_date: string | null; due_date: string | null; paid_date: string | null; amount: number; status: string; file_url: string; notes: string }
interface BudgetItem { id: string; category: string; description: string; amount: number; spent: number; variance: number }
interface Partner    { id: string; account_id: string; relationship: string; account_name: string; account_type: string; email: string; phone: string; start_date: string | null; end_date: string | null; notes: string }
interface Document   { id: string; title: string; kind: string; file_url: string; version: string; uploaded_at: string; uploaded_by_name: string | null }
interface Approval   { id: string; kind: string; status: string; request_reason: string; requested_by_name: string | null; requested_at: string; approver_name: string | null; decided_at: string | null; decision_reason: string }
interface ApprovalsResp { items: Approval[]; approval_required: boolean; approval_reason: string; threshold_gbp: number }
interface FundingItem  { id: string; amount: number; purpose: string; source: string; payment_provider: string; gift_aid_eligible: boolean; donor_name: string | null; created_at: string }
interface FundingResp  { items: FundingItem[]; total_raised: number; gift_aid_total: number; txn_count: number }
interface VendorRollupRow { account_id: string; account_name: string; account_type: string; invoice_count: number; invoice_total: number; expense_count: number; expense_total: number; total_spend: number }
interface VendorRollupResp { vendors: VendorRollupRow[]; unlinked_invoices: number; unlinked_expenses: number }

// ─── Helpers ────────────────────────────────────────────────────────────────

const TABS = [
  'overview', 'team', 'milestones', 'risks',
  'budget', 'expenses', 'invoices', 'funding',
  'partners', 'vendors', 'documents', 'activity', 'approvals',
] as const
type Tab = typeof TABS[number]

const TAB_LABEL: Record<Tab, string> = {
  overview: '🏠 Overview', team: '👥 Team', milestones: '🎯 Milestones', risks: '⚠️ Risks',
  budget: '📊 Budget', expenses: '💸 Expenses', invoices: '📑 Invoices', funding: '🎁 Funding',
  partners: '🤝 Partners', vendors: '🏷️ Vendors', documents: '📄 Documents', activity: '📜 Activity',
  approvals: '✅ Approvals',
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n || 0)
}
function fmtDate(d: string | null): string { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' }
function fmtAge(d: string | null): string {
  if (!d) return '—'
  const t = new Date(d).getTime(); if (!t) return d
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`
  return `${Math.floor(s/86400)}d ago`
}

const STATUS_TONE: Record<string, string> = {
  DRAFT:     'bg-white/10 border-white/20 text-white/70',
  ACTIVE:    'bg-green-500/15 border-green-500/30 text-green-300',
  ON_HOLD:   'bg-amber-500/15 border-amber-500/30 text-amber-300',
  COMPLETE:  'bg-blue-500/15 border-blue-500/30 text-blue-300',
  COMPLETED: 'bg-blue-500/15 border-blue-500/30 text-blue-300',
  CANCELLED: 'bg-red-500/15 border-red-500/30 text-red-300',
  PENDING:   'bg-amber-500/15 border-amber-500/30 text-amber-300',
  APPROVED:  'bg-green-500/15 border-green-500/30 text-green-300',
  REJECTED:  'bg-red-500/15 border-red-500/30 text-red-300',
  WITHDRAWN: 'bg-white/5 border-white/10 text-white/40',
  IN_PROGRESS: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
  DONE:      'bg-green-500/15 border-green-500/30 text-green-300',
  SKIPPED:   'bg-white/5 border-white/10 text-white/40',
  RECEIVED:  'bg-white/10 border-white/20 text-white/70',
  PAID:      'bg-green-500/15 border-green-500/30 text-green-300',
  DISPUTED:  'bg-red-500/15 border-red-500/30 text-red-300',
  OPEN:      'bg-red-500/15 border-red-500/30 text-red-300',
  CLOSED:    'bg-white/5 border-white/10 text-white/40',
  MITIGATED: 'bg-green-500/15 border-green-500/30 text-green-300',
}
const RAG_TONE: Record<string, string> = {
  GREEN: 'bg-green-500/15 border-green-500/30 text-green-300',
  AMBER: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
  RED:   'bg-red-500/15 border-red-500/30 text-red-300',
}

function Badge({ value, tone }: { value: string; tone?: string }) {
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${tone || 'bg-white/5 border-white/10 text-white/60'}`}>
      {value}
    </span>
  )
}

// ─── Generic CRUD-tab helpers ────────────────────────────────────────────────

function SectionHeader({ title, count, action }: { title: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-white font-bold text-lg">{title}{typeof count === 'number' && <span className="text-white/40 ml-2 text-sm font-normal">({count})</span>}</h2>
      {action}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  // useSearchParams is a hook → must run on every render. Pull id up front.
  const searchParams = useSearchParams()
  const id = searchParams.get('id') || ''

  const [tab, setTab] = useState<Tab>('overview')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [err, setErr] = useState('')
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const loadSummary = useCallback(async () => {
    if (!id) return
    setErr('')
    try {
      const s = await apiFetch<Summary>(`/admin/projects/${id}/summary`)
      setSummary(s)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load project') }
  }, [id])
  useEffect(() => { loadSummary() }, [loadSummary])

  // Early-return AFTER all hooks have been called (rules-of-hooks compliant).
  if (!id) {
    return <div className="p-6 text-white/40">No project id in the URL. Go back to <Link href="/finance/projects" className="text-saffron-300 underline">the list</Link>.</div>
  }

  if (err) return (
    <div className="space-y-5"><Link href="/finance/projects" className="text-saffron-300 text-sm hover:underline">← Back to projects</Link>
    <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl">{err}</div></div>
  )
  if (!summary) return <div className="text-white/40 p-6">Loading…</div>

  const pctBudgetUsed = summary.budget_total > 0 ? Math.min(100, (summary.actual_cost / summary.budget_total) * 100) : 0

  return (
    <div className="space-y-5 animate-fade-in max-w-6xl">
      <Link href="/finance/projects" className="text-saffron-300 text-sm hover:underline">← Back to projects</Link>

      {/* Header */}
      <div className="glass rounded-2xl p-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Badge value={summary.status || 'DRAFT'} tone={STATUS_TONE[summary.status?.toUpperCase()] || ''} />
              <Badge value={`RAG ${summary.risk_level || 'GREEN'}`} tone={RAG_TONE[(summary.risk_level || 'GREEN').toUpperCase()] || ''} />
              {summary.pending_approvals > 0 && <Badge value={`${summary.pending_approvals} pending approval`} tone="bg-amber-500/15 border-amber-500/30 text-amber-300" />}
            </div>
            <h1 className="text-3xl font-black text-white">{summary.name}</h1>
            <p className="text-white/40 text-sm mt-1">
              <span className="font-mono">{summary.project_id}</span> · {summary.branch_id}
              {summary.parent_project_name && <> · child of <Link href={`/finance/projects/detail?id=${summary.parent_project_id}`} className="text-saffron-300 hover:underline">{summary.parent_project_name}</Link></>}
            </p>
            {summary.description && <p className="text-white/60 text-sm mt-3 max-w-3xl">{summary.description}</p>}
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="Budget"          value={fmtCurrency(summary.budget_total)} hint={`${pctBudgetUsed.toFixed(0)}% used`} />
          <KPI label="Actual"          value={fmtCurrency(summary.actual_cost)}  hint={`${fmtCurrency(summary.budget_total - summary.actual_cost)} remaining`} />
          <KPI label="Funds raised"    value={fmtCurrency(summary.incoming_funds_attributed)} hint={`Goal ${fmtCurrency(summary.goal_amount)}`} />
          <KPI label="Open invoices"   value={fmtCurrency(summary.open_invoices)} hint={`Team ${summary.team_size} · Risks ${summary.open_risks}`} />
        </div>

        {/* Owners — click any card to assign / change the person */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <OwnerEditor projectId={id} role="Project Manager" field="project_manager_id"
            current={summary.project_manager_id ? { id: summary.project_manager_id, name: summary.project_manager_name || '', email: summary.project_manager_email || '' } : null}
            onSaved={loadSummary} />
          <OwnerEditor projectId={id} role="Business Owner"  field="business_owner_id"
            current={summary.business_owner_id ? { id: summary.business_owner_id, name: summary.business_owner_name || '', email: summary.business_owner_email || '' } : null}
            onSaved={loadSummary} />
          <OwnerEditor projectId={id} role="Tech Owner"      field="tech_owner_id"
            current={summary.tech_owner_id ? { id: summary.tech_owner_id, name: summary.tech_owner_name || '', email: summary.tech_owner_email || '' } : null}
            onSaved={loadSummary} />
        </div>

        {/* Sub-projects */}
        {summary.sub_projects.length > 0 && (
          <div>
            <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Sub-projects</p>
            <div className="flex gap-2 flex-wrap">
              {summary.sub_projects.map(c => (
                <Link key={c.id} href={`/finance/projects/detail?id=${c.id}`}
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 flex items-center gap-2">
                  <span className="text-white/80 text-sm">{c.name}</span>
                  <Badge value={c.status} tone={STATUS_TONE[c.status?.toUpperCase()] || ''} />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-white/10">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${tab === t ? 'border-saffron-400 text-saffron-400' : 'border-transparent text-white/50 hover:text-white/80'}`}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {actionMsg && (
        <p className={`text-sm rounded-lg px-3 py-2 ${actionMsg.ok ? 'bg-green-500/15 text-green-300 border border-green-500/30' : 'bg-red-500/15 text-red-300 border border-red-500/30'}`}>
          {actionMsg.text}
        </p>
      )}

      {tab === 'overview'   && <OverviewTab   s={summary} />}
      {tab === 'team'       && <TeamTab       projectId={id} setMsg={setActionMsg} onChange={loadSummary} />}
      {tab === 'milestones' && <MilestonesTab projectId={id} setMsg={setActionMsg} onChange={loadSummary} />}
      {tab === 'risks'      && <RisksTab      projectId={id} setMsg={setActionMsg} onChange={loadSummary} />}
      {tab === 'budget'     && <BudgetTab     projectId={id} setMsg={setActionMsg} onChange={loadSummary} />}
      {tab === 'expenses'   && <ExpensesTab   projectId={id} setMsg={setActionMsg} onChange={loadSummary} />}
      {tab === 'invoices'   && <InvoicesTab   projectId={id} setMsg={setActionMsg} onChange={loadSummary} />}
      {tab === 'funding'    && <FundingTab    projectId={id} />}
      {tab === 'partners'   && <PartnersTab   projectId={id} setMsg={setActionMsg} onChange={loadSummary} />}
      {tab === 'vendors'    && <VendorsTab    projectId={id} />}
      {tab === 'documents'  && <DocumentsTab  projectId={id} setMsg={setActionMsg} onChange={loadSummary} />}
      {tab === 'activity'   && <ActivityTab   projectId={id} setMsg={setActionMsg} onChange={loadSummary} />}
      {tab === 'approvals'  && <ApprovalsTab  projectId={id} setMsg={setActionMsg} onChange={loadSummary} />}
    </div>
  )
}

// ─── Small reusable bits ────────────────────────────────────────────────────

function KPI({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl p-3 bg-white/5 border border-white/10">
      <p className="text-white/40 text-[10px] uppercase tracking-wider">{label}</p>
      <p className="text-xl font-black text-white">{value}</p>
      {hint && <p className="text-white/40 text-xs mt-0.5">{hint}</p>}
    </div>
  )
}
function OwnerEditor({ projectId, role, field, current, onSaved }: {
  projectId: string
  role: string
  field: 'project_manager_id' | 'business_owner_id' | 'tech_owner_id'
  current: { id: string; name: string; email: string } | null
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  async function save(sel: { id: string; name: string; email: string } | null) {
    setSaving(true)
    try {
      await apiFetch(`/admin/projects/${projectId}/owners`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: sel?.id || '' }),
      })
      onSaved(); setEditing(false)
    } finally { setSaving(false) }
  }
  return (
    <div className="rounded-xl p-3 bg-white/5 border border-white/10">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-white/40 text-[10px] uppercase tracking-wider">{role}</p>
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-saffron-300 text-[10px] hover:underline">
            {current ? 'Change' : 'Assign'}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-1">
          <UserPicker value={current ? { id: current.id, name: current.name, email: current.email } : null} onChange={save} placeholder="Search & assign…" />
          <div className="flex justify-between text-[10px]">
            <button onClick={() => save(null)} disabled={saving} className="text-red-400 hover:underline">Clear</button>
            <button onClick={() => setEditing(false)} className="text-white/40 hover:text-white/70">Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-white font-semibold text-sm">{current?.name || <span className="text-white/30">— unassigned</span>}</p>
          {current?.email && <p className="text-white/40 text-xs">{current.email}</p>}
        </>
      )}
    </div>
  )
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

function OverviewTab({ s }: { s: Summary }) {
  return (
    <div className="glass rounded-2xl p-5 space-y-4">
      <h2 className="text-white font-bold">Overview</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Field label="Start date" value={fmtDate(s.start_date)} />
        <Field label="End date"   value={fmtDate(s.end_date)} />
        <Field label="Milestones" value={`${s.milestones_done}/${s.milestones_total}`} />
        <Field label="Documents"  value={String(s.documents_count)} />
        <Field label="Partners"   value={String(s.partners_count)} />
        <Field label="Activity"   value={`${s.activity_count} events`} />
        <Field label="Goal"       value={fmtCurrency(s.goal_amount)} />
        <Field label="Budget items" value={fmtCurrency(s.budget_items_total)} />
      </div>
    </div>
  )
}
function Field({ label, value }: { label: string; value: string }) {
  return <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2"><p className="text-white/40 text-[10px] uppercase tracking-wider">{label}</p><p className="text-white">{value}</p></div>
}

function CardWrap({ children }: { children: React.ReactNode }) {
  return <div className="glass rounded-2xl p-5 space-y-4">{children}</div>
}

// Hook abstracting the typical "fetch list / post / delete" pattern.
function useList<T>(url: string, key: string = 'items') {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try { const d = await apiFetch<Record<string, unknown>>(url); setItems((d?.[key] as T[]) || []) }
    catch { setItems([]) } finally { setLoading(false) }
  }, [url, key])
  useEffect(() => { load() }, [load])
  return { items, loading, reload: load }
}

// ─── Team ───────────────────────────────────────────────────────────────────

function TeamTab({ projectId, setMsg, onChange }: { projectId: string; setMsg: (m: { text: string; ok: boolean }) => void; onChange: () => void }) {
  const { items, reload } = useList<Assignment>(`/admin/projects/${projectId}/assignments`)
  const [picked, setPicked] = useState<{ id: string; name: string; email: string } | null>(null)
  const [role, setRole] = useState('TEAM_MEMBER'); const [notes, setNotes] = useState('')
  async function add() {
    if (!picked) { setMsg({ text: 'Pick a person first', ok: false }); return }
    try { await apiFetch(`/admin/projects/${projectId}/assignments`, { method: 'POST', body: JSON.stringify({ user_id: picked.id, role: role.trim(), notes }) })
      setMsg({ text: 'Added', ok: true }); setPicked(null); setNotes(''); reload(); onChange() }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) }
  }
  async function remove(aid: string) {
    if (!confirm('Remove this team member?')) return
    try { await apiFetch(`/admin/projects/${projectId}/assignments/${aid}`, { method: 'DELETE' })
      setMsg({ text: 'Removed', ok: true }); reload(); onChange() }
    catch { setMsg({ text: 'Failed', ok: false }) }
  }
  return <CardWrap>
    <SectionHeader title="Team" count={items.length} action={<Link href="/users" className="text-xs text-saffron-300 hover:underline">+ Add user →</Link>} />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      <UserPicker value={picked} onChange={setPicked} placeholder="Search for a person…" />
      <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={role} onChange={e => setRole(e.target.value)}>
        {['PROJECT_MANAGER','BUSINESS_OWNER','TECH_OWNER','DEVELOPER','ANALYST','TESTER','TEAM_MEMBER','OBSERVER'].map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <div className="flex gap-2">
        <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white flex-1" placeholder="notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
        <button onClick={add} className="px-4 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold">+ Add</button>
      </div>
    </div>
    <table className="w-full text-sm">
      <thead><tr className="text-left text-white/40 text-xs uppercase tracking-wider border-b border-white/10">
        <th className="py-2">Person</th><th className="py-2">Role</th><th className="py-2">Notes</th><th className="py-2">Added</th><th className="py-2"></th>
      </tr></thead>
      <tbody>
        {items.map(a => <tr key={a.id} className="border-b border-white/5">
          <td className="py-2 text-white">{a.user_name || <span className="text-white/30 font-mono text-xs">{a.user_id.slice(0,8)}</span>}<p className="text-white/40 text-xs">{a.user_email}</p></td>
          <td className="py-2"><Badge value={a.role} /></td>
          <td className="py-2 text-white/60">{a.notes}</td>
          <td className="py-2 text-white/40 text-xs">{fmtAge(a.assigned_at)}</td>
          <td className="py-2 text-right"><button onClick={() => remove(a.id)} className="text-red-400 text-xs hover:underline">Remove</button></td>
        </tr>)}
        {items.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-white/30">No team members yet.</td></tr>}
      </tbody>
    </table>
  </CardWrap>
}

// ─── Milestones ─────────────────────────────────────────────────────────────

function MilestonesTab({ projectId, setMsg, onChange }: { projectId: string; setMsg: (m: { text: string; ok: boolean }) => void; onChange: () => void }) {
  const { items, reload } = useList<Milestone>(`/admin/projects/${projectId}/milestones`)
  const [title, setTitle] = useState(''); const [due, setDue] = useState('')
  async function add() {
    if (!title.trim()) return
    try { await apiFetch(`/admin/projects/${projectId}/milestones`, { method: 'POST', body: JSON.stringify({ title, due_date: due || null }) })
      setTitle(''); setDue(''); reload(); onChange() }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) }
  }
  async function setStatus(m: Milestone, s: string) {
    try { await apiFetch(`/admin/projects/${projectId}/milestones/${m.id}`, { method: 'PUT', body: JSON.stringify({ ...m, status: s, owner_id: null }) })
      reload(); onChange() } catch { /* ignore */ }
  }
  return <CardWrap>
    <SectionHeader title="Milestones" count={items.length} />
    <div className="flex gap-2 flex-wrap">
      <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white flex-1 min-w-[200px]" placeholder="Milestone title" value={title} onChange={e => setTitle(e.target.value)} />
      <input type="date" className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={due} onChange={e => setDue(e.target.value)} />
      <button onClick={add} className="px-4 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold">+ Add</button>
    </div>
    <div className="space-y-2">
      {items.map(m => <div key={m.id} className="rounded-xl p-3 bg-white/5 border border-white/10">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex-1 min-w-0"><p className="text-white font-semibold">{m.title}</p><p className="text-white/40 text-xs">Due {fmtDate(m.due_date)} · {m.owner_name || 'no owner'}</p></div>
          <Badge value={m.status} tone={STATUS_TONE[m.status] || ''} />
          <select value={m.status} onChange={e => setStatus(m, e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white">
            {['PENDING','IN_PROGRESS','DONE','SKIPPED'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>)}
      {items.length === 0 && <p className="text-white/30 text-sm text-center py-6">No milestones yet.</p>}
    </div>
  </CardWrap>
}

// ─── Risks ──────────────────────────────────────────────────────────────────

function RisksTab({ projectId, setMsg, onChange }: { projectId: string; setMsg: (m: { text: string; ok: boolean }) => void; onChange: () => void }) {
  const { items, reload } = useList<Risk>(`/admin/projects/${projectId}/risks`)
  const [title, setTitle] = useState(''); const [likelihood, setL] = useState(3); const [impact, setI] = useState(3); const [mit, setMit] = useState('')
  async function add() {
    if (!title.trim()) return
    try { await apiFetch(`/admin/projects/${projectId}/risks`, { method: 'POST', body: JSON.stringify({ title, likelihood, impact, mitigation: mit }) })
      setTitle(''); setMit(''); reload(); onChange() }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) }
  }
  return <CardWrap>
    <SectionHeader title="Risk register" count={items.length} />
    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
      <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white md:col-span-2" placeholder="Risk title" value={title} onChange={e => setTitle(e.target.value)} />
      <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={likelihood} onChange={e => setL(parseInt(e.target.value))}>{[1,2,3,4,5].map(n => <option key={n} value={n}>Likelihood {n}</option>)}</select>
      <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={impact} onChange={e => setI(parseInt(e.target.value))}>{[1,2,3,4,5].map(n => <option key={n} value={n}>Impact {n}</option>)}</select>
      <button onClick={add} className="px-4 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold">+ Add</button>
      <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white md:col-span-5" placeholder="Mitigation" value={mit} onChange={e => setMit(e.target.value)} />
    </div>
    <table className="w-full text-sm">
      <thead><tr className="text-left text-white/40 text-xs uppercase tracking-wider border-b border-white/10">
        <th className="py-2">Risk</th><th className="py-2">L × I = Score</th><th className="py-2">Mitigation</th><th className="py-2">Status</th>
      </tr></thead>
      <tbody>
        {items.map(r => <tr key={r.id} className="border-b border-white/5">
          <td className="py-2 text-white">{r.title}{r.description && <p className="text-white/40 text-xs">{r.description}</p>}</td>
          <td className="py-2 text-white/70">{r.likelihood} × {r.impact} = <span className={`font-bold ${r.risk_score >= 15 ? 'text-red-400' : r.risk_score >= 8 ? 'text-amber-400' : 'text-green-400'}`}>{r.risk_score}</span></td>
          <td className="py-2 text-white/60">{r.mitigation}</td>
          <td className="py-2"><Badge value={r.status} tone={STATUS_TONE[r.status] || ''} /></td>
        </tr>)}
        {items.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-white/30">No risks logged.</td></tr>}
      </tbody>
    </table>
  </CardWrap>
}

// ─── Budget ─────────────────────────────────────────────────────────────────

function BudgetTab({ projectId, setMsg, onChange }: { projectId: string; setMsg: (m: { text: string; ok: boolean }) => void; onChange: () => void }) {
  const { items, reload } = useList<BudgetItem>(`/admin/projects/${projectId}/budget-items`)
  const [cat, setCat] = useState('LABOUR'); const [amt, setAmt] = useState(''); const [desc, setDesc] = useState('')
  async function add() {
    if (!amt) return
    try { await apiFetch(`/admin/projects/${projectId}/budget-items`, { method: 'POST', body: JSON.stringify({ category: cat, amount: Number(amt), description: desc }) })
      setAmt(''); setDesc(''); reload(); onChange() }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) }
  }
  return <CardWrap>
    <SectionHeader title="Budget — by category" count={items.length} />
    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
      <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={cat} onChange={e => setCat(e.target.value)}>{['LABOUR','MATERIALS','SERVICES','TRAVEL','OTHER'].map(c => <option key={c}>{c}</option>)}</select>
      <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" type="number" step="0.01" placeholder="£ amount" value={amt} onChange={e => setAmt(e.target.value)} />
      <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="description" value={desc} onChange={e => setDesc(e.target.value)} />
      <button onClick={add} className="px-4 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold">+ Add</button>
    </div>
    <table className="w-full text-sm">
      <thead><tr className="text-left text-white/40 text-xs uppercase tracking-wider border-b border-white/10">
        <th className="py-2">Category</th><th className="py-2">Description</th><th className="py-2 text-right">Budget</th><th className="py-2 text-right">Spent</th><th className="py-2 text-right">Variance</th>
      </tr></thead>
      <tbody>
        {items.map(b => <tr key={b.id} className="border-b border-white/5">
          <td className="py-2 text-white">{b.category}</td>
          <td className="py-2 text-white/60">{b.description}</td>
          <td className="py-2 text-right text-white/80">{fmtCurrency(b.amount)}</td>
          <td className="py-2 text-right text-white/80">{fmtCurrency(b.spent)}</td>
          <td className={`py-2 text-right font-bold ${b.variance < 0 ? 'text-red-400' : 'text-green-400'}`}>{fmtCurrency(b.variance)}</td>
        </tr>)}
        {items.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-white/30">No budget items yet.</td></tr>}
      </tbody>
    </table>
  </CardWrap>
}

// ─── Expenses ───────────────────────────────────────────────────────────────

function ExpensesTab({ projectId, setMsg, onChange }: { projectId: string; setMsg: (m: { text: string; ok: boolean }) => void; onChange: () => void }) {
  const { items, reload } = useList<Expense>(`/admin/projects/${projectId}/expenses`)
  const [date, setDate] = useState(new Date().toISOString().slice(0,10)); const [cat, setCat] = useState('OTHER'); const [vendor, setVendor] = useState(''); const [amt, setAmt] = useState(''); const [desc, setDesc] = useState('')
  async function add() {
    if (!amt) return
    try { await apiFetch(`/admin/projects/${projectId}/expenses`, { method: 'POST', body: JSON.stringify({ spent_on: date, category: cat, vendor, amount: Number(amt), description: desc }) })
      setAmt(''); setDesc(''); setVendor(''); reload(); onChange() }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) }
  }
  return <CardWrap>
    <SectionHeader title="Expenses" count={items.length} />
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
      <input type="date" className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={date} onChange={e => setDate(e.target.value)} />
      <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={cat} onChange={e => setCat(e.target.value)}>{['LABOUR','MATERIALS','SERVICES','TRAVEL','OTHER'].map(c => <option key={c}>{c}</option>)}</select>
      <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="vendor" value={vendor} onChange={e => setVendor(e.target.value)} />
      <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" type="number" step="0.01" placeholder="£ amount" value={amt} onChange={e => setAmt(e.target.value)} />
      <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white md:col-span-1" placeholder="description" value={desc} onChange={e => setDesc(e.target.value)} />
      <button onClick={add} className="px-4 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold">+ Add</button>
    </div>
    <table className="w-full text-sm">
      <thead><tr className="text-left text-white/40 text-xs uppercase tracking-wider border-b border-white/10">
        <th className="py-2">Date</th><th className="py-2">Category</th><th className="py-2">Vendor</th><th className="py-2">Description</th><th className="py-2 text-right">Amount</th>
      </tr></thead>
      <tbody>
        {items.map(e => <tr key={e.id} className="border-b border-white/5">
          <td className="py-2 text-white/60 text-xs">{fmtDate(e.spent_on)}</td>
          <td className="py-2"><Badge value={e.category} /></td>
          <td className="py-2 text-white">{e.vendor || '—'}</td>
          <td className="py-2 text-white/60">{e.description}</td>
          <td className="py-2 text-right text-saffron-300 font-bold">{fmtCurrency(e.amount)}</td>
        </tr>)}
        {items.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-white/30">No expenses recorded.</td></tr>}
      </tbody>
    </table>
  </CardWrap>
}

// ─── Invoices ───────────────────────────────────────────────────────────────

function InvoicesTab({ projectId, setMsg, onChange }: { projectId: string; setMsg: (m: { text: string; ok: boolean }) => void; onChange: () => void }) {
  const { items, reload } = useList<Invoice>(`/admin/projects/${projectId}/invoices`)
  const [vendorPick, setVendorPick] = useState<{ id: string; name: string } | null>(null)
  const [no, setNo] = useState(''); const [date, setDate] = useState(''); const [due, setDue] = useState(''); const [amt, setAmt] = useState('')
  async function add() {
    if (!vendorPick || !amt) { setMsg({ text: 'Pick a vendor and enter an amount', ok: false }); return }
    try { await apiFetch(`/admin/projects/${projectId}/invoices`, { method: 'POST', body: JSON.stringify({ vendor: vendorPick.name, invoice_no: no, invoice_date: date || null, due_date: due || null, amount: Number(amt) }) })
      setVendorPick(null); setNo(''); setDate(''); setDue(''); setAmt(''); reload(); onChange() }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) }
  }
  async function markPaid(inv: Invoice) {
    try { await apiFetch(`/admin/projects/${projectId}/invoices/${inv.id}`, { method: 'PUT', body: JSON.stringify({ ...inv, status: 'PAID', paid_date: new Date().toISOString().slice(0,10) }) })
      reload(); onChange() } catch { /* ignore */ }
  }
  return <CardWrap>
    <SectionHeader title="Vendor invoices" count={items.length} action={<Link href="/accounts" className="text-xs text-saffron-300 hover:underline">+ New vendor →</Link>} />
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
      <div className="md:col-span-2"><AccountPicker accountType="supplier" value={vendorPick} onChange={setVendorPick} placeholder="Search vendor…" /></div>
      <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="invoice #" value={no} onChange={e => setNo(e.target.value)} />
      <input type="date" className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={date} onChange={e => setDate(e.target.value)} />
      <input type="date" className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={due} onChange={e => setDue(e.target.value)} />
      <div className="flex gap-2">
        <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white flex-1" type="number" step="0.01" placeholder="£" value={amt} onChange={e => setAmt(e.target.value)} />
        <button onClick={add} className="px-3 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold">+</button>
      </div>
    </div>
    <table className="w-full text-sm">
      <thead><tr className="text-left text-white/40 text-xs uppercase tracking-wider border-b border-white/10">
        <th className="py-2">Vendor</th><th className="py-2">Invoice #</th><th className="py-2">Date</th><th className="py-2">Due</th><th className="py-2 text-right">Amount</th><th className="py-2">Status</th><th className="py-2"></th>
      </tr></thead>
      <tbody>
        {items.map(i => <tr key={i.id} className="border-b border-white/5">
          <td className="py-2 text-white">{i.vendor}</td>
          <td className="py-2 text-white/60 font-mono text-xs">{i.invoice_no || '—'}</td>
          <td className="py-2 text-white/60 text-xs">{fmtDate(i.invoice_date)}</td>
          <td className="py-2 text-white/60 text-xs">{fmtDate(i.due_date)}</td>
          <td className="py-2 text-right text-saffron-300 font-bold">{fmtCurrency(i.amount)}</td>
          <td className="py-2"><Badge value={i.status} tone={STATUS_TONE[i.status] || ''} /></td>
          <td className="py-2 text-right">{i.status !== 'PAID' && <button onClick={() => markPaid(i)} className="text-green-400 text-xs hover:underline">Mark paid</button>}</td>
        </tr>)}
        {items.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-white/30">No invoices.</td></tr>}
      </tbody>
    </table>
  </CardWrap>
}

// ─── Funding (read-only) ────────────────────────────────────────────────────

function FundingTab({ projectId }: { projectId: string }) {
  const [data, setData] = useState<FundingResp | null>(null)
  useEffect(() => { apiFetch<FundingResp>(`/admin/projects/${projectId}/funding`).then(setData).catch(() => setData(null)) }, [projectId])
  if (!data) return <CardWrap><p className="text-white/40 text-sm">Loading…</p></CardWrap>
  return <CardWrap>
    <SectionHeader title="Funding — donations attributed to this project" count={data.txn_count} />
    <div className="grid grid-cols-3 gap-2 mb-3">
      <KPI label="Total raised" value={fmtCurrency(data.total_raised)} />
      <KPI label="Gift Aid (25%)" value={fmtCurrency(data.gift_aid_total)} />
      <KPI label="Transactions" value={String(data.txn_count)} />
    </div>
    <table className="w-full text-sm">
      <thead><tr className="text-left text-white/40 text-xs uppercase tracking-wider border-b border-white/10">
        <th className="py-2">When</th><th className="py-2">Donor</th><th className="py-2">Source</th><th className="py-2 text-right">Amount</th><th className="py-2">GA</th>
      </tr></thead>
      <tbody>
        {data.items.map(d => <tr key={d.id} className="border-b border-white/5">
          <td className="py-2 text-white/60 text-xs">{fmtDate(d.created_at)}</td>
          <td className="py-2 text-white">{d.donor_name || <span className="text-white/30">anonymous</span>}</td>
          <td className="py-2 text-white/60 text-xs">{d.source}</td>
          <td className="py-2 text-right text-saffron-300 font-bold">{fmtCurrency(d.amount)}</td>
          <td className="py-2">{d.gift_aid_eligible && <Badge value="GA" tone="bg-green-500/15 border-green-500/30 text-green-300" />}</td>
        </tr>)}
        {data.items.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-white/30">No donations linked yet. Tag donations with this project_id to attribute them.</td></tr>}
      </tbody>
    </table>
  </CardWrap>
}

// ─── Partners ───────────────────────────────────────────────────────────────

function PartnersTab({ projectId, setMsg, onChange }: { projectId: string; setMsg: (m: { text: string; ok: boolean }) => void; onChange: () => void }) {
  const { items, reload } = useList<Partner>(`/admin/projects/${projectId}/partners`)
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null)
  const [rel, setRel] = useState('PARTNER'); const [notes, setNotes] = useState('')
  async function add() {
    if (!picked) { setMsg({ text: 'Pick a CRM account first', ok: false }); return }
    try { await apiFetch(`/admin/projects/${projectId}/partners`, { method: 'POST', body: JSON.stringify({ account_id: picked.id, relationship: rel, notes }) })
      setPicked(null); setNotes(''); reload(); onChange() }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) }
  }
  return <CardWrap>
    <SectionHeader title="Partners + suppliers" count={items.length} action={<Link href="/accounts" className="text-xs text-saffron-300 hover:underline">+ New account →</Link>} />
    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
      <AccountPicker accountType="any" value={picked} onChange={setPicked} placeholder="Search CRM accounts…" />
      <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={rel} onChange={e => setRel(e.target.value)}>{['PARTNER','GRANTOR','BENEFICIARY','SPONSOR','SUPPLIER'].map(r => <option key={r}>{r}</option>)}</select>
      <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="notes" value={notes} onChange={e => setNotes(e.target.value)} />
      <button onClick={add} className="px-4 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold">+ Add</button>
    </div>
    <table className="w-full text-sm">
      <thead><tr className="text-left text-white/40 text-xs uppercase tracking-wider border-b border-white/10">
        <th className="py-2">Account</th><th className="py-2">Relationship</th><th className="py-2">Contact</th><th className="py-2">Notes</th>
      </tr></thead>
      <tbody>
        {items.map(p => <tr key={p.id} className="border-b border-white/5">
          <td className="py-2 text-white">{p.account_name}<p className="text-white/40 text-xs">{p.account_type}</p></td>
          <td className="py-2"><Badge value={p.relationship} /></td>
          <td className="py-2 text-white/60 text-xs">{p.email || '—'}<br/>{p.phone}</td>
          <td className="py-2 text-white/60">{p.notes}</td>
        </tr>)}
        {items.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-white/30">No partners linked. Pick a crm_accounts.id from the Accounts page.</td></tr>}
      </tbody>
    </table>
  </CardWrap>
}

// ─── Vendors rollup (read-only) ─────────────────────────────────────────────

function VendorsTab({ projectId }: { projectId: string }) {
  const [data, setData] = useState<VendorRollupResp | null>(null)
  useEffect(() => { apiFetch<VendorRollupResp>(`/admin/projects/${projectId}/vendors-rollup`).then(setData).catch(() => setData(null)) }, [projectId])
  if (!data) return <CardWrap><p className="text-white/40 text-sm">Loading…</p></CardWrap>
  return <CardWrap>
    <SectionHeader title="Vendors rollup" count={data.vendors.length} />
    {(data.unlinked_invoices > 0 || data.unlinked_expenses > 0) && (
      <p className="text-amber-300 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
        ⚠ {data.unlinked_invoices} invoice(s) and {data.unlinked_expenses} expense(s) have a free-text vendor with no linked CRM account.
      </p>
    )}
    <table className="w-full text-sm">
      <thead><tr className="text-left text-white/40 text-xs uppercase tracking-wider border-b border-white/10">
        <th className="py-2">Vendor</th><th className="py-2 text-right">Invoices</th><th className="py-2 text-right">Invoice £</th><th className="py-2 text-right">Expenses</th><th className="py-2 text-right">Expense £</th><th className="py-2 text-right">Total</th>
      </tr></thead>
      <tbody>
        {data.vendors.map(v => <tr key={v.account_id} className="border-b border-white/5">
          <td className="py-2 text-white">{v.account_name}<p className="text-white/40 text-xs">{v.account_type}</p></td>
          <td className="py-2 text-right text-white/60">{v.invoice_count}</td>
          <td className="py-2 text-right text-white/80">{fmtCurrency(v.invoice_total)}</td>
          <td className="py-2 text-right text-white/60">{v.expense_count}</td>
          <td className="py-2 text-right text-white/80">{fmtCurrency(v.expense_total)}</td>
          <td className="py-2 text-right text-saffron-300 font-bold">{fmtCurrency(v.total_spend)}</td>
        </tr>)}
        {data.vendors.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-white/30">No linked vendors. Link invoices/expenses to a CRM account to populate this rollup.</td></tr>}
      </tbody>
    </table>
  </CardWrap>
}

// ─── Documents ──────────────────────────────────────────────────────────────

function DocumentsTab({ projectId, setMsg, onChange }: { projectId: string; setMsg: (m: { text: string; ok: boolean }) => void; onChange: () => void }) {
  const { items, reload } = useList<Document>(`/admin/projects/${projectId}/documents`)
  const [title, setTitle] = useState(''); const [kind, setKind] = useState('OTHER'); const [url, setUrl] = useState('')
  async function add() {
    if (!title.trim() || !url.trim()) return
    try { await apiFetch(`/admin/projects/${projectId}/documents`, { method: 'POST', body: JSON.stringify({ title, kind, file_url: url }) })
      setTitle(''); setUrl(''); reload(); onChange() }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) }
  }
  return <CardWrap>
    <SectionHeader title="Documents" count={items.length} />
    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
      <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="title" value={title} onChange={e => setTitle(e.target.value)} />
      <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={kind} onChange={e => setKind(e.target.value)}>{['CHARTER','CONTRACT','REPORT','INVOICE','OTHER'].map(k => <option key={k}>{k}</option>)}</select>
      <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="https:// file URL (SharePoint / Drive)" value={url} onChange={e => setUrl(e.target.value)} />
      <button onClick={add} className="px-4 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold">+ Add</button>
    </div>
    <div className="space-y-2">
      {items.map(d => <a key={d.id} href={d.file_url} target="_blank" rel="noreferrer" className="block rounded-xl p-3 bg-white/5 border border-white/10 hover:bg-white/10">
        <div className="flex items-center justify-between gap-2">
          <div><p className="text-white font-semibold">{d.title}</p><p className="text-white/40 text-xs">{d.kind} · uploaded {fmtAge(d.uploaded_at)} by {d.uploaded_by_name || 'unknown'}</p></div>
          <span className="text-saffron-300 text-xs">Open ↗</span>
        </div>
      </a>)}
      {items.length === 0 && <p className="text-white/30 text-sm text-center py-6">No documents.</p>}
    </div>
  </CardWrap>
}

// ─── Activity ───────────────────────────────────────────────────────────────

function ActivityTab({ projectId, setMsg, onChange }: { projectId: string; setMsg: (m: { text: string; ok: boolean }) => void; onChange: () => void }) {
  const { items, reload } = useList<Activity>(`/admin/projects/${projectId}/activities`)
  const [note, setNote] = useState('')
  async function add() {
    if (!note.trim()) return
    try { await apiFetch(`/admin/projects/${projectId}/activities`, { method: 'POST', body: JSON.stringify({ kind: 'NOTE', title: note, body: '' }) })
      setNote(''); reload(); onChange() }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) }
  }
  return <CardWrap>
    <SectionHeader title="Activity" count={items.length} />
    <div className="flex gap-2">
      <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white flex-1" placeholder="Add a note…" value={note} onChange={e => setNote(e.target.value)} />
      <button onClick={add} className="px-4 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold">+ Note</button>
    </div>
    <div className="space-y-2">
      {items.map(a => <div key={a.id} className="flex gap-3 items-start text-sm border-b border-white/5 pb-2">
        <Badge value={a.kind} />
        <div className="flex-1"><p className="text-white">{a.title}</p>{a.body && <p className="text-white/60 text-xs">{a.body}</p>}<p className="text-white/30 text-xs">{a.actor_email || 'system'} · {fmtAge(a.created_at)}</p></div>
      </div>)}
      {items.length === 0 && <p className="text-white/30 text-sm text-center py-6">No activity yet.</p>}
    </div>
  </CardWrap>
}

// ─── Approvals ──────────────────────────────────────────────────────────────

function ApprovalsTab({ projectId, setMsg, onChange }: { projectId: string; setMsg: (m: { text: string; ok: boolean }) => void; onChange: () => void }) {
  const [data, setData] = useState<ApprovalsResp | null>(null)
  const [kind, setKind] = useState('START'); const [reason, setReason] = useState('')
  const reload = useCallback(() => apiFetch<ApprovalsResp>(`/admin/projects/${projectId}/approvals`).then(setData).catch(() => setData(null)), [projectId])
  useEffect(() => { reload() }, [reload])
  async function request() {
    try { await apiFetch(`/admin/projects/${projectId}/approvals`, { method: 'POST', body: JSON.stringify({ kind, request_reason: reason }) })
      setReason(''); reload(); onChange() }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) }
  }
  async function decide(ap: Approval, status: 'APPROVED' | 'REJECTED' | 'WITHDRAWN') {
    const r = prompt(`Reason for ${status}?`) || ''
    try { await apiFetch(`/admin/projects/${projectId}/approvals/${ap.id}`, { method: 'PUT', body: JSON.stringify({ status, decision_reason: r }) })
      reload(); onChange() }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed', ok: false }) }
  }
  if (!data) return <CardWrap><p className="text-white/40 text-sm">Loading…</p></CardWrap>
  return <CardWrap>
    <SectionHeader title="Approvals" count={data.items.length} />
    {data.approval_required && (
      <p className="text-amber-300 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
        ⚠ Approval required to move to ACTIVE — reason: {data.approval_reason}. Threshold £{data.threshold_gbp}.
      </p>
    )}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
      <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={kind} onChange={e => setKind(e.target.value)}>{['START','CHANGE_BUDGET','CHANGE_SCOPE','CLOSE'].map(k => <option key={k}>{k}</option>)}</select>
      <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white md:col-span-2" placeholder="reason for request" value={reason} onChange={e => setReason(e.target.value)} />
      <button onClick={request} className="px-4 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold">Request approval</button>
    </div>
    <table className="w-full text-sm">
      <thead><tr className="text-left text-white/40 text-xs uppercase tracking-wider border-b border-white/10">
        <th className="py-2">Kind</th><th className="py-2">Status</th><th className="py-2">Requested</th><th className="py-2">Decision</th><th className="py-2"></th>
      </tr></thead>
      <tbody>
        {data.items.map(a => <tr key={a.id} className="border-b border-white/5">
          <td className="py-2"><Badge value={a.kind} /></td>
          <td className="py-2"><Badge value={a.status} tone={STATUS_TONE[a.status] || ''} /></td>
          <td className="py-2 text-white/60 text-xs">{a.requested_by_name} · {fmtAge(a.requested_at)}<br/>{a.request_reason}</td>
          <td className="py-2 text-white/60 text-xs">{a.approver_name || '—'} {a.decided_at && `· ${fmtAge(a.decided_at)}`}<br/>{a.decision_reason}</td>
          <td className="py-2 text-right">{a.status === 'PENDING' && <div className="flex gap-1 justify-end">
            <button onClick={() => decide(a, 'APPROVED')} className="text-green-400 text-xs hover:underline">Approve</button>
            <button onClick={() => decide(a, 'REJECTED')} className="text-red-400 text-xs hover:underline">Reject</button>
          </div>}</td>
        </tr>)}
        {data.items.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-white/30">No approvals yet.</td></tr>}
      </tbody>
    </table>
  </CardWrap>
}
