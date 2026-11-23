// Phase 1b: send one marketing-compliant email to a single contact as
// a smoke test for the whole pipeline (opt-in gate → footer → SMTP →
// sent_emails audit). The composer and the audience-wide sender land
// in Phase 1c; this page already exercises the gate so we can prove
// end-to-end deliverability before writing more UI.

import { useState } from 'react'
import { api, HttpError } from '../api'

export function CampaignsPage() {
  const [contactId, setContactId] = useState('')
  const [subject,   setSubject]   = useState('A hello from SHITAL')
  const [body,      setBody]      = useState(
    '<p>Hi,</p><p>This is a test send from the new campaigns hub.</p><p>— SHITAL</p>',
  )
  const [busy,      setBusy]      = useState(false)
  const [result,    setResult]    = useState<string>('')
  const [error,     setError]     = useState<string>('')

  async function onSend() {
    setBusy(true); setResult(''); setError('')
    try {
      const r = await api.sendTest({ contact_id: contactId.trim(), subject, html: body })
      if (r.sent) {
        setResult(`Sent (audit id ${r.sent_email_id}). Preference URL: ${r.prefs_url || 'n/a'}`)
      } else if (r.skipped) {
        setResult(`Skipped — ${r.reason}. The donor has opted out of email.`)
      } else {
        setError(r.reason || 'Unknown failure from backend')
      }
    } catch (e) {
      setError(e instanceof HttpError ? `${e.status}: ${e.message}` : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-lg font-bold mb-1">Send a test</h2>
      <p className="text-sm opacity-60 mb-5">
        One-off send to a single contact id. Opt-out gate + unsubscribe footer applied automatically.
      </p>

      <label className="block mb-3">
        <span className="text-xs opacity-70 uppercase tracking-wider">Contact id (UUID)</span>
        <input value={contactId} onChange={e => setContactId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          className="mt-1 w-full rounded-lg px-3 py-2 bg-black/40 border border-white/10 outline-none focus:border-yellow-500 font-mono text-sm" />
      </label>

      <label className="block mb-3">
        <span className="text-xs opacity-70 uppercase tracking-wider">Subject</span>
        <input value={subject} onChange={e => setSubject(e.target.value)}
          className="mt-1 w-full rounded-lg px-3 py-2 bg-black/40 border border-white/10 outline-none focus:border-yellow-500" />
      </label>

      <label className="block mb-5">
        <span className="text-xs opacity-70 uppercase tracking-wider">HTML body</span>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={6}
          className="mt-1 w-full rounded-lg px-3 py-2 bg-black/40 border border-white/10 outline-none focus:border-yellow-500 font-mono text-xs" />
      </label>

      <button onClick={onSend} disabled={busy || !contactId.trim()}
        className="px-5 py-2.5 rounded-lg font-bold bg-yellow-500 text-black disabled:opacity-60">
        {busy ? 'Sending…' : 'Send test'}
      </button>

      {result && <p className="mt-4 text-sm" style={{ color: '#4ade80' }}>{result}</p>}
      {error  && <p className="mt-4 text-sm" style={{ color: '#fca5a5' }}>{error}</p>}
    </div>
  )
}
