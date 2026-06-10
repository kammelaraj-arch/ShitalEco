'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

/**
 * Typeahead picker for projects — used to set a parent project on a child.
 * Backed by GET /admin/projects?search= (the same list endpoint behind the
 * Projects page) so results respect branch/status filters when applied.
 *
 * `excludeId` lets the caller hide the current project from results so a
 * project can't pick itself as parent. Backend additionally enforces the
 * cycle check, but doing it here too keeps the UI honest.
 */

interface Project {
  id: string
  project_id: string
  name: string
  branch_id: string
  project_type: string
  status: string
}

interface ProjectPickerProps {
  value: { id: string; name: string; project_id?: string } | null
  onChange: (sel: { id: string; name: string; project_id: string } | null) => void
  excludeId?: string
  placeholder?: string
  className?: string
}

export function ProjectPicker({ value, onChange, excludeId, placeholder, className = '' }: ProjectPickerProps) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen]       = useState(false)
  const containerRef          = useRef<HTMLDivElement>(null)

  const search = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ per_page: '20' })
      if (q.trim()) qs.set('search', q.trim())
      const d = await apiFetch<{ projects: Project[] } | { items: Project[] } | Project[]>(`/admin/projects?${qs}`)
      const items = Array.isArray(d) ? d : ((d as { projects?: Project[]; items?: Project[] }).projects ?? (d as { items?: Project[] }).items ?? [])
      setResults((excludeId ? items.filter(p => p.id !== excludeId) : items).slice(0, 20))
    } catch { setResults([]) }
    finally { setLoading(false) }
  }, [excludeId])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => search(query), 200)
    return () => clearTimeout(t)
  }, [query, open, search])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  function pick(p: Project) {
    onChange({ id: p.id, name: p.name, project_id: p.project_id })
    setOpen(false); setQuery('')
  }
  function clear() { onChange(null); setQuery('') }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {value ? (
        <div className="flex items-center gap-2 bg-white/5 border border-saffron-400/40 rounded-lg px-3 py-2">
          <span className="text-saffron-300 text-sm">📁</span>
          <span className="flex-1 text-white text-sm font-semibold truncate">
            {value.name}{value.project_id && <span className="text-white/40 font-normal font-mono"> · {value.project_id}</span>}
          </span>
          <button type="button" onClick={clear} className="text-white/40 hover:text-red-400 text-lg leading-none">✕</button>
        </div>
      ) : (
        <input
          value={query}
          onFocus={() => { setOpen(true); search('') }}
          onChange={e => { setQuery(e.target.value); if (!open) setOpen(true) }}
          placeholder={placeholder || 'Search projects…'}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-saffron-400/50"
        />
      )}
      {open && !value && (
        <div className="absolute z-30 mt-1 w-full bg-temple-deep border border-white/10 rounded-xl shadow-2xl max-h-[280px] overflow-y-auto">
          {loading && <div className="px-3 py-3 text-white/40 text-xs">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="px-3 py-3 text-white/40 text-xs">No projects found.</div>
          )}
          {results.map(p => (
            <button key={p.id} type="button" onClick={() => pick(p)}
              className="w-full text-left px-3 py-2 hover:bg-white/5 border-b border-white/5 last:border-b-0">
              <div className="text-white text-sm font-semibold">{p.name}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-white/40 text-[10px] font-mono">{p.project_id}</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                  {p.project_type}
                </span>
                <span className="text-white/40 text-[10px]">{p.branch_id}</span>
                <span className="text-white/40 text-[10px]">{p.status}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
