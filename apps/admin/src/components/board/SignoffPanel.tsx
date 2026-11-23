'use client'
// Phase D — chair sign-off panel. Lives on the Vote & Close step once
// the resolution is CLOSED. Shows the blocker checklist, a signature
// pad, an "approve external audience" action when needed, and the
// finalise button that PIN-gates + generates the PDF + fires fan-out.

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface SignoffState {
  resolution: {
    id: string
    title: string
    status: string
    outcome: string
    chair_signoff_at: string | null
    pdf_attachment_id: string | null
  }
  pending_conditions: number
  chair_signature_on_file: boolean
  plan: { id: string; requires_chair_approval: boolean; approved_at: string | null; status: string } | null
  blockers: string[]
  ready_to_finalise: boolean
}

export function SignoffPanel({ resolutionId, onSignedOff }: { resolutionId: string; onSignedOff?: () => void }) {
  const [state, setState] = useState<SignoffState | null>(null)
  const [error, setError] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [sigSaved, setSigSaved] = useState(false)
  const [result, setResult] = useState<{ pdf_attachment_id: string; announcement: Record<string, unknown> } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<SignoffState>(`/admin/board/resolutions/${resolutionId}/signoff`)
      setState(r); setSigSaved(r.chair_signature_on_file)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
  }, [resolutionId])
  useEffect(() => { load() }, [load])

  async function saveSignature(pngBase64: string) {
    setBusy(true); setError('')
    try {
      await apiFetch(`/admin/board/resolutions/${resolutionId}/signoff/signature`, {
        method: 'POST',
        body: JSON.stringify({ png_base64: pngBase64 }),
      })
      setSigSaved(true)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Signature save failed') }
    finally   { setBusy(false) }
  }

  async function approveAnnouncement() {
    setBusy(true); setError('')
    try {
      await apiFetch(`/admin/board/resolutions/${resolutionId}/announcement/approve`, { method: 'POST' })
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Approve failed') }
    finally   { setBusy(false) }
  }

  async function finalise() {
    if (!pin) return
    setBusy(true); setError('')
    try {
      const r = await apiFetch<typeof result>(`/admin/board/resolutions/${resolutionId}/signoff/finalise`, {
        method: 'POST',
        body: JSON.stringify({ pin }),
      })
      setResult(r)
      setPin('')
      onSignedOff?.()
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Finalise failed') }
    finally   { setBusy(false) }
  }

  if (!state) return <p className="text-xs text-white/40">Loading sign-off state…</p>

  const r = state.resolution
  const signedOff = !!r.chair_signoff_at

  return (
    <div className="space-y-3">
      {signedOff ? (
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
          <p className="text-green-300 text-sm font-bold">✓ Signed off {new Date(r.chair_signoff_at!).toLocaleString('en-GB')}</p>
          {r.pdf_attachment_id && (
            <p className="mt-1 text-xs">
              <a href={`/api/v1/admin/board/resolutions/${resolutionId}/attachments/${r.pdf_attachment_id}/download`}
                 className="text-saffron-300 hover:underline">Download signed PDF →</a>
            </p>
          )}
        </div>
      ) : (
        <>
          <ChecklistBlock blockers={state.blockers} />

          {state.plan?.requires_chair_approval && !state.plan.approved_at && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="text-amber-300 text-xs font-bold mb-2">
                External-audience announcement awaits your approval before sign-off.
              </p>
              <button onClick={approveAnnouncement} disabled={busy}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/20 border border-amber-500/40 text-amber-200 disabled:opacity-40">
                {busy ? 'Approving…' : 'Approve external audience'}
              </button>
            </div>
          )}

          {!sigSaved && (
            <SignaturePad onSave={saveSignature} />
          )}
          {sigSaved && !signedOff && (
            <p className="text-green-300 text-xs">✓ Chair signature on file. Finalise below to lock the record.</p>
          )}

          <div className="rounded-xl border border-saffron-400/40 bg-saffron-400/5 p-4">
            <p className="text-saffron-300 text-xs font-bold uppercase tracking-widest mb-2">Finalise sign-off</p>
            <p className="text-white/60 text-xs mb-3">
              Generates a signed PDF, locks the record, and runs the announcement fan-out (email-only in this release).
              PIN-gated on top of the audit log.
            </p>
            <div className="flex gap-2">
              <input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)}
                placeholder="Chair PIN"
                className="flex-1 rounded-lg px-3 py-2 text-sm bg-white/5 border border-white/10 text-white outline-none focus:border-saffron-400/50" />
              <button onClick={finalise} disabled={busy || !pin || state.blockers.length > 0}
                className="px-4 py-2 rounded-lg text-sm font-black bg-saffron-gradient text-[#3B0000] disabled:opacity-40">
                {busy ? 'Finalising…' : 'Sign off →'}
              </button>
            </div>
          </div>
        </>
      )}

      {result && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3 text-xs text-indigo-200">
          <p>PDF attached. Announcement fan-out: <code>{JSON.stringify(result.announcement)}</code></p>
        </div>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  )
}

function ChecklistBlock({ blockers }: { blockers: string[] }) {
  if (!blockers.length) {
    return <p className="text-green-300 text-xs">✓ All sign-off checks passed — you can finalise below.</p>
  }
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
      <p className="text-red-300 text-xs font-bold mb-1">Blockers</p>
      <ul className="list-disc ml-5 text-xs text-white/80">
        {blockers.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
    </div>
  )
}

// ─── Signature pad ──────────────────────────────────────────────────────────
function SignaturePad({ onSave }: { onSave: (pngBase64: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const lastPt = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)

  function getCtx() { return canvasRef.current?.getContext('2d') || null }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true
    const r = canvasRef.current!.getBoundingClientRect()
    lastPt.current = { x: e.clientX - r.left, y: e.clientY - r.top }
    setEmpty(false)
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = getCtx()!
    const r = canvasRef.current!.getBoundingClientRect()
    const pt = { x: e.clientX - r.left, y: e.clientY - r.top }
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#111'
    ctx.beginPath()
    ctx.moveTo(lastPt.current!.x, lastPt.current!.y)
    ctx.lineTo(pt.x, pt.y)
    ctx.stroke()
    lastPt.current = pt
  }
  function end() { drawing.current = false; lastPt.current = null }
  function clear() {
    const c = canvasRef.current!
    getCtx()!.clearRect(0, 0, c.width, c.height)
    setEmpty(true)
  }
  function save() {
    const c = canvasRef.current!
    onSave(c.toDataURL('image/png'))
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-white/70 text-xs font-bold mb-2">Draw your signature</p>
      <canvas
        ref={canvasRef} width={480} height={120}
        onPointerDown={start} onPointerMove={move}
        onPointerUp={end} onPointerLeave={end}
        className="w-full bg-white rounded-lg touch-none cursor-crosshair"
        style={{ aspectRatio: '480 / 120' }} />
      <div className="flex items-center gap-2 mt-2">
        <button onClick={clear} className="text-xs text-white/60 hover:text-white underline">Clear</button>
        <div className="flex-1" />
        <button onClick={save} disabled={empty}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 disabled:opacity-40">
          Save signature
        </button>
      </div>
      <p className="mt-2 text-[11px] text-white/40">
        The PIN you type below is the legal signature (Simple Electronic Signature under eIDAS).
        This drawing is visual presence only — it renders on the PDF.
      </p>
    </div>
  )
}
