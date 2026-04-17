'use client'
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api'

// ── Generic search-select dropdown ───────────────────────────────────────────

export interface SelectOption {
  value: string
  label: string
}

interface SearchSelectProps {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-amber-500/50 transition-colors'

export function SearchSelect({ options, value, onChange, placeholder = 'Search…', className }: SearchSelectProps) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const current = options.find(o => o.value === value)
  const filtered = options.filter(o => o.label.toLowerCase().includes(q.toLowerCase()))

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => { setOpen(!open); setQ('') }}
        className={`${inp} text-left flex items-center justify-between`}
        style={{ color: current ? '#fff' : 'rgba(255,255,255,0.3)' }}
      >
        <span className="truncate">{current?.label || placeholder}</span>
        <span className="text-white/30 text-xs ml-2 flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute z-50 w-full mt-1 rounded-xl border border-white/10 overflow-hidden"
            style={{ background: '#1C0A0A', maxHeight: 220, overflowY: 'auto' }}
          >
            <div className="p-2 border-b border-white/10">
              <input
                autoFocus
                value={q} onChange={e => setQ(e.target.value)}
                placeholder="Type to search…"
                className="w-full bg-white/5 rounded-lg px-3 py-1.5 text-white text-xs outline-none"
              />
            </div>
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-white/30 text-xs">No results</p>
            ) : filtered.map(o => (
              <button
                key={o.value} type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors"
                style={{ color: o.value === value ? '#F59E0B' : '#fff' }}
              >
                {o.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── BranchSelect — loads branches from API, renders SearchSelect ──────────────

interface Branch { id: string; branch_id: string; name: string; city: string }

interface BranchSelectProps {
  /** Current value — the branch's branch_id slug (e.g. "wembley") */
  value: string
  onChange: (branchId: string, branch?: Branch) => void
  placeholder?: string
  /** If true, prepend an "— Any branch —" option with value "" */
  allowAny?: boolean
  className?: string
}

export function BranchSelect({ value, onChange, placeholder = 'Search branch…', allowAny = false, className }: BranchSelectProps) {
  const [branches, setBranches] = useState<Branch[]>([])

  useEffect(() => {
    apiFetch<{ branches: Branch[] }>('/branches')
      .then(d => setBranches(d.branches || []))
      .catch(() => {})
  }, [])

  const options: SelectOption[] = [
    ...(allowAny ? [{ value: '', label: '— Any branch —' }] : []),
    ...branches.map(b => ({
      value: b.branch_id || b.id,
      label: b.city ? `${b.name} — ${b.city}` : b.name,
    })),
  ]

  return (
    <SearchSelect
      options={options.length > (allowAny ? 1 : 0) ? options : [{ value: 'main', label: 'Main' }]}
      value={value}
      onChange={v => onChange(v, branches.find(b => (b.branch_id || b.id) === v))}
      placeholder={placeholder}
      className={className}
    />
  )
}
