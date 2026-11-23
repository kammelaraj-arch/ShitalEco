'use client'
// Public contributor page — someone the chair has asked for information
// before a resolution goes to vote. Flow:
//   1. Open with ?t=<jwt>
//   2. GET /public/board/info/{token} → request meta + whether PIN is set
//   3. If no PIN, set one (first visit). Otherwise type the stored PIN.
//   4. Write a rich-text response (sanitized server-side). Non-text
//      requests also need an uploaded attachment.
//   5. Submit & Lock. From then on the response is read-only.

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

const API = process.env.NEXT_PUBLIC_API_URL || '/api/v1'

interface RequestMeta {
  id: string
  target_email: string
  target_name: string
  prompt: string
  expected_type: 'text' | 'document' | 'image' | 'video' | 'audio'
  is_required: boolean
  due_at: string | null
  status: 'OPEN' | 'SUBMITTED' | 'CANCELLED'
}
interface LoadResponse {
  request:   RequestMeta
  resolution: { id: string; title: string }
  has_pin:   boolean
  contributor_name: string
}

export default function BoardInfoPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-gray-50" />}>
      <BoardInfoPageInner />
    </Suspense>
  )
}

function BoardInfoPageInner() {
  const params = useSearchParams()
  const token = params.get('t') || ''

  const [meta,  setMeta]  = useState<LoadResponse | null>(null)
  const [error, setError] = useState('')
  const [pin,   setPin]   = useState('')
  const [pin2,  setPin2]  = useState('')
  const [name,  setName]  = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [attachmentId, setAttachmentId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ response_id: string; content_hash: string; locked_at: string } | null>(null)

  const load = useCallback(async () => {
    if (!token) { setError('Missing token in URL'); return }
    try {
      const r = await fetch(`${API}/public/board/info/${encodeURIComponent(token)}`)
      if (!r.ok) throw new Error(await r.text())
      const d: LoadResponse = await r.json()
      setMeta(d)
      if (d.contributor_name) setName(d.contributor_name)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
  }, [token])
  useEffect(() => { load() }, [load])

  async function setPinNow() {
    if (!/^\d{4,10}$/.test(pin)) { setError('PIN must be 4–10 digits'); return }
    if (pin !== pin2) { setError('PINs do not match'); return }
    setBusy(true); setError('')
    try {
      const r = await fetch(`${API}/public/board/info/set-pin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, pin, name }),
      })
      if (!r.ok) throw new Error(await r.text())
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Set PIN failed') }
    finally { setBusy(false) }
  }

  async function uploadFile(file: File) {
    if (!meta) return
    setUploading(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      // Reuse the existing admin attachments endpoint. It accepts public
      // uploads via the signed info-request token in the X-Info-Token header.
      const r = await fetch(
        `${API}/public/board/info/upload?t=${encodeURIComponent(token)}`,
        { method: 'POST', body: fd },
      )
      if (!r.ok) throw new Error(await r.text())
      const d = await r.json() as { attachment_id: string }
      setAttachmentId(d.attachment_id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed') }
    finally   { setUploading(false) }
  }

  async function submit() {
    if (!meta) return
    if (!/^\d{4,10}$/.test(pin)) { setError('Enter your PIN'); return }
    if (meta.request.expected_type !== 'text' && !attachmentId) {
      setError(`A ${meta.request.expected_type} attachment is required`); return
    }
    if (!bodyHtml.trim() && !attachmentId) {
      setError('Add text or an attachment'); return
    }
    setBusy(true); setError('')
    try {
      const r = await fetch(`${API}/public/board/info/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, pin, body_html: bodyHtml, attachment_id: attachmentId }),
      })
      if (!r.ok) throw new Error(await r.text())
      const d = await r.json()
      setDone(d)
    } catch (e) { setError(e instanceof Error ? e.message : 'Submit failed') }
    finally { setBusy(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!meta) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center">
          {error ? (
            <div className="rounded bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>
          ) : <p className="text-sm text-gray-500">Loading…</p>}
        </div>
      </main>
    )
  }

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full rounded-xl bg-white border border-green-200 p-6 text-center">
          <div className="text-green-600 text-2xl mb-2">✓</div>
          <h1 className="text-lg font-bold mb-1">Submitted</h1>
          <p className="text-sm text-gray-600 mb-3">
            Thank you. The Board will review your contribution. Your response is now locked and cannot be changed.
          </p>
          <div className="text-[11px] font-mono text-gray-400 break-all">hash: {done.content_hash}</div>
        </div>
      </main>
    )
  }

  const needSetPin = !meta.has_pin
  const locked = meta.request.status !== 'OPEN'

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <header>
          <p className="text-xs uppercase tracking-widest text-gray-500">Information Request</p>
          <h1 className="text-xl font-bold mt-1">{meta.resolution.title}</h1>
          <p className="text-xs text-gray-500 mt-1">For: {meta.request.target_name || meta.request.target_email}</p>
        </header>

        <section className="rounded border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs uppercase tracking-widest font-bold text-amber-700 mb-1">What's needed</p>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{meta.request.prompt}</p>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
            <span className="rounded-full bg-amber-100 px-2 py-0.5">{meta.request.expected_type}</span>
            {meta.request.is_required && (
              <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5">Required</span>
            )}
            {meta.request.due_at && <span>Due {new Date(meta.request.due_at).toLocaleString('en-GB')}</span>}
          </div>
        </section>

        {locked && (
          <div className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
            This request is {meta.request.status.toLowerCase()} — no further action needed.
          </div>
        )}

        {!locked && needSetPin && (
          <section className="space-y-2">
            <h2 className="font-bold text-sm">Set a PIN</h2>
            <p className="text-xs text-gray-600">
              You'll need this PIN every time you contribute to a SHITAL Board request. Choose 4–10 digits you'll remember.
            </p>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name (optional)"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)}
                placeholder="New PIN" className="rounded border border-gray-300 px-3 py-2 text-sm" />
              <input type="password" inputMode="numeric" value={pin2} onChange={e => setPin2(e.target.value)}
                placeholder="Confirm PIN" className="rounded border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <button onClick={setPinNow} disabled={busy}
              className="w-full rounded bg-indigo-600 text-white py-2 text-sm font-medium disabled:opacity-50">
              {busy ? 'Saving…' : 'Set PIN and continue'}
            </button>
          </section>
        )}

        {!locked && !needSetPin && (
          <section className="space-y-3">
            <h2 className="font-bold text-sm">Your response</h2>

            <textarea value={bodyHtml} onChange={e => setBodyHtml(e.target.value)} rows={5}
              placeholder="Type your response. Plain text is fine; basic HTML is sanitized."
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />

            {meta.request.expected_type !== 'text' && (
              <div className="rounded border border-dashed border-gray-300 p-3">
                <label className="block text-xs text-gray-600 mb-1">
                  Attach a {meta.request.expected_type}
                  {meta.request.is_required && ' (required)'}
                </label>
                <input type="file"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f) }}
                  disabled={uploading} className="text-sm" />
                {attachmentId && <p className="mt-1 text-xs text-green-700">✓ Uploaded (will lock on submit)</p>}
              </div>
            )}

            <input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)}
              placeholder="Your PIN to confirm" className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />

            <button onClick={submit} disabled={busy || !pin}
              className="w-full rounded bg-green-600 text-white py-2.5 text-sm font-bold disabled:opacity-50">
              {busy ? 'Locking…' : 'Submit & Lock'}
            </button>

            <p className="text-[11px] text-gray-500">
              Your submission will be sealed once you click. A SHA-256 hash of the content is printed on the final
              resolution's PDF appendix so the record proves integrity offline.
            </p>
          </section>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </main>
  )
}
