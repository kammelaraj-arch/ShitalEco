export type PaymentProvider = 'PAYPAL' | 'STRIPE' | 'CASH' | 'KIOSK'

export interface CreatePaymentIntentInput {
  amount: number // in pence/cents
  currency: string
  orderId: string
  description: string
  metadata?: Record<string, string>
  idempotencyKey: string
}

export interface PaymentIntent {
  id: string
  provider: PaymentProvider
  clientSecret?: string // for Stripe
  approvalUrl?: string // for PayPal
  amount: number
  currency: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REFUNDED'
}

export interface RefundInput {
  paymentRef: string
  amount?: number // partial refund, if undefined = full refund
  reason?: string
  idempotencyKey: string
}

export interface WebhookEvent {
  provider: PaymentProvider
  eventType: string
  payload: unknown
  signature?: string
}
