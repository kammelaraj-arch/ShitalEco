'use client'
// Vote recipients picker — shown on the Review step once a resolution is
// OPEN. Lists every active trustee with a checkbox, their email + phone,
// a badge for anyone who's already received an invite or voted, and a
// channel selector (Email / SMS). The chair ticks who to send to, picks
// one or both channels, hits Send. The backend writes a VOTE_INVITES_SENT
// audit row with who, what channel, how many succeeded / failed.

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface Recipient {
  id: string
  full_name: string
  email: string
  phone: string
  role: string
  is_active: boolean
  has_voted: boolean
  last_sent_at: string | null
  last_sent_via: string
  email_ok: boolean
  sms_ok: boolean
}

interface SendResult {
  trustees_total: number
  channels: string[]
  tokens_created: number
  tokens_reused: number
  email_failed: string[]
  sms_sent: string[]
  sms_failed: string[]
}

function timeAgo(iso: string): string {
  if (!iso) return ''
  try {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
  } catch { return '' }
}

export function VoteRecipientsPanel({
  resolutionId,
  resolutionIsOpen,
}: {
  resolutionId: string
  resolutionIsOpen: boolean
}) {
  const [items, setItems] = useState<Recipient[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [channels, setChannels] = useState<{ email: boolean; sms: boolean }>({ email: true, sms: false })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<SendResult | null>(null)

  async function load() {
    try {
      const r = await apiFetch<{ items: Recipient[] }>(
        `/admin/board/resolutions/${resolutionId}/vote-recipients`,
      )
      setItems(r.items || [])
      // Default: pre-check everyone who hasn't voted yet.
      setSelected(new Set((r.items || []).filter(x => !x.has_voted).map(x => x.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recipients')
    }
  }
  useEffect(() => { if (resolutionId) load() }, [resolutionId]) // eslint-disable-line

  const toggle = (id: string) => setSelected(s => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const chosenChannels = useMemo(() => {
    const out: string[] = []
    if (channels.email) out.push('EMAIL')
    if (channels.sms) out.push('SMS')
    return out
  }, [channels])

  async function send() {
    if (selected.size === 0) { setError('Pick at least one trustee'); return }
    if (chosenChannels.length === 0) { setError('Pick at least one channel'); return }
    const names = items.filter(i => selected.has(i.id)).map(i => i.full_name)
    const chText = chosenChannels.join(' + ')
    if (!confirm(`Send ${chText} invite to ${names.length} trustee${names.length === 1 ? '' : 's'}?\n\n${names.slice(0, 5).join(', ')}${names.length > 5 ? ` + ${names.length - 5} more` : ''}`)) return

    setSending(true); setError(''); setResult(null)
    try {
      const r = await apiFetch<SendResult>(
        `/admin/board/resolutions/${resolutionId}/send-vote-invites`,
        {
          method: 'POST',
          body: JSON.stringify({
            trustee_ids: Array.from(selected),
            channels:    chosenChannels,
          }),
        },
      )
      setResult(r)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const allIds = items.map(i => i.id)
  const activeIds = items.filter(i => !i.has_voted).map(i => i.id)

  return (
    <div className="rounded-2xl border border-white/10 bg-white/3 p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-white/70 text-xs uppercase tracking-widest font-bold">📨 Vote recipients</p>
          <p className="text-white/50 text-[11px] mt-0.5">
            {resolutionIsOpen
              ? 'Pick who gets a magic-link invite. Each row shows their last-sent status.'
              : 'Publish the resolution first — then you can send invites.'}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <button type="button" onClick={() => setSelected(new Set(allIds))}
            className="px-2.5 py-1 rounded-lg border border-white/10 text-white/70 hover:bg-white/5">Select all</button>
          <button type="button" onClick={() => setSelected(new Set(activeIds))}
            className="px-2.5 py-1 rounded-lg border border-white/10 text-white/70 hover:bg-white/5">Not-yet-voted</button>
          <button type="button" onClick={() => setSelected(new Set())}
            className="px-2.5 py-1 rounded-lg border border-white/10 text-white/70 hover:bg-white/5">None</button>
        </div>
      </div>

      <ul className="divide-y divide-white/5 rounded-xl border border-white/5">
        {items.length === 0 && (
          <li className="px-3 py-3 text-white/40 text-xs italic">Loading trustees…</li>
        )}
        {items.map(r => {
          const checked = selected.has(r.id)
          return (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2">
              <input type="checkbox" checked={checked} onChange={() => toggle(r.id)}
                disabled={!resolutionIsOpen}
                className="h-4 w-4 accent-saffron-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-white text-sm font-bold truncate">{r.full_name}</p>
                  <span className="px-1.5 py-0 rounded bg-white/5 text-white/50 text-[10px] font-bold uppercase">{r.role}</span>
                  {r.has_voted && <span className="px-1.5 py-0 rounded bg-emerald-600/20 text-emerald-300 text-[10px] font-bold uppercase">Voted</span>}
                  {r.last_sent_at && !r.has_voted && (
                    <span className="px-1.5 py-0 rounded bg-sky-600/20 text-sky-300 text-[10px] font-bold uppercase">
                      {(r.last_sent_via || 'SENT').toLowerCase()} · {timeAgo(r.last_sent_at)}
                    </span>
                  )}
                </div>
                <p className="text-white/50 text-[11px] truncate">
                  {r.email || <span className="text-white/30">no email</span>}
                  {r.phone ? <span> · {r.phone}</span> : null}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <span className={`text-[10px] font-bold uppercase ${r.email_ok ? 'text-white/50' : 'text-white/20 line-through'}`} title={r.email_ok ? 'Email on file' : 'No email on file'}>✉</span>
                <span className={`text-[10px] font-bold uppercase ${r.sms_ok ? 'text-white/50' : 'text-white/20 line-through'}`} title={r.sms_ok ? 'Phone on file' : 'No phone on file'}>📱</span>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-white/5">
        <span className="text-white/60 text-xs font-bold uppercase tracking-wide">Send via:</span>
        <label className="flex items-center gap-1.5 text-white/80 text-sm">
          <input type="checkbox" checked={channels.email}
            onChange={e => setChannels(c => ({ ...c, email: e.target.checked }))}
            className="h-4 w-4 accent-saffron-500" />
          ✉ Email
        </label>
        <label className="flex items-center gap-1.5 text-white/80 text-sm">
          <input type="checkbox" checked={channels.sms}
            onChange={e => setChannels(c => ({ ...c, sms: e.target.checked }))}
            className="h-4 w-4 accent-saffron-500" />
          📱 SMS
        </label>
        <div className="flex-1" />
        <button type="button" onClick={send}
          disabled={!resolutionIsOpen || sending || selected.size === 0 || chosenChannels.length === 0}
          className="px-4 py-2 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
          {sending ? 'Sending…' : `Send to ${selected.size}`}
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-red-200 text-xs">{error}</div>}

      {result && (
        <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-xs text-emerald-100 space-y-1">
          <p className="font-bold">
            Sent via {result.channels.join(' + ')} to {result.trustees_total} trustee{result.trustees_total === 1 ? '' : 's'}.
          </p>
          <p>Tokens created: {result.tokens_created} · reused: {result.tokens_reused}</p>
          {result.sms_sent.length > 0 && <p>SMS sent: {result.sms_sent.length}</p>}
          {(result.email_failed.length > 0 || result.sms_failed.length > 0) && (
            <details className="mt-1">
              <summary className="cursor-pointer text-red-200">⚠ Some sends failed — details</summary>
              {result.email_failed.length > 0 && <p>Email: {result.email_failed.join('; ')}</p>}
              {result.sms_failed.length > 0 && <p>SMS: {result.sms_failed.join('; ')}</p>}
            </details>
          )}
        </div>
      )}
    </div>
  )
}
