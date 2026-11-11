'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface Pledge {
  id: string
  category: string
  selected_items: string[]
  donor_name: string
  donor_email: string
  donor_phone: string
  notes: string
  branch_id: string | null
  status: string
  created_at: string
}

const CATEGORY_META: Record<string, { label: string; icon: string; accent: string }> = {
  services: { label: 'Professional Services', icon: '🛠️', accent: '#D8B4FE' },
  volunt:   { label: 'Volunteering',          icon: '🤝', accent: '#A7F3D0' },
  material: { label: 'Materials',             icon: '🗿', accent: '#FFD28B' },
  business: { label: 'Business Sponsorship',  icon: '💼', accent: '#A6E0A9' },
}

export default function PledgesPage() {
  const [pledges, setPledges] = useState<Pledge[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState('')
  const [filterCat, setFilterCat] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ limit: '500' })
      if (filterCat) qs.set('category', filterCat)
      const d = await apiFetch<{ pledges: Pledge[] }>(`/kiosk/project-pledges?${qs}`)
      setPledges(d.pledges ?? [])
    } catch (e) {
      setErr(String(e))
    } finally {
      setLoading(false)
    }
  }, [filterCat])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-black">Project Pledges</h1>
        <p className="text-sm opacity-60 mt-1">
          Non-payment offers from the Project Donation kiosk flow — volunteering, professional services, materials and business sponsorship. Follow up with each donor directly.
        </p>
      </div>

      <div className="flex gap-2 mb-4">
        {[
          { id: '', label: 'All' },
          { id: 'services', label: 'Professional Services' },
          { id: 'volunt',   label: 'Volunteering' },
          { id: 'material', label: 'Materials' },
          { id: 'business', label: 'Business Sponsorship' },
        ].map(f => (
          <button key={f.id}
            onClick={() => setFilterCat(f.id)}
            className={`px-3 py-2 rounded-lg text-sm ${
              filterCat === f.id
                ? 'bg-saffron-400 text-black font-bold'
                : 'bg-white/5 border border-white/10'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {err && <div className="mb-3 text-sm p-3 rounded-lg bg-red-500/15 border border-red-500/40 text-red-200">{err}</div>}

      {loading ? (
        <div className="opacity-60">Loading…</div>
      ) : pledges.length === 0 ? (
        <div className="p-6 rounded-xl bg-white/5 border border-dashed border-white/10 opacity-70">
          No pledges yet.
        </div>
      ) : (
        <div className="grid gap-3">
          {pledges.map(p => {
            const meta = CATEGORY_META[p.category] ?? { label: p.category, icon: '📋', accent: '#FFF' }
            return (
              <div key={p.id} className="p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{meta.icon}</span>
                      <span className="font-bold text-lg">{p.donor_name || '— (no name)'}</span>
                    </div>
                    <div className="text-xs opacity-60 mt-1">
                      {meta.label}
                      {p.branch_id && ` · Branch: ${p.branch_id}`}
                      {` · ${new Date(p.created_at).toLocaleString('en-GB')}`}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    {p.donor_email && <div>📧 <a href={`mailto:${p.donor_email}`} className="underline">{p.donor_email}</a></div>}
                    {p.donor_phone && <div>📞 <a href={`tel:${p.donor_phone}`} className="underline">{p.donor_phone}</a></div>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {p.selected_items.map((item, i) => (
                    <span key={i}
                          className="px-2 py-1 rounded-lg text-xs"
                          style={{ background: `${meta.accent}20`, border: `1px solid ${meta.accent}40` }}>
                      {item}
                    </span>
                  ))}
                </div>
                {p.notes && (
                  <div className="text-sm mt-3 opacity-80 italic">“{p.notes}”</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
