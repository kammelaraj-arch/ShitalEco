'use client'
import { useState, useRef } from 'react'
import { useBranding, BrandingConfig } from '@/lib/branding'

const COLOR_PRESETS = [
  { name: 'Shital Crimson',  primary: '#B91C1C', accent: '#FFD700' },
  { name: 'Temple Saffron',  primary: '#FF9933', accent: '#FFD700' },
  { name: 'Royal Navy',      primary: '#1E3A5F', accent: '#FFD700' },
  { name: 'Forest Green',    primary: '#166534', accent: '#86EFAC' },
  { name: 'Peacock Blue',    primary: '#0E7490', accent: '#FDE68A' },
  { name: 'Deep Maroon',     primary: '#7f1010', accent: '#FCD34D' },
]

export default function BrandingPage() {
  const { branding, setBranding } = useBranding()
  const [draft, setDraft] = useState<BrandingConfig>({ ...branding })
  const [saved, setSaved] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function handleSave() {
    setBranding(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setUploadError('Image must be under 2MB'); return }
    setUploadError('')
    const reader = new FileReader()
    reader.onload = ev => {
      const url = ev.target?.result as string
      setDraft(d => ({ ...d, logoUrl: url }))
    }
    reader.readAsDataURL(file)
  }

  const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-crimson-700/50 focus:ring-1 focus:ring-crimson-700/20'

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-black text-white">🎨 Branding Settings</h1>
        <p className="text-white/40 mt-1 text-sm">Customise the logo, organisation name and colour scheme.</p>
      </div>

      {/* Logo */}
      <section className="glass rounded-2xl p-6 space-y-4">
        <h2 className="text-white font-black text-lg">Organisation Logo</h2>

        {/* Preview */}
        <div className="flex items-center gap-4 p-4 rounded-xl" style={{ background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.18)' }}>
          {draft.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.logoUrl} alt="logo preview" className="h-14 w-14 rounded-xl object-contain"
              style={{ background: 'rgba(185,28,28,0.15)', padding: '3px' }}
              onError={e => { (e.currentTarget as HTMLImageElement).src = '' }} />
          ) : (
            <div className="h-14 w-14 rounded-xl flex items-center justify-center text-2xl"
              style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
              🛕
            </div>
          )}
          <div>
            <p className="text-white font-black text-base">{draft.orgName || 'Organisation Name'}</p>
            <p className="text-white/40 text-xs">{draft.orgSubtitle || 'Admin Portal'}</p>
          </div>
        </div>

        {/* Upload file */}
        <div>
          <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Upload Logo Image</label>
          <div className="flex gap-3 items-center">
            <button
              onClick={() => fileRef.current?.click()}
              className="px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}
            >
              📁 Choose File
            </button>
            <span className="text-white/30 text-xs">PNG, JPG, SVG — max 2MB</span>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </div>
          {uploadError && <p className="text-red-400 text-xs mt-2">{uploadError}</p>}
        </div>

        {/* Or paste URL */}
        <div>
          <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Or Paste Logo URL</label>
          <input
            type="url"
            value={draft.logoUrl.startsWith('data:') ? '' : draft.logoUrl}
            onChange={e => setDraft(d => ({ ...d, logoUrl: e.target.value }))}
            placeholder="https://example.com/logo.png"
            className={inp}
          />
        </div>

        {draft.logoUrl && (
          <button onClick={() => setDraft(d => ({ ...d, logoUrl: '' }))}
            className="text-red-400 text-xs hover:text-red-300 transition-colors">
            ✕ Remove logo (use default icon)
          </button>
        )}
      </section>

      {/* Organisation details */}
      <section className="glass rounded-2xl p-6 space-y-4">
        <h2 className="text-white font-black text-lg">Organisation Details</h2>
        <div>
          <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Organisation Name</label>
          <input value={draft.orgName} onChange={e => setDraft(d => ({ ...d, orgName: e.target.value }))}
            placeholder="Shital Temple" className={inp} />
        </div>
        <div>
          <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Subtitle / Role</label>
          <input value={draft.orgSubtitle} onChange={e => setDraft(d => ({ ...d, orgSubtitle: e.target.value }))}
            placeholder="Admin Portal" className={inp} />
        </div>
      </section>

      {/* Colours */}
      <section className="glass rounded-2xl p-6 space-y-4">
        <h2 className="text-white font-black text-lg">Colour Scheme</h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {COLOR_PRESETS.map(p => (
            <button
              key={p.name}
              onClick={() => setDraft(d => ({ ...d, primaryColor: p.primary, accentColor: p.accent }))}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all text-left"
              style={{
                borderColor: draft.primaryColor === p.primary ? p.primary : 'rgba(255,255,255,0.1)',
                background: draft.primaryColor === p.primary ? `${p.primary}22` : 'rgba(255,255,255,0.03)',
              }}
            >
              <div className="w-6 h-6 rounded-full flex-shrink-0" style={{ background: `linear-gradient(135deg,${p.primary},${p.accent})` }} />
              <span className="text-white/70 text-xs font-medium">{p.name}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Primary Colour</label>
            <div className="flex gap-2 items-center">
              <input type="color" value={draft.primaryColor}
                onChange={e => setDraft(d => ({ ...d, primaryColor: e.target.value }))}
                className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent" />
              <input type="text" value={draft.primaryColor}
                onChange={e => setDraft(d => ({ ...d, primaryColor: e.target.value }))}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Accent Colour</label>
            <div className="flex gap-2 items-center">
              <input type="color" value={draft.accentColor}
                onChange={e => setDraft(d => ({ ...d, accentColor: e.target.value }))}
                className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent" />
              <input type="text" value={draft.accentColor}
                onChange={e => setDraft(d => ({ ...d, accentColor: e.target.value }))}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none font-mono" />
            </div>
          </div>
        </div>
      </section>

      <button
        onClick={handleSave}
        className="w-full py-4 rounded-2xl text-white font-black text-base transition-all active:scale-[0.98] shadow-crimson"
        style={{ background: saved ? '#166534' : 'linear-gradient(135deg,#B91C1C,#7f1010)' }}
      >
        {saved ? '✓ Saved!' : 'Save Branding'}
      </button>
    </div>
  )
}
