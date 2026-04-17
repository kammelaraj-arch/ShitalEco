import Stripe from 'stripe'
import {
  ok,
  err,
  tryAsync,
  type Result,
  createContextLogger,
  ExternalServiceError,
  ValidationError,
  DomainError,
} from '@shital/config'
import { env } from '@shital/config'
import type { CreatePaymentIntentInput, PaymentIntent, RefundInput } from './types.js'

const log = createContextLogger({ module: 'stripe.provider' })

function buildStripeClient(): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-06-20',
    typescript: true,
  })
}

let _stripe: Stripe | null = null

function getStripe(): Stripe {
  if (_stripe === null) {
    _stripe = buildStripeClient()
  }
  return _stripe
}

function mapStripeStatus(
  status: Stripe.PaymentIntent.Status,
): PaymentIntent['status'] {
  switch (status) {
    case 'succeeded':
      return 'COMPLETED'
    case 'processing':
      return 'PROCESSING'
    case 'canceled':
      return 'FAILED'
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
    case 'requires_capture':
      return 'PENDING'
    default:
      return 'PENDING'
  }
}

export class StripeProvider {
  async createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<Result<PaymentIntent>> {
    if (input.amount <= 0) {
      return err(new ValidationError('Amount must be greater than 0'))
    }

    return tryAsync(async () => {
      const stripe = getStripe()

      const intent = await stripe.paymentIntents.create(
        {
          amount: input.amount, // already in pence/cents
          currency: input.currency.toLowerCase(),
          description: input.description,
          metadata: {
            orderId: input.orderId,
            ...(input.metadata ?? {}),
          },
          capture_method: 'automatic',
        },
        {
          idempotencyKey: input.idempotencyKey,
        },
      )

      log.info(
        { orderId: input.orderId, intentId: intent.id },
        'Stripe PaymentIntent created',
      )

      return {
        id: intent.id,
        provider: 'STRIPE' as const,
        ...(intent.client_secret != null ? { clientSecret: intent.client_secret } : {}),
        amount: intent.amount,
        currency: intent.currency.toUpperCase(),
        status: mapStripeStatus(intent.status),
      }
    })
  }

  async createTerminalPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<Result<PaymentIntent>> {
    if (input.amount <= 0) {
      return err(new ValidationError('Amount must be greater than 0'))
    }

    return tryAsync(async () => {
      const stripe = getStripe()

      const createParams: Stripe.PaymentIntentCreateParams = {
        amount: input.amount,
        currency: input.currency.toLowerCase(),
        description: input.description,
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        metadata: {
          orderId: input.orderId,
          terminalPayment: 'true',
          ...(input.metadata ?? {}),
        },
      }

      if (env.STRIPE_TERMINAL_LOCATION_ID !== undefined) {
        // Store location in metadata so terminal reader can be assigned at capture time
        createParams.metadata = {
          ...createParams.metadata,
          locationId: env.STRIPE_TERMINAL_LOCATION_ID,
        }
      }

      const intent = await stripe.paymentIntents.create(createParams, {
        idempotencyKey: input.idempotencyKey,
      })

      log.info(
        { orderId: input.orderId, intentId: intent.id },
        'Stripe Terminal PaymentIntent created',
      )

      return {
        id: intent.id,
        provider: 'KIOSK' as const,
        ...(intent.client_secret != null ? { clientSecret: intent.client_secret } : {}),
        amount: intent.amount,
        currency: intent.currency.toUpperCase(),
        status: mapStripeStatus(intent.status),
      }
    })
  }

  async refund(input: RefundInput): Promise<Result<{ refundId: string }>> {
    return tryAsync(async () => {
      const stripe = getStripe()

      const params: Stripe.RefundCreateParams = {
        payment_intent: input.paymentRef,
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.reason !== undefined
          ? { reason: 'requested_by_customer' as const }
          : {}),
        metadata: {
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        },
      }

      const refund = await stripe.refunds.create(params, {
        idempotencyKey: input.idempotencyKey,
      })

      log.info({ paymentRef: input.paymentRef, refundId: refund.id }, 'Stripe refund issued')
      return { refundId: refund.id }
    })
  }

  constructWebhookEvent(
    body: string,
    signature: string,
    secret: string,
  ): Result<{ type: string; data: unknown }> {
    try {
      const stripe = getStripe()
      const event = stripe.webhooks.constructEvent(body, signature, secret)
      return ok({ type: event.type, data: event.data })
    } catch (e) {
      if (e instanceof Stripe.errors.StripeSignatureVerificationError) {
        return err(new DomainError('WEBHOOK_SIGNATURE_INVALID', 'Stripe webhook signature verification failed'))
      }
      return err(new ExternalServiceError('Stripe', String(e)))
    }
  }
}

export const stripeProvider = new StripeProvider()
