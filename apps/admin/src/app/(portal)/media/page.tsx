'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch, API_BASE, getToken } from '@/lib/api'

interface MediaImage {
  id: string
  url: string
  original_name: string
  mime: string
  size_bytes: number
  created_by: string
  created_at: string | null
}

function fmtSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Absolute origin so a copied URL works when pasted into any external page.
function absUrl(path: string): string {
  if (typeof window === 'undefined') return path
  return `${window.location.origin}${path}`
}

export default function MediaLibraryPage() {
  const [images, setImages] = useState<MediaImage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [copiedId, setCopiedId] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await apiFetch<{ images: MediaImage[] }>('/admin/media/library')
      setImages(d.images || [])
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load images')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function uploadFiles(files: FileList | null) {
    if (!files || !files.length) return
    setUploading(true)
    setError('')
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        const token = getToken()
        const res = await fetch(`${API_BASE}/admin/media/library`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        })
        if (!res.ok) {
          let msg = `Upload failed (HTTP ${res.status})`
          try { const j = await res.json(); if (j.detail) msg = j.detail } catch { /* ignore */ }
          throw new Error(`${file.name}: ${msg}`)
        }
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function remove(img: MediaImage) {
    if (!confirm(`Delete this image?\n\n${img.original_name || img.id}\n\nAny page using it will break.`)) return
    try {
      await apiFetch(`/admin/media/library/${img.id}`, { method: 'DELETE' })
      setImages(prev => prev.filter(i => i.id !== img.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function copyUrl(img: MediaImage) {
    const url = absUrl(img.url)
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(img.id)
      setTimeout(() => setCopiedId(''), 1500)
    } catch {
      // Clipboard blocked — select-prompt fallback.
      window.prompt('Copy this image URL:', url)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">🖼️ Image Library</h1>
          <p className="text-white/50 text-sm mt-1">
            Upload images and use their URL in any web page. Stored on the server.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            multiple
            className="hidden"
            onChange={e => uploadFiles(e.target.files)}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="bg-saffron-500 hover:bg-saffron-400 disabled:opacity-50 text-white font-semibold text-sm rounded-xl px-5 py-3 transition"
          >
            {uploading ? 'Uploading…' : '⬆️ Upload images'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/15 border border-red-500/30 text-red-300 text-sm rounded-xl px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-white/40 text-sm py-16 text-center">Loading…</div>
      ) : images.length === 0 ? (
        <div
          onClick={() => fileInput.current?.click()}
          className="border-2 border-dashed border-white/15 rounded-2xl py-16 text-center text-white/40 text-sm cursor-pointer hover:border-saffron-400/40 transition"
        >
          No images yet — click <span className="text-saffron-400 font-semibold">Upload images</span> to add one.
          <div className="text-white/25 text-xs mt-1">PNG, JPG, WEBP, GIF or SVG · up to 8 MB each</div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          <AnimatePresence>
            {images.map(img => (
              <motion.div
                key={img.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden group"
              >
                <div className="aspect-square bg-[repeating-conic-gradient(#1a1a1a_0_25%,#222_0_50%)] bg-[length:20px_20px] flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.original_name} className="max-w-full max-h-full object-contain" />
                </div>
                <div className="p-3">
                  <p className="text-white/80 text-xs font-medium truncate" title={img.original_name}>
                    {img.original_name || 'image'}
                  </p>
                  <p className="text-white/35 text-[11px] mt-0.5">
                    {fmtSize(img.size_bytes)}{img.created_by ? ` · ${img.created_by}` : ''}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => copyUrl(img)}
                      className="flex-1 bg-white/10 hover:bg-white/15 text-white text-xs font-semibold rounded-lg px-2 py-1.5 transition"
                    >
                      {copiedId === img.id ? '✓ Copied' : '🔗 Copy URL'}
                    </button>
                    <button
                      onClick={() => remove(img)}
                      title="Delete"
                      className="bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs rounded-lg px-2.5 py-1.5 transition"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
