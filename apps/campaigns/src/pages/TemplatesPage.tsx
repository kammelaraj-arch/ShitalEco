// Marketing email templates — reusable bodies with {{ merge_variable }}
// placeholders. Distinct from admin→email-templates which holds the
// transactional templates (receipts etc.).

import { useEffect, useState } from 'react'
import { api, HttpError } from '../api'

type Status   = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
type Category = 'newsletter' | 'appeal' | 'event' | 'welcome' | 'thank-you' | 'general'

interface TemplateListRow {
  id: string
  name: string
  subject: string
  category: Category
  status: Status
  variables: string[]
  updated_at: string
}
interface TemplateFull extends TemplateListRow {
  html_body: string
  text_body: string
}

const CATEGORY_OPTS: Category[] = ['newsletter', 'appeal', 'event', 'welcome', 'thank-you', 'general']

export function TemplatesPage() {
  const [items, setItems] = useState<TemplateListRow[]>([])
  const [editing, setEditing] = useState<TemplateFull | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ subject: string; html_body: string; text_body: string } | null>(null)

  async function load() {
    try { setItems((await api.listTemplates()).items) }
    catch (e) { setError(e instanceof HttpError ? e.message : 'Load failed') }
  }
  useEffect(() => { load() }, [])

  async function open(id: string) {
    try { const r = await api.getTemplate(id); setEditing(r.template); setPreview(null) }
    catch (e) { setError(e instanceof HttpError ? e.message : 'Open failed') }
  }

  async function createNew(name: string) {
    try {
      const r = await api.createTemplate({ name, category: 'general' })
      await load()
      await open(r.id)
      setCreating(false)
    } catch (e) { setError(e instanceof HttpError ? e.message : 'Create failed') }
  }

  async function save() {
    if (!editing) return
    try {
      await api.updateTemplate(editing.id, {
        name: editing.name, subject: editing.subject,
        html_body: editing.html_body, text_body: editing.text_body,
        category: editing.category, status: editing.status,
      })
      await load()
      const r = await api.getTemplate(editing.id); setEditing(r.template)
    } catch (e) { setError(e instanceof HttpError ? e.message : 'Save failed') }
  }
  async function doPreview() {
    if (!editing) return
    try { setPreview(await api.previewTemplate(editing.id, {})) }
    catch (e) { setError(e instanceof HttpError ? e.message : 'Preview failed') }
  }
  async function archive() {
    if (!editing) return
    if (!confirm('Archive this template?')) return
    try { await api.archiveTemplate(editing.id); setEditing(null); await load() }
    catch (e) { setError(e instanceof HttpError ? e.message : 'Archive failed') }
  }

  return (
    <div className="p-6 max-w-5xl grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* List */}
      <section className="lg:col-span-1 space-y-2">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">Templates</h2>
          <button onClick={() => setCreating(true)} className="text-xs text-yellow-400 hover:underline">+ New</button>
        </div>
        {creating && <CreateRow onCreate={createNew} onCancel={() => setCreating(false)} />}
        {items.length === 0 && !creating && <p className="text-sm opacity-50">No templates yet.</p>}
        {items.map(t => (
          <button key={t.id} onClick={() => open(t.id)}
            className={`w-full text-left rounded-lg border p-3 transition-colors ${
              editing?.id === t.id
                ? 'border-yellow-500/50 bg-yellow-500/10'
                : 'border-white/10 bg-white/5 hover:bg-white/10'
            }`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm">{t.name}</span>
              <StatusPill status={t.status} />
            </div>
            <p className="text-xs opacity-60 mt-1">{t.subject || <em>(no subject)</em>}</p>
            <p className="text-[11px] opacity-50 mt-0.5">
              {t.category} · {t.variables.length ? `{{ ${t.variables.join(' / ')} }}` : 'no variables'}
            </p>
          </button>
        ))}
      </section>

      {/* Editor */}
      <section className="lg:col-span-2">
        {!editing && (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-8 text-sm opacity-60 text-center">
            Pick a template to edit, or hit <b>+ New</b>.
          </div>
        )}
        {editing && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <input value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="Template name"
                className="flex-1 rounded-lg px-3 py-2 text-sm bg-black/40 border border-white/10 outline-none focus:border-yellow-500" />
              <select value={editing.category}
                onChange={e => setEditing({ ...editing, category: e.target.value as Category })}
                className="rounded-lg px-2 py-2 text-sm bg-black/40 border border-white/10">
                {CATEGORY_OPTS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={editing.status}
                onChange={e => setEditing({ ...editing, status: e.target.value as Status })}
                className="rounded-lg px-2 py-2 text-sm bg-black/40 border border-white/10">
                <option value="DRAFT">DRAFT</option>
                <option value="PUBLISHED">PUBLISHED</option>
                <option value="ARCHIVED">ARCHIVED</option>
              </select>
            </div>
            <input value={editing.subject}
              onChange={e => setEditing({ ...editing, subject: e.target.value })}
              placeholder="Subject (supports {{ first_name }})"
              className="w-full rounded-lg px-3 py-2 text-sm bg-black/40 border border-white/10 outline-none focus:border-yellow-500" />
            <textarea value={editing.html_body}
              onChange={e => setEditing({ ...editing, html_body: e.target.value })}
              rows={10}
              placeholder="HTML body — basic tags allowed (p/strong/em/a/ul/ol/li/h2-4). Use {{ first_name }} / {{ amount }} etc."
              className="w-full rounded-lg px-3 py-2 text-xs font-mono bg-black/40 border border-white/10 outline-none focus:border-yellow-500 resize-y" />
            <textarea value={editing.text_body}
              onChange={e => setEditing({ ...editing, text_body: e.target.value })}
              rows={4}
              placeholder="Plain-text fallback (optional). Same {{ vars }} apply."
              className="w-full rounded-lg px-3 py-2 text-xs font-mono bg-black/40 border border-white/10 outline-none focus:border-yellow-500 resize-y" />
            {editing.variables?.length > 0 && (
              <p className="text-[11px] opacity-60">
                Detected variables: <code>{editing.variables.map(v => `{{ ${v} }}`).join(' · ')}</code>
              </p>
            )}
            <div className="flex items-center gap-2">
              <button onClick={save}
                className="rounded-lg bg-yellow-500 text-black px-3 py-2 text-sm font-bold">Save</button>
              <button onClick={doPreview}
                className="rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 px-3 py-2 text-sm">
                Preview
              </button>
              <div className="flex-1" />
              <button onClick={archive}
                className="rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 px-3 py-2 text-sm">
                Archive
              </button>
            </div>

            {preview && (
              <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3">
                <p className="text-[11px] opacity-60 uppercase tracking-widest mb-1">Preview</p>
                <p className="text-sm font-bold mb-2">{preview.subject}</p>
                <div className="prose prose-sm prose-invert max-w-none"
                     dangerouslySetInnerHTML={{ __html: preview.html_body }} />
              </div>
            )}
          </div>
        )}
      </section>
      {error && <p className="col-span-full text-xs text-red-400">{error}</p>}
    </div>
  )
}

function StatusPill({ status }: { status: Status }) {
  const cls =
    status === 'PUBLISHED' ? 'bg-green-500/15 text-green-300' :
    status === 'ARCHIVED'  ? 'bg-gray-500/15 text-gray-400' :
                             'bg-amber-500/15 text-amber-300'
  return <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${cls}`}>{status}</span>
}

function CreateRow({ onCreate, onCancel }: { onCreate: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  return (
    <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-2 flex items-center gap-2">
      <input value={name} onChange={e => setName(e.target.value)} autoFocus
        placeholder="Template name" className="flex-1 rounded px-2 py-1 bg-black/40 border border-white/10 text-sm" />
      <button onClick={() => name.trim() && onCreate(name.trim())}
        disabled={!name.trim()} className="text-xs rounded bg-yellow-500 text-black px-2 py-1 font-bold disabled:opacity-50">
        Create
      </button>
      <button onClick={onCancel} className="text-xs text-white/60">×</button>
    </div>
  )
}
