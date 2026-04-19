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
    const r = await fetch(`${API}/service/paypal/config`)
    if (!r.ok) return { client_id: '', env: 'sandbox', currency: 'GBP' }
    return r.json()
  },

  async paypalCreateOrder(
    amount: number, description: string, branchId: string,
    prefill?: { contact_name?: string; contact_email?: string; contact_postcode?: string; contact_address?: string },
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
    contact_name: string; contact_email: string; contact_phone: string
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
}
