const API = (import.meta.env.VITE_API_URL as string) || '/api/v1'

export const api = {
  async getItems(category?: string, branchId = 'main') {
    const q = new URLSearchParams({ branch_id: branchId, active_only: 'true' })
    if (category) q.set('category', category)
    const r = await fetch(`${API}/items?${q}`)
    if (!r.ok) return []
    const d = await r.json()
    return d.items ?? []
  },

  async getSoftDonations(branchId = 'main') {
    const r = await fetch(`${API}/items/kiosk/soft-donations?branch_id=${branchId}`)
    if (!r.ok) return []
    return (await r.json()).items ?? []
  },

  async getProjects(branchId = 'main') {
    const r = await fetch(`${API}/items/kiosk/projects?branch_id=${branchId}`)
    if (!r.ok) return { items: [], projects: [] }
    return await r.json()
  },

  async getShop(branchId = 'main') {
    const r = await fetch(`${API}/items/kiosk/shop?branch_id=${branchId}`)
    if (!r.ok) return []
    return (await r.json()).items ?? []
  },

  async getSponsorship(branchId = 'main') {
    const r = await fetch(`${API}/items/kiosk/sponsorship?branch_id=${branchId}`)
    if (!r.ok) return []
    return (await r.json()).items ?? []
  },

  async getGeneralDonations() {
    const r = await fetch(`${API}/items/kiosk/general-donations`)
    if (!r.ok) return []
    return (await r.json()).items ?? []
  },

  async getServices(branchId = 'main') {
    const r = await fetch(`${API}/kiosk/services?branch_id=${branchId}`)
    if (!r.ok) return []
    return (await r.json()).services ?? []
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

  async lookupPostcode(postcode: string): Promise<string[]> {
    try {
      const r = await fetch(`${API}/kiosk/postcode/${encodeURIComponent(postcode)}`)
      if (!r.ok) return []
      const d = await r.json()
      return d.addresses ?? []
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
      contact_postcode?: string; contact_address?: string
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
  ): Promise<{ plan_id: string; amount: string; frequency: string }> {
    const r = await fetch(`${API}/service/giving/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier_id: tierId, branch_id: branchId,
        donor_first_name: donorFirstName, donor_surname: donorSurname,
        donor_email: donorEmail, donor_postcode: donorPostcode, donor_address: donorAddress,
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
  }): Promise<{ success: boolean }> {
    const r = await fetch(`${API}/service/giving/subscription/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!r.ok) throw new Error(`Approve failed: ${r.status}`)
    return r.json()
  },
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
