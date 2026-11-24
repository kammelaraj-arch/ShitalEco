'use client'
// Compliance calendar — statutory filings & deadlines. Lists the
// deadlines (Commission AR, Accounts, ICO, HMRC Gift Aid, Companies
// House, DBS…) and the per-cycle filing records.

import { useCallback, useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'

interface Deadline {
  id: string
  title: string
  authority: string
  frequency: string
  base_month: number | null
  base_day: number | null
  days_offset_from_fye: number | null
  owner_name: string
  remind_days: number[]
  status: string
  notes: string
}
interface Filing {
  id: string
  deadline_id: string
  deadline_title: string
  authority: string
  period_start: string | null
  period_end: string | null
  due_date: string
  filed_at: string | null
  reference_number: string
  status: string
  note: string
}

const AUTHORITIES = ['COMMISSION', 'COMPANIES_HOUSE', 'HMRC', 'ICO', 'LOCAL_AUTHORITY', 'DBS', 'OTHER']
const FREQUENCIES = ['ANNUAL', 'QUARTERLY', 'MONTHLY', 'ONE_OFF']

export default function ComplianceCalendarPage() {
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [filings, setFilings] = useState<Filing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'calendar' | 'deadlines'>('calendar')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    title: '', authority: 'COMMISSION', frequency: 'ANNUAL',
    base_month: '' as string | number, base_day: '' as string | number,
    days_offset_from_fye: '' as string | number,
    owner_name: '', notes: '',
  })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [d, f] = await Promise.all([
        apiFetch<{ deadlines: Deadline[] }>('/admin/compliance/deadlines'),
        apiFetch<{ filings: Filing[] }>('/admin/compliance/filings'),
      ])
      setDeadlines(d.deadlines || [])
      setFilings(f.filings || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function addDeadline() {
    if (!form.title.trim()) { setError('Title is required'); return }
    try {
      await apiFetch('/admin/compliance/deadlines', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title, authority: form.authority, frequency: form.frequency,
          base_month: form.base_month === '' ? null : Number(form.base_month),
          base_day: form.base_day === '' ? null : Number(form.base_day),
          days_offset_from_fye: form.days_offset_from_fye === '' ? null : Number(form.days_offset_from_fye),
          owner_name: form.owner_name, notes: form.notes,
        }),
      })
      setShowForm(false)
      setForm({
        title: '', authority: 'COMMISSION', frequency: 'ANNUAL',
        base_month: '', base_day: '', days_offset_from_fye: '',
        owner_name: '', notes: '',
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function logFiling(d: Deadline) {
    const due = window.prompt('Due date (YYYY-MM-DD)', '')
    if (!due) return
    try {
      await apiFetch('/admin/compliance/filings', {
        method: 'POST',
        body: JSON.stringify({
          deadline_id: d.id,
          due_date: due,
          period_start: null, period_end: null,
          note: '',
        }),
      })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function markFiled(f: Filing) {
    const ref = window.prompt('Reference number from the authority', f.reference_number || '') || ''
    try {
      await apiFetch(`/admin/compliance/filings/${f.id}/mark-filed`, {
        method: 'POST',
        body: JSON.stringify({ reference_number: ref }),
      })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function archiveDeadline(d: Deadline) {
    if (!confirm(`Archive "${d.title}"?`)) return
    try {
      await apiFetch(`/admin/compliance/deadlines/${d.id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  const today = new Date()
  const upcoming = filings
    .filter(f => f.status !== 'FILED')
    .sort((a, b) => a.due_date.localeCompare(b.due_date))

  return (
    <div className="p-6 space-y-6 text-white max-w-[1400px] mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black">Compliance calendar</h1>
          <p className="text-white/50 text-sm mt-0.5">
            Annual return, accounts, ICO, HMRC — every statutory filing in one place.
          </p>
        </div>
        <div className="flex gap-2">
          {[
            { k: 'calendar',  label: 'Calendar' },
            { k: 'deadlines', label: 'Deadlines' },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k as 'calendar' | 'deadlines')}
              className={'px-4 py-2 rounded-xl text-sm font-bold ' +
                (tab === t.k ? 'bg-saffron-gradient text-white shadow-saffron'
                  : 'border border-white/10 text-white/70 hover:bg-white/5')}>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {error && <div className="bg-red-500/15 border border-red-500/40 text-red-200 px-4 py-3 rounded-xl text-sm">{error}</div>}
      {loading && <p className="text-white/50 text-sm">Loading…</p>}

      {tab === 'calendar' && (
        <section className="space-y-4">
          {upcoming.length === 0 ? (
            <p className="text-white/40 text-sm italic">No upcoming filings scheduled. Add one from the Deadlines tab.</p>
          ) : (
            <div className="space-y-2">
              {upcoming.map(f => {
                const due = new Date(f.due_date)
                const days = Math.round((due.getTime() - today.getTime()) / 864e5)
                const colour =
                  days < 0 ? 'border-red-500/50 bg-red-500/10'
                  : days <= 30 ? 'border-amber-500/40 bg-amber-500/10'
                  : days <= 90 ? 'border-sky-500/30 bg-sky-500/5'
                  : 'border-emerald-500/30 bg-emerald-500/5'
                return (
                  <div key={f.id} className={'rounded-xl border p-4 flex items-start justify-between gap-3 ' + colour}>
                    <div>
                      <p className="text-white font-bold">{f.deadline_title}</p>
                      <p className="text-white/50 text-xs mt-0.5">
                        {f.authority.replace(/_/g, ' ')} · due {due.toLocaleDateString()} ({days < 0 ? `overdue by ${-days}d` : `${days}d`})
                      </p>
                      {f.reference_number && <p className="text-white/50 text-xs mt-1">Ref: {f.reference_number}</p>}
                    </div>
                    <button onClick={() => markFiled(f)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-black">
                      ✓ Mark filed
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Already-filed section */}
          {filings.filter(f => f.status === 'FILED').length > 0 && (
            <>
              <h2 className="text-white/60 text-xs uppercase tracking-widest font-black">Already filed</h2>
              <ul className="space-y-1 text-xs text-white/60">
                {filings.filter(f => f.status === 'FILED').map(f => (
                  <li key={f.id}>
                    ✓ {f.deadline_title} · due {new Date(f.due_date).toLocaleDateString()}
                    {f.reference_number && ` · ref ${f.reference_number}`}
                    {f.filed_at && ` · filed ${new Date(f.filed_at).toLocaleDateString()}`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {tab === 'deadlines' && (
        <section className="space-y-4">
          <button onClick={() => setShowForm(s => !s)}
            className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
            {showForm ? 'Close' : '+ Add deadline'}
          </button>

          {showForm && (
            <div className="rounded-2xl border border-saffron-400/30 bg-saffron-400/5 p-5 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-3">
                  <label className="block text-white/50 text-xs font-bold mb-1">Title</label>
                  <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-white/50 text-xs font-bold mb-1">Authority</label>
                  <select value={form.authority} onChange={e => setForm(f => ({ ...f, authority: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm">
                    {AUTHORITIES.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-white/50 text-xs font-bold mb-1">Frequency</label>
                  <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm">
                    {FREQUENCIES.map(fq => <option key={fq} value={fq}>{fq.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-white/50 text-xs font-bold mb-1">Owner</label>
                  <input value={form.owner_name} onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-white/50 text-xs font-bold mb-1">Base month (1-12)</label>
                  <input type="number" min={1} max={12} value={form.base_month}
                    onChange={e => setForm(f => ({ ...f, base_month: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-white/50 text-xs font-bold mb-1">Days after FYE</label>
                  <input type="number" value={form.days_offset_from_fye}
                    onChange={e => setForm(f => ({ ...f, days_offset_from_fye: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm"
                    placeholder="304 = 10 months" />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-white/50 text-xs font-bold mb-1">Notes</label>
                  <textarea rows={2} value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm resize-none" />
                </div>
              </div>
              <button onClick={addDeadline}
                className="px-4 py-2 rounded-xl bg-saffron-gradient text-white text-sm font-black shadow-saffron">
                Save deadline
              </button>
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-white/60 text-xs uppercase tracking-widest">
                <tr>
                  <th className="px-3 py-2 text-left">Title</th>
                  <th className="px-3 py-2 text-left">Authority</th>
                  <th className="px-3 py-2 text-left">Frequency</th>
                  <th className="px-3 py-2 text-left">Owner</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {deadlines.map(d => (
                  <tr key={d.id} className="border-t border-white/5">
                    <td className="px-3 py-2">
                      <p className="font-bold text-white">{d.title}</p>
                      {d.notes && <p className="text-white/50 text-xs mt-0.5 line-clamp-1">{d.notes}</p>}
                    </td>
                    <td className="px-3 py-2 text-white/70 text-xs">{d.authority.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2 text-white/70 text-xs">{d.frequency}</td>
                    <td className="px-3 py-2 text-white/70 text-xs">{d.owner_name || '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={
                        'px-2 py-0.5 rounded-full text-[10px] font-black border ' +
                        (d.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30'
                          : 'bg-white/10 text-white/40 border-white/20')
                      }>{d.status}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => logFiling(d)}
                        className="px-2 py-1 rounded-lg border border-white/15 text-white/70 text-xs font-bold hover:bg-white/5">
                        + Filing
                      </button>
                      {d.status === 'ACTIVE' && (
                        <button onClick={() => archiveDeadline(d)}
                          className="ml-1 text-red-400/60 hover:text-red-400 text-xs">✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
