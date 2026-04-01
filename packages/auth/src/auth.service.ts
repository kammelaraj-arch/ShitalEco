import { z } from 'zod'
import {
  ok,
  err,
  tryAsync,
  type Result,
  createContextLogger,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ConflictError,
  DomainError,
  OTP_TTL_SECONDS,
} from '@shital/config'
import { prisma } from '@shital/db'
import { hashPassword, verifyPassword, validatePasswordStrength } from './password.js'
import { signAccessToken, signRefreshToken, verifyRefreshToken, ACCESS_EXPIRES_IN_SECONDS } from './jwt.js'
import { generateEmailOtp, generateTotpSecret, generateTotpUri, verifyTotpToken } from './otp.js'
import type { AuthUser, TokenPair } from './types.js'

const log = createContextLogger({ module: 'auth.service' })

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
  phone: z.string().optional(),
})

async function buildTokenPair(user: AuthUser, ipAddress?: string, userAgent?: string): Promise<TokenPair> {
  const accessToken = await signAccessToken(user)
  const refreshToken = await signRefreshToken(user.id)

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await prisma.session.create({
    data: {
      userId: user.id,
      token: refreshToken,
      expiresAt,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    },
  })

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_EXPIRES_IN_SECONDS,
  }
}

function toAuthUser(user: {
  id: string
  email: string
  name: string
  role: AuthUser['role']
  branchId: string | null
  mfaEnabled: boolean
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    branchId: user.branchId,
    mfaEnabled: user.mfaEnabled,
  }
}

export class AuthService {
  async loginWithEmail(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<Result<TokenPair>> {
    const ctxLog = createContextLogger({ module: 'auth.service', userId: undefined })

    return tryAsync(async () => {
      const user = await prisma.user.findFirst({
        where: { email: email.toLowerCase(), deletedAt: null },
      })

      if (user === null || user === undefined) {
        throw new UnauthorizedError('Invalid email or password')
      }

      if (!user.isActive) {
        throw new UnauthorizedError('Account is disabled')
      }

      if (user.passwordHash === null || user.passwordHash === undefined) {
        throw new UnauthorizedError('Password login not configured for this account')
      }

      const passwordOk = await verifyPassword(password, user.passwordHash)
      if (!passwordOk) {
        ctxLog.warn({ email }, 'Failed login attempt')
        throw new UnauthorizedError('Invalid email or password')
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })

      const authUser = toAuthUser(user)
      const tokens = await buildTokenPair(authUser, ipAddress, userAgent)

      ctxLog.info({ userId: user.id }, 'User logged in via email')
      return tokens
    })
  }

  async loginWithOtp(
    email: string,
    code: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<Result<TokenPair>> {
    return tryAsync(async () => {
      const user = await prisma.user.findFirst({
        where: { email: email.toLowerCase(), deletedAt: null },
      })

      if (user === null || user === undefined) {
        throw new UnauthorizedError('Invalid OTP')
      }

      if (!user.isActive) {
        throw new UnauthorizedError('Account is disabled')
      }

      const otpRecord = await prisma.otpCode.findFirst({
        where: {
          userId: user.id,
          code,
          purpose: 'LOGIN',
          used: false,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      })

      if (otpRecord === null || otpRecord === undefined) {
        throw new UnauthorizedError('Invalid or expired OTP')
      }

      await prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: { used: true },
      })

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })

      const authUser = toAuthUser(user)
      const tokens = await buildTokenPair(authUser, ipAddress, userAgent)

      log.info({ userId: user.id }, 'User logged in via OTP')
      return tokens
    })
  }

  async refreshTokens(
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<Result<TokenPair>> {
    const verifyResult = await verifyRefreshToken(refreshToken)
    if (!verifyResult.ok) {
      return err(new UnauthorizedError('Invalid refresh token'))
    }

    return tryAsync(async () => {
      const session = await prisma.session.findFirst({
        where: {
          token: refreshToken,
          expiresAt: { gt: new Date() },
        },
        include: { user: true },
      })

      if (session === null || session === undefined) {
        throw new UnauthorizedError('Session not found or expired')
      }

      if (!session.user.isActive || session.user.deletedAt !== null) {
        throw new UnauthorizedError('Account is disabled')
      }

      // Rotate: delete old session
      await prisma.session.delete({ where: { id: session.id } })

      const authUser = toAuthUser(session.user)
      const tokens = await buildTokenPair(authUser, ipAddress, userAgent)

      log.info({ userId: session.userId }, 'Tokens refreshed')
      return tokens
    })
  }

  async logout(sessionToken: string): Promise<Result<void>> {
    return tryAsync(async () => {
      await prisma.session.deleteMany({ where: { token: sessionToken } })
      log.info({ token: sessionToken.slice(0, 8) + '...' }, 'Session logged out')
    })
  }

  async logoutAll(userId: string): Promise<Result<void>> {
    return tryAsync(async () => {
      await prisma.session.deleteMany({ where: { userId } })
      log.info({ userId }, 'All sessions logged out')
    })
  }

  async registerDevotee(data: {
    email: string
    password: string
    name: string
    phone?: string
  }): Promise<Result<AuthUser>> {
    const parsed = registerSchema.safeParse(data)
    if (!parsed.success) {
      return err(new ValidationError('Invalid registration data', parsed.error.format()))
    }

    const strength = validatePasswordStrength(parsed.data.password)
    if (!strength.valid) {
      return err(new ValidationError('Password does not meet requirements', strength.errors))
    }

    return tryAsync(async () => {
      const existing = await prisma.user.findFirst({
        where: { email: parsed.data.email.toLowerCase(), deletedAt: null },
      })

      if (existing !== null && existing !== undefined) {
        throw new ConflictError(`Email already registered: ${parsed.data.email}`)
      }

      const passwordHash = await hashPassword(parsed.data.password)

      const user = await prisma.user.create({
        data: {
          email: parsed.data.email.toLowerCase(),
          passwordHash,
          name: parsed.data.name,
          phone: parsed.data.phone ?? null,
          role: 'DEVOTEE',
        },
      })

      // Generate and store email verification OTP
      const otpCode = generateEmailOtp()
      const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000)

      await prisma.otpCode.create({
        data: {
          userId: user.id,
          code: otpCode,
          purpose: 'EMAIL_VERIFY',
          expiresAt,
        },
      })

      log.info({ userId: user.id, email: user.email }, 'Devotee registered; OTP created for email verification')

      return toAuthUser(user)
    })
  }

  async setupMfa(userId: string): Promise<Result<{ secret: string; uri: string }>> {
    return tryAsync(async () => {
      const user = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
      })

      if (user === null || user === undefined) {
        throw new NotFoundError('User', userId)
      }

      const secret = generateTotpSecret()
      const uri = generateTotpUri(user.email, secret)

      await prisma.user.update({
        where: { id: userId },
        data: { mfaSecret: secret },
      })

      log.info({ userId }, 'MFA secret generated')
      return { secret, uri }
    })
  }

  async verifyMfa(userId: string, token: string): Promise<Result<boolean>> {
    return tryAsync(async () => {
      const user = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
      })

      if (user === null || user === undefined) {
        throw new NotFoundError('User', userId)
      }

      if (user.mfaSecret === null || user.mfaSecret === undefined) {
        throw new DomainError('MFA_NOT_SETUP', 'MFA has not been configured for this user')
      }

      const valid = verifyTotpToken(token, user.mfaSecret)

      if (valid && !user.mfaEnabled) {
        await prisma.user.update({
          where: { id: userId },
          data: { mfaEnabled: true },
        })
        log.info({ userId }, 'MFA enabled for user')
      }

      return valid
    })
  }
}
