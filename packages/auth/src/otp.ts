import { randomInt } from 'node:crypto'
import { authenticator } from 'otplib'

/**
 * Generate a 6-digit numeric OTP using cryptographically secure randomness.
 * The result is zero-padded to always be 6 digits.
 */
export function generateEmailOtp(): string {
  const code = randomInt(0, 1_000_000)
  return code.toString().padStart(6, '0')
}

/**
 * Generate a base32 TOTP secret suitable for use with authenticator apps.
 */
export function generateTotpSecret(): string {
  return authenticator.generateSecret()
}

/**
 * Verify a TOTP token against the stored secret.
 * Uses a ±1 window to account for clock drift.
 */
export function verifyTotpToken(token: string, secret: string): boolean {
  return authenticator.check(token, secret)
}

/**
 * Generate an otpauth:// URI for QR code display.
 * E.g. otpauth://totp/Shital%20Temple:user@example.com?secret=...&issuer=Shital%20Temple
 */
export function generateTotpUri(email: string, secret: string): string {
  return authenticator.keyuri(email, 'Shital Temple', secret)
}
