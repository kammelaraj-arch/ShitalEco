'use client'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

interface Template {
  id: string
  template_key: string
  name: string
  subject: string
  html_body: string
  text_body: string
  variables: string[]
  is_active: boolean
  updated_at: string
}

const TAB_LABELS = ['Subject & HTML', 'Plain Text', 'Preview']

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Template | null>(null)
  const [draft, setDraft] = useState<Partial<Template>>({})
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    fetch(`${API}/admin/email-templates`)
      .then(r => r.json())
      .then(d => { setTemplates(d.templates || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const selectTemplate = (t: Template) => {
    setSelected(t)
    setDraft({ subject: t.subject, html_body: t.html_body, text_body: t.text_body, name: t.name })
    setTab(0)
    setError('')
    setSuccess('')
  }

  const save = async () => {
    if (!selected) return
    setSaving(true); setError(''); setSuccess('')
    try {
      const res = await fetch(`${API}/admin/email-templates/${selected.template_key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      setTemplates(prev => prev.map(t => t.template_key === updated.template_key ? updated : t))
      setSelected(updated)
      setSuccess('Template saved successfully!')
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async () => {
    if (!selected || !testEmail.includes('@')) { setError('Enter a valid email for test'); return }
    setTesting(true); setError(''); setSuccess('')
    try {
      const res = await fetch(`${API}/admin/email-templates/test-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail, template_key: selected.template_key }),
      })
      const data = await res.json()
      if (data.sent) setSuccess(`Test email sent to ${testEmail}`)
      else setError(data.reason || data.error || 'Failed to send test email')
    } catch (e) {
      setError(String(e))
    } finally {
      setTesting(false)
    }
  }

  const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-crimson-700/50 transition-colors'

  return (
    <div className="flex gap-6 h-[calc(100vh-96px)]">
      {/* ── Template list ── */}
      <div className="w-64 flex-shrink-0 space-y-2">
        <h2 className="text-white font-black text-sm uppercase tracking-wider px-1 mb-3">Templates</h2>
        {loading ? (
          <p className="text-white/30 text-sm px-1">Loading…</p>
        ) : templates.map(t => (
          <button key={t.template_key} onClick={() => selectTemplate(t)}
            className={`w-full text-left px-4 py-3 rounded-xl transition-all border ${
              selected?.template_key === t.template_key
                ? 'border-crimson-700/50 bg-crimson-700/10 text-white'
                : 'border-transparent text-white/60 hover:text-white hover:bg-white/5'
            }`}>
            <p className="font-bold text-sm">{t.name}</p>
            <p className="text-[11px] text-white/30 font-mono mt-0.5">{t.template_key}</p>
          </button>
        ))}
      </div>

      {/* ── Editor ── */}
      <div className="flex-1 min-w-0 flex flex-col glass rounded-2xl border border-temple-border overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-4xl mb-3">📧</p>
              <p className="text-white/40">Select a template to edit</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-white font-black text-lg">{selected.name}</h2>
                <p className="text-white/30 text-xs font-mono">{selected.template_key}</p>
              </div>
              <div className="flex items-center gap-3">
                <input value={testEmail} onChange={e => setTestEmail(e.target.value)}
                  placeholder="test@example.com"
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-crimson-700/40 w-48" />
                <button onClick={sendTest} disabled={testing}
                  className="px-4 py-2 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:text-white hover:bg-white/5 disabled:opacity-40">
                  {testing ? 'Sending…' : '📤 Test'}
                </button>
                <button onClick={save} disabled={saving}
                  className="px-5 py-2 rounded-xl font-black text-white text-sm disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            {/* Alerts */}
            <AnimatePresence>
              {(error || success) && (
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className={`mx-6 mt-4 px-4 py-3 rounded-xl text-sm font-medium flex-shrink-0 ${
                    error ? 'bg-red-500/10 border border-red-500/30 text-red-300' : 'bg-green-500/10 border border-green-500/30 text-green-300'
                  }`}>
                  {error || success}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Variables pill row */}
            <div className="px-6 py-3 flex gap-2 flex-wrap flex-shrink-0">
              <span className="text-white/30 text-xs pt-0.5">Variables:</span>
              {(selected.variables || []).map(v => (
                <code key={v} className="px-2 py-0.5 rounded-md bg-white/5 text-white/50 text-[11px] font-mono border border-white/5">
                  {'{{ '}{ v }{'  }}'}
                </code>
              ))}
            </div>

            {/* Subject */}
            <div className="px-6 pb-3 flex-shrink-0">
              <label className="block text-white/40 text-xs font-semibold uppercase tracking-wide mb-1.5">Subject Line</label>
              <input value={draft.subject || ''} onChange={e => setDraft(p => ({ ...p, subject: e.target.value }))}
                className={inp} placeholder="e.g. Your donation receipt — {{ order_ref }}" />
            </div>

            {/* Tab switcher */}
            <div className="flex px-6 gap-1 flex-shrink-0 border-b border-white/5 pb-0">
              {TAB_LABELS.map((label, i) => (
                <button key={i} onClick={() => setTab(i)}
                  className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-colors ${
                    tab === i ? 'text-white border-b-2 border-crimson-700' : 'text-white/40 hover:text-white/70'
                  }`}>{label}</button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-6 min-h-0">
              {tab === 0 && (
                <textarea
                  value={draft.html_body || ''}
                  onChange={e => setDraft(p => ({ ...p, html_body: e.target.value }))}
                  className="w-full h-full min-h-[400px] bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white/80 text-xs font-mono outline-none focus:border-crimson-700/40 resize-none leading-relaxed"
                  placeholder="HTML email body — supports Jinja2 {{ variables }}"
                  spellCheck={false}
                />
              )}
              {tab === 1 && (
                <textarea
                  value={draft.text_body || ''}
                  onChange={e => setDraft(p => ({ ...p, text_body: e.target.value }))}
                  className="w-full h-full min-h-[400px] bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white/80 text-sm font-mono outline-none focus:border-crimson-700/40 resize-none leading-relaxed"
                  placeholder="Plain text fallback — supports Jinja2 {{ variables }}"
                  spellCheck={false}
                />
              )}
              {tab === 2 && (
                <div className="bg-white rounded-2xl overflow-hidden h-full min-h-[400px]">
                  <div className="bg-gray-100 px-4 py-2 text-xs text-gray-500 font-mono border-b border-gray-200">
                    Preview (rendered with sample data)
                  </div>
                  <iframe
                    srcDoc={renderPreview(draft.html_body || '')}
                    className="w-full h-full border-0"
                    title="Email preview"
                    sandbox="allow-same-origin"
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function renderPreview(html: string): string {
  // Replace Jinja2 variables with sample values for preview
  const samples: Record<string, string> = {
    'order_ref': 'ORD-A1B2C3D4',
    'customer_name': 'Priya Patel',
    'total': '51.00',
    'branch_name': 'Shital Temple Wembley',
    'date': '4 April 2026',
  }
  let result = html
  // Replace {{ var }} patterns
  result = result.replace(/\{\{\s*([^}|%]+?)\s*\}\}/g, (_, key) => {
    const k = key.trim().split('|')[0].trim().split(' or ')[0].trim()
    return samples[k] ?? `[${k}]`
  })
  // Replace simple for loops with sample data
  result = result.replace(/\{%\s*for item in items\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/g, (_match, body) => {
    return body
      .replace(/\{\{\s*item\.name\s*\}\}/g, 'General Donation')
      .replace(/\{\{\s*item\.quantity\s*\}\}/g, '1')
      .replace(/\{\{.*?format\(item\.unitPrice.*?\)\s*\}\}/g, '51.00')
  })
  // Strip remaining Jinja2 tags
  result = result.replace(/\{%[^%]*%\}/g, '').replace(/\{\{[^}]*\}\}/g, '[value]')
  return result
}
