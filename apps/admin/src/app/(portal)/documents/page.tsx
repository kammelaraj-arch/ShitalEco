'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Document {
  id: string
  title: string
  category: string
  description: string
  file_url: string
  file_name: string
  file_size: number
  mime_type: string
  uploaded_by: string
  version: string
  review_due: string
  tags: string
  created_at: string
}

interface DocForm {
  title: string
  category: string
  description: string
  file_url: string
  file_name: string
  file_size: string
  mime_type: string
  version: string
  review_due: string
  tags: string
}

const CATEGORIES = [
  { id: 'POLICY',     label: 'Policy',      icon: '📋' },
  { id: 'FINANCE',    label: 'Finance',     icon: '💰' },
  { id: 'HR',         label: 'HR',          icon: '👥' },
  { id: 'COMPLIANCE', label: 'Compliance',  icon: '⚖️' },
  { id: 'LEGAL',      label: 'Legal',       icon: '⚡' },
  { id: 'GOVERNANCE', label: 'Governance',  icon: '🏛️' },
  { id: 'GENERAL',    label: 'General',     icon: '📁' },
]

const CAT_COLORS: Record<string, string> = {
  POLICY:     'bg-blue-500/20 text-blue-400 border-blue-500/30',
  FINANCE:    'bg-green-500/20 text-green-400 border-green-500/30',
  HR:         'bg-purple-500/20 text-purple-400 border-purple-500/30',
  COMPLIANCE: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  LEGAL:      'bg-red-500/20 text-red-400 border-red-500/30',
  GOVERNANCE: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  GENERAL:    'bg-white/10 text-white/50 border-white/10',
}

const EMPTY_FORM: DocForm = {
  title: '', category: 'GENERAL', description: '', file_url: '', file_name: '',
  file_size: '', mime_type: '', version: '1.0', review_due: '', tags: '',
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-saffron-400/50'
const lbl = 'block text-white/50 text-xs font-semibold uppercase tracking-wide mb-1.5'

function fmtSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeCategory, setActiveCategory] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<DocForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = activeCategory ? `?category=${activeCategory}` : ''
      const res = await apiFetch<{ documents: Document[] }>(`/documents${params}`)
      setDocs(res.documents || [])
    } catch {
      setError('Failed to load documents')
    } finally { setLoading(false) }
  }, [activeCategory])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await apiFetch('/documents', {
        method: 'POST',
        body: JSON.stringify({ ...form, file_size: parseInt(form.file_size) || 0 }),
      })
      setShowForm(false)
      setForm(EMPTY_FORM)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save document')
    } finally { setSaving(false) }
  }

  const del = async (id: string) => {
    if (!confirm('Delete this document?')) return
    setDeleting(id)
    try {
      await apiFetch(`/documents/${id}`, { method: 'DELETE' })
      await load()
    } catch {
      setError('Failed to delete document')
    } finally { setDeleting(null) }
  }

  // Count per category (from all docs regardless of filter)
  const [allDocs, setAllDocs] = useState<Document[]>([])
  useEffect(() => {
    apiFetch<{ documents: Document[] }>('/documents')
      .then(r => setAllDocs(r.documents || []))
      .catch(() => {})
  }, [docs])

  const countFor = (catId: string) => allDocs.filter(d => d.category === catId).length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Documents</h1>
          <p className="text-white/40 mt-1">Temple documents and compliance files — live from database</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="px-5 py-2.5 rounded-xl bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90">
          + Upload Document
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}

      <div className="flex flex-col md:flex-row gap-4">
        {/* Category sidebar */}
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
          className="hidden md:block w-52 flex-shrink-0 space-y-1">
          <button onClick={() => setActiveCategory('')}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
              activeCategory === '' ? 'bg-saffron-400/15 text-saffron-400 border border-saffron-400/30' : 'text-white/50 hover:text-white/80 hover:bg-white/5'
            }`}>
            <span>📂</span>
            <span className="flex-1">All Documents</span>
            <span className="text-xs text-white/30">{allDocs.length}</span>
          </button>
          {CATEGORIES.map(cat => (
            <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                activeCategory === cat.id ? 'bg-saffron-400/15 text-saffron-400 border border-saffron-400/30' : 'text-white/50 hover:text-white/80 hover:bg-white/5'
              }`}>
              <span>{cat.icon}</span>
              <span className="flex-1">{cat.label}</span>
              <span className="text-xs text-white/30">{countFor(cat.id)}</span>
            </button>
          ))}
        </motion.div>

        {/* Document list */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex-1">
          {loading ? (
            <div className="glass rounded-2xl p-6 text-center text-white/30 py-16">Loading documents…</div>
          ) : docs.length === 0 ? (
            <div className="glass rounded-2xl p-6 min-h-[400px] flex flex-col items-center justify-center">
              <p className="text-6xl mb-4">📁</p>
              <p className="text-white/40 text-lg font-semibold">No documents in this category</p>
              <p className="text-white/20 text-sm mt-1">Upload documents to organise and share with your team</p>
              <button onClick={() => setShowForm(true)}
                className="mt-6 px-6 py-3 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/5 transition-all">
                Upload First Document
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {docs.map((doc, i) => (
                <motion.div key={doc.id}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="glass rounded-xl p-4 border border-temple-border hover:border-white/15 transition-all group">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-xl flex-shrink-0">
                      {CATEGORIES.find(c => c.id === doc.category)?.icon || '📄'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-white font-semibold text-sm">{doc.title}</h3>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${CAT_COLORS[doc.category] || CAT_COLORS.GENERAL}`}>
                          {doc.category}
                        </span>
                        <span className="text-xs text-white/30 bg-white/5 px-2 py-0.5 rounded-full">v{doc.version}</span>
                      </div>
                      {doc.description && <p className="text-white/40 text-xs mt-1 truncate">{doc.description}</p>}
                      <div className="flex items-center gap-4 mt-2 flex-wrap">
                        {doc.file_name && (
                          <span className="text-white/40 text-xs flex items-center gap-1">
                            📎 {doc.file_name}{doc.file_size ? ` (${fmtSize(doc.file_size)})` : ''}
                          </span>
                        )}
                        {doc.review_due && (
                          <span className="text-amber-400/70 text-xs">Review: {new Date(doc.review_due).toLocaleDateString('en-GB')}</span>
                        )}
                        {doc.tags && (
                          <span className="text-white/30 text-xs">{doc.tags}</span>
                        )}
                        <span className="text-white/20 text-xs">
                          {doc.created_at ? new Date(doc.created_at).toLocaleDateString('en-GB') : ''}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      {doc.file_url && (
                        <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                          className="text-saffron-400 text-xs font-semibold hover:text-saffron-300 transition-colors">Open</a>
                      )}
                      <button onClick={() => del(doc.id)} disabled={deleting === doc.id}
                        className="text-white/30 hover:text-red-400 text-xs font-semibold transition-colors disabled:opacity-40">
                        {deleting === doc.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* Upload Document slide-over */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 h-full w-[500px] bg-temple-deep border-l border-temple-border z-50 flex flex-col overflow-hidden">
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-black text-lg">Upload Document</h2>
                <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div>
                  <label className={lbl}>Title *</label>
                  <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inp} placeholder="e.g. Safeguarding Policy 2026" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Category</label>
                    <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inp}>
                      {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Version</label>
                    <input value={form.version} onChange={e => setForm(p => ({ ...p, version: e.target.value }))} className={inp} placeholder="1.0" />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Description</label>
                  <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} className={inp + ' resize-none'} />
                </div>
                <div>
                  <label className={lbl}>File URL</label>
                  <input value={form.file_url} onChange={e => setForm(p => ({ ...p, file_url: e.target.value }))} className={inp} placeholder="https://storage.example.com/file.pdf" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>File Name</label>
                    <input value={form.file_name} onChange={e => setForm(p => ({ ...p, file_name: e.target.value }))} className={inp} placeholder="safeguarding-policy.pdf" />
                  </div>
                  <div>
                    <label className={lbl}>File Size (bytes)</label>
                    <input type="number" min="0" value={form.file_size} onChange={e => setForm(p => ({ ...p, file_size: e.target.value }))} className={inp} placeholder="0" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>MIME Type</label>
                    <input value={form.mime_type} onChange={e => setForm(p => ({ ...p, mime_type: e.target.value }))} className={inp} placeholder="application/pdf" />
                  </div>
                  <div>
                    <label className={lbl}>Review Due</label>
                    <input type="date" value={form.review_due} onChange={e => setForm(p => ({ ...p, review_due: e.target.value }))} className={inp} />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Tags</label>
                  <input value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))} className={inp} placeholder="charity, compliance, 2026" />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/5 flex gap-3">
                <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border border-white/10 text-white/60 font-semibold text-sm">Cancel</button>
                <button onClick={save} disabled={saving || !form.title.trim()}
                  className="flex-[2] py-3 rounded-xl bg-saffron-gradient text-white font-black text-sm disabled:opacity-40">
                  {saving ? 'Saving…' : 'Upload Document'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
