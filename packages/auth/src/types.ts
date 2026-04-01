import type { Role } from '@shital/config'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: Role
  branchId: string | null
  mfaEnabled: boolean
}

export interface JwtPayload {
  sub: string // userId
  email: string
  role: Role
  branchId: string | null
  iat: number
  exp: number
  jti: string // jwt id for revocation
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export type AuthProvider = 'email' | 'office365' | 'google' | 'apple' | 'kiosk'
