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
}

const EMPTY: Omit<Tier, 'id' | 'paypal_plan_id' | 'active_subscribers'> = {
  amount: 5, label: '', description: '', frequency: 'MONTH',
  is_active: true, is_default: false, display_order: 0,
}

const STATUS_COLOURS: Record<string, string> = {
  ACTIVE: '#4ade80', PENDING_APPROVAL: '#fbbf24',
  CANCELLED: '#f87171', SUSPENDED: '#fb923c', EXPIRED: '#94a3b8',
}

export default function RecurringGivingPage() {
  const [tiers, setTiers]     = useState<Tier[]>([])
  const [subs, setSubs]       = useState<Sub[]>([])
  const [tab, setTab]         = useState<'tiers' | 'subs'>('tiers')
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

  useEffect(() => { loadTiers(); loadSubs() }, [])

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

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10">
        {(['tiers', 'subs'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === t ? 'border-saffron-400 text-saffron-400' : 'border-transparent text-white/50 hover:text-white/80'}`}>
            {t === 'tiers' ? `Donation Tiers (${tiers.length})` : `Subscriptions (${subs.length})`}
          </button>
        ))}
      </div>

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
          {subs.length === 0 && <p className="text-white/40 text-sm">No subscriptions yet.</p>}
          {subs.map(s => (
            <div key={s.id} className="rounded-xl p-4 flex items-center gap-4"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-white">£{Number(s.amount).toFixed(0)}/{s.frequency.toLowerCase()}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: `${STATUS_COLOURS[s.status] || '#94a3b8'}20`, color: STATUS_COLOURS[s.status] || '#94a3b8' }}>{s.status}</span>
                  {s.tier_label && <span className="text-xs text-white/50">{s.tier_label}</span>}
                </div>
                <p className="text-sm text-white/70 mt-0.5">{s.donor_name || 'Anonymous'}{s.donor_email && ` · ${s.donor_email}`}</p>
                <p className="text-xs text-white/40 mt-0.5">PayPal: {s.paypal_subscription_id} · {s.branch_id}</p>
                {refreshNote[s.id] && (
                  <p className="text-xs text-saffron-400 mt-1">↻ {refreshNote[s.id]}</p>
                )}
              </div>
              <div className="text-right text-xs text-white/40 flex-shrink-0 flex flex-col items-end gap-2">
                <p>{s.approved_at ? new Date(s.approved_at).toLocaleDateString('en-GB') : 'Pending'}</p>
                <button
                  onClick={() => refreshFromPayPal(s.id)}
                  disabled={refreshingId === s.id || !s.paypal_subscription_id}
                  title="Ask PayPal what the real status is — use when a sub is stuck on PENDING_APPROVAL but the donor says they signed up"
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/8 text-white/70 hover:bg-white/15 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">
                  {refreshingId === s.id ? '↻ Checking…' : '↻ Refresh from PayPal'}
                </button>
              </div>
            </div>
          ))}
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
