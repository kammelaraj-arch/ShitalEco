'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'

interface AccountDetail {
  id: string
  name: string
  legal_name: string
  account_type: string
  status: string
  website: string
  email: string
  phone: string
  industry: string
  registration_number: string
  vat_number: string
  charity_number: string
  primary_contact_id: string | null
  primary_contact_name: string | null
  parent_account_id: string | null
  parent_account_name: string | null
  branch_id: string
  notes: string
  created_at: string
  updated_at: string
}

interface ContactLink {
  link_id: string
  contact_id: string
  full_name: string
  first_name: string
  surname: string
  email: string
  phone: string
  role: string
  is_primary: boolean
  linked_at: string
}

interface Service {
  id: string
  service_name: string
  service_type: string
  description: string
  is_active: boolean
  created_at: string
}

interface AccountAddress {
  id: string
  formatted: string
  postcode: string
  house_number: string
  uprn: string
  is_primary: boolean
  created_at: string
}

interface ContactSearchResult {
  id: string
  full_name: string
  email: string
}

interface AddressSearchResult {
  id: string
  formatted: string
  postcode: string
  contact_name: string | null
}

const ACCOUNT_TYPES = ['customer', 'vendor', 'partner', 'donor', 'supplier', 'charity-partner']
const STATUSES = ['active', 'prospect', 'inactive']

export default function AccountDetailPageWrapper() {
  // useSearchParams() needs a Suspense boundary under static export.
  return (
    <Suspense fallback={<div className="text-center py-20 text-white/30">Loading…</div>}>
      <AccountDetailPage />
    </Suspense>
  )
}

function AccountDetailPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = searchParams.get('id') || ''

  const [account, setAccount] = useState<AccountDetail | null>(null)
  const [contacts, setContacts] = useState<ContactLink[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [addresses, setAddresses] = useState<AccountAddress[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'details' | 'contacts' | 'services' | 'addresses'>('details')

  // Contact picker
  const [contactQ, setContactQ] = useState('')
  const [contactResults, setContactResults] = useState<ContactSearchResult[]>([])
  const [linkRole, setLinkRole] = useState('')
  const [showCreateContact, setShowCreateContact] = useState(false)
  const [newContact, setNewContact] = useState({ first_name: '', surname: '', email: '', phone: '' })
  const [creatingContact, setCreatingContact] = useState(false)

  // Service form
  const [serviceName, setServiceName] = useState('')
  const [serviceType, setServiceType] = useState('')
  const [serviceDesc, setServiceDesc] = useState('')

  // Address picker
  const [addressQ, setAddressQ] = useState('')
  const [addressResults, setAddressResults] = useState<AddressSearchResult[]>([])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setError('')
    try {
      const data = await apiFetch<{
        account: AccountDetail
        contacts: ContactLink[]
        services: Service[]
        addresses: AccountAddress[]
      }>(`/admin/accounts/${id}`)
      setAccount(data.account)
      setContacts(data.contacts || [])
      setServices(data.services || [])
      setAddresses(data.addresses || [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!account) return
    setSaving(true); setError('')
    try {
      await apiFetch(`/admin/accounts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: account.name,
          legal_name: account.legal_name,
          account_type: account.account_type,
          status: account.status,
          website: account.website,
          email: account.email,
          phone: account.phone,
          industry: account.industry,
          registration_number: account.registration_number,
          vat_number: account.vat_number,
          charity_number: account.charity_number,
          primary_contact_id: account.primary_contact_id,
          parent_account_id: account.parent_account_id,
          branch_id: account.branch_id,
          notes: account.notes,
        }),
      })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!account) return
    if (!confirm(`Delete account "${account.name}"? This soft-deletes — addresses/contacts remain.`)) return
    try {
      await apiFetch(`/admin/accounts/${id}`, { method: 'DELETE' })
      router.push('/accounts')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  // Contact picker — calls existing /admin/contacts search
  useEffect(() => {
    if (!contactQ.trim()) { setContactResults([]); return }
    const t = setTimeout(async () => {
      try {
        const data = await apiFetch<{ contacts: ContactSearchResult[] }>(`/admin/contacts?q=${encodeURIComponent(contactQ)}&per_page=10`)
        setContactResults(data.contacts || [])
      } catch { setContactResults([]) }
    }, 250)
    return () => clearTimeout(t)
  }, [contactQ])

  // Pre-fill the new-contact form from whatever's in the search box (best guess).
  // If the query has a space, treat it as "First Surname"; otherwise drop it
  // into First name. Email goes in if it looks like one.
  const openCreateContact = () => {
    const q = contactQ.trim()
    if (q.includes('@')) {
      setNewContact({ first_name: '', surname: '', email: q, phone: '' })
    } else if (q.includes(' ')) {
      const [first, ...rest] = q.split(/\s+/)
      setNewContact({ first_name: first, surname: rest.join(' '), email: '', phone: '' })
    } else if (q) {
      setNewContact({ first_name: q, surname: '', email: '', phone: '' })
    }
    setShowCreateContact(true)
  }

  const createAndLinkContact = async (makePrimary: boolean) => {
    if (!newContact.first_name && !newContact.surname && !newContact.email) return
    setCreatingContact(true)
    try {
      const created = await apiFetch<{ id: string }>('/admin/contacts', {
        method: 'POST',
        body: JSON.stringify({
          first_name: newContact.first_name,
          surname:    newContact.surname,
          full_name:  `${newContact.first_name} ${newContact.surname}`.trim(),
          email:      newContact.email,
          phone:      newContact.phone,
          first_source: 'admin',
        }),
      })
      await apiFetch(`/admin/accounts/${id}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ contact_id: created.id, role: linkRole, is_primary: makePrimary }),
      })
      setShowCreateContact(false)
      setNewContact({ first_name: '', surname: '', email: '', phone: '' })
      setContactQ(''); setContactResults([]); setLinkRole('')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create + link contact')
    } finally {
      setCreatingContact(false)
    }
  }

  const linkContact = async (cid: string, makePrimary: boolean) => {
    try {
      await apiFetch(`/admin/accounts/${id}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ contact_id: cid, role: linkRole, is_primary: makePrimary }),
      })
      setContactQ(''); setContactResults([]); setLinkRole('')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to link contact')
    }
  }

  const unlinkContact = async (cid: string) => {
    if (!confirm('Unlink this contact from the account?')) return
    try {
      await apiFetch(`/admin/accounts/${id}/contacts/${cid}`, { method: 'DELETE' })
      await load()
    } catch { /* ignore */ }
  }

  const addService = async () => {
    if (!serviceName.trim()) return
    try {
      await apiFetch(`/admin/accounts/${id}/services`, {
        method: 'POST',
        body: JSON.stringify({
          service_name: serviceName.trim(),
          service_type: serviceType,
          description: serviceDesc,
          is_active: true,
        }),
      })
      setServiceName(''); setServiceType(''); setServiceDesc('')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add service')
    }
  }

  const removeService = async (sid: string) => {
    if (!confirm('Remove this service?')) return
    try {
      await apiFetch(`/admin/accounts/${id}/services/${sid}`, { method: 'DELETE' })
      await load()
    } catch { /* ignore */ }
  }

  // Address picker — search unlinked addresses via existing endpoint
  useEffect(() => {
    if (!addressQ.trim()) { setAddressResults([]); return }
    const t = setTimeout(async () => {
      try {
        const data = await apiFetch<{ addresses: AddressSearchResult[] }>(
          `/admin/addresses?q=${encodeURIComponent(addressQ)}&per_page=10`,
        )
        setAddressResults(data.addresses || [])
      } catch { setAddressResults([]) }
    }, 250)
    return () => clearTimeout(t)
  }, [addressQ])

  const linkAddress = async (addressId: string) => {
    try {
      await apiFetch(`/admin/accounts/${id}/addresses`, {
        method: 'POST',
        body: JSON.stringify({ address_id: addressId }),
      })
      setAddressQ(''); setAddressResults([])
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to link address')
    }
  }

  const unlinkAddress = async (addrId: string) => {
    if (!confirm('Unlink this address from the account? The address itself is kept.')) return
    try {
      await apiFetch(`/admin/accounts/${id}/addresses/${addrId}`, { method: 'DELETE' })
      await load()
    } catch { /* ignore */ }
  }

  if (loading) return <div className="text-center py-20 text-white/30">Loading…</div>
  if (!account) return <div className="text-center py-20 text-white/30">Account not found.</div>

  const setField = <K extends keyof AccountDetail>(k: K, v: AccountDetail[K]) =>
    setAccount(a => (a ? { ...a, [k]: v } : a))

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/accounts" className="text-white/40 text-sm hover:text-white/80">← Back to accounts</Link>
          <h1 className="text-3xl font-black text-white mt-1">{account.name}</h1>
          {account.legal_name && account.legal_name !== account.name && (
            <p className="text-white/40">{account.legal_name}</p>
          )}
        </div>
        <button onClick={remove}
          className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm font-bold hover:bg-red-500/20 transition">
          Delete
        </button>
      </div>

      {error && <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{error}</div>}

      <div className="flex gap-1 p-1 glass rounded-xl w-fit flex-wrap">
        {(['details', 'contacts', 'services', 'addresses'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all capitalize ${
              tab === t ? 'bg-saffron-gradient text-white shadow-saffron' : 'text-white/50 hover:text-white/80'
            }`}>
            {t === 'contacts'   ? `Contacts (${contacts.length})`
             : t === 'services' ? `Services (${services.length})`
             : t === 'addresses'? `Addresses (${addresses.length})`
             : 'Details'}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <div className="glass rounded-2xl p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Name *" value={account.name} onChange={v => setField('name', v)} />
            <Field label="Legal name" value={account.legal_name} onChange={v => setField('legal_name', v)} />
            <Select label="Type" value={account.account_type} onChange={v => setField('account_type', v)} options={ACCOUNT_TYPES} />
            <Select label="Status" value={account.status} onChange={v => setField('status', v)} options={STATUSES} />
            <Field label="Website" value={account.website} onChange={v => setField('website', v)} />
            <Field label="Email" value={account.email} onChange={v => setField('email', v)} />
            <Field label="Phone" value={account.phone} onChange={v => setField('phone', v)} />
            <Field label="Industry" value={account.industry} onChange={v => setField('industry', v)} />
            <Field label="Companies House #" value={account.registration_number} onChange={v => setField('registration_number', v)} />
            <Field label="VAT #" value={account.vat_number} onChange={v => setField('vat_number', v)} />
            <Field label="Charity #" value={account.charity_number} onChange={v => setField('charity_number', v)} />
            <Field label="Branch (code)" value={account.branch_id} onChange={v => setField('branch_id', v)} />
          </div>
          <div>
            <label className="block text-white/40 text-xs uppercase tracking-wider mb-1.5">Notes</label>
            <textarea
              value={account.notes}
              onChange={e => setField('notes', e.target.value)}
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-saffron-500/60"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={save} disabled={saving}
              className="px-5 py-2.5 rounded-lg bg-saffron-gradient text-white font-bold shadow-saffron hover:opacity-90 disabled:opacity-40 transition">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      {tab === 'contacts' && (
        <div className="glass rounded-2xl p-6 space-y-5">
          <div>
            <h3 className="text-white font-bold text-lg mb-1">Linked contacts</h3>
            <p className="text-white/40 text-sm">People at this account, with their role.</p>
          </div>

          <div className="rounded-xl bg-white/[0.02] border border-white/5 p-4 space-y-3">
            <p className="text-white/60 text-sm font-bold">Add a contact</p>
            <div className="flex gap-3 flex-wrap">
              <input
                value={contactQ}
                onChange={e => setContactQ(e.target.value)}
                placeholder="Search existing contacts (name, email)…"
                className="flex-1 min-w-[260px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-saffron-500/60"
              />
              <input
                value={linkRole}
                onChange={e => setLinkRole(e.target.value)}
                placeholder="Role (CEO, Trustee…)"
                className="w-48 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-saffron-500/60"
              />
            </div>
            {contactResults.length > 0 && (
              <div className="border border-white/10 rounded-lg overflow-hidden">
                {contactResults.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 last:border-0 hover:bg-white/5">
                    <div>
                      <div className="text-white text-sm font-medium">{c.full_name || '(no name)'}</div>
                      <div className="text-white/40 text-xs">{c.email || '—'}</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => linkContact(c.id, false)}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10">
                        Add
                      </button>
                      <button onClick={() => linkContact(c.id, true)}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-saffron-gradient text-white shadow-saffron hover:opacity-90">
                        Add as primary
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* No-match hint or create CTA */}
            {!showCreateContact && (
              <button onClick={openCreateContact}
                className="text-saffron-400 hover:text-saffron-300 text-xs font-bold underline">
                {contactQ && contactResults.length === 0
                  ? `+ Create new contact "${contactQ}"`
                  : '+ Create new contact'}
              </button>
            )}

            {showCreateContact && (
              <div className="rounded-lg border border-saffron-500/30 bg-saffron-500/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-saffron-300 text-sm font-bold">New contact</p>
                  <button onClick={() => { setShowCreateContact(false); setNewContact({ first_name: '', surname: '', email: '', phone: '' }) }}
                    className="text-white/40 hover:text-white/80 text-xs">Cancel</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input value={newContact.first_name}
                    onChange={e => setNewContact(c => ({ ...c, first_name: e.target.value }))}
                    placeholder="First name"
                    className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-saffron-500/60 text-sm" />
                  <input value={newContact.surname}
                    onChange={e => setNewContact(c => ({ ...c, surname: e.target.value }))}
                    placeholder="Surname"
                    className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-saffron-500/60 text-sm" />
                  <input value={newContact.email} type="email"
                    onChange={e => setNewContact(c => ({ ...c, email: e.target.value }))}
                    placeholder="Email"
                    className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-saffron-500/60 text-sm" />
                  <input value={newContact.phone}
                    onChange={e => setNewContact(c => ({ ...c, phone: e.target.value }))}
                    placeholder="Phone"
                    className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-saffron-500/60 text-sm" />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => createAndLinkContact(false)} disabled={creatingContact}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-40">
                    {creatingContact ? 'Creating…' : 'Create & link'}
                  </button>
                  <button onClick={() => createAndLinkContact(true)} disabled={creatingContact}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-saffron-gradient text-white shadow-saffron hover:opacity-90 disabled:opacity-40">
                    {creatingContact ? 'Creating…' : 'Create & link as primary'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {contacts.length === 0 ? (
            <div className="text-center py-10 text-white/30">No contacts linked yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    {['Name', 'Email', 'Phone', 'Role', 'Primary', ''].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-semibold uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contacts.map(c => (
                    <tr key={c.link_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-white text-sm font-medium">{c.full_name || '—'}</td>
                      <td className="px-4 py-3 text-white/60 text-sm font-mono">{c.email || '—'}</td>
                      <td className="px-4 py-3 text-white/60 text-sm font-mono">{c.phone || '—'}</td>
                      <td className="px-4 py-3 text-white/70 text-sm">{c.role || '—'}</td>
                      <td className="px-4 py-3">
                        {c.is_primary
                          ? <span className="text-xs font-bold text-saffron-300">★ Primary</span>
                          : <span className="text-white/30 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => unlinkContact(c.contact_id)}
                          className="text-red-400/70 hover:text-red-400 text-xs underline">
                          Unlink
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'services' && (
        <div className="glass rounded-2xl p-6 space-y-5">
          <div>
            <h3 className="text-white font-bold text-lg mb-1">Services / capabilities</h3>
            <p className="text-white/40 text-sm">What this account provides — multiple entries allowed.</p>
          </div>

          <div className="rounded-xl bg-white/[0.02] border border-white/5 p-4 space-y-3">
            <p className="text-white/60 text-sm font-bold">Add a service</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input value={serviceName} onChange={e => setServiceName(e.target.value)} placeholder="Service name (required)"
                className="px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-saffron-500/60" />
              <input value={serviceType} onChange={e => setServiceType(e.target.value)} placeholder="Type (catering, cleaning, audit…)"
                className="px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-saffron-500/60" />
            </div>
            <input value={serviceDesc} onChange={e => setServiceDesc(e.target.value)} placeholder="Description (optional)"
              className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-saffron-500/60" />
            <button onClick={addService} disabled={!serviceName.trim()}
              className="px-4 py-2 rounded-lg bg-saffron-gradient text-white text-sm font-bold shadow-saffron hover:opacity-90 disabled:opacity-40 transition">
              + Add service
            </button>
          </div>

          {services.length === 0 ? (
            <div className="text-center py-10 text-white/30">No services yet.</div>
          ) : (
            <div className="space-y-2">
              {services.map(s => (
                <div key={s.id} className="flex items-start justify-between gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-bold">{s.service_name}</span>
                      {s.service_type && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/60">{s.service_type}</span>
                      )}
                      {!s.is_active && <span className="text-xs text-white/30">(inactive)</span>}
                    </div>
                    {s.description && <p className="text-white/50 text-sm mt-1">{s.description}</p>}
                  </div>
                  <button onClick={() => removeService(s.id)}
                    className="text-red-400/70 hover:text-red-400 text-xs underline">Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'addresses' && (
        <div className="glass rounded-2xl p-6 space-y-5">
          <div>
            <h3 className="text-white font-bold text-lg mb-1">Addresses</h3>
            <p className="text-white/40 text-sm">
              Linked from the existing addresses lookup —{' '}
              <Link href="/addresses" className="text-saffron-400 underline">add a new address there</Link>{' '}
              first if needed, then attach it here.
            </p>
          </div>

          <div className="rounded-xl bg-white/[0.02] border border-white/5 p-4 space-y-3">
            <p className="text-white/60 text-sm font-bold">Attach an existing address</p>
            <input
              value={addressQ}
              onChange={e => setAddressQ(e.target.value)}
              placeholder="Search by postcode, street, contact…"
              className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-saffron-500/60"
            />
            {addressResults.length > 0 && (
              <div className="border border-white/10 rounded-lg overflow-hidden">
                {addressResults.map(a => (
                  <div key={a.id} className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 last:border-0 hover:bg-white/5">
                    <div className="flex-1">
                      <div className="text-white text-sm">{a.formatted || '—'}</div>
                      <div className="text-white/40 text-xs font-mono">
                        {a.postcode}{a.contact_name ? ` · linked to ${a.contact_name}` : ''}
                      </div>
                    </div>
                    <button onClick={() => linkAddress(a.id)}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg bg-saffron-gradient text-white shadow-saffron hover:opacity-90">
                      Attach
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {addresses.length === 0 ? (
            <div className="text-center py-10 text-white/30">No addresses attached yet.</div>
          ) : (
            <div className="space-y-2">
              {addresses.map(a => (
                <div key={a.id} className="flex items-start justify-between gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="flex-1">
                    <div className="text-white text-sm">{a.formatted || '—'}</div>
                    <div className="text-white/40 text-xs font-mono">
                      {a.house_number && `${a.house_number} · `}{a.postcode}
                      {a.uprn && ` · UPRN ${a.uprn}`}
                      {a.is_primary && ' · primary'}
                    </div>
                  </div>
                  <button onClick={() => unlinkAddress(a.id)}
                    className="text-red-400/70 hover:text-red-400 text-xs underline">Unlink</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-white/40 text-xs uppercase tracking-wider mb-1.5">{label}</label>
      <input
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-saffron-500/60"
      />
    </div>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="block text-white/40 text-xs uppercase tracking-wider mb-1.5">{label}</label>
      <select value={value || ''} onChange={e => onChange(e.target.value)}
        className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-saffron-500/60">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}
