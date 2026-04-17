import {
  ok,
  err,
  tryAsync,
  type Result,
  createContextLogger,
  ExternalServiceError,
  DomainError,
  ValidationError,
} from '@shital/config'
import { env } from '@shital/config'
import type { CreatePaymentIntentInput, PaymentIntent, RefundInput } from './types.js'

const log = createContextLogger({ module: 'paypal.provider' })

interface PayPalAccessTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

interface PayPalOrderLink {
  href: string
  rel: string
  method: string
}

interface PayPalOrderResponse {
  id: string
  status: string
  links: PayPalOrderLink[]
}

interface PayPalCaptureResponse {
  id: string
  status: string
  purchase_units: Array<{
    payments: {
      captures: Array<{
        id: string
        status: string
        amount: { currency_code: string; value: string }
      }>
    }
  }>
}

interface PayPalRefundResponse {
  id: string
  status: string
}

interface PayPalWebhookVerifyResponse {
  verification_status: string
}

interface PayPalErrorResponse {
  message?: string
  error_description?: string
  name?: string
}

let cachedToken: { value: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken !== null && now < cachedToken.expiresAt - 30_000) {
    return cachedToken.value
  }

  const baseUrl =
    env.PAYPAL_MODE === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com'

  const credentials = Buffer.from(
    `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`,
  ).toString('base64')

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!response.ok) {
    const body = (await response.json()) as PayPalErrorResponse
    throw new ExternalServiceError(
      'PayPal',
      `Failed to obtain access token: ${body.error_description ?? body.message ?? response.statusText}`,
    )
  }

  const data = (await response.json()) as PayPalAccessTokenResponse
  cachedToken = {
    value: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  }
  return cachedToken.value
}

function getBaseUrl(): string {
  return env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com'
}

async function paypalRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const token = await getAccessToken()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (idempotencyKey !== undefined) {
    headers['PayPal-Request-Id'] = idempotencyKey
  }

  const response = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  if (!response.ok) {
    const errorBody = (await response.json()) as PayPalErrorResponse
    throw new ExternalServiceError(
      'PayPal',
      `${method} ${path} failed (${response.status}): ${errorBody.message ?? errorBody.name ?? response.statusText}`,
    )
  }

  const text = await response.text()
  if (text.length === 0) {
    return {} as T
  }
  return JSON.parse(text) as T
}

export class PayPalProvider {
  async createOrder(input: CreatePaymentIntentInput): Promise<Result<PaymentIntent>> {
    if (input.amount <= 0) {
      return err(new ValidationError('Amount must be greater than 0'))
    }

    return tryAsync(async () => {
      // PayPal expects amounts in major currency units (e.g. GBP, not pence)
      const majorAmount = (input.amount / 100).toFixed(2)

      const order = await paypalRequest<PayPalOrderResponse>(
        'POST',
        '/v2/checkout/orders',
        {
          intent: 'CAPTURE',
          purchase_units: [
            {
              reference_id: input.orderId,
              description: input.description,
              amount: {
                currency_code: input.currency.toUpperCase(),
                value: majorAmount,
              },
              custom_id: input.orderId,
            },
          ],
          application_context: {
            brand_name: 'Shital Hindu Temple',
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
          },
        },
        input.idempotencyKey,
      )

      const approvalLink = order.links.find((l) => l.rel === 'approve')
      const approvalUrl = approvalLink?.href

      log.info({ orderId: input.orderId, paypalOrderId: order.id }, 'PayPal order created')

      return {
        id: order.id,
        provider: 'PAYPAL' as const,
        ...(approvalUrl !== undefined ? { approvalUrl } : {}),
        amount: input.amount,
        currency: input.currency,
        status: 'PENDING' as const,
      }
    })
  }

  async captureOrder(
    orderId: string,
    idempotencyKey: string,
  ): Promise<Result<{ status: string; captureId: string }>> {
    if (!orderId) {
      return err(new ValidationError('orderId is required'))
    }

    return tryAsync(async () => {
      const capture = await paypalRequest<PayPalCaptureResponse>(
        'POST',
        `/v2/checkout/orders/${orderId}/capture`,
        {},
        idempotencyKey,
      )

      const firstUnit = capture.purchase_units[0]
      if (firstUnit === undefined) {
        throw new ExternalServiceError('PayPal', 'No purchase units in capture response')
      }

      const captureRecord = firstUnit.payments.captures[0]
      if (captureRecord === undefined) {
        throw new ExternalServiceError('PayPal', 'No capture record in response')
      }

      log.info(
        { orderId, captureId: captureRecord.id, status: capture.status },
        'PayPal order captured',
      )

      return {
        status: capture.status,
        captureId: captureRecord.id,
      }
    })
  }

  async refund(input: RefundInput): Promise<Result<{ refundId: string }>> {
    return tryAsync(async () => {
      const body: Record<string, unknown> = {}

      if (input.amount !== undefined) {
        // input.amount is in pence/cents; PayPal needs major units
        body['amount'] = {
          value: (input.amount / 100).toFixed(2),
          // Currency must be retrieved from the capture — we leave it to the caller
          // to pass amount in same currency as original. We omit currency_code here
          // because PayPal defaults to the original capture currency.
        }
      }

      if (input.reason !== undefined) {
        body['note_to_payer'] = input.reason.slice(0, 255)
      }

      const refund = await paypalRequest<PayPalRefundResponse>(
        'POST',
        `/v2/payments/captures/${input.paymentRef}/refund`,
        body,
        input.idempotencyKey,
      )

      log.info({ captureId: input.paymentRef, refundId: refund.id }, 'PayPal refund issued')
      return { refundId: refund.id }
    })
  }

  async verifyWebhook(
    headers: Record<string, string>,
    body: string,
  ): Promise<Result<boolean>> {
    return tryAsync(async () => {
      const transmissionId = headers['paypal-transmission-id'] ?? headers['PAYPAL-TRANSMISSION-ID']
      const transmissionTime =
        headers['paypal-transmission-time'] ?? headers['PAYPAL-TRANSMISSION-TIME']
      const certUrl = headers['paypal-cert-url'] ?? headers['PAYPAL-CERT-URL']
      const authAlgo = headers['paypal-auth-algo'] ?? headers['PAYPAL-AUTH-ALGO']
      const transmissionSig =
        headers['paypal-transmission-sig'] ?? headers['PAYPAL-TRANSMISSION-SIG']
      const webhookId = headers['paypal-webhook-id'] ?? headers['PAYPAL-WEBHOOK-ID']

      if (
        transmissionId === undefined ||
        transmissionTime === undefined ||
        certUrl === undefined ||
        authAlgo === undefined ||
        transmissionSig === undefined
      ) {
        throw new DomainError(
          'WEBHOOK_INVALID_HEADERS',
          'Missing required PayPal webhook headers',
        )
      }

      let parsedBody: unknown
      try {
        parsedBody = JSON.parse(body)
      } catch {
        throw new DomainError('WEBHOOK_INVALID_BODY', 'Webhook body is not valid JSON')
      }

      const result = await paypalRequest<PayPalWebhookVerifyResponse>(
        'POST',
        '/v1/notifications/verify-webhook-signature',
        {
          transmission_id: transmissionId,
          transmission_time: transmissionTime,
          cert_url: certUrl,
          auth_algo: authAlgo,
          transmission_sig: transmissionSig,
          webhook_id: webhookId,
          webhook_event: parsedBody,
        },
      )

      const verified = result.verification_status === 'SUCCESS'
      log.info({ verified }, 'PayPal webhook verification result')
      return verified
    })
  }
}

export const paypalProvider = new PayPalProvider()
