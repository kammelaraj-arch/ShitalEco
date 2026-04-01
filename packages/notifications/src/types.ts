export interface EmailPayload {
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
}

export interface WhatsAppPayload {
  to: string // E.164 format e.g. +447700900000
  template?: string
  templateParams?: Record<string, string>
  text?: string
}

export interface NotificationPayload {
  userId: string
  title: string
  body: string
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR'
  channel: 'IN_APP' | 'EMAIL' | 'WHATSAPP' | 'PUSH'
  metadata?: Record<string, unknown>
}
