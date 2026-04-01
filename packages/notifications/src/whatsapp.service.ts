import axios from 'axios'
import {
  ok,
  tryAsync,
  err,
  type Result,
  createContextLogger,
  ExternalServiceError,
  env,
} from '@shital/config'
import type { WhatsAppPayload } from './types.js'

const log = createContextLogger({ module: 'whatsapp.service' })

const META_API_VERSION = 'v19.0'
const META_API_BASE = 'https://graph.facebook.com'

interface MetaTextMessage {
  messaging_product: 'whatsapp'
  recipient_type: 'individual'
  to: string
  type: 'text'
  text: { body: string }
}

interface MetaTemplateMessage {
  messaging_product: 'whatsapp'
  recipient_type: 'individual'
  to: string
  type: 'template'
  template: {
    name: string
    language: { code: 'en_GB' }
    components: Array<{
      type: 'body'
      parameters: Array<{ type: 'text'; text: string }>
    }>
  }
}

type MetaMessage = MetaTextMessage | MetaTemplateMessage

async function sendViaMetaCloudApi(payload: WhatsAppPayload): Promise<void> {
  const phoneId = env.META_WHATSAPP_PHONE_ID
  const token = env.META_WHATSAPP_TOKEN

  let message: MetaMessage

  if (payload.template !== undefined && payload.template !== null && payload.template !== '') {
    const params = payload.templateParams ?? {}
    message = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: payload.to,
      type: 'template',
      template: {
        name: payload.template,
        language: { code: 'en_GB' },
        components: [
          {
            type: 'body',
            parameters: Object.values(params).map((v) => ({ type: 'text' as const, text: v })),
          },
        ],
      },
    }
  } else {
    const body = payload.text ?? ''
    message = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: payload.to,
      type: 'text',
      text: { body },
    }
  }

  await axios.post(
    `${META_API_BASE}/${META_API_VERSION}/${phoneId}/messages`,
    message,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
  )
}

async function sendViaFallback(_payload: WhatsAppPayload): Promise<void> {
  log.warn('Baileys fallback not yet initialized')
  throw new ExternalServiceError('WhatsApp', 'Baileys fallback not yet initialized')
}

export async function sendWhatsApp(payload: WhatsAppPayload): Promise<Result<void>> {
  return tryAsync(async () => {
    try {
      await sendViaMetaCloudApi(payload)
      log.info({ to: payload.to, template: payload.template }, 'WhatsApp message sent via Meta Cloud API')
    } catch (primaryError) {
      log.warn(
        { to: payload.to, err: primaryError },
        'Meta Cloud API failed, attempting Baileys fallback',
      )
      await sendViaFallback(payload)
    }
  })
}

export async function sendBookingConfirmation(
  phone: string,
  name: string,
  service: string,
  date: string,
  ref: string,
): Promise<Result<void>> {
  const text = [
    `🙏 Jai Shree Krishna, ${name}!`,
    ``,
    `Your booking has been confirmed:`,
    `📿 Service: ${service}`,
    `📅 Date: ${date}`,
    `🔖 Reference: ${ref}`,
    ``,
    `Please arrive 15 minutes before your scheduled time.`,
    `For queries, reply to this message or call the temple office.`,
    ``,
    `Shital Hindu Temple`,
  ].join('\n')

  return sendWhatsApp({ to: phone, text })
}

export async function sendDonationReceipt(
  phone: string,
  name: string,
  amount: string,
  ref: string,
): Promise<Result<void>> {
  const text = [
    `🙏 Jai Shree Krishna, ${name}!`,
    ``,
    `Thank you for your generous donation.`,
    `💰 Amount: ${amount}`,
    `🔖 Reference: ${ref}`,
    ``,
    `Your donation supports the work of Shital Hindu Temple.`,
    `A full receipt has been sent to your email.`,
    ``,
    `May God bless you.`,
    `Shital Hindu Temple`,
  ].join('\n')

  return sendWhatsApp({ to: phone, text })
}
