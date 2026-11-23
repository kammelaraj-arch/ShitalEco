// Saved audience segments — reusable across campaigns. Mirrors the
// board announcement audience kinds (one resolver for both).

import { useEffect, useState } from 'react'
import { api, HttpError } from '../api'

type Kind = 'all_contacts' | 'volunteers' | 'recent_donors' | 'trustees' | 'individuals' | 'external_list'

interface SegmentRow { id: string; name: string; description: string; entry_count: number; updated_at: string }
interface EntryRow { id: string; kind: Kind; params: Record<string, unknown>; created_at: string }

const KIND_LABELS: Record<Kind, string> = {
  all_contacts:  'All contacts',
  volunteers:    'Active volunteers',
  recent_donors: 'Recent donors',
  trustees:      'Active trustees',
  individuals:   'Specific contacts',
  external_list: 'External email list',
}

export function AudiencesPage() {
  const [items, setItems] = useState<SegmentRow[]>([])
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function load() {
    try { setItems((await api.listSegments()).items) }
    catch (e) { setError(e instanceof HttpError ? e.message : 'Load failed') }
  }
  useEffect(() => { load() }, [])

  async function create() {
    if (!name.trim()) return
    try { await api.createSegment({ name, description: desc }); setName(''); setDesc(''); await load() }
    catch (e) { setError(e instanceof HttpError ? e.message : 'Create failed') }
  }
  async function del(id: string) {
    if (!confirm('Delete this segment?')) return
    try { await api.deleteSegment(id); await load() }
    catch (e) { setError(e instanceof HttpError ? e.message : 'Delete failed') }
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <section>
        <h2 className="text-lg font-bold mb-1">Saved audiences</h2>
        <p className="text-sm opacity-60 mb-4">Reusable segments the composer and board announcements can target.</p>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-4 space-y-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Segment name — e.g. London donors"
            className="w-full rounded-lg px-3 py-2 bg-black/40 border border-white/10 outline-none focus:border-yellow-500" />
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Short description (optional)"
            className="w-full rounded-lg px-3 py-2 bg-black/40 border border-white/10 outline-none focus:border-yellow-500 text-sm" />
          <button onClick={create} disabled={!name.trim()}
            className="rounded-lg bg-yellow-500 text-black px-3 py-2 text-sm font-bold disabled:opacity-50">
            Create segment
          </button>
        </div>

        {items.length === 0 && <p className="text-sm opacity-50">No segments yet — create one above.</p>}
        {items.map(s => (
          <div key={s.id} className="rounded-xl border border-white/10 bg-white/5 p-4 mb-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold">{s.name}</div>
                <div className="text-xs opacity-60">{s.entry_count} entr{s.entry_count === 1 ? 'y' : 'ies'}</div>
                {s.description && <div className="text-xs opacity-50 mt-1">{s.description}</div>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setOpen(open === s.id ? null : s.id)}
                  className="text-xs text-yellow-400 hover:underline">
                  {open === s.id ? 'Close' : 'Edit entries'}
                </button>
                <button onClick={() => del(s.id)} className="text-xs text-red-400 hover:underline">Delete</button>
              </div>
            </div>
            {open === s.id && <EntryEditor segmentId={s.id} onChange={load} />}
          </div>
        ))}
        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
      </section>
    </div>
  )
}

function EntryEditor({ segmentId, onChange }: { segmentId: string; onChange: () => void }) {
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [kind, setKind] = useState<Kind>('all_contacts')
  const [months, setMonths] = useState<number>(12)
  const [extRaw, setExtRaw] = useState('')
  const [indRaw, setIndRaw] = useState('')
  const [preview, setPreview] = useState<{ total: number; per_entry: Array<{ entry_id: string; count: number }> } | null>(null)
  const [error, setError] = useState('')

  async function load() {
    try {
      const d = await api.getSegment(segmentId)
      setEntries(d.entries as EntryRow[])
      const p = await api.previewSegment(segmentId)
      setPreview(p)
    } catch (e) { setError(e instanceof HttpError ? e.message : 'Load failed') }
  }
  useEffect(() => { load() }, [segmentId]) // eslint-disable-line

  async function add() {
    let params: Record<string, unknown> = {}
    try {
      if (kind === 'recent_donors') params = { months }
      if (kind === 'individuals') {
        const ids = indRaw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
        if (!ids.length) throw new Error('Paste contact UUIDs')
        params = { contact_ids: ids }
      }
      if (kind === 'external_list') {
        const people = extRaw.split('\n').map(line => {
          const [email, ...rest] = line.split(',').map(s => s.trim())
          return { email: email || '', name: rest.join(' ') }
        }).filter(p => p.email.includes('@'))
        if (!people.length) throw new Error('One email per line')
        params = { people }
      }
      await api.addSegmentEntry(segmentId, { kind, params })
      setIndRaw(''); setExtRaw('')
      await load(); onChange()
    } catch (e) { setError(e instanceof HttpError ? e.message : (e as Error).message) }
  }
  async function del(entryId: string) {
    try { await api.deleteSegmentEntry(segmentId, entryId); await load(); onChange() }
    catch (e) { setError(e instanceof HttpError ? e.message : 'Delete failed') }
  }
  const byEntry = Object.fromEntries((preview?.per_entry || []).map(p => [p.entry_id, p.count]))

  return (
    <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
      <p className="text-xs opacity-60">Entries — resolve together to an approximate <b className="text-yellow-400">{preview?.total ?? '…'}</b> recipients.</p>
      {entries.map(e => (
        <div key={e.id} className="flex items-center justify-between rounded-lg bg-black/30 px-3 py-2 text-xs">
          <span>{KIND_LABELS[e.kind]} · ~{byEntry[e.id] ?? '?'}</span>
          <button onClick={() => del(e.id)} className="text-red-400 hover:underline">Remove</button>
        </div>
      ))}
      <div className="rounded-lg border border-dashed border-white/15 p-2 space-y-2 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <select value={kind} onChange={e => setKind(e.target.value as Kind)}
            className="rounded px-2 py-1 bg-black/40 border border-white/10">
            {(Object.keys(KIND_LABELS) as Kind[]).map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
          {kind === 'recent_donors' && (
            <label className="flex items-center gap-1">
              <span>Months:</span>
              <input type="number" min={1} max={60} value={months}
                onChange={e => setMonths(Number(e.target.value))}
                className="w-16 rounded px-1 py-0.5 bg-black/40 border border-white/10" />
            </label>
          )}
          <button onClick={add} className="ml-auto rounded bg-yellow-500 text-black px-3 py-1 font-bold">Add entry</button>
        </div>
        {kind === 'external_list' && (
          <textarea value={extRaw} onChange={e => setExtRaw(e.target.value)} rows={3}
            placeholder="One per line: email,optional name"
            className="w-full rounded px-2 py-1 bg-black/40 border border-white/10 font-mono" />
        )}
        {kind === 'individuals' && (
          <textarea value={indRaw} onChange={e => setIndRaw(e.target.value)} rows={2}
            placeholder="Contact UUIDs, comma or newline separated"
            className="w-full rounded px-2 py-1 bg-black/40 border border-white/10 font-mono" />
        )}
      </div>
      {error && <p className="text-red-400">{error}</p>}
    </div>
  )
}
