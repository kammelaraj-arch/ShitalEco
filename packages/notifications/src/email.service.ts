import {
  tryAsync,
  type Result,
  createContextLogger,
} from '@shital/config'
import type { EmailPayload } from './types.js'

const log = createContextLogger({ module: 'email.service' })

/**
 * Outbound email is handled by the Python backend using Microsoft 365 SMTP
 * (see backend/src/shital/api/routers/email_templates.py → send_raw_email).
 * SendGrid has been removed; no Node SMTP client is wired up here, so these
 * shims log a warning and resolve to a not-sent Result until a backend relay
 * call is wired in.
 *
 * Nothing outside this package currently calls these helpers; they are kept
 * so `pnpm --filter @shital/notifications typecheck` still passes for any
 * downstream consumers that import the type.
 */

const NOT_WIRED =
  'Email send not wired on the Node side. Route this through the backend ' +
  '(POST /api/v1/kiosk/receipt or send_raw_email) which uses Microsoft 365 SMTP.'

export async function sendEmail(payload: EmailPayload): Promise<Result<void>> {
  return tryAsync(async () => {
    log.warn(
      { to: payload.to, subject: payload.subject },
      NOT_WIRED,
    )
    throw new Error(NOT_WIRED)
  })
}

export async function sendOtpEmail(
  _email: string,
  _name: string,
  _otp: string,
): Promise<Result<void>> {
  return tryAsync(async () => {
    log.warn({ fn: 'sendOtpEmail' }, NOT_WIRED)
    throw new Error(NOT_WIRED)
  })
}

export async function sendWelcomeEmail(_email: string, _name: string): Promise<Result<void>> {
  return tryAsync(async () => {
    log.warn({ fn: 'sendWelcomeEmail' }, NOT_WIRED)
    throw new Error(NOT_WIRED)
  })
}

export async function sendPayslipEmail(
  _email: string,
  _name: string,
  _period: string,
  _pdfBuffer: Buffer,
): Promise<Result<void>> {
  return tryAsync(async () => {
    log.warn({ fn: 'sendPayslipEmail' }, NOT_WIRED)
    throw new Error(NOT_WIRED)
  })
}
