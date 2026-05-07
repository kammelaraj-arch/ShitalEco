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
    if (!r.ok) throw new Error(`PayPal capture failed: ${r.status}`)
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
  ): Promise<{ plan_id: string; amount: string; frequency: string }> {
    const r = await fetch(`${API}/service/giving/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier_id: tierId, branch_id: branchId,
        donor_first_name: donorFirstName, donor_surname: donorSurname,
        donor_email: donorEmail, donor_postcode: donorPostcode, donor_address: donorAddress,
        donor_phone: donorPhone,
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
    success: boolean; reference_number: string; message: string
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
  availability: Record<string, Record<string, string>>; availability_pattern: string
  // Consents
  declaration_agreed: boolean; confidentiality_agreed: boolean; marketing_consent: boolean
  branch_id: string
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
