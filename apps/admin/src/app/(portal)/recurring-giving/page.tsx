'use client'
import { useState, useEffect } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || '/api/v1'
function token() { return typeof window !== 'undefined' ? (localStorage.getItem('shital_access_token') || '') : '' }
function authHeaders() { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` } }

interface Tier {
  id: string; amount: number; label: string; description: string
  frequency: string; is_active: boolean; is_default: boolean
  display_order: number; paypal_plan_id: string; active_subscribers: number
}
interface Sub {
  id: string; paypal_subscription_id: string; amount: number; frequency: string
  status: string; donor_name: string; donor_email: string; branch_id: string
  approved_at: string; tier_label: string; created_at: string
  payment_provider?: string; stripe_subscription_id?: string
}

const EMPTY: Omit<Tier, 'id' | 'paypal_plan_id' | 'active_subscribers'> = {
  amount: 5, label: '', description: '', frequency: 'MONTH',
  is_active: true, is_default: false, display_order: 0,
}

const STATUS_COLOURS: Record<string, string> = {
  // Lifecycle v2
  REQUEST_INITIATED:  '#94a3b8',   // slate   — donor clicked, nothing charged
  AWAITING_PAYMENT:   '#fbbf24',   // amber   — at Stripe hosted checkout
  ACTIVE:             '#4ade80',   // green   — first payment settled, live
  PAST_DUE:           '#fb923c',   // orange  — payment failed, grace
  CANCELLING:         '#fdba74',   // orange  — donor cancelled, serving out period
  CANCELLED:          '#f87171',   // red
  EXPIRED:            '#94a3b8',   // slate
  ABANDONED:          '#64748b',   // dark slate — donor never finished Checkout
  // legacy
  PENDING_APPROVAL:   '#fbbf24',
  SUSPENDED:          '#fb923c',
}

// Short, human-readable labels for the pills. Kept here so backend
// status codes stay ALLCAPS + stable while the UI explains them.
const STATUS_LABELS: Record<string, string> = {
  REQUEST_INITIATED:  'Request initiated',
  AWAITING_PAYMENT:   'Awaiting payment',
  ACTIVE:             'Active',
  PAST_DUE:           'Past due',
  CANCELLING:         'Cancelling',
  CANCELLED:          'Cancelled',
  EXPIRED:            'Expired',
  ABANDONED:          'Abandoned',
  PENDING_APPROVAL:   'Pending approval',
  SUSPENDED:          'Suspended',
  PENDING_CONTACT:    'Pending contact',
}

interface Charge {
  id: string; amount: number; currency: string; payment_provider: string
  payment_ref: string | null; branch_id: string; created_at: string
  status: string; gift_aid_eligible: boolean
  donor_email: string | null; donor_name: string | null
  donor_first_name: string | null; donor_surname: string | null
}
interface GivingStats {
  subscriptions: Record<string, number>
  totals: {
    this_month: number; last_month: number; this_year: number; all_time: number
    charge_count: number
  }
  recent_charges: Charge[]
}

function fmtGBP(n: number): string {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function RecurringGivingPage() {
  const [tiers, setTiers]     = useState<Tier[]>([])
  const [subs, setSubs]       = useState<Sub[]>([])
  const [tab, setTab]         = useState<'tiers' | 'subs' | 'charges' | 'links'>('tiers')
  const [linkAmount, setLinkAmount] = useState('11')
  const [linkBranch, setLinkBranch] = useState('')
  const [copied, setCopied]   = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState('')
  // Separate line for the auto-polling diagnostic so it doesn't overwrite
  // the Import / Force-link / Sync result the operator just clicked.
  const [diagNote, setDiagNote] = useState('')
  // Status filter for the Subscriptions list. Default is 'live' so the
  // page opens on just the real billing subscriptions — not the
  // REQUEST_INITIATED / ABANDONED / EXPIRED rows that the diagnostic
  // already shows a count of up top. Matches how Stripe Dashboard →
  // Subscriptions opens: active first, status filter on the side.
  const [subFilter, setSubFilter] = useState<'live' | 'pending' | 'ended' | 'all'>('live')
  const [stats, setStats]     = useState<GivingStats | null>(null)

  async function syncPayPal() {
    setSyncing(true); setSyncNote('')
    try {
      const r = await fetch(`${API}/admin/giving/sync-paypal`, { method: 'POST', headers: authHeaders() })
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const d = await r.json()
      const x = d.result || {}
      setSyncNote(x.skipped
        ? `Skipped: ${x.skipped}`
        : `Synced ${x.scanned ?? 0} subscriptions · ${x.status_updated ?? 0} status updates · ${x.activated ?? 0} activated · ${x.payments_recorded ?? 0} payments recorded`)
      await loadSubs()
    } catch (e) {
      setSyncNote(e instanceof Error ? e.message : 'Sync failed')
    } finally { setSyncing(false) }
  }

  async function syncStripe() {
    setSyncing(true); setSyncNote('')
    try {
      const r = await fetch(`${API}/admin/giving/sync-stripe`, { method: 'POST', headers: authHeaders() })
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const d = await r.json()
      const x = d.result || {}
      const samples = (x.error_samples as Array<{ type?: string; message?: string }> | undefined) || []
      const errDetail = x.errors && samples.length
        ? ` · first error: ${samples[0]?.type || '?'} — ${samples[0]?.message || '?'}`
        : ''
      setSyncNote(x.skipped
        ? `Skipped: ${x.skipped}`
        : `Stripe · scanned ${x.scanned ?? 0} · ${x.status_updated ?? 0} status updates · ${x.activated ?? 0} activated · ${x.linked_orphans ?? 0} linked · ${x.payments_recorded ?? 0} payments recorded · ${(x.stale_reaped ?? 0) + (x.orphans_expired ?? 0)} stale expired${x.errors ? ` · ${x.errors} errors${errDetail}` : ''}`)
      await loadSubs()
    } catch (e) {
      setSyncNote(e instanceof Error ? e.message : 'Sync failed')
    } finally { setSyncing(false) }
  }

  // Full Stripe → donations mirror. Walks every succeeded Stripe charge
  // in the window and upserts it into donations (idempotent on
  // payment_ref). Links subscription rows when the charge belongs to an
  // invoice we can match. This is the proper direction: Stripe is the
  // source of truth, we mirror. A daily background task does the same
  // with a 2-day window.
  async function stripeImport() {
    setSyncing(true); setSyncNote('')
    try {
      // 7-day window — enough to cover a week of outage / missed daily
      // cadence without pulling the full history every click. Operator
      // explicitly asked not to re-scan old records; the historical
      // backfill was a one-off and it's already done. The daily
      // background task uses the same 7-day window.
      const r = await fetch(`${API}/admin/giving/stripe-import?days=7`, { method: 'POST', headers: authHeaders() })
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const d = await r.json()
      if (d.skipped) { setSyncNote(`Skipped: ${d.skipped}`); return }
      const samples = (d.error_samples as Array<{ stage?: string; error?: string }> | undefined) || []
      const errTail = d.errors && samples.length
        ? ` · first error: ${samples[0]?.stage || '?'} — ${samples[0]?.error || '?'}`
        : ''
      setSyncNote(
        `Stripe import · scanned ${d.scanned ?? 0} charges · ${d.imported ?? 0} new donations · ` +
        `${d.contacts_created ?? 0} new contacts · ${d.contacts_linked ?? 0} contacts linked · ` +
        `${d.addresses_created ?? 0} addresses · ${d.linked_subs ?? 0} subs flipped ACTIVE · ` +
        `${d.skipped_duplicates ?? 0} duplicates skipped${d.errors ? ` · ${d.errors} errors${errTail}` : ''}`
      )
      await loadSubs()
    } catch (e) {
      setSyncNote(e instanceof Error ? e.message : 'Import failed')
    } finally { setSyncing(false) }
  }

  // Nuclear-option repair: hits /admin/giving/stripe-force-link which
  // bypasses _handle_checkout_completed entirely and just runs a minimal
  // targeted UPDATE per paid Stripe session → matching rgs row. Use when
  // "Sync from Stripe" reports errors and you need to see the per-row
  // outcome spelled out instead of a silent aggregate.
  async function stripeForceLink() {
    setSyncing(true); setSyncNote('')
    try {
      const r = await fetch(`${API}/admin/giving/stripe-force-link?days=30`, { method: 'POST', headers: authHeaders() })
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const d = await r.json()
      const rows = (d.rows as Array<{ result?: string; rgs_id?: string }> | undefined) || []
      const firstFail = rows.find(row => row.result && !row.result.startsWith('updated'))
      const tail = firstFail ? ` · first non-update: ${firstFail.rgs_id || '?'} → ${firstFail.result}` : ''
      setSyncNote(
        `Force-link · attempted ${d.attempted ?? 0} · ${d.updated ?? 0} updated · ${d.skipped ?? 0} skipped · ${d.errors ?? 0} errors${tail}`
      )
      await loadSubs()
    } catch (e) {
      setSyncNote(e instanceof Error ? e.message : 'Force-link failed')
    } finally { setSyncing(false) }
  }

  // Rebuild PayPal product + plan IDs against the currently-configured
  // PayPal environment. Fixes the "subscriptions come back EXPIRED
  // immediately" trap that happens after switching PAYPAL_ENV or
  // PAYPAL_CLIENT_ID — our cached plan_ids still reference the old
  // environment / account, so new subscriptions reference a plan live
  // PayPal doesn't recognise.
  async function rebuildPayPalPlans() {
    const ok = confirm(
      'Rebuild PayPal plans?\n\n' +
      'This clears the cached PayPal product + plan IDs on every tier and ' +
      'recreates them against the currently-configured PayPal environment.\n\n' +
      'Use when subscriptions are failing because the stored plan IDs no ' +
      "longer exist in PayPal (e.g. after switching sandbox ⇄ live, or " +
      'rotating PayPal credentials).\n\n' +
      'Safe to run — existing subscriptions are unaffected.'
    )
    if (!ok) return
    setSyncing(true); setSyncNote('')
    try {
      const r = await fetch(`${API}/admin/giving/rebuild-paypal-plans`, { method: 'POST', headers: authHeaders() })
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const d = await r.json()
      setSyncNote(
        `Rebuild · cleared ${d.cleared ?? 0} cached plan IDs · regenerated ${d.regenerated ?? 0}` +
        (d.failed ? ` · ${d.failed} failed` : '')
      )
      await loadTiers()
    } catch (e) {
      setSyncNote(e instanceof Error ? e.message : 'Rebuild failed')
    } finally { setSyncing(false) }
  }

  // Recover PayPal rows that lost their paypal_subscription_id (donor
  // approved the subscription on PayPal's side but our /approve or webhook
  // never fired, so our row sits with no sub_id and gets reaped to EXPIRED).
  // Pulls PayPal's webhook event HISTORY and matches by donor email.
  async function recoverPayPalOrphans() {
    const ok = confirm(
      'Recover PayPal orphans from webhook history?\n\n' +
      'For every EXPIRED PayPal row with a donor email, we look at PayPal\'s ' +
      'last 90 days of subscription-activated events (even ones our webhook ' +
      'originally dropped) and try to match them by email. Matches get ' +
      'linked and flipped ACTIVE. Rows without a donor email cannot be ' +
      'recovered this way.\n\n' +
      'Safe to run — only touches orphan rows.'
    )
    if (!ok) return
    setSyncing(true); setSyncNote('')
    try {
      const r = await fetch(`${API}/admin/giving/recover-paypal-orphans`, { method: 'POST', headers: authHeaders() })
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const d = await r.json()
      const x = d.result || {}
      setSyncNote(x.skipped
        ? `Skipped: ${x.skipped}`
        : `PayPal recover · scanned ${x.scanned ?? 0} orphan rows · ${x.events_fetched ?? 0} PayPal events · ${x.matched_by_email ?? 0} email matches · ${x.linked ?? 0} linked + ACTIVE · ${x.unmatched_rows ?? 0} orphan rows left`)
      await loadSubs()
    } catch (e) {
      setSyncNote(e instanceof Error ? e.message : 'Recovery failed')
    } finally { setSyncing(false) }
  }

  // Pull a side-by-side view of what Stripe actually knows about recent
  // Checkout sessions vs what our DB thinks happened. Returns a plain-
  // English verdict pointing at the specific break: "donors aren't
  // reaching Stripe", "paying but we're not linking", "all working", etc.
  async function stripeDiagnostic(silent = false) {
    if (!silent) { setSyncing(true); setSyncNote('') }
    try {
      const r = await fetch(`${API}/admin/giving/stripe-diagnostic?days=30`, { headers: authHeaders() })
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const d = await r.json()
      const line = (
        `Diag · ${d.stripe_session_count ?? 0} Stripe sessions · ` +
        `${d.paid_sessions_with_rgs ?? 0} paid · ` +
        `${(d.paid_but_unlinked?.length ?? 0)} unlinked. ` +
        `${d.verdict || ''}`
      )
      // Silent auto-poll goes to diagNote only — never clobbers the Import/
      // Force-link/Sync output the operator just clicked. Explicit click
      // still writes to the main syncNote.
      if (silent) setDiagNote(line)
      else { setSyncNote(line); setDiagNote(line) }
    } catch (e) {
      if (!silent) setSyncNote(e instanceof Error ? e.message : 'Diagnostic failed')
    } finally { if (!silent) setSyncing(false) }
  }

  // Auto-diagnostic — runs on page load and every 30 s so the yellow
  // banner is always showing current state (orphan count, verdict),
  // not a stale snapshot from the last manual click. Silent on errors
  // so a transient network blip doesn't scare the operator.
  useEffect(() => {
    stripeDiagnostic(true)
    const iv = setInterval(() => stripeDiagnostic(true), 30_000)
    return () => clearInterval(iv)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-sync — runs the full reconcile once on page load so an orphan
  // paid session that happens to be sitting in PENDING_APPROVAL when
  // the operator opens the page gets linked within ~2 seconds, without
  // anyone having to click "Sync from Stripe". The 60 s background
  // self-heal loop (shipped in #329) runs this same reconcile every
  // minute anyway — this just moves the next tick to "now".
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        await fetch(`${API}/admin/giving/sync-stripe`, { method: 'POST', headers: authHeaders() })
        await stripeDiagnostic(true)
      } catch { /* silent — background loop will still catch it */ }
    }, 400) // small delay so initial subs load first
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Time-only reap — marks any Stripe row stuck in PENDING_APPROVAL for
  // more than 2 days as EXPIRED. Used to clear the historical pile that
  // Pass B's windowed reap missed. No Stripe calls, safe to repeat.
  async function reapStaleStripe() {
    if (!confirm('Mark every Stripe row stuck in PENDING_APPROVAL for more than 2 days as EXPIRED?\n\nThis is for donors who opened Checkout and never paid. Safe and reversible by an admin editing the row.')) return
    setSyncing(true); setSyncNote('')
    try {
      const r = await fetch(`${API}/admin/giving/reap-stale-stripe`, { method: 'POST', headers: authHeaders() })
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const d = await r.json()
      setSyncNote(`Cleaned up ${d.reaped ?? 0} stale Stripe PENDING_APPROVAL rows (older than ${d.older_than_days ?? 2} days).`)
      await loadSubs()
    } catch (e) {
      setSyncNote(e instanceof Error ? e.message : 'Reap failed')
    } finally { setSyncing(false) }
  }

  const SERVICE_BASE = 'https://service.shital.org.uk'
  const buildLink = (amount: string | number, branch = '') =>
    `${SERVICE_BASE}/?amount=${encodeURIComponent(String(amount))}${branch ? `&branch=${encodeURIComponent(branch)}` : ''}`
  const copyLink = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(url); setTimeout(() => setCopied(''), 1800) } catch { /* clipboard blocked */ }
  }
  const [form, setForm]       = useState(EMPTY)
  const [editId, setEditId]   = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  async function loadTiers() {
    try {
      const r = await fetch(`${API}/admin/giving/tiers`, { headers: authHeaders() })
      if (!r.ok) throw new Error(`Tiers HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      setTiers((await r.json()).tiers)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tiers')
    }
  }
  async function loadSubs() {
    try {
      const r = await fetch(`${API}/admin/giving/subscriptions`, { headers: authHeaders() })
      if (!r.ok) throw new Error(`Subscriptions HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      setSubs((await r.json()).subscriptions)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load subscriptions')
    }
  }

  async function loadStats() {
    try {
      const r = await fetch(`${API}/admin/giving/stats?limit=50`, { headers: authHeaders() })
      if (!r.ok) return
      setStats(await r.json())
    } catch { /* silent — the other data still loads */ }
  }
  useEffect(() => {
    loadTiers(); loadSubs(); loadStats()
    // Refresh stats + charges every 60 s so the strip stays fresh while
    // the operator keeps the page open.
    const iv = setInterval(loadStats, 60_000)
    return () => clearInterval(iv)
  }, [])

  // Track which sub-id is currently being refreshed (per-row spinner) and
  // the most recent refresh result for the inline status note.
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [refreshNote, setRefreshNote] = useState<Record<string, string>>({})

  async function refreshFromPayPal(subId: string) {
    setRefreshingId(subId)
    setRefreshNote(n => ({ ...n, [subId]: '' }))
    try {
      const r = await fetch(
        `${API}/admin/giving/subscriptions/${subId}/refresh-from-paypal`,
        { method: 'POST', headers: authHeaders() },
      )
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        setRefreshNote(n => ({
          ...n,
          [subId]: body?.detail || `HTTP ${r.status}`,
        }))
      } else {
        setRefreshNote(n => ({
          ...n,
          [subId]: body.changed
            ? `PayPal says ${body.paypal_status} → ${body.db_status_after}`
            : `PayPal agrees: ${body.paypal_status} (no change)`,
        }))
        await loadSubs()
      }
    } catch (e) {
      setRefreshNote(n => ({ ...n, [subId]: e instanceof Error ? e.message : 'Network error' }))
    } finally {
      setRefreshingId(null)
    }
  }

  function openNew() { setForm(EMPTY); setEditId(null); setShowForm(true); setError('') }
  function openEdit(t: Tier) {
    setForm({ amount: t.amount, label: t.label, description: t.description, frequency: t.frequency,
      is_active: t.is_active, is_default: t.is_default, display_order: t.display_order })
    setEditId(t.id); setShowForm(true); setError('')
  }

  async function save() {
    if (!form.label.trim()) { setError('Label is required'); return }
    setSaving(true); setError('')
    try {
      const url = editId ? `${API}/admin/giving/tiers/${editId}` : `${API}/admin/giving/tiers`
      const r = await fetch(url, { method: editId ? 'PUT' : 'POST', headers: authHeaders(), body: JSON.stringify(form) })
      if (!r.ok) throw new Error(await r.text())
      setShowForm(false); await loadTiers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  async function deactivate(id: string) {
    if (!confirm('Deactivate this tier? Existing subscribers are unaffected.')) return
    await fetch(`${API}/admin/giving/tiers/${id}`, { method: 'DELETE', headers: authHeaders() })
    loadTiers()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Monthly Giving</h1>
          <p className="text-sm text-white/50 mt-1">Configure recurring donation tiers for the service portal</p>
        </div>
        <button onClick={openNew}
          className="px-4 py-2.5 rounded-xl text-white text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
          + New Tier
        </button>
      </div>

      {error && !showForm && (
        <p className="text-sm rounded-lg px-3 py-2 bg-red-500/15 text-red-300 border border-red-500/30">
          {error}
        </p>
      )}

      {/* ── Live Monthly Giving stats strip ───────────────────────────────
          Six tiles, refreshed every 60 s from /admin/giving/stats. Answers
          the questions the operator used to have to compile by hand:
            - how many subscriptions are ACTIVE right now?
            - how much have we actually received this month / this year?
            - how many individual charges have landed? */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { k: 'this_month',     label: 'This month',       sub: 'from monthly giving',  value: fmtGBP(stats.totals.this_month),  tone: '#4ade80' },
            { k: 'last_month',     label: 'Last month',       sub: 'from monthly giving',  value: fmtGBP(stats.totals.last_month),  tone: '#fbbf24' },
            { k: 'this_year',      label: 'This year',        sub: 'all branches',          value: fmtGBP(stats.totals.this_year),   tone: '#f59e0b' },
            { k: 'all_time',       label: 'All-time',         sub: 'since launch',          value: fmtGBP(stats.totals.all_time),    tone: '#D4AF37' },
            { k: 'charge_count',   label: 'Successful charges', sub: 'invoices settled',    value: String(stats.totals.charge_count), tone: '#60a5fa' },
            { k: 'active_subs',    label: 'Active subscriptions', sub: 'now billing',       value: String(stats.subscriptions.ACTIVE || 0), tone: '#86efac' },
          ].map(s => (
            <div key={s.k} className="rounded-xl p-4 relative overflow-hidden border border-white/5"
              style={{ background: 'rgba(255,255,255,0.03)' }}>
              <div className="absolute top-0 right-0 w-14 h-14 rounded-full blur-xl opacity-20"
                style={{ background: s.tone }} />
              <p className="text-white/50 text-[11px] font-medium uppercase tracking-wider">{s.label}</p>
              <p className="text-2xl font-black text-white mt-1" style={{ color: s.tone }}>{s.value}</p>
              <p className="text-white/30 text-[10px] mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 flex-wrap">
        {(['tiers', 'subs', 'charges', 'links'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === t ? 'border-saffron-400 text-saffron-400' : 'border-transparent text-white/50 hover:text-white/80'}`}>
            {t === 'tiers'   ? `Donation Tiers (${tiers.length})` :
             t === 'subs'    ? (() => {
               // Show the USEFUL number first (how many are currently
               // billing) and the gross total in a muted second clause
               // so the tab stops looking like 153 live subscribers when
               // most of those rows are abandoned Checkouts.
               const active   = stats?.subscriptions.ACTIVE          || 0
               const pending  = stats?.subscriptions.PENDING_APPROVAL || 0
               const expired  = stats?.subscriptions.EXPIRED          || 0
               const canceled = stats?.subscriptions.CANCELLED        || 0
               const total    = subs.length
               return `Subscriptions · ${active} active · ${pending} pending · ${total} all`
                 // Compact for mobile
                 .replace(active + ' active', `${active} active`)
                 + (expired + canceled > 0 ? ` (· ${expired + canceled} ended)` : '')
             })() :
             t === 'charges' ? `Recent Charges (${stats?.recent_charges.length ?? 0})` :
                               '🔗 Share Links'}
          </button>
        ))}
      </div>

      {/* Recent monthly-giving charges — the Stripe-style transaction list
          the operator asked for. Pulled from the `donations` table where
          purpose='Monthly Giving' (same rows the finance ledger shows). */}
      {tab === 'charges' && (
        <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-white font-bold">Recent monthly-giving charges</h2>
            <p className="text-white/40 text-xs">Updates every 60 s · purpose=Monthly Giving · status=COMPLETED</p>
          </div>
          {(!stats || stats.recent_charges.length === 0) ? (
            <p className="text-sm text-white/40 py-6 text-center">No monthly-giving charges yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-white/50 border-b border-white/10 uppercase text-[11px] tracking-wider">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Date / time</th>
                    <th className="px-3 py-2 text-left font-semibold">Donor</th>
                    <th className="px-3 py-2 text-left font-semibold">Provider</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 text-center font-semibold">🇬🇧</th>
                    <th className="px-3 py-2 text-left font-semibold">Branch</th>
                    <th className="px-3 py-2 text-left font-semibold">Payment ref</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent_charges.map(c => {
                    const d = new Date(c.created_at)
                    const donorLabel = (c.donor_name || c.donor_email || '—').toString()
                    return (
                      <tr key={c.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-3 py-2 text-white/80 text-xs whitespace-nowrap">
                          {d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-3 py-2 text-white/80 text-xs max-w-[220px] truncate" title={c.donor_email || ''}>
                          {donorLabel}
                        </td>
                        <td className="px-3 py-2 text-xs capitalize">
                          <span className="px-2 py-0.5 rounded-full border text-[11px] font-bold"
                            style={{
                              background: c.payment_provider?.toLowerCase() === 'stripe' ? 'rgba(99,91,255,0.15)' : 'rgba(0,70,193,0.15)',
                              color:      c.payment_provider?.toLowerCase() === 'stripe' ? '#9FA8FF' : '#60A5FA',
                              borderColor:c.payment_provider?.toLowerCase() === 'stripe' ? 'rgba(99,91,255,0.4)' : 'rgba(0,70,193,0.4)',
                            }}>
                            {c.payment_provider}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-sm font-bold text-green-400">
                          {fmtGBP(c.amount)}
                        </td>
                        <td className="px-3 py-2 text-center text-xs">
                          {c.gift_aid_eligible ? <span className="text-blue-300 font-bold">Yes</span> : <span className="text-white/20">—</span>}
                        </td>
                        <td className="px-3 py-2 text-white/60 text-xs">{c.branch_id}</td>
                        <td className="px-3 py-2 text-white/40 text-[11px] font-mono truncate max-w-[180px]" title={c.payment_ref || ''}>
                          {c.payment_ref || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tiers tab */}
      {tab === 'tiers' && (
        <div className="space-y-3">
          {tiers.length === 0 && <p className="text-white/40 text-sm">No tiers configured.</p>}
          {tiers.map(tier => (
            <div key={tier.id} className="rounded-xl p-4 flex items-center gap-4"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', opacity: tier.is_active ? 1 : 0.5 }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-xl text-saffron-400">£{Number(tier.amount).toFixed(0)}</span>
                  <span className="text-xs font-semibold text-white/50">/{tier.frequency.toLowerCase()}</span>
                  {tier.is_default && <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(212,175,55,0.2)', color: '#D4AF37' }}>Default</span>}
                  {!tier.is_active && <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-900/40 text-red-400">Inactive</span>}
                </div>
                <p className="font-semibold text-white text-sm mt-0.5">{tier.label}</p>
                {tier.description && <p className="text-xs text-white/50 mt-0.5">{tier.description}</p>}
                <div className="flex gap-3 mt-1.5 text-xs text-white/40">
                  <span>👥 {tier.active_subscribers} active</span>
                  {tier.paypal_plan_id && <span>✅ Plan ready</span>}
                  {!tier.paypal_plan_id && <span>⏳ Plan created on first subscription</span>}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => openEdit(tier)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 text-white hover:bg-white/20">Edit</button>
                {tier.is_active && <button onClick={() => deactivate(tier.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-900/40 text-red-400 hover:bg-red-900/60">Deactivate</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Subscriptions tab */}
      {tab === 'subs' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-white/40 text-xs">PayPal &amp; Stripe are the source of truth — sync pulls live statuses + records any payments.</p>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={syncStripe} disabled={syncing}
                className="px-4 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#635BFF,#4B45C6)' }}>
                {syncing ? 'Syncing…' : '↻ Sync from Stripe'}
              </button>
              <button onClick={syncPayPal} disabled={syncing}
                className="px-4 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#0070BA,#003087)' }}>
                {syncing ? 'Syncing…' : '↻ Sync from PayPal'}
              </button>
              {/* Nuclear option — regenerate PayPal product + plan IDs when
                  cached ones reference a stale environment / account. */}
              <button onClick={rebuildPayPalPlans} disabled={syncing}
                title="Clears cached PayPal plan IDs and recreates them against the current PAYPAL_ENV. Use when subs come back EXPIRED immediately."
                className="px-4 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
                {syncing ? 'Rebuilding…' : '🔧 Rebuild PayPal plans'}
              </button>
              {/* Recover EXPIRED PayPal rows whose paypal_subscription_id was
                  never captured (donor approved on PayPal but our /approve or
                  webhook never fired). Pulls PayPal's event history and
                  matches by donor email. */}
              <button onClick={recoverPayPalOrphans} disabled={syncing}
                title="Scans PayPal's webhook event history (last 90 days) and matches EXPIRED PayPal orphan rows to their real subscription by donor email."
                className="px-4 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#0070BA,#003087)' }}>
                {syncing ? 'Recovering…' : '🩹 Recover PayPal orphans'}
              </button>
              {/* Diagnostic — compare what Stripe knows vs what our DB thinks.
                  Returns a verdict pointing at the specific failure. */}
              <button onClick={() => stripeDiagnostic()} disabled={syncing}
                title="Pulls Stripe's view of Checkout sessions for the last 30 days and cross-checks against our DB. Tells you whether donors are abandoning, paying-but-unlinked, or working."
                className="px-4 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#0ea5e9,#0369a1)' }}>
                {syncing ? 'Checking…' : '🔍 Stripe diagnostic'}
              </button>
              {/* Full Stripe → donations mirror. The proper direction:
                  Stripe is the source of truth, we pull. Daily background
                  task does the same with a 2-day window. */}
              <button onClick={stripeImport} disabled={syncing}
                title="Pulls the last 7 days of Stripe charges and mirrors them into our donations table (idempotent — duplicates are skipped). A daily background task does the same automatically every 24 h, so clicking this is only needed if you want the next tick right now. Does NOT re-pull historical records."
                className="px-4 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#8b5cf6,#5b21b6)' }}>
                {syncing ? 'Importing…' : '⬇ Import from Stripe'}
              </button>
              {/* Nuclear-option repair. Bypasses _handle_checkout_completed
                  and runs a minimal targeted UPDATE per paid Stripe session. */}
              <button onClick={stripeForceLink} disabled={syncing}
                title="For every paid Stripe Checkout session in the last 30 days, forcibly links its rgs row ACTIVE with a minimal UPDATE. Use when Sync reports errors — reports per-row outcome in the response."
                className="px-4 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#ef4444,#b91c1c)' }}>
                {syncing ? 'Forcing…' : '🔧 Force-link stuck Stripe'}
              </button>
              {/* Time-only reap of stale PENDING Stripe rows. Clears the
                  historical pile that Pass B's windowed reap missed. */}
              <button onClick={reapStaleStripe} disabled={syncing}
                title="Marks every Stripe row stuck in PENDING_APPROVAL for more than 2 days as EXPIRED. Donors that never finished Checkout stop cluttering the list. Safe, idempotent, no Stripe calls."
                className="px-4 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#f59e0b,#b45309)' }}>
                {syncing ? 'Reaping…' : '🧹 Clean up stale pending'}
              </button>
            </div>
          </div>
          {syncNote && <p className="text-xs rounded-lg px-3 py-2 bg-cyan-500/10 text-cyan-200 border border-cyan-500/20 whitespace-pre-wrap break-all">{syncNote}</p>}
          {diagNote && diagNote !== syncNote && <p className="text-xs rounded-lg px-3 py-2 bg-amber-500/10 text-amber-200 border border-amber-500/20">{diagNote}</p>}
          {/* Status filter — defaults to Live so the page opens on just the
              real billing subscriptions, same as Stripe Dashboard. */}
          {(() => {
            const LIVE_STATES    = new Set(['ACTIVE', 'PAST_DUE', 'CANCELLING'])
            const PENDING_STATES = new Set(['REQUEST_INITIATED', 'AWAITING_PAYMENT', 'PENDING_APPROVAL', 'PENDING_CONTACT'])
            const ENDED_STATES   = new Set(['CANCELLED', 'EXPIRED', 'ABANDONED', 'SUSPENDED'])
            const counts = {
              live:    subs.filter(s => LIVE_STATES.has(s.status)).length,
              pending: subs.filter(s => PENDING_STATES.has(s.status)).length,
              ended:   subs.filter(s => ENDED_STATES.has(s.status)).length,
              all:     subs.length,
            }
            const pick = (set: Set<string> | null) => set ? subs.filter(s => set.has(s.status)) : subs
            const filtered = subFilter === 'live'    ? pick(LIVE_STATES)
                           : subFilter === 'pending' ? pick(PENDING_STATES)
                           : subFilter === 'ended'   ? pick(ENDED_STATES)
                           :                            pick(null)
            return (
              <>
                <div className="flex items-center gap-2 pt-1">
                  {(['live', 'pending', 'ended', 'all'] as const).map(f => (
                    <button key={f} onClick={() => setSubFilter(f)}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                        subFilter === f
                          ? 'bg-saffron-400/20 text-saffron-300 border border-saffron-400/40'
                          : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white/80'
                      }`}>
                      {f === 'live'    ? `● Live (${counts.live})`    :
                       f === 'pending' ? `◐ Pending (${counts.pending})` :
                       f === 'ended'   ? `○ Ended (${counts.ended})`  :
                                         `All (${counts.all})`}
                    </button>
                  ))}
                </div>
                {filtered.length === 0 && (
                  <p className="text-white/40 text-sm mt-2">
                    {subFilter === 'live'
                      ? 'No live subscriptions. Switch to "Pending" or "All" to see donor-initiated rows that never paid.'
                      : 'No subscriptions in this view.'}
                  </p>
                )}
                {filtered.map(s => {
                  const donorLabel = (s.donor_name && s.donor_name.trim())
                    || s.donor_email
                    || 'Anonymous'
                  const subRef = s.payment_provider === 'stripe'
                    ? (s.stripe_subscription_id || '')
                    : (s.paypal_subscription_id || '')
                  const shortRef = subRef ? `${subRef.slice(0, 14)}…${subRef.slice(-4)}` : '—'
                  const createdLabel = s.created_at
                    ? new Date(s.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '—'
                  return (
                    <div key={s.id} className="rounded-xl p-4 flex items-center gap-4"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-white">£{Number(s.amount).toFixed(0)}/{s.frequency.toLowerCase()}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                                title={s.status}
                                style={{ background: `${STATUS_COLOURS[s.status] || '#94a3b8'}20`, color: STATUS_COLOURS[s.status] || '#94a3b8' }}>
                            {STATUS_LABELS[s.status] || s.status}
                          </span>
                          {(s.payment_provider === 'stripe')
                            ? <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: '#635bff20', color: '#a5a1ff' }}>💳 Stripe</span>
                            : <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: '#0070ba20', color: '#4aa3e0' }}>PayPal</span>}
                          {s.tier_label && <span className="text-xs text-white/50">{s.tier_label}</span>}
                        </div>
                        <p className="text-sm text-white/80 mt-0.5">{donorLabel}</p>
                        <p className="text-xs text-white/40 mt-0.5 font-mono">
                          {shortRef} · {s.branch_id}
                        </p>
                        {refreshNote[s.id] && (
                          <p className="text-xs text-saffron-400 mt-1">↻ {refreshNote[s.id]}</p>
                        )}
                      </div>
                      <div className="text-right text-xs text-white/40 flex-shrink-0 flex flex-col items-end gap-2">
                        <div>
                          <p className="text-white/70 font-semibold">{createdLabel}</p>
                          <p className="text-white/30 text-[10px]">created</p>
                        </div>
                        {s.payment_provider !== 'stripe' && (
                          <button
                            onClick={() => refreshFromPayPal(s.id)}
                            disabled={refreshingId === s.id || !s.paypal_subscription_id}
                            title="Ask PayPal what the real status is — use when a sub is stuck on PENDING_APPROVAL but the donor says they signed up"
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/8 text-white/70 hover:bg-white/15 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">
                            {refreshingId === s.id ? '↻ Checking…' : '↻ Refresh from PayPal'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </>
            )
          })()}
        </div>
      )}

      {/* Share Links tab */}
      {tab === 'links' && (
        <div className="space-y-5">
          <div className="rounded-xl px-4 py-3 text-sm bg-cyan-500/10 border border-cyan-500/20 text-cyan-200">
            Share these links (or print as QR) so donors can set up monthly giving and pay by
            <strong> debit/credit card</strong>. The card option appears on PayPal when your business
            account has <strong>“PayPal account optional”</strong> turned on
            (PayPal → Account Settings → Website payments → Website preferences).
          </div>

          {/* Custom builder */}
          <div className="glass rounded-2xl p-4 border border-temple-border space-y-3">
            <p className="text-white/60 text-sm font-bold">Build a link</p>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-white/40 text-xs mb-1">Monthly amount (£)</label>
                <input value={linkAmount} onChange={e => setLinkAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  className="w-32 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm" placeholder="11" />
              </div>
              <div>
                <label className="block text-white/40 text-xs mb-1">Branch (internal ref / code, optional)</label>
                <input value={linkBranch} onChange={e => setLinkBranch(e.target.value)}
                  className="w-48 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm" placeholder="wembley_main" />
              </div>
            </div>
            {linkAmount && Number(linkAmount) >= 1 && (
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-white/70 bg-black/30 rounded-lg px-3 py-2 break-all">{buildLink(linkAmount, linkBranch)}</code>
                <button onClick={() => copyLink(buildLink(linkAmount, linkBranch))}
                  className="px-3 py-2 rounded-lg text-white text-xs font-bold whitespace-nowrap" style={{ background: 'linear-gradient(135deg,#0891B2,#0E7490)' }}>
                  {copied === buildLink(linkAmount, linkBranch) ? '✓ Copied' : 'Copy'}
                </button>
                <a href={buildLink(linkAmount, linkBranch)} target="_blank" rel="noreferrer"
                  className="px-3 py-2 rounded-lg border border-white/10 text-white/60 text-xs font-bold whitespace-nowrap">Test ↗</a>
              </div>
            )}
          </div>

          {/* Quick links from configured tiers */}
          <div>
            <p className="text-white/60 text-sm font-bold mb-2">Quick links from your tiers</p>
            <div className="space-y-2">
              {tiers.length === 0 && <p className="text-white/40 text-sm">No tiers configured — add tiers, or use the builder above.</p>}
              {tiers.map(tier => {
                const url = buildLink(tier.amount)
                return (
                  <div key={tier.id} className="glass rounded-xl px-4 py-3 border border-temple-border flex items-center gap-3">
                    <span className="text-white font-bold w-20">£{Number(tier.amount).toFixed(2)}</span>
                    <span className="text-white/40 text-sm flex-1 truncate">{tier.label}</span>
                    <code className="hidden sm:block text-[11px] text-white/40 truncate max-w-[280px]">{url}</code>
                    <button onClick={() => copyLink(url)}
                      className="px-3 py-1.5 rounded-lg text-white text-xs font-bold" style={{ background: 'linear-gradient(135deg,#0891B2,#0E7490)' }}>
                      {copied === url ? '✓' : 'Copy'}
                    </button>
                    <a href={url} target="_blank" rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg border border-white/10 text-white/60 text-xs font-bold">Test ↗</a>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4" style={{ background: '#1a0a00', border: '1px solid rgba(212,175,55,0.3)' }}>
            <h2 className="font-bold text-lg text-saffron-400">{editId ? 'Edit Tier' : 'New Tier'}</h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-white/50 mb-1">Amount (£) *</label>
                <input type="number" min="1" step="0.01" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-lg bg-white/10 text-white text-sm border border-white/20 focus:border-yellow-400 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-white/50 mb-1">Frequency</label>
                <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-white/10 text-white text-sm border border-white/20 focus:border-yellow-400 outline-none">
                  <option value="MONTH">Monthly</option>
                  <option value="WEEK">Weekly</option>
                  <option value="YEAR">Annually</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-white/50 mb-1">Label *</label>
              <input type="text" value={form.label} placeholder="e.g. Prasad Patron"
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-white/10 text-white text-sm border border-white/20 focus:border-yellow-400 outline-none" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-white/50 mb-1">Description</label>
              <input type="text" value={form.description} placeholder="Short description shown to donors"
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-white/10 text-white text-sm border border-white/20 focus:border-yellow-400 outline-none" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-white/50 mb-1">Display Order</label>
                <input type="number" min="0" value={form.display_order}
                  onChange={e => setForm(f => ({ ...f, display_order: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-lg bg-white/10 text-white text-sm border border-white/20 focus:border-yellow-400 outline-none" />
              </div>
              <div className="flex flex-col gap-2 pt-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_default} onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))}
                    className="rounded" style={{ accentColor: '#FF9933' }} />
                  <span className="text-sm text-white">Set as default</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    className="rounded" style={{ accentColor: '#FF9933' }} />
                  <span className="text-sm text-white">Active</span>
                </label>
              </div>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-lg font-semibold text-sm bg-white/10 text-white">Cancel</button>
              <button onClick={save} disabled={saving}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
