'use client'
/**
 * Activities — reusable task templates (Kitchen prep, Setup for puja, Welcome
 * desk…) that trustees assign to volunteers / staff on specific dates.
 *
 * Two panels on one page:
 *  - LEFT:  activity catalogue (create / archive)
 *  - RIGHT: today's schedule — every assignment for today across all people
 *           + an "Assign…" button on each activity that opens a picker
 *             (person + date + optional time + notes).
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { apiFetch } from '@/lib/api'

type PersonType = 'employee' | 'volunteer'

interface Activity {
  id: string
  name: string
  description: string
  colour: string
  archived: boolean
  created_at: string
}

interface Assignment {
  id: string
  activity_id: string
  activity_name: string
  activity_colour: string
  person_type: PersonType
  person_id: string
  person_name: string
  assigned_date: string
  start_time: string | null
  end_time: string | null
  status: 'assigned' | 'in_progress' | 'done' | 'skipped'
  notes: string
}

interface Person {
  id: string
  name: string
  role: string
}

type ItemType = 'checkbox' | 'text' | 'number' | 'photo' | 'signature'

interface ChecklistItem {
  id: string
  label: string
  item_type: ItemType
  required: boolean
  help_text: string
  order_index: number
}

interface AssignmentChecklistEntry {
  item_id: string
  label: string
  item_type: ItemType
  required: boolean
  help_text: string
  order_index: number
  is_checked: boolean
  value_text: string
  value_number: number | null
  photo_url: string
  signature_data: string
  checked_by: string
  checked_at: string | null
}

interface RosterResponse {
  employees: Person[]
  volunteers: Person[]
}

const STATUS_STYLES: Record<Assignment['status'], string> = {
  assigned:    'bg-white/5 text-white/70 border-white/15',
  in_progress: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  done:        'bg-green-500/15 text-green-300 border-green-500/30',
  skipped:     'bg-rose-500/10 text-rose-300 border-rose-500/30',
}

function todayStr(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [roster, setRoster] = useState<RosterResponse>({ employees: [], volunteers: [] })
  const [scheduleDate, setScheduleDate] = useState(todayStr())
  const [loading, setLoading] = useState(true)

  // Create form
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)

  // Assign modal
  const [assignFor, setAssignFor] = useState<Activity | null>(null)
  const [assignPerson, setAssignPerson] = useState<string>('')
  const [assignPersonType, setAssignPersonType] = useState<PersonType>('volunteer')
  const [assignDate, setAssignDate] = useState(todayStr())
  const [assignStart, setAssignStart] = useState('')
  const [assignEnd, setAssignEnd] = useState('')
  const [assignNotes, setAssignNotes] = useState('')
  const [assigning, setAssigning] = useState(false)

  // Checklist editor modal (per template)
  const [editItemsFor, setEditItemsFor] = useState<Activity | null>(null)
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [newItemLabel, setNewItemLabel] = useState('')
  const [newItemType, setNewItemType] = useState<ItemType>('checkbox')
  const [newItemRequired, setNewItemRequired] = useState(true)
  const [newItemHelp, setNewItemHelp] = useState('')
  const [savingItem, setSavingItem] = useState(false)

  // Per-assignment inline checklist expansion
  const [expandedAssignmentId, setExpandedAssignmentId] = useState<string | null>(null)
  const [checklistEntries, setChecklistEntries] = useState<AssignmentChecklistEntry[]>([])
  const [checklistLoading, setChecklistLoading] = useState(false)

  const load = useCallback(async () => {
    try {
      const [acts, assigns, r] = await Promise.all([
        apiFetch<Activity[]>('/attendance/activities'),
        apiFetch<Assignment[]>(`/attendance/assignments?from_date=${scheduleDate}&to_date=${scheduleDate}`),
        apiFetch<RosterResponse>('/attendance/roster'),
      ])
      setActivities(acts); setAssignments(assigns); setRoster(r)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load activities')
    } finally {
      setLoading(false)
    }
  }, [scheduleDate])

  useEffect(() => { load() }, [load])

  async function createActivity(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      await apiFetch('/attendance/activities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || null }),
      })
      setNewName(''); setNewDesc('')
      toast.success('Activity created')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setCreating(false)
    }
  }

  async function archive(a: Activity) {
    if (!confirm(`Archive activity "${a.name}"? It won't appear in the picker.`)) return
    try {
      await apiFetch(`/attendance/activities/${a.id}/archive`, { method: 'POST' })
      toast.success('Archived')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Archive failed')
    }
  }

  function openAssign(a: Activity) {
    setAssignFor(a)
    setAssignPerson(''); setAssignPersonType('volunteer')
    setAssignDate(todayStr())
    setAssignStart(''); setAssignEnd(''); setAssignNotes('')
  }

  async function submitAssign() {
    if (!assignFor || !assignPerson) return
    setAssigning(true)
    try {
      await apiFetch(`/attendance/activities/${assignFor.id}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person_type: assignPersonType, person_id: assignPerson,
          assigned_date: assignDate,
          start_time: assignStart || null, end_time: assignEnd || null,
          notes: assignNotes.trim() || null,
        }),
      })
      toast.success('Assigned')
      setAssignFor(null); load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Assignment failed')
    } finally {
      setAssigning(false)
    }
  }

  async function setStatus(a: Assignment, status: Assignment['status']) {
    try {
      await apiFetch(`/attendance/assignments/${a.id}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Status update failed')
    }
  }

  // ── Checklist editor (template-level) ───────────────────────────────────────
  async function openEditItems(a: Activity) {
    setEditItemsFor(a)
    setItems([])
    setNewItemLabel(''); setNewItemType('checkbox'); setNewItemRequired(true); setNewItemHelp('')
    try {
      const r = await apiFetch<ChecklistItem[]>(`/attendance/activities/${a.id}/checklist-items`)
      setItems(r)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load checklist')
    }
  }

  async function addItem() {
    if (!editItemsFor || !newItemLabel.trim()) return
    setSavingItem(true)
    try {
      const r = await apiFetch<ChecklistItem>(
        `/attendance/activities/${editItemsFor.id}/checklist-items`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: newItemLabel.trim(), item_type: newItemType,
            required: newItemRequired, help_text: newItemHelp.trim() || null,
          }),
        })
      setItems(prev => [...prev, r])
      setNewItemLabel(''); setNewItemHelp(''); setNewItemRequired(true); setNewItemType('checkbox')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add item')
    } finally {
      setSavingItem(false)
    }
  }

  async function updateItem(it: ChecklistItem, patch: Partial<ChecklistItem>) {
    const next = { ...it, ...patch }
    setItems(prev => prev.map(x => (x.id === it.id ? next : x)))
    try {
      await apiFetch(`/attendance/checklist-items/${it.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: next.label, item_type: next.item_type,
          required: next.required, help_text: next.help_text || null,
          order_index: next.order_index,
        }),
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
      // Revert on failure
      setItems(prev => prev.map(x => (x.id === it.id ? it : x)))
    }
  }

  async function deleteItem(it: ChecklistItem) {
    if (!confirm(`Delete checklist item "${it.label}"?`)) return
    try {
      await apiFetch(`/attendance/checklist-items/${it.id}`, { method: 'DELETE' })
      setItems(prev => prev.filter(x => x.id !== it.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function moveItem(it: ChecklistItem, dir: -1 | 1) {
    const sorted = [...items].sort((a, b) => a.order_index - b.order_index)
    const idx = sorted.findIndex(x => x.id === it.id)
    const neighbour = sorted[idx + dir]
    if (!neighbour) return
    const swapped = sorted.map(x => {
      if (x.id === it.id) return { ...x, order_index: neighbour.order_index }
      if (x.id === neighbour.id) return { ...x, order_index: it.order_index }
      return x
    })
    setItems(swapped)
    try {
      await apiFetch(`/attendance/activities/${editItemsFor!.id}/checklist-items/reorder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: swapped.map(x => ({ id: x.id, order_index: x.order_index })),
        }),
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reorder failed')
    }
  }

  // ── Assignment inline checklist (volunteer-facing tick-off) ────────────────
  async function openAssignmentChecklist(a: Assignment) {
    if (expandedAssignmentId === a.id) {
      setExpandedAssignmentId(null); setChecklistEntries([])
      return
    }
    setExpandedAssignmentId(a.id); setChecklistEntries([]); setChecklistLoading(true)
    try {
      const r = await apiFetch<{ items: AssignmentChecklistEntry[] }>(`/attendance/assignments/${a.id}/checklist`)
      setChecklistEntries(r.items || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load checklist')
    } finally {
      setChecklistLoading(false)
    }
  }

  async function setItemState(assignmentId: string, item: AssignmentChecklistEntry,
                              patch: Partial<AssignmentChecklistEntry>) {
    const next = { ...item, ...patch }
    setChecklistEntries(prev => prev.map(x => (x.item_id === item.item_id ? next : x)))
    try {
      await apiFetch(`/attendance/assignments/${assignmentId}/checklist/${item.item_id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_checked: next.is_checked,
          value_text: next.value_text || null,
          value_number: next.value_number ?? null,
          photo_url: next.photo_url || null,
          signature_data: next.signature_data || null,
        }),
      })
      // Refresh the assignment status (may have auto-flipped to in_progress / done)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
      setChecklistEntries(prev => prev.map(x => (x.item_id === item.item_id ? item : x)))
    }
  }

  async function remove(a: Assignment) {
    if (!confirm(`Remove this assignment of "${a.activity_name}" from ${a.person_name}?`)) return
    try {
      await apiFetch(`/attendance/assignments/${a.id}`, { method: 'DELETE' })
      toast.success('Removed')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Remove failed')
    }
  }

  const pickerPeople = useMemo(() => {
    return assignPersonType === 'employee' ? roster.employees : roster.volunteers
  }, [assignPersonType, roster])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-white">📋 Activities</h1>
        <p className="text-white/40 mt-1 text-sm">
          Named tasks you assign to volunteers and staff. Attendance + activities together give you a
          real-time view of who&apos;s doing what, when.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* LEFT · Activity catalogue */}
        <div className="space-y-4">
          <h2 className="text-white/70 font-bold text-sm uppercase tracking-wider">Activity catalogue</h2>

          <form onSubmit={createActivity} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-2">
            <input
              value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="New activity name (e.g. Kitchen prep)"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-saffron-400/50"
            />
            <input
              value={newDesc} onChange={e => setNewDesc(e.target.value)}
              placeholder="Optional description"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-saffron-400/50"
            />
            <button
              type="submit" disabled={creating || !newName.trim()}
              className="px-4 py-2 rounded-lg bg-saffron-500/20 text-saffron-200 border border-saffron-400/40 text-sm font-bold hover:bg-saffron-500/30 transition disabled:opacity-50">
              {creating ? 'Creating…' : '+ Add activity'}
            </button>
          </form>

          {loading ? (
            <div className="text-white/40 text-sm">Loading…</div>
          ) : activities.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-white/40 text-sm">
              No activities yet. Create one above.
            </div>
          ) : (
            <div className="space-y-2">
              {activities.map(a => (
                <motion.div key={a.id} layout
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-white font-bold">{a.name}</div>
                    {a.description && (
                      <div className="text-white/50 text-xs mt-1">{a.description}</div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0 flex-wrap">
                    <button onClick={() => openEditItems(a)}
                      className="px-3 py-1.5 rounded-lg bg-white/5 text-white/60 border border-white/10 text-xs hover:bg-white/10 hover:text-white"
                      title="Edit the checklist items that appear when this activity is assigned">
                      📝 Checklist
                    </button>
                    <button onClick={() => openAssign(a)}
                      className="px-3 py-1.5 rounded-lg bg-saffron-500/20 text-saffron-200 border border-saffron-400/40 text-xs font-bold hover:bg-saffron-500/30">
                      Assign…
                    </button>
                    <button onClick={() => archive(a)}
                      className="px-3 py-1.5 rounded-lg bg-white/5 text-white/40 border border-white/10 text-xs hover:bg-white/10 hover:text-white/70">
                      Archive
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT · Day schedule */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-white/70 font-bold text-sm uppercase tracking-wider">Schedule</h2>
            <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
              className="ml-auto bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm outline-none focus:border-saffron-400/50" />
          </div>

          {assignments.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-white/40 text-sm">
              No assignments for this day.
            </div>
          ) : (
            <div className="space-y-2">
              {assignments.map(a => (
                <motion.div key={a.id} layout
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-white font-bold text-sm">{a.activity_name}</div>
                      <div className="text-white/60 text-xs mt-0.5">
                        {a.person_name || a.person_id.slice(0, 8)}
                        <span className="text-white/30"> · {a.person_type}</span>
                        {a.start_time && (
                          <span className="text-white/30"> · {a.start_time.slice(0, 5)}
                            {a.end_time ? `–${a.end_time.slice(0, 5)}` : ''}
                          </span>
                        )}
                      </div>
                      {a.notes && (
                        <div className="text-white/50 text-xs mt-1 italic">{a.notes}</div>
                      )}
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${STATUS_STYLES[a.status]}`}>
                      {a.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 text-xs">
                    {(['assigned', 'in_progress', 'done', 'skipped'] as const).map(s => (
                      <button key={s} onClick={() => setStatus(a, s)}
                        disabled={a.status === s}
                        className={`px-2 py-0.5 rounded border transition ${
                          a.status === s ? 'bg-white/10 text-white/40 border-white/10 cursor-default'
                                         : 'bg-white/[0.03] text-white/60 border-white/10 hover:bg-white/10'
                        }`}>
                        {s === 'in_progress' ? 'in progress' : s}
                      </button>
                    ))}
                    <button onClick={() => openAssignmentChecklist(a)}
                      className="ml-auto px-2 py-0.5 rounded border bg-white/[0.03] text-saffron-200 border-saffron-400/30 hover:bg-saffron-500/10">
                      {expandedAssignmentId === a.id ? '▲ Hide' : '▼ Checklist'}
                    </button>
                    <button onClick={() => remove(a)}
                      className="px-2 py-0.5 rounded border bg-white/[0.03] text-rose-300/80 border-rose-500/20 hover:bg-rose-500/10">
                      Remove
                    </button>
                  </div>

                  {/* Inline checklist (volunteer tick-off / data entry) */}
                  {expandedAssignmentId === a.id && (
                    <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                      {checklistLoading ? (
                        <div className="text-white/40 text-xs">Loading checklist…</div>
                      ) : checklistEntries.length === 0 ? (
                        <div className="text-white/40 text-xs italic">
                          No checklist items defined on this template yet. Add some from the catalogue on the left (📝 Checklist).
                        </div>
                      ) : (
                        checklistEntries.map(it => (
                          <div key={it.item_id} className="rounded-lg bg-white/[0.02] border border-white/5 p-2">
                            <div className="flex items-start gap-2">
                              {it.item_type === 'checkbox' ? (
                                <input type="checkbox" checked={it.is_checked}
                                  onChange={e => setItemState(a.id, it, { is_checked: e.target.checked })}
                                  className="mt-0.5 accent-saffron-400 w-4 h-4 shrink-0" />
                              ) : (
                                <span className="mt-0.5 text-saffron-300 text-xs shrink-0">●</span>
                              )}
                              <div className="flex-1 min-w-0">
                                <label className="text-white text-xs font-semibold flex items-center gap-1">
                                  {it.label}
                                  {it.required && <span className="text-rose-300">*</span>}
                                  <span className="text-white/30 text-[10px] uppercase ml-1">{it.item_type}</span>
                                </label>
                                {it.help_text && (
                                  <p className="text-white/40 text-[11px] italic mt-0.5">{it.help_text}</p>
                                )}
                                {it.item_type === 'text' && (
                                  <input type="text" defaultValue={it.value_text}
                                    onBlur={e => setItemState(a.id, it, { value_text: e.target.value })}
                                    placeholder="Record value…"
                                    className="mt-1 w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs" />
                                )}
                                {it.item_type === 'number' && (
                                  <input type="number" step="any" defaultValue={it.value_number ?? ''}
                                    onBlur={e => setItemState(a.id, it, { value_number: e.target.value === '' ? null : parseFloat(e.target.value) })}
                                    placeholder="e.g. 4.5"
                                    className="mt-1 w-32 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs" />
                                )}
                                {it.item_type === 'photo' && (
                                  <input type="url" defaultValue={it.photo_url}
                                    onBlur={e => setItemState(a.id, it, { photo_url: e.target.value })}
                                    placeholder="Paste image URL (uploader coming in phase 3)"
                                    className="mt-1 w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs" />
                                )}
                                {it.item_type === 'signature' && (
                                  <input type="text" defaultValue={it.signature_data}
                                    onBlur={e => setItemState(a.id, it, { signature_data: e.target.value })}
                                    placeholder="Signatory name (pad coming in phase 3)"
                                    className="mt-1 w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs" />
                                )}
                                {it.checked_by && it.checked_at && (
                                  <p className="text-white/30 text-[10px] mt-1">
                                    by {it.checked_by} · {new Date(it.checked_at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Assign modal */}
      {assignFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.6)' }}
             onClick={() => setAssignFor(null)}>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg rounded-2xl border border-white/10 p-5 space-y-3"
            style={{ background: '#180a0a' }}
            onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-black text-lg">
              Assign: <span className="text-saffron-200">{assignFor.name}</span>
            </h3>
            <div className="flex gap-2">
              {(['volunteer', 'employee'] as const).map(t => (
                <button key={t} type="button"
                  onClick={() => { setAssignPersonType(t); setAssignPerson('') }}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition
                    ${assignPersonType === t ? 'bg-saffron-500/20 text-saffron-200 border border-saffron-400/40'
                                             : 'bg-white/5 text-white/50 border border-white/10'}`}>
                  {t === 'employee' ? 'Staff' : 'Volunteer'}
                </button>
              ))}
            </div>
            <select
              value={assignPerson} onChange={e => setAssignPerson(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-saffron-400/50">
              <option value="">— pick {assignPersonType === 'employee' ? 'staff member' : 'volunteer'} —</option>
              {pickerPeople.map(p => (
                <option key={p.id} value={p.id}>{p.name || p.id.slice(0, 8)}{p.role ? ` — ${p.role}` : ''}</option>
              ))}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-white/50 text-xs mb-1">Date</label>
                <input type="date" value={assignDate} onChange={e => setAssignDate(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
              </div>
              <div>
                <label className="block text-white/50 text-xs mb-1">Start</label>
                <input type="time" value={assignStart} onChange={e => setAssignStart(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
              </div>
              <div>
                <label className="block text-white/50 text-xs mb-1">End</label>
                <input type="time" value={assignEnd} onChange={e => setAssignEnd(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
              </div>
            </div>
            <textarea rows={2} value={assignNotes} onChange={e => setAssignNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-saffron-400/50" />
            <div className="flex gap-2 pt-2">
              <button onClick={submitAssign} disabled={!assignPerson || assigning}
                className="flex-1 px-4 py-2.5 rounded-lg text-white font-bold text-sm transition disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#B91C1C,#7f1010)' }}>
                {assigning ? 'Assigning…' : 'Assign'}
              </button>
              <button onClick={() => setAssignFor(null)}
                className="px-4 py-2.5 rounded-lg bg-white/5 text-white/70 border border-white/10 text-sm">
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Checklist editor modal (define items on a template) */}
      {editItemsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.6)' }}
             onClick={() => setEditItemsFor(null)}>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 p-5 space-y-4"
            style={{ background: '#180a0a' }}
            onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-white font-black text-lg">
                Checklist for: <span className="text-saffron-200">{editItemsFor.name}</span>
              </h3>
              <p className="text-white/40 text-xs mt-1">
                Items here appear on every assignment of this activity.
                Volunteer ticks them off, auto-completes the task when all required items are done.
              </p>
            </div>

            {/* Add-item row */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
              <div className="flex gap-2 flex-wrap">
                <input value={newItemLabel} onChange={e => setNewItemLabel(e.target.value)}
                  placeholder="New item (e.g. Degrease oven)"
                  className="flex-1 min-w-[200px] bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
                <select value={newItemType} onChange={e => setNewItemType(e.target.value as ItemType)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
                  <option value="checkbox">☑ Checkbox</option>
                  <option value="text">📝 Text</option>
                  <option value="number">🔢 Number</option>
                  <option value="photo">📷 Photo</option>
                  <option value="signature">✍️ Signature</option>
                </select>
                <label className="flex items-center gap-1 text-xs text-white/60">
                  <input type="checkbox" checked={newItemRequired}
                    onChange={e => setNewItemRequired(e.target.checked)}
                    className="accent-saffron-400" />
                  Required
                </label>
              </div>
              <input value={newItemHelp} onChange={e => setNewItemHelp(e.target.value)}
                placeholder="Optional help text (shown under the item)"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
              <button onClick={addItem} disabled={savingItem || !newItemLabel.trim()}
                className="px-4 py-2 rounded-lg bg-saffron-500/20 text-saffron-200 border border-saffron-400/40 text-sm font-bold hover:bg-saffron-500/30 disabled:opacity-50">
                {savingItem ? 'Adding…' : '+ Add item'}
              </button>
            </div>

            {/* Items list */}
            {items.length === 0 ? (
              <div className="text-white/40 text-sm italic text-center py-6">
                No items yet. Add your first item above.
              </div>
            ) : (
              <div className="space-y-2">
                {[...items].sort((a, b) => a.order_index - b.order_index).map((it, idx, arr) => (
                  <div key={it.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex items-start gap-2">
                    <div className="flex flex-col gap-0.5 text-white/40 text-xs">
                      <button onClick={() => moveItem(it, -1)} disabled={idx === 0}
                        className="hover:text-white disabled:opacity-20">▲</button>
                      <button onClick={() => moveItem(it, 1)} disabled={idx === arr.length - 1}
                        className="hover:text-white disabled:opacity-20">▼</button>
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <input value={it.label}
                        onChange={e => setItems(prev => prev.map(x => x.id === it.id ? { ...x, label: e.target.value } : x))}
                        onBlur={e => updateItem(it, { label: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-sm font-semibold" />
                      <div className="flex gap-2 flex-wrap items-center text-xs">
                        <select value={it.item_type}
                          onChange={e => updateItem(it, { item_type: e.target.value as ItemType })}
                          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white">
                          <option value="checkbox">☑ Checkbox</option>
                          <option value="text">📝 Text</option>
                          <option value="number">🔢 Number</option>
                          <option value="photo">📷 Photo</option>
                          <option value="signature">✍️ Signature</option>
                        </select>
                        <label className="flex items-center gap-1 text-white/60">
                          <input type="checkbox" checked={it.required}
                            onChange={e => updateItem(it, { required: e.target.checked })}
                            className="accent-saffron-400" />
                          Required
                        </label>
                      </div>
                      <input value={it.help_text || ''}
                        onChange={e => setItems(prev => prev.map(x => x.id === it.id ? { ...x, help_text: e.target.value } : x))}
                        onBlur={e => updateItem(it, { help_text: e.target.value })}
                        placeholder="Help text (optional)"
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white/70 text-xs" />
                    </div>
                    <button onClick={() => deleteItem(it)}
                      className="px-2 py-1 rounded border bg-white/[0.03] text-rose-300/80 border-rose-500/20 hover:bg-rose-500/10 text-xs shrink-0">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex pt-2">
              <button onClick={() => setEditItemsFor(null)}
                className="ml-auto px-4 py-2 rounded-lg bg-white/5 text-white/70 border border-white/10 text-sm">
                Done
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
