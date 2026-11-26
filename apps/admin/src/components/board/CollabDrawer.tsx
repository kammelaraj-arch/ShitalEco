'use client'
// Collaboration drawer — a right-side slide-in panel that holds every
// supporting-material surface the Board Resolution wizard used to stack
// inline on the Context step:
//
//   📎 Files            supporting-file attachments (upload + pull from meeting)
//   🔗 Links            external links (manual URL + SharePoint picker)
//   💬 Info requests    chair-asks-manager info-request flow
//   🗨 Comments         internal thread on the draft
//
// Rationale: the Context step was carrying four nested panels, each with
// its own card chrome + title row + help text. The author only ever
// interacts with one at a time, so promoting them into tabs inside an
// off-canvas drawer collapses the main form from six stacked blocks to
// two (background + recommendation) without hiding any capability.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ExternalLinksPanel } from '@/components/board/ExternalLinksPanel'
import { CommentsPanel } from '@/components/board/CommentsPanel'
import { InfoRequestsPanel } from '@/components/board/InfoRequestsPanel'

type Tab = 'files' | 'links' | 'info' | 'comments'

export interface DrawerAttachment {
  id: string
  filename: string
  size_bytes: number
  source: string
  url: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  resolutionId: string
  locked: boolean
  attachments: DrawerAttachment[]
  uploading: boolean
  onUploadFiles: (files: FileList | null) => void | Promise<void>
  onPullMeetingFiles: () => void | Promise<void>
  showPullMeetingFiles: boolean
  onRemoveAttachment: (attId: string) => void | Promise<void>
  onOpenRequiredChange: (b: boolean) => void
}

function fmtBytes(n: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'files',    label: 'Files',         icon: '📎' },
  { key: 'links',    label: 'Links',         icon: '🔗' },
  { key: 'info',     label: 'Info requests', icon: '💬' },
  { key: 'comments', label: 'Comments',      icon: '🗨' },
]

export function CollabDrawer({
  isOpen, onClose,
  resolutionId, locked,
  attachments, uploading,
  onUploadFiles, onPullMeetingFiles, showPullMeetingFiles,
  onRemoveAttachment, onOpenRequiredChange,
}: Props) {
  const [tab, setTab] = useState<Tab>('files')

  // Close on Escape so it feels like a dialog.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Scrim */}
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          />
          {/* Drawer */}
          <motion.div
            key="drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.22 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[520px] bg-zinc-900 border-l border-white/10 shadow-2xl flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <div className="min-w-0">
                <h3 className="font-black text-white text-base">Supporting material</h3>
                <p className="text-white/50 text-[11px]">Files, links, info requests and comments for this resolution</p>
              </div>
              <button onClick={onClose} className="text-white/60 hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="flex gap-1 px-3 py-2 border-b border-white/10 overflow-x-auto">
              {TABS.map(t => {
                const active = tab === t.key
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${
                      active ? 'bg-saffron-400/20 text-saffron-300' : 'text-white/60 hover:text-white/80 hover:bg-white/5'
                    }`}
                  >
                    <span>{t.icon}</span>
                    <span className="uppercase tracking-wide">{t.label}</span>
                    {t.key === 'files' && attachments.length > 0 && (
                      <span className="ml-1 rounded-full bg-white/10 px-1.5 text-[10px] font-black text-white">{attachments.length}</span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="flex-1 overflow-y-auto">
              {tab === 'files' && (
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-white/70 text-xs uppercase tracking-widest font-bold">📎 Supporting files</p>
                    <div className="flex gap-2 flex-wrap">
                      <label className="px-3 py-1.5 rounded-lg border border-white/10 text-white/80 text-xs font-bold hover:bg-white/5 cursor-pointer">
                        {uploading ? 'Uploading…' : '+ Add files'}
                        <input type="file" multiple hidden disabled={locked || uploading}
                          onChange={e => { void onUploadFiles(e.target.files); e.currentTarget.value = '' }} />
                      </label>
                      {showPullMeetingFiles && (
                        <button onClick={() => void onPullMeetingFiles()} disabled={locked || uploading}
                          className="px-3 py-1.5 rounded-lg border border-saffron-400/40 text-saffron-300 text-xs font-bold hover:bg-saffron-400/10 disabled:opacity-40">
                          📥 Pull meeting files
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-white/40 text-xs">Minutes, quotes, prior correspondence. Trustees see these linked from the vote-invite.</p>
                  {attachments.length === 0 ? (
                    <p className="text-white/30 text-xs italic">No files attached yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {attachments.map(a => (
                        <li key={a.id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-white/3 text-xs">
                          <div className="min-w-0 flex-1 flex items-center gap-2">
                            <span className="text-white/40">{a.source === 'meeting' ? '📅' : a.source === 'ai' ? '✨' : '📎'}</span>
                            <a href={a.url} target="_blank" rel="noreferrer" className="text-saffron-300 hover:underline truncate">{a.filename}</a>
                            <span className="text-white/40">· {fmtBytes(a.size_bytes)}</span>
                          </div>
                          {!locked && (
                            <button onClick={() => void onRemoveAttachment(a.id)} className="text-red-400/60 hover:text-red-400 px-1">✕</button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {tab === 'links' && (
                <div className="p-4 bg-white">
                  <ExternalLinksPanel resolutionId={resolutionId} locked={locked} />
                </div>
              )}

              {tab === 'info' && (
                <div className="p-4 bg-white">
                  <InfoRequestsPanel resolutionId={resolutionId} locked={locked} onChange={onOpenRequiredChange} />
                </div>
              )}

              {tab === 'comments' && (
                <div className="p-4 bg-white">
                  <CommentsPanel resolutionId={resolutionId} locked={locked} />
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
