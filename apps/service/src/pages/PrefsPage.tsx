// Preference centre — Phase 1a compliance front-end.
//
// A donor arrives here from the unsubscribe / preferences link in a
// marketing email, carrying ?t=<jwt>. We GET /me/prefs with the token,
// render a checklist of per-channel subscriptions, and POST back the
// changes. One-click "unsubscribe from all" sends everything to false.
//
// No login required — the signed token authenticates the donor.
// No navigation into the rest of the service portal from here — this is
// a landing page by itself so a donor can bail the moment they hit
// "Unsubscribe" without being nudged elsewhere.

import { useEffect, useMemo, useState } from 'react'

const API = (import.meta.env.VITE_API_URL as string) || '/api/v1'

interface PrefsResponse {
  contact: { first_name: string; surname: string; email: string }
  channels: Record<string, boolean>
  supported_channels: string[]
}

const CHANNEL_LABELS: Record<string, { label: string; blurb: string; emoji: string }> = {
  email:    { label: 'Email',    blurb: 'Newsletters, campaign updates, appeal reminders.', emoji: '✉️' },
  sms:      { label: 'SMS',      blurb: 'Short messages for time-sensitive campaigns.',    emoji: '💬' },
  whatsapp: { label: 'WhatsApp', blurb: 'Community updates and event reminders.',          emoji: '📱' },
  phone:    { label: 'Phone',    blurb: 'Occasional calls from a SHITAL volunteer.',       emoji: '📞' },
  post:     { label: 'Post',     blurb: 'Printed newsletters, annual report, event cards.', emoji: '📬' },
}

export function PrefsPage() {
  const token = useMemo(() => {
    const p = new URLSearchParams(window.location.search)
    return p.get('t') || ''
  }, [])

  const [state,   setState]   = useState<PrefsResponse | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [savedAt, setSavedAt] = useState<string>('')
  const [error,   setError]   = useState<string>('')

  // Initial fetch — if the token is bad we show a friendly error rather
  // than the raw 401 message.
  useEffect(() => {
    if (!token) { setError('This link is missing its preference token.'); return }
    fetch(`${API}/me/prefs?t=${encodeURIComponent(token)}`)
      .then(async r => {
        if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`)
        return r.json() as Promise<PrefsResponse>
      })
      .then(setState)
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load preferences'))
  }, [token])

  async function save(channels: Record<string, boolean>, reason: string = '') {
    if (!state) return
    setSaving(true); setError('')
    try {
      const r = await fetch(`${API}/me/prefs?t=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels, reason }),
      })
      if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`)
      setState({ ...state, channels: { ...state.channels, ...channels } })
      setSavedAt(new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save preferences')
    } finally {
      setSaving(false)
    }
  }

  function toggle(ch: string) {
    if (!state) return
    save({ [ch]: !state.channels[ch] })
  }

  function unsubscribeAll() {
    if (!state) return
    const off: Record<string, boolean> = {}
    for (const ch of state.supported_channels) off[ch] = false
    save(off, 'one_click_unsubscribe')
  }

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-xl px-4 py-10 text-white" style={{ minHeight: 'calc(100vh - 140px)' }}>
      <div className="text-center mb-6">
        <h1 className="font-display text-3xl font-black" style={{ color: 'var(--text)' }}>
          Your subscription preferences
        </h1>
        <p className="text-sm mt-2 opacity-75">Tick only the channels you want to hear from.</p>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm mb-4"
             style={{ background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.4)', color: '#fca5a5' }}>
          {error}
        </div>
      )}

      {!state && !error && (
        <p className="text-center opacity-60 text-sm">Loading…</p>
      )}

      {state && (
        <>
          <div className="rounded-xl p-4 mb-5 text-sm"
               style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="font-semibold">
              {(state.contact.first_name || 'Friend')}
              {state.contact.surname ? ` ${state.contact.surname}` : ''}
            </div>
            {state.contact.email && (
              <div className="text-xs opacity-60 font-mono">{state.contact.email}</div>
            )}
          </div>

          <div className="space-y-3">
            {state.supported_channels.map(ch => {
              const meta = CHANNEL_LABELS[ch] || { label: ch, blurb: '', emoji: '•' }
              const on = state.channels[ch]
              return (
                <button
                  key={ch}
                  onClick={() => toggle(ch)}
                  disabled={saving}
                  className="w-full flex items-start gap-3 rounded-xl p-4 text-left transition-colors disabled:opacity-60"
                  style={{
                    background: on ? 'rgba(74,222,128,0.10)' : 'rgba(255,255,255,0.04)',
                    border: on ? '1px solid rgba(74,222,128,0.35)' : '1px solid rgba(255,255,255,0.08)',
                  }}>
                  <div className="text-2xl shrink-0">{meta.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold flex items-center gap-2">
                      {meta.label}
                      <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                            style={{
                              background: on ? 'rgba(74,222,128,0.2)' : 'rgba(239,68,68,0.15)',
                              color: on ? '#4ade80' : '#f87171',
                            }}>
                        {on ? 'Subscribed' : 'Unsubscribed'}
                      </span>
                    </div>
                    <div className="text-xs opacity-70 mt-1">{meta.blurb}</div>
                  </div>
                </button>
              )
            })}
          </div>

          <button
            onClick={unsubscribeAll}
            disabled={saving}
            className="w-full mt-6 py-3 rounded-xl font-bold text-sm transition-colors disabled:opacity-60"
            style={{
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5',
            }}>
            Unsubscribe from every channel
          </button>

          {savedAt && (
            <p className="text-center text-xs opacity-60 mt-4">✓ Saved at {savedAt}</p>
          )}

          <p className="text-center text-[11px] opacity-50 mt-8">
            Transactional emails (donation receipts, Gift Aid confirmations) continue regardless of these settings as required by law.
          </p>
        </>
      )}
    </div>
  )
}
