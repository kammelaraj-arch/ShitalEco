import { SignJWT, jwtVerify } from 'jose'
import { randomUUID } from 'node:crypto'
import { env, tryAsync, type Result } from '@shital/config'
import type { AuthUser, JwtPayload } from './types.js'

const ACCESS_TOKEN_TTL = '1h'
const REFRESH_TOKEN_TTL = '7d'
const ACCESS_EXPIRES_IN_SECONDS = 60 * 60 // 1 hour

function getSecret(): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET)
}

export async function signAccessToken(user: AuthUser): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    email: user.email,
    role: user.role,
    branchId: user.branchId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .setJti(randomUUID())
    .sign(getSecret())
}

export async function signRefreshToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_TTL)
    .setJti(randomUUID())
    .sign(getSecret())
}

export async function verifyAccessToken(token: string): Promise<Result<JwtPayload>> {
  return tryAsync(async () => {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.role !== 'string' ||
      typeof payload.jti !== 'string' ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      throw new Error('Invalid JWT payload shape')
    }

    return {
      sub: payload.sub,
      email: payload.email as string,
      role: payload.role as JwtPayload['role'],
      branchId: (payload['branchId'] as string | null | undefined) ?? null,
      iat: payload.iat,
      exp: payload.exp,
      jti: payload.jti,
    } satisfies JwtPayload
  })
}

export async function verifyRefreshToken(token: string): Promise<Result<{ sub: string }>> {
  return tryAsync(async () => {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })

    if (typeof payload.sub !== 'string') {
      throw new Error('Invalid refresh token payload')
    }

    return { sub: payload.sub }
  })
}

export { ACCESS_EXPIRES_IN_SECONDS }
