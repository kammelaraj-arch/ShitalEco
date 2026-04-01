import {
  ok,
  tryAsync,
  type Result,
  createContextLogger,
  DomainError,
  ValidationError,
  ExternalServiceError,
} from '@shital/config'
import { env } from '@shital/config'
import { prisma } from '@shital/db'
import { PayPalProvider } from './paypal.provider.js'
import { StripeProvider } from './stripe.provider.js'
import type {
  PaymentProvider,
  CreatePaymentIntentInput,
  PaymentIntent,
  RefundInput,
} from './types.js'

const log = createContextLogger({ module: 'payment.service' })

export class PaymentService {
  private readonly paypal: PayPalProvider
  private readonly stripe: StripeProvider

  constructor(paypal?: PayPalProvider, stripe?: StripeProvider) {
    this.paypal = paypal ?? new PayPalProvider()
    this.stripe = stripe ?? new StripeProvider()
  }

  async createPayment(
    provider: PaymentProvider,
    input: CreatePaymentIntentInput,
  ): Promise<Result<PaymentIntent>> {
    switch (provider) {
      case 'PAYPAL':
        return this.paypal.createOrder(input)

      case 'STRIPE':
        return this.stripe.createPaymentIntent(input)

      case 'KIOSK':
        return this.stripe.createTerminalPaymentIntent(input)

      case 'CASH':
        return {
          ok: true,
          value: {
            id: `cash-${input.idempotencyKey}`,
            provider: 'CASH',
            amount: input.amount,
            currency: input.currency,
            status: 'PENDING',
          },
        }
    }
  }

  async capturePayment(
    provider: PaymentProvider,
    paymentRef: string,
    idempotencyKey: string,
  ): Promise<Result<{ status: string }>> {
    switch (provider) {
      case 'PAYPAL': {
        const result = await this.paypal.captureOrder(paymentRef, idempotencyKey)
        if (!result.ok) {
          return result
        }
        return ok({ status: result.value.status })
      }

      case 'STRIPE':
      case 'KIOSK': {
        // Stripe automatic capture — nothing to do client-side after PaymentIntent is confirmed
        return ok({ status: 'PROCESSING' })
      }

      case 'CASH': {
        return ok({ status: 'COMPLETED' })
      }
    }
  }

  async refund(
    provider: PaymentProvider,
    input: RefundInput,
  ): Promise<Result<{ refundId: string }>> {
    switch (provider) {
      case 'PAYPAL':
        return this.paypal.refund(input)

      case 'STRIPE':
      case 'KIOSK':
        return this.stripe.refund(input)

      case 'CASH':
        return {
          ok: false,
          error: new DomainError(
            'CASH_REFUND_NOT_SUPPORTED',
            'Cash payments cannot be refunded via this service; process manually.',
          ),
        }
    }
  }

  async handleWebhook(
    provider: PaymentProvider,
    headers: Record<string, string>,
    body: string,
  ): Promise<Result<void>> {
    return tryAsync(async () => {
      if (provider === 'PAYPAL') {
        const verifyResult = await this.paypal.verifyWebhook(headers, body)
        if (!verifyResult.ok) {
          throw verifyResult.error
        }
        if (!verifyResult.value) {
          throw new DomainError('WEBHOOK_SIGNATURE_INVALID', 'PayPal webhook signature invalid')
        }

        let payload: unknown
        try {
          payload = JSON.parse(body)
        } catch {
          throw new DomainError('WEBHOOK_INVALID_BODY', 'Webhook body is not valid JSON')
        }

        await this.processPayPalWebhookEvent(payload)
        return
      }

      if (provider === 'STRIPE' || provider === 'KIOSK') {
        const stripeSignature = headers['stripe-signature'] ?? headers['Stripe-Signature']
        if (stripeSignature === undefined || stripeSignature === '') {
          throw new DomainError('WEBHOOK_MISSING_SIGNATURE', 'Missing Stripe-Signature header')
        }

        const webhookSecret = env.STRIPE_SECRET_KEY
        const eventResult = this.stripe.constructWebhookEvent(body, stripeSignature, webhookSecret)
        if (!eventResult.ok) {
          throw eventResult.error
        }

        await this.processStripeWebhookEvent(eventResult.value.type, eventResult.value.data)
        return
      }

      throw new DomainError('UNSUPPORTED_PROVIDER', `Webhook handling not supported for provider: ${provider}`)
    })
  }

  async recordCashPayment(
    orderId: string,
    amount: number,
    receivedBy: string,
  ): Promise<Result<void>> {
    if (!orderId || !receivedBy) {
      return {
        ok: false,
        error: new ValidationError('orderId and receivedBy are required'),
      }
    }

    if (amount <= 0) {
      return {
        ok: false,
        error: new ValidationError('Amount must be greater than 0'),
      }
    }

    return tryAsync(async () => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, totalAmount: true },
      })

      if (order === null || order === undefined) {
        throw new DomainError('ORDER_NOT_FOUND', `Order not found: ${orderId}`)
      }

      if (order.status !== 'PENDING' && order.status !== 'PROCESSING') {
        throw new DomainError(
          'ORDER_INVALID_STATUS',
          `Order ${orderId} has status ${order.status}, cannot record cash payment`,
        )
      }

      const expectedAmount = typeof order.totalAmount === 'number'
        ? order.totalAmount
        : (order.totalAmount as { toNumber(): number }).toNumber()

      const amountInPounds = amount / 100

      if (Math.abs(amountInPounds - expectedAmount) > 0.01) {
        throw new ValidationError(
          `Cash amount ${amountInPounds} does not match order total ${expectedAmount}`,
        )
      }

      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'COMPLETED',
          paymentProvider: 'CASH',
          paymentRef: `cash-${receivedBy}-${Date.now()}`,
          metadata: {
            cashReceivedBy: receivedBy,
            cashReceivedAt: new Date().toISOString(),
          },
        },
      })

      log.info({ orderId, amount, receivedBy }, 'Cash payment recorded')
    })
  }

  private async processPayPalWebhookEvent(payload: unknown): Promise<void> {
    if (
      payload === null ||
      typeof payload !== 'object' ||
      !('event_type' in payload) ||
      !('resource' in payload)
    ) {
      log.warn({ payload }, 'Unrecognised PayPal webhook payload shape')
      return
    }

    const event = payload as { event_type: string; resource: Record<string, unknown> }
    const eventType = event.event_type
    const resource = event.resource

    log.info({ eventType }, 'Processing PayPal webhook event')

    switch (eventType) {
      case 'CHECKOUT.ORDER.APPROVED': {
        const orderId = resource['id'] as string | undefined
        const customId = (resource['purchase_units'] as Array<{ custom_id?: string }> | undefined)?.[0]?.custom_id
        if (customId !== undefined) {
          await prisma.order.updateMany({
            where: { id: customId, status: 'PENDING' },
            data: { status: 'PROCESSING', paymentProvider: 'PAYPAL', paymentRef: orderId },
          })
        }
        break
      }

      case 'PAYMENT.CAPTURE.COMPLETED': {
        const captureId = resource['id'] as string | undefined
        const customId = resource['custom_id'] as string | undefined

        if (customId !== undefined) {
          await prisma.order.updateMany({
            where: { id: customId },
            data: { status: 'COMPLETED', paymentProvider: 'PAYPAL', paymentRef: captureId },
          })
        }
        break
      }

      case 'PAYMENT.CAPTURE.DENIED':
      case 'PAYMENT.CAPTURE.REVERSED': {
        const customId = resource['custom_id'] as string | undefined
        if (customId !== undefined) {
          await prisma.order.updateMany({
            where: { id: customId },
            data: { status: 'FAILED' },
          })
        }
        break
      }

      case 'PAYMENT.CAPTURE.REFUNDED': {
        const customId = resource['custom_id'] as string | undefined
        if (customId !== undefined) {
          await prisma.order.updateMany({
            where: { id: customId },
            data: { status: 'REFUNDED' },
          })
        }
        break
      }

      default:
        log.info({ eventType }, 'PayPal webhook event not handled')
    }
  }

  private async processStripeWebhookEvent(
    type: string,
    data: unknown,
  ): Promise<void> {
    log.info({ type }, 'Processing Stripe webhook event')

    if (
      data === null ||
      typeof data !== 'object' ||
      !('object' in data)
    ) {
      log.warn({ type, data }, 'Unrecognised Stripe webhook data shape')
      return
    }

    const obj = (data as { object: Record<string, unknown> }).object

    switch (type) {
      case 'payment_intent.succeeded': {
        const intentId = obj['id'] as string | undefined
        const metadata = obj['metadata'] as Record<string, string> | undefined
        const orderId = metadata?.['orderId']

        if (orderId !== undefined && intentId !== undefined) {
          await prisma.order.updateMany({
            where: { id: orderId },
            data: { status: 'COMPLETED', paymentProvider: 'STRIPE', paymentRef: intentId },
          })
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const metadata = obj['metadata'] as Record<string, string> | undefined
        const orderId = metadata?.['orderId']

        if (orderId !== undefined) {
          await prisma.order.updateMany({
            where: { id: orderId },
            data: { status: 'FAILED' },
          })
        }
        break
      }

      case 'payment_intent.processing': {
        const intentId = obj['id'] as string | undefined
        const metadata = obj['metadata'] as Record<string, string> | undefined
        const orderId = metadata?.['orderId']

        if (orderId !== undefined && intentId !== undefined) {
          await prisma.order.updateMany({
            where: { id: orderId, status: 'PENDING' },
            data: { status: 'PROCESSING', paymentProvider: 'STRIPE', paymentRef: intentId },
          })
        }
        break
      }

      case 'charge.refunded': {
        const paymentIntentId = obj['payment_intent'] as string | undefined

        if (paymentIntentId !== undefined) {
          await prisma.order.updateMany({
            where: { paymentRef: paymentIntentId },
            data: { status: 'REFUNDED' },
          })
        }
        break
      }

      default:
        log.info({ type }, 'Stripe webhook event not handled')
    }
  }
}

export const paymentService = new PaymentService()
