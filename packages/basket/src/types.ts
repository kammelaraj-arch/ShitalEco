export interface AddItemInput {
  basketId: string
  itemType: 'SERVICE' | 'DONATION' | 'PRODUCT'
  referenceId?: string
  name: string
  description?: string
  quantity: number
  unitPrice: number
  metadata?: Record<string, unknown>
}

export interface BasketSummary {
  id: string
  branchId: string
  items: BasketItemSummary[]
  subtotal: number
  giftAidAmount: number
  total: number
  itemCount: number
  currency: string
}

export interface BasketItemSummary {
  id: string
  itemType: string
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
  metadata?: Record<string, unknown>
}
