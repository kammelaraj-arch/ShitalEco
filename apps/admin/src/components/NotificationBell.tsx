'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface Notification {
  id: string
  kind: string
  title: string
  body: string
  link_url: string
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS' | string
  read_at: string | null
  created_at: string
}

interface NotificationsResp {
  items: Notification[]
  unread_count: number
}

function fmtAge(iso: string): string {
  const t = new Date(iso).getTime()
  if (!t) return iso
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return `${Math.floor(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const SEVERITY_DOT: Record<string, string> = {
  INFO:    'bg-blue-400',
  WARNING: 'bg-amber-400',
  ERROR:   'bg-red-400',
  SUCCESS: 'bg-green-400',
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<NotificationsResp | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await apiFetch<NotificationsResp>('/admin/notifications?limit=30')
      setData(d)
    } catch { /* ignored — token may be expiring, retry next poll */ }
    finally { setLoading(false) }
  }, [])

  // Poll every 60s for new notifications. Cheap query — indexed on (user_id,
  // created_at) — so this is fine to run while the admin is open.
  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  async function markRead(ids: string[] | null) {
    try {
      await apiFetch('/admin/notifications/read', {
        method: 'POST', body: JSON.stringify({ ids }),
      })
      load()
    } catch { /* ignore */ }
  }

  const unread = data?.unread_count ?? 0

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative w-9 h-9 rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 flex items-center justify-center"
        aria-label="Notifications"
      >
        <span className="text-lg">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-out catcher */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div className="absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-2xl shadow-2xl z-50 max-h-[70vh] flex flex-col"
               style={{ background: '#0f0008', border: '1px solid rgba(212,175,55,0.3)' }}
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-white/10">
              <h3 className="font-bold text-white">Notifications</h3>
              <div className="flex items-center gap-2">
                {unread > 0 && (
                  <button onClick={() => markRead(null)}
                          className="text-xs text-saffron-300 hover:underline">
                    Mark all read
                  </button>
                )}
                <button onClick={load} className="text-xs text-white/40 hover:text-white/70">↻</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading && !data && <p className="text-white/40 text-sm text-center p-6">Loading…</p>}
              {data && data.items.length === 0 && (
                <p className="text-white/30 text-sm text-center p-6">No notifications yet.</p>
              )}
              {data?.items.map(n => {
                const isUnread = !n.read_at
                const content = (
                  <div className={`p-3 border-b border-white/5 hover:bg-white/3 flex gap-3 items-start ${isUnread ? 'bg-saffron-500/5' : ''}`}>
                    <span className={`w-2 h-2 rounded-full mt-2 ${SEVERITY_DOT[n.severity] || 'bg-white/40'}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${isUnread ? 'text-white font-semibold' : 'text-white/70'}`}>{n.title}</p>
                      {n.body && <p className="text-white/50 text-xs mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-white/30 text-[10px] mt-1">{n.kind} · {fmtAge(n.created_at)} ago</p>
                    </div>
                  </div>
                )
                return n.link_url ? (
                  <a key={n.id} href={n.link_url}
                     onClick={() => { markRead([n.id]); setOpen(false) }}
                     className="block">
                    {content}
                  </a>
                ) : (
                  <div key={n.id} onClick={() => markRead([n.id])} className="cursor-pointer">
                    {content}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
