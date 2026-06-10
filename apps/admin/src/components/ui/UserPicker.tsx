'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

/**
 * Typeahead picker for users — used wherever we need an admin to choose a
 * real user record instead of pasting a UUID (project owners, assignments).
 * Backed by GET /users?search= which already exists for the Users admin page.
 */

interface User {
  id: string
  full_name: string
  email: string
  role: string
  branch_id: string | null
}

interface UserPickerProps {
  value: { id: string; name: string; email?: string } | null
  onChange: (sel: { id: string; name: string; email: string } | null) => void
  placeholder?: string
  className?: string
}

export function UserPicker({ value, onChange, placeholder, className = '' }: UserPickerProps) {
  const [query, setQuery]   = useState('')
  const [results, setResults] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen]     = useState(false)
  const containerRef        = useRef<HTMLDivElement>(null)

  const search = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ active_only: 'true' })
      if (q.trim()) qs.set('search', q.trim())
      const d = await apiFetch<{ users: User[] } | User[]>(`/users?${qs}`)
      const items = Array.isArray(d) ? d : (d.users || [])
      setResults(items.slice(0, 20))
    } catch { setResults([]) }
    finally { setLoading(false) }
  }, [])

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

  function pick(u: User) {
    onChange({ id: u.id, name: u.full_name || u.email, email: u.email })
    setOpen(false); setQuery('')
  }
  function clear() { onChange(null); setQuery('') }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {value ? (
        <div className="flex items-center gap-2 bg-white/5 border border-saffron-400/40 rounded-lg px-3 py-2">
          <span className="text-saffron-300 text-sm">👤</span>
          <span className="flex-1 text-white text-sm font-semibold truncate">
            {value.name}{value.email && <span className="text-white/40 font-normal"> · {value.email}</span>}
          </span>
          <button type="button" onClick={clear} className="text-white/40 hover:text-red-400 text-lg leading-none">✕</button>
        </div>
      ) : (
        <input
          value={query}
          onFocus={() => { setOpen(true); search('') }}
          onChange={e => { setQuery(e.target.value); if (!open) setOpen(true) }}
          placeholder={placeholder || 'Search users…'}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-saffron-400/50"
        />
      )}
      {open && !value && (
        <div className="absolute z-30 mt-1 w-full bg-temple-deep border border-white/10 rounded-xl shadow-2xl max-h-[280px] overflow-y-auto">
          {loading && <div className="px-3 py-3 text-white/40 text-xs">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="px-3 py-3 text-white/40 text-xs">
              No users found. <a href="/users" target="_blank" className="text-saffron-300 hover:underline">Add one →</a>
            </div>
          )}
          {results.map(u => (
            <button key={u.id} type="button" onClick={() => pick(u)}
              className="w-full text-left px-3 py-2 hover:bg-white/5 border-b border-white/5 last:border-b-0">
              <div className="text-white text-sm font-semibold">{u.full_name || u.email}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                  {u.role}
                </span>
                <span className="text-white/40 text-[10px]">{u.email}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
