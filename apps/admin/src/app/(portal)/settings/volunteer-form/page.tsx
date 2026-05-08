'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Field {
  key: string
  default: string
  override: string | null
  effective: string
  description: string
  kind: 'heading' | 'paragraph' | 'label' | 'placeholder' | 'button'
  group: string
  updated_by_name: string
  updated_at: string | null
}

const KIND_LABEL: Record<Field['kind'], string> = {
  heading:     'Heading',
  paragraph:   'Paragraph',
  label:       'Label',
  placeholder: 'Placeholder',
  button:      'Button',
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}

export default function VolunteerFormTextPage() {
  const [fields, setFields] = useState<Field[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [editing, setEditing] = useState<Field | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await apiFetch<{ fields: Field[] }>(`/admin/form-config/volunteer_registration`)
      setFields(data.fields || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function openEdit(f: Field) {
    setEditing(f)
    setDraft(f.override ?? f.default)
    setError(''); setSuccess('')
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    try {
      // Encode the field_key (it has dots) — Express/FastAPI :path catch
      // already handles dots, but encode just in case.
      await apiFetch(`/admin/form-config/volunteer_registration/${encodeURI(editing.key)}`, {
        method: 'PUT', body: JSON.stringify({ text: draft }),
      })
      setEditing(null)
      setSuccess(`Saved "${editing.key}"`)
      setTimeout(() => setSuccess(''), 3000)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally { setSaving(false) }
  }

  async function reset(f: Field) {
    if (!confirm(`Revert "${f.key}" to default?`)) return
    try {
      await apiFetch(`/admin/form-config/volunteer_registration/${encodeURI(f.key)}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset')
    }
  }

  // Group fields by .group
  const groups: Record<string, Field[]> = {}
  for (const f of fields) {
    const g = f.group || 'Other'
    if (!groups[g]) groups[g] = []
    groups[g].push(f)
  }
  const customisedCount = fields.filter(f => f.override !== null).length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Volunteer Form Text</h1>
          <p className="text-white/40 mt-1">
            Edit the copy on <code className="text-saffron-300">service.shital.org.uk/?screen=volunteer</code>.
            Changes go live immediately. Empty / default text reverts to the original.
          </p>
        </div>
        <a href="https://service.shital.org.uk/?screen=volunteer" target="_blank" rel="noopener"
          className="px-4 py-2 rounded-xl border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/5">
          Preview public form ↗
        </a>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}
      {success && <div className="bg-green-500/10 border border-green-500/30 text-green-300 px-4 py-3 rounded-xl text-sm">{success}</div>}

      {!loading && (
        <div className="glass rounded-2xl p-5 border border-saffron-400/20">
          <p className="text-saffron-400 text-xs font-bold uppercase tracking-widest mb-1">Status</p>
          <p className="text-white text-sm">
            <strong className="text-saffron-300">{customisedCount}</strong> of <strong>{fields.length}</strong> fields customised.
            {customisedCount > 0 && ' Click any field to view its custom text + revert.'}
          </p>
        </div>
      )}

      {loading && <div className="text-white/40 p-8">Loading form fields…</div>}

      {!loading && Object.entries(groups).map(([groupName, groupFields]) => (
        <div key={groupName} className="glass rounded-2xl p-5">
          <h2 className="font-black text-white text-lg mb-4">{groupName}</h2>
          <div className="space-y-2">
            {groupFields.map(f => (
              <div key={f.key} onClick={() => openEdit(f)}
                className="p-3 rounded-xl bg-white/3 border border-white/5 hover:bg-white/5 cursor-pointer transition-colors">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-white/10 text-white/60">
                      {KIND_LABEL[f.kind]}
                    </span>
                    <code className="text-saffron-300 text-xs">{f.key}</code>
                    {f.override !== null && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-saffron-400/20 text-saffron-300 border border-saffron-400/30">
                        ✏ Customised
                      </span>
                    )}
                  </div>
                  {f.override !== null && (
                    <button onClick={e => { e.stopPropagation(); reset(f) }}
                      className="text-red-400/60 hover:text-red-400 text-xs">Revert</button>
                  )}
                </div>
                {f.description && <p className="text-white/40 text-xs mb-2">{f.description}</p>}
                <p className="text-white/85 text-sm whitespace-pre-wrap">{f.effective}</p>
                {f.override !== null && f.updated_by_name && (
                  <p className="text-white/30 text-xs italic mt-2">
                    Last edited by {f.updated_by_name} {fmtDate(f.updated_at)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <AnimatePresence>
        {editing && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setEditing(null)} className="fixed inset-0 bg-black/70 z-40" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="fixed inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 top-1/2 -translate-y-1/2 z-50 max-w-2xl w-full sm:w-[640px] bg-temple-deep border border-white/10 rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <p className="text-saffron-300 text-xs font-mono mb-1">{editing.key}</p>
                  <h2 className="text-white font-black text-lg">{KIND_LABEL[editing.kind]}</h2>
                  <p className="text-white/50 text-xs mt-1">{editing.description}</p>
                </div>
                <button onClick={() => setEditing(null)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>

              <div className="rounded-xl bg-white/3 border border-white/5 p-3 mb-4">
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-wide mb-1">Default text</p>
                <p className="text-white/70 text-sm whitespace-pre-wrap">{editing.default}</p>
              </div>

              <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5">Override text</label>
              {editing.kind === 'paragraph' || editing.default.length > 80 ? (
                <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={6}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50 resize-y" />
              ) : (
                <input value={draft} onChange={e => setDraft(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50" />
              )}
              <p className="text-white/40 text-xs mt-2">
                Tip: matching the default exactly will clear the override (clean revert).
              </p>

              <div className="flex gap-3 mt-5">
                <button onClick={() => setEditing(null)}
                  className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm font-semibold">Cancel</button>
                {editing.override !== null && (
                  <button onClick={() => { setDraft(editing.default) }}
                    className="px-4 py-2.5 rounded-xl border border-red-500/30 text-red-400 text-sm font-semibold hover:bg-red-500/10">
                    Use default
                  </button>
                )}
                <button onClick={save} disabled={saving}
                  className="flex-[2] py-2.5 rounded-xl bg-saffron-gradient text-white text-sm font-black disabled:opacity-40">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
