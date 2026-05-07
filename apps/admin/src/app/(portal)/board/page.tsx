'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { apiFetch } from '@/lib/api'

interface Rules {
  id: string
  quorum_min: number
  quorum_fraction_numerator: number
  quorum_fraction_denominator: number
  chair_casting_vote_enabled: boolean
  written_resolution_requires_unanimous: boolean
  active_trustees: number
  effective_quorum: number
  notice_period_days: number
}

interface Meeting {
  id: string
  meeting_type: string
  mode: string
  title: string
  scheduled_at: string
  status: string
}

interface Trustee {
  id: string
  full_name: string
  role: string
  is_active: boolean
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return iso }
}

export default function BoardOverviewPage() {
  const [rules, setRules] = useState<Rules | null>(null)
  const [trustees, setTrustees] = useState<Trustee[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const [r, t, m] = await Promise.all([
          apiFetch<{ rules: Rules }>('/admin/board/governing-rules'),
          apiFetch<{ items: Trustee[]; total: number }>('/admin/board/trustees?is_active=true&limit=100'),
          apiFetch<{ items: Meeting[]; total: number }>('/admin/board/meetings?upcoming_only=true&limit=10'),
        ])
        setRules(r.rules)
        setTrustees(t.items)
        setMeetings(m.items)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load board overview')
      } finally { setLoading(false) }
    })()
  }, [])

  const officersByRole = {
    CHAIR:     trustees.filter(t => t.role === 'CHAIR'),
    TREASURER: trustees.filter(t => t.role === 'TREASURER'),
    SECRETARY: trustees.filter(t => t.role === 'SECRETARY'),
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-white">Board &amp; Resolutions</h1>
        <p className="text-white/40 mt-1">Trustee directory, meetings, governing rules — Charity Commission aligned</p>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Trustees', value: trustees.length, icon: '👥', href: '/board/trustees', color: 'from-blue-600 to-indigo-500' },
          { label: 'Effective Quorum', value: rules?.effective_quorum ?? '—', icon: '🎯', href: '/board/rules', color: 'from-saffron-400 to-amber-500' },
          { label: 'Upcoming Meetings', value: meetings.length, icon: '📅', href: '/board/meetings', color: 'from-green-600 to-emerald-500' },
          { label: 'Notice Period', value: rules ? `${rules.notice_period_days} days` : '—', icon: '⏰', href: '/board/rules', color: 'from-violet-600 to-purple-500' },
        ].map((s, i) => (
          <Link key={s.label} href={s.href}>
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="glass rounded-2xl p-5 relative overflow-hidden hover:bg-white/5 transition-colors cursor-pointer">
              <div className={`absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br ${s.color} opacity-10 blur-xl`} />
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-lg mb-3`}>{s.icon}</div>
              <p className="text-white/50 text-xs font-medium">{s.label}</p>
              <p className="text-3xl font-black text-white mt-1">{loading ? '—' : s.value}</p>
            </motion.div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-black text-white">Officers</h2>
            <Link href="/board/trustees" className="text-saffron-400 text-xs font-bold hover:underline">Manage trustees →</Link>
          </div>
          <div className="space-y-3">
            {(['CHAIR', 'TREASURER', 'SECRETARY'] as const).map(role => (
              <div key={role} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/3 border border-white/5">
                <div>
                  <p className="text-white/60 text-xs font-bold uppercase tracking-widest">{role.toLowerCase()}</p>
                  {officersByRole[role].length > 0
                    ? officersByRole[role].map(t => <p key={t.id} className="text-white text-sm font-semibold">{t.full_name}</p>)
                    : <p className="text-white/30 text-sm italic">— Not appointed —</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-black text-white">Upcoming Meetings</h2>
            <Link href="/board/meetings" className="text-saffron-400 text-xs font-bold hover:underline">All meetings →</Link>
          </div>
          {meetings.length === 0
            ? <p className="text-white/30 text-sm italic py-3">No upcoming meetings scheduled.</p>
            : (
              <div className="space-y-3">
                {meetings.slice(0, 5).map(m => (
                  <Link key={m.id} href={`/board/meetings`}>
                    <div className="p-3 rounded-xl bg-white/3 border border-white/5 hover:bg-white/5 cursor-pointer transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-white text-sm font-bold">{m.title || `${m.meeting_type.replace(/_/g, ' ')} (${m.mode})`}</p>
                          <p className="text-white/50 text-xs mt-0.5">{fmtDate(m.scheduled_at)} · {m.mode}</p>
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold border bg-amber-500/15 text-amber-300 border-amber-500/30 flex-shrink-0">
                          {m.status}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
        </div>
      </div>

      <div className="glass rounded-2xl p-5 border border-saffron-400/20">
        <p className="text-saffron-400 text-xs font-bold uppercase tracking-widest mb-2">Coming in PRs 2-6</p>
        <ul className="space-y-1.5 text-sm text-white/70">
          <li>📜 PR 2 — Resolutions builder, agenda packs, voting engine (quorum + casting vote)</li>
          <li>✍️ PR 3 — Written (circular) resolutions with e-signature workflow</li>
          <li>🛡️ PR 4 — Per-role permissions (Chair / Secretary / Treasurer / Trustee)</li>
          <li>⚖️ PR 5 — Conflicts register + retrospective decisions + audit-pack PDF export</li>
          <li>🔔 PR 6 — Notifications, reminders, action tracking, MS 365 calendar sync</li>
        </ul>
      </div>
    </div>
  )
}
