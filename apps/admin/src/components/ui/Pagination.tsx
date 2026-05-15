'use client'
import React from 'react'

/**
 * Standard data-grid paginator.
 *
 * Page-size selector defaults to 10 / 20 / 50 / 75 / 100 per the project
 * convention (user-asked for exactly these). Renders compact at small
 * widths — the page-info text wraps below on mobile so the controls
 * never overflow.
 *
 * Controlled component: caller owns `page` + `pageSize` state and
 * supplies onChange handlers. `total` drives the page-count display
 * and disables Next on the last page; pass `null`/`undefined` if your
 * endpoint doesn't return a total and we'll fall back to "Page N"
 * with only Prev/Next gating.
 */

export const DEFAULT_PAGE_SIZES = [10, 20, 50, 75, 100] as const
export type PageSize = typeof DEFAULT_PAGE_SIZES[number]

interface Props {
  page: number                     // 1-indexed
  pageSize: number
  total?: number | null            // total rows; null if unknown
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  pageSizes?: readonly number[]
  /** Optional disabled state (e.g. while loading) */
  disabled?: boolean
}

export function Pagination({
  page, pageSize, total, onPageChange, onPageSizeChange,
  pageSizes = DEFAULT_PAGE_SIZES, disabled = false,
}: Props) {
  const totalPages = total != null && total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : null
  const hasPrev = page > 1
  const hasNext = totalPages != null ? page < totalPages : true   // unknown total → always allow Next

  const from = total != null && total > 0 ? (page - 1) * pageSize + 1 : 0
  const to   = total != null ? Math.min(total, page * pageSize) : 0

  const btn = (extra = '') =>
    `px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed ${extra}`

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-white/5 bg-white/[0.02]">
      <div className="flex items-center gap-2 text-xs text-white/50">
        <label className="font-semibold uppercase tracking-wide">Rows</label>
        <select
          value={pageSize}
          disabled={disabled}
          onChange={e => {
            const next = parseInt(e.target.value, 10) || 20
            onPageSizeChange(next)
            // Snap page back to 1 when page-size changes — otherwise the
            // caller could end up on a page past the new last page.
            if (page !== 1) onPageChange(1)
          }}
          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white text-xs outline-none"
        >
          {pageSizes.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        {total != null && total > 0 && (
          <span className="ml-2">
            <span className="font-bold text-white">{from}–{to}</span>
            <span className="text-white/40"> of </span>
            <span className="font-bold text-white">{total.toLocaleString('en-GB')}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btn()}
          disabled={disabled || !hasPrev}
          onClick={() => onPageChange(1)}
          aria-label="First page"
        >« First</button>
        <button
          type="button"
          className={btn()}
          disabled={disabled || !hasPrev}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >‹ Prev</button>

        <span className="text-xs text-white/60 px-2">
          Page <span className="font-bold text-white">{page}</span>
          {totalPages != null && (
            <> of <span className="font-bold text-white">{totalPages}</span></>
          )}
        </span>

        <button
          type="button"
          className={btn()}
          disabled={disabled || !hasNext}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >Next ›</button>
        <button
          type="button"
          className={btn()}
          disabled={disabled || totalPages == null || !hasNext}
          onClick={() => totalPages != null && onPageChange(totalPages)}
          aria-label="Last page"
        >Last »</button>
      </div>
    </div>
  )
}
