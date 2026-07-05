import { cachedFetch } from './utils/cachedFetch'

const API = (import.meta.env.VITE_API_URL as string) || '/api/v1'

export const api = {
  async getItems(category?: string, branchId = 'main') {
    const q = new URLSearchParams({ branch_id: branchId, active_only: 'true' })
    if (category) q.set('category', category)
    const d = await cachedFetch<{ items?: unknown[] }>(`${API}/items?${q}`)
    return ((d?.items ?? []) as any[])
  },

  async getSoftDonations(branchId = 'main') {
    const d = await cachedFetch<{ items?: unknown[] }>(`${API}/items/kiosk/soft-donations?branch_id=${branchId}`)
    return ((d?.items ?? []) as any[])
  },

  async getProjects(branchId = 'main') {
    const d = await cachedFetch<{ items?: unknown[]; projects?: unknown[] }>(`${API}/items/kiosk/projects?branch_id=${branchId}`)
    return ({ items: d?.items ?? [], projects: d?.projects ?? [] } as { items: any[]; projects: any[] })
  },

  async getShop(branchId = 'main') {
    const d = await cachedFetch<{ items?: unknown[] }>(`${API}/items/kiosk/shop?branch_id=${branchId}`)
    return ((d?.items ?? []) as any[])
  },

  async getSponsorship(branchId = 'main') {
    const d = await cachedFetch<{ items?: unknown[] }>(`${API}/items/kiosk/sponsorship?branch_id=${branchId}`)
    return ((d?.items ?? []) as any[])
  },

  async getGeneralDonations() {
    const d = await cachedFetch<{ items?: unknown[] }>(`${API}/items/kiosk/general-donations`)
    return ((d?.items ?? []) as any[])
  },

  async getServices(branchId = 'main') {
    const d = await cachedFetch<{ services?: unknown[] }>(`${API}/kiosk/services?branch_id=${branchId}`)
    return ((d?.services ?? []) as any[])
  },

  async createBasket(branchId = 'main') {
    try {
      const r = await fetch(`${API}/kiosk/basket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: branchId }),
      })
      if (!r.ok) return null
      const d = await r.json()
      return d.basket_id ?? null
    } catch { return null }
  },

  async addBasketItem(params: {
    basket_id: string; item_type: string; reference_id?: string
    name: string; quantity: number; unit_price: number
  }) {
    try {
      await fetch(`${API}/kiosk/basket/item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
    } catch { /* non-fatal */ }
  },

  async lookupPostcode(postcode: string): Promise<Array<{ formatted: string; uprn: string }>> {
    try {
      const r = await fetch(`${API}/kiosk/postcode/${encodeURIComponent(postcode)}`)
      if (!r.ok) return []
      const d = await r.json()
      const raw: unknown[] = d.addresses ?? []
      return raw.map((a) =>
        typeof a === 'string'
          ? { formatted: a, uprn: '' }
          : { formatted: (a as { formatted: string }).formatted ?? '', uprn: (a as { uprn?: string }).uprn ?? '' }
      )
    } catch { return [] }
  },

  async sendReceipt(params: {
    basket_id: string; email: string; name: string
    total: number; items: Array<{ name: string; quantity: number; unit_price: number }>
  }) {
    try {
      await fetch(`${API}/kiosk/receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
    } catch { /* non-fatal */ }
  },

  async paypalConfig(): Promise<{ client_id: string; env: string; currency: string }> {
    const fallback = (import.meta.env.VITE_PAYPAL_CLIENT_ID as string) || ''
    try {
      const r = await fetch(`${API}/service/paypal/config`)
      if (!r.ok) return { client_id: fallback, env: 'live', currency: 'GBP' }
      const d = await r.json()
      return { ...d, client_id: d.client_id || fallback }
    } catch {
      return { client_id: fallback, env: 'live', currency: 'GBP' }
    }
  },

  async paypalCreateOrder(
    amount: number, description: string, branchId: string,
    prefill?: {
      contact_name?: string; contact_first_name?: string; contact_surname?: string
      contact_email?: string; contact_phone?: string
      contact_postcode?: string; contact_address?: string; contact_uprn?: string
    },
  ): Promise<string> {
    const r = await fetch(`${API}/service/paypal/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, description, branch_id: branchId, ...prefill }),
    })
    if (!r.ok) throw new Error(`PayPal order failed: ${r.status}`)
    const d = await r.json()
    return d.id
  },

  async getBranches(): Promise<Array<{ branch_id: string; name: string; city: string; is_active: boolean }>> {
    try {
      const r = await fetch(`${API}/branches`)
      if (!r.ok) return []
      const d = await r.json()
      return (d.branches ?? []).filter((b: { is_active: boolean }) => b.is_active)
    } catch { return [] }
  },

  async paypalCapture(params: {
    paypal_order_id: string; amount: number; branch_id: string
    contact_name: string; contact_first_name?: string; contact_surname?: string
    contact_email: string; contact_phone: string
    gift_aid: boolean; gift_aid_postcode: string; gift_aid_address: string
    contact_uprn?: string
  }) {
    const r = await fetch(`${API}/service/paypal/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!r.ok) {
      // Backend's HTTPException with structured detail: surface the PayPal
      // references so PaymentPage can show the donor what to email us with.
      // FastAPI wraps `detail` in {detail: {...}}; tolerate plain-string too.
      let body: any = null
      try { body = await r.json() } catch { /* not JSON */ }
      const detail = body?.detail
      const err: any = new Error(
        typeof detail === 'string'
          ? detail
          : detail?.message || `PayPal capture failed: ${r.status}`,
      )
      if (detail && typeof detail === 'object') {
        err.paypal_order_id   = detail.paypal_order_id
        err.paypal_capture_id = detail.paypal_capture_id
        err.amount            = detail.amount
      }
      err.status = r.status
      throw err
    }
    return r.json()
  },

  async givingTiers(): Promise<{ tiers: GivingTier[] }> {
    const r = await fetch(`${API}/service/giving/tiers`)
    if (!r.ok) return { tiers: [] }
    return r.json()
  },

  async givingSubscribe(
    tierId: string, branchId: string,
    donorFirstName: string, donorSurname: string, donorEmail: string,
    donorPostcode: string, donorAddress: string,
    donorPhone: string = '',
    customAmount: number | null = null,
    customLabel: string = '',
  ): Promise<{ plan_id: string; amount: string; frequency: string }> {
    const r = await fetch(`${API}/service/giving/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier_id: tierId, branch_id: branchId,
        donor_first_name: donorFirstName, donor_surname: donorSurname,
        donor_email: donorEmail, donor_postcode: donorPostcode, donor_address: donorAddress,
        donor_phone: donorPhone,
        // Backend uses these only when tier_id == 'custom'.
        ...(customAmount != null ? { custom_amount: customAmount } : {}),
        ...(customLabel ? { custom_label: customLabel } : {}),
      }),
    })
    if (!r.ok) throw new Error(`Subscribe failed: ${r.status}`)
    return r.json()
  },

  async givingApprove(params: {
    subscription_id: string; plan_id: string; tier_id: string
    amount: number; frequency: string; branch_id: string
    donor_first_name: string; donor_surname: string; donor_email: string
    donor_postcode: string; donor_address: string
    donor_phone?: string
    gift_aid_declared?: boolean
    tier_label?: string
  }): Promise<{ success: boolean }> {
    const r = await fetch(`${API}/service/giving/subscription/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!r.ok) throw new Error(`Approve failed: ${r.status}`)
    return r.json()
  },

  async registerVolunteer(payload: VolunteerRegistrationPayload): Promise<{
    success: boolean; reference_number: string; message: string; stage: number
  }> {
    const r = await fetch(`${API}/service/volunteers/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      // Surface backend error envelope { detail: { errors: [...] } }
      const detail = (data as { detail?: { errors?: string[] } })?.detail
      const msg = detail?.errors?.length ? detail.errors.join(' · ') : `Registration failed: ${r.status}`
      throw new Error(msg)
    }
    return data
  },

  // Volunteer ladder: add emergency contact / references to an existing
  // application (proven by reference_number + email) to climb the stages.
  async advanceVolunteer(payload: VolunteerAdvancePayload): Promise<{
    success: boolean; reference_number: string; stage: number
  }> {
    const r = await fetch(`${API}/service/volunteers/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      const detail = (data as { detail?: { errors?: string[] } })?.detail
      const msg = detail?.errors?.length ? detail.errors.join(' · ') : `Update failed: ${r.status}`
      throw new Error(msg)
    }
    return data
  },

  // ── Seva shifts & booking ───────────────────────────────────────────────
  async getSevaShifts(branchId = ''): Promise<{ shifts: SevaShift[] }> {
    const r = await fetch(`${API}/seva/shifts?branch_id=${encodeURIComponent(branchId)}`)
    if (!r.ok) throw new Error(`Could not load seva (HTTP ${r.status})`)
    return r.json()
  },
  // Active seva groups that have a WhatsApp invite link, for the "join" buttons.
  async getSevaWhatsappGroups(branchId = ''): Promise<{ groups: SevaWhatsappGroup[] }> {
    try {
      const r = await fetch(`${API}/seva/whatsapp-groups?branch_id=${encodeURIComponent(branchId)}`)
      if (!r.ok) return { groups: [] }
      return r.json()
    } catch { return { groups: [] } }
  },
  // The caller's own booked seva — by donor token if signed in, else by email.
  async getMySevaBookings(email = '', token?: string): Promise<{ bookings: SevaBooking[] }> {
    const q = email ? `?email=${encodeURIComponent(email)}` : ''
    const r = await fetch(`${API}/seva/my-bookings${q}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    if (!r.ok) return { bookings: [] }
    return r.json()
  },
  async bookSeva(shiftId: string, body: { name: string; email: string; phone?: string }, token?: string):
      Promise<{ ok: boolean; already_booked?: boolean; cancel_pin?: string }> {
    const r = await fetch(`${API}/seva/shifts/${encodeURIComponent(shiftId)}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error((d as { detail?: string }).detail || `Booking failed (HTTP ${r.status})`)
    return d
  },
  // Withdraw a booking ("I can't make it") — requires the booking's PIN.
  async cancelSevaBooking(bookingId: string, pin: string, token?: string): Promise<{ ok: boolean }> {
    const r = await fetch(`${API}/seva/bookings/${encodeURIComponent(bookingId)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ pin }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error((d as { detail?: string }).detail || `Could not cancel (HTTP ${r.status})`)
    return d
  },
  async offerSevaAvailability(body: { name: string; email: string; branch_id: string; note: string }, token?: string):
      Promise<{ ok: boolean }> {
    const r = await fetch(`${API}/seva/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error((d as { detail?: string }).detail || `Could not save (HTTP ${r.status})`)
    return d
  },

  async getFormConfig(formKey: string): Promise<{ form_key: string; fields: Record<string, string> }> {
    const r = await fetch(`${API}/service/form-config/${formKey}`)
    if (!r.ok) throw new Error(`form-config fetch failed: ${r.status}`)
    return r.json()
  },

  // ── Volunteer draft (cross-device partial save) ─────────────────────────
  async saveVolunteerDraft(args: { token?: string; payload: unknown; email?: string; branchId?: string }):
      Promise<{ ok: boolean; token: string; expires_at: string | null }> {
    const r = await fetch(`${API}/service/volunteers/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: args.token || '',
        payload: args.payload,
        email: args.email || '',
        branch_id: args.branchId || 'main',
      }),
    })
    if (!r.ok) throw new Error(`Draft save failed: ${r.status}`)
    return r.json()
  },

  async getVolunteerDraft(token: string): Promise<{
    token: string
    payload: Record<string, unknown>
    branch_id: string
    updated_at: string | null
    expires_at: string | null
  }> {
    const r = await fetch(`${API}/service/volunteers/draft/${encodeURIComponent(token)}`)
    if (!r.ok) throw new Error(`Draft not found: ${r.status}`)
    return r.json()
  },

  async deleteVolunteerDraft(token: string): Promise<void> {
    await fetch(`${API}/service/volunteers/draft/${encodeURIComponent(token)}`, { method: 'DELETE' })
  },

  async emailVolunteerDraftLink(args: { token: string; email: string }): Promise<{ ok: boolean; sent_to: string }> {
    const r = await fetch(`${API}/service/volunteers/draft/email-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      const detail = (data as { detail?: string })?.detail
      throw new Error(detail || `Email send failed (HTTP ${r.status})`)
    }
    return data
  },
}

export interface VolunteerRegistrationPayload {
  // Personal
  title: string; first_names: string; last_name: string
  address: string; postcode: string
  mobile: string; phone: string; email: string; age_range: string
  // Emergency contact
  ec_title: string; ec_full_name: string; ec_email: string
  ec_mobile: string; ec_phone: string; ec_address: string; ec_postcode: string
  // Health + criminal
  has_health_restrictions: boolean; health_notes: string
  has_criminal_record: boolean; criminal_record_details: string
  // Referees
  ref1_title: string; ref1_first_names: string; ref1_last_name: string
  ref1_address: string; ref1_postcode: string
  ref1_mobile: string; ref1_phone: string; ref1_email: string
  ref2_title: string; ref2_first_names: string; ref2_last_name: string
  ref2_address: string; ref2_postcode: string
  ref2_mobile: string; ref2_phone: string; ref2_email: string
  // Skills + availability
  skills: Record<string, string[]>; skills_other_text: string
  // Availability shape: { days: string[], times: string[], notes: string }.
  // Stored as JSONB server-side; the admin UI also handles legacy
  // {day: {slot: time}} rows submitted before this redesign.
  availability: { days: string[]; times: string[]; notes: string }
  availability_pattern: string
  // Consents
  declaration_agreed: boolean; confidentiality_agreed: boolean; marketing_consent: boolean
  branch_id: string
  // Where the volunteer wants to help: array of branch codes, with the
  // literal "remote" as a sentinel for online/remote-only volunteering.
  preferred_branches: string[]
}

export interface SevaShift {
  id: string; branch_id: string; title: string; description: string
  starts_at: string; ends_at: string | null; needed: number; booked: number; spots_left: number
}

export interface SevaBooking {
  id: string; shift_id: string; title: string; description: string
  branch_id: string; starts_at: string; kind: string; status: string; booked_at: string
  cancel_pin?: string
}

export interface SevaWhatsappGroup {
  name: string; description: string; whatsapp_invite_url: string
  branch_id: string; is_default: boolean
}

export interface VolunteerAdvancePayload {
  reference_number: string
  email: string
  ec_title?: string; ec_full_name?: string; ec_relationship?: string; ec_email?: string
  ec_mobile?: string; ec_phone?: string; ec_address?: string; ec_postcode?: string
  has_health_restrictions?: boolean; health_notes?: string
  has_criminal_record?: boolean; criminal_record_details?: string
  ref1_title?: string; ref1_first_names?: string; ref1_last_name?: string
  ref1_address?: string; ref1_postcode?: string
  ref1_mobile?: string; ref1_phone?: string; ref1_email?: string
  ref2_title?: string; ref2_first_names?: string; ref2_last_name?: string
  ref2_address?: string; ref2_postcode?: string
  ref2_mobile?: string; ref2_phone?: string; ref2_email?: string
  confidentiality_agreed?: boolean
}

export interface GivingTier {
  id: string
  amount: number
  label: string
  description: string
  frequency: string
  is_default: boolean
  display_order: number
}
