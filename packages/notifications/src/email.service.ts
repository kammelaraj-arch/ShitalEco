import sgMail from '@sendgrid/mail'
import {
  ok,
  tryAsync,
  type Result,
  createContextLogger,
  ExternalServiceError,
  env,
} from '@shital/config'
import type { EmailPayload } from './types.js'

const log = createContextLogger({ module: 'email.service' })

const DEFAULT_FROM = 'noreply@shital.org'
const SENDGRID_FREE_TIER_DAILY_LIMIT = 100
const SENDGRID_WARN_THRESHOLD = 90

// Simple in-memory daily counter (resets on process restart)
let dailySentCount = 0
let dailyCountResetDate = new Date().toISOString().slice(0, 10)

function incrementDailyCount(): void {
  const today = new Date().toISOString().slice(0, 10)
  if (today !== dailyCountResetDate) {
    dailySentCount = 0
    dailyCountResetDate = today
  }
  dailySentCount++
  if (dailySentCount >= SENDGRID_WARN_THRESHOLD) {
    log.warn(
      { dailySentCount, limit: SENDGRID_FREE_TIER_DAILY_LIMIT },
      'Approaching SendGrid free tier daily email limit',
    )
  }
}

function getApiKey(): string {
  return env.SENDGRID_API_KEY
}

export async function sendEmail(payload: EmailPayload): Promise<Result<void>> {
  return tryAsync(async () => {
    sgMail.setApiKey(getApiKey())

    const toAddresses = Array.isArray(payload.to) ? payload.to : [payload.to]

    const mailData = {
      to: toAddresses,
      from: payload.from ?? DEFAULT_FROM,
      subject: payload.subject,
      html: payload.html,
      ...(payload.replyTo !== undefined ? { replyTo: payload.replyTo } : {}),
      ...(payload.text !== undefined ? { text: payload.text } : {}),
    }
    await sgMail.send(mailData as Parameters<typeof sgMail.send>[0])

    incrementDailyCount()
    log.info({ to: toAddresses, subject: payload.subject }, 'Email sent')
  })
}

export async function sendOtpEmail(
  email: string,
  name: string,
  otp: string,
): Promise<Result<void>> {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Verification Code</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
          <tr>
            <td style="background:#b45309;padding:24px 32px;">
              <h1 style="color:#fff;margin:0;font-size:22px;">Shital Hindu Temple</h1>
              <p style="color:#fde68a;margin:4px 0 0;font-size:13px;">ERP Platform</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="font-size:16px;color:#374151;margin:0 0 8px;">Dear ${escapeHtml(name)},</p>
              <p style="font-size:15px;color:#6b7280;margin:0 0 24px;">
                Your one-time verification code is:
              </p>
              <div style="text-align:center;margin:0 0 24px;">
                <span style="display:inline-block;font-size:36px;font-weight:bold;letter-spacing:12px;color:#b45309;background:#fef3c7;padding:16px 32px;border-radius:8px;border:2px dashed #d97706;">
                  ${escapeHtml(otp)}
                </span>
              </div>
              <p style="font-size:14px;color:#9ca3af;margin:0 0 8px;">
                This code expires in <strong>5 minutes</strong>. Do not share it with anyone.
              </p>
              <p style="font-size:14px;color:#9ca3af;margin:0;">
                If you did not request this code, please ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:16px 32px;text-align:center;">
              <p style="font-size:12px;color:#9ca3af;margin:0;">
                © ${new Date().getFullYear()} Shital Hindu Temple. Registered Charity.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()

  return sendEmail({
    to: email,
    subject: `${otp} is your Shital Temple verification code`,
    html,
    text: `Dear ${name},\n\nYour one-time verification code is: ${otp}\n\nThis code expires in 5 minutes. Do not share it with anyone.\n\nIf you did not request this code, please ignore this email.\n\n© ${new Date().getFullYear()} Shital Hindu Temple`,
  })
}

export async function sendWelcomeEmail(email: string, name: string): Promise<Result<void>> {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Shital Temple</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
          <tr>
            <td style="background:linear-gradient(135deg,#b45309,#d97706);padding:32px;text-align:center;">
              <h1 style="color:#fff;margin:0;font-size:26px;">🕉 Shital Hindu Temple</h1>
              <p style="color:#fde68a;margin:8px 0 0;font-size:14px;">Jay Shree Krishna</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="color:#1f2937;font-size:20px;margin:0 0 16px;">Welcome, ${escapeHtml(name)}!</h2>
              <p style="font-size:15px;color:#6b7280;line-height:1.6;margin:0 0 16px;">
                We are delighted to welcome you to the Shital Hindu Temple community.
                Your account has been created and you can now access our services.
              </p>
              <p style="font-size:15px;color:#6b7280;line-height:1.6;margin:0 0 24px;">
                You can use the platform to book pujas, view temple events, make donations, and more.
              </p>
              <div style="background:#fef3c7;border-left:4px solid #d97706;padding:16px;border-radius:0 8px 8px 0;margin-bottom:24px;">
                <p style="margin:0;font-size:14px;color:#92400e;">
                  Please verify your email address using the OTP that was sent separately.
                </p>
              </div>
              <p style="font-size:14px;color:#9ca3af;margin:0;">
                If you have any questions, please contact us at
                <a href="mailto:info@shital.org" style="color:#b45309;">info@shital.org</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:16px 32px;text-align:center;">
              <p style="font-size:12px;color:#9ca3af;margin:0;">
                © ${new Date().getFullYear()} Shital Hindu Temple. Registered Charity.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()

  return sendEmail({
    to: email,
    subject: 'Welcome to Shital Hindu Temple',
    html,
    text: `Dear ${name},\n\nWelcome to Shital Hindu Temple! Your account has been created.\n\nPlease verify your email using the OTP sent separately.\n\nJay Shree Krishna.\n\n© ${new Date().getFullYear()} Shital Hindu Temple`,
  })
}

export async function sendPayslipEmail(
  email: string,
  name: string,
  period: string,
  pdfBuffer: Buffer,
): Promise<Result<void>> {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Payslip</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
          <tr>
            <td style="background:#1f2937;padding:24px 32px;">
              <h1 style="color:#fff;margin:0;font-size:20px;">Shital Hindu Temple</h1>
              <p style="color:#9ca3af;margin:4px 0 0;font-size:13px;">Payroll Department</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="font-size:16px;color:#374151;margin:0 0 16px;">Dear ${escapeHtml(name)},</p>
              <p style="font-size:15px;color:#6b7280;line-height:1.6;margin:0 0 16px;">
                Please find attached your payslip for the period <strong style="color:#374151;">${escapeHtml(period)}</strong>.
              </p>
              <p style="font-size:14px;color:#9ca3af;margin:0 0 24px;">
                This payslip is confidential. If you have any queries regarding your pay, please contact HR.
              </p>
              <div style="background:#f3f4f6;padding:16px;border-radius:8px;">
                <p style="margin:0;font-size:13px;color:#6b7280;">
                  📎 Attachment: Payslip_${escapeHtml(period.replace(/\s/g, '_'))}.pdf
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:16px 32px;text-align:center;">
              <p style="font-size:12px;color:#9ca3af;margin:0;">
                © ${new Date().getFullYear()} Shital Hindu Temple. Registered Charity. This email is confidential.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()

  const filename = `Payslip_${period.replace(/\s/g, '_')}.pdf`

  return tryAsync(async () => {
    sgMail.setApiKey(getApiKey())

    await sgMail.send({
      to: email,
      from: DEFAULT_FROM,
      subject: `Your Payslip for ${period}`,
      html,
      text: `Dear ${name},\n\nPlease find attached your payslip for ${period}.\n\n© ${new Date().getFullYear()} Shital Hindu Temple`,
      attachments: [
        {
          content: pdfBuffer.toString('base64'),
          filename,
          type: 'application/pdf',
          disposition: 'attachment',
        },
      ],
    })

    incrementDailyCount()
    log.info({ to: email, period }, 'Payslip email sent')
  })
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
