'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

/**
 * Typeahead picker for CRM accounts.
 *
 * Used by Purchase Orders / Purchase Invoices / Sales Invoices so the
 * supplier/customer is ALWAYS a real CRM account, not a free-text string.
 * The backend resolver (`_resolve_account_name`) rejects mismatched types
 * (eg. you can't bill a donor) so the picker filters by `accountType` to
 * stop the user picking from the wrong list to begin with.
 *
 * Props:
 *   accountType: 'supplier' | 'customer'  — filters the CRM lookup
 *   value:       { id, name } | null      — current selection
 *   onChange:    (selection) => void      — fires on pick OR clear
 *   placeholder: string                   — input placeholder
 *
 * Behaviour:
 *   - Empty input → no results panel
 *   - Typing → debounced 200ms → hits /accounts?q=&account_type=
 *   - Click result → fills the field, fires onChange
 *   - Clear button (✕) → clears selection
 *   - Click outside → closes results panel
 */

interface Account {
  id: string
  name: string
  legal_name: string
  account_type: string
  email: string
  charity_number: string
  status: string
}

// 'any' = no account_type filter — used by the project Partners tab where
// the relationship (PARTNER / GRANTOR / SPONSOR / …) is stored separately
// and any account can be linked.
type AccountTypeFilter = 'supplier' | 'customer' | 'any'

interface AccountPickerProps {
  accountType: AccountTypeFilter
  value: { id: string; name: string } | null
  onChange: (sel: { id: string; name: string } | null) => void
  placeholder?: string
  className?: string
  required?: boolean
}

export function AccountPicker({
  accountType, value, onChange,
  placeholder, className = '', required = false,
}: AccountPickerProps) {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<Account[]>([])
  const [loading, setLoading]   = useState(false)
  const [open, setOpen]         = useState(false)
  const containerRef            = useRef<HTMLDivElement>(null)

  // Search the API as the user types
  const search = useCallback(async (q: string) => {
    setLoading(true)
    try {
      // Suppliers can also be tagged 'vendor' in some legacy data — backend
      // accepts both, so we fetch both and merge. The 'customer' side is
      // single-typed.
      const types = accountType === 'supplier' ? ['supplier', 'vendor']
                  : accountType === 'customer' ? ['customer']
                  : ['']  // 'any' → one call with no account_type filter
      const all: Account[] = []
      for (const t of types) {
        const qs = new URLSearchParams({ status: 'active', per_page: '20' })
        if (t) qs.set('account_type', t)
        if (q.trim()) qs.set('q', q.trim())
        const d = await apiFetch<{ accounts: Account[] }>(`/accounts?${qs}`)
        all.push(...(d.accounts || []))
      }
      // De-dupe by id (in case the same account is tagged both)
      const seen = new Set<string>()
      const merged = all.filter(a => seen.has(a.id) ? false : (seen.add(a.id), true))
      setResults(merged.slice(0, 20))
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [accountType])

  // Debounced typing
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => search(query), 200)
    return () => clearTimeout(t)
  }, [query, open, search])

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  function pick(a: Account) {
    onChange({ id: a.id, name: a.name })
    setOpen(false)
    setQuery('')
  }

  function clear() {
    onChange(null)
    setQuery('')
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {value ? (
        <div className="flex items-center gap-2 bg-white/5 border border-saffron-400/40 rounded-xl px-3 py-2.5">
          <span className="text-saffron-300 text-sm">🏢</span>
          <span className="flex-1 text-white text-sm font-semibold truncate">{value.name}</span>
          <button type="button" onClick={clear}
            className="text-white/40 hover:text-red-400 text-lg leading-none">✕</button>
        </div>
      ) : (
        <input
          value={query}
          onFocus={() => { setOpen(true); search('') }}
          onChange={e => { setQuery(e.target.value); if (!open) setOpen(true) }}
          placeholder={placeholder || `Search CRM ${accountType}s…`}
          required={required}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-saffron-400/50"
        />
      )}
      {open && !value && (
        <div className="absolute z-30 mt-1 w-full bg-temple-deep border border-white/10 rounded-xl shadow-2xl max-h-[280px] overflow-y-auto">
          {loading && <div className="px-3 py-3 text-white/40 text-xs">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="px-3 py-3 text-white/40 text-xs">
              No {accountType}s found. <a href="/accounts" target="_blank" className="text-saffron-300 hover:underline">Add one in CRM →</a>
            </div>
          )}
          {results.map(a => (
            <button key={a.id} type="button" onClick={() => pick(a)}
              className="w-full text-left px-3 py-2 hover:bg-white/5 border-b border-white/5 last:border-b-0">
              <div className="text-white text-sm font-semibold">{a.name}</div>
              {a.legal_name && a.legal_name !== a.name && (
                <div className="text-white/40 text-[10px]">{a.legal_name}</div>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                  {a.account_type}
                </span>
                {a.email && <span className="text-white/40 text-[10px]">{a.email}</span>}
                {a.charity_number && <span className="text-white/40 text-[10px]">Charity {a.charity_number}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
