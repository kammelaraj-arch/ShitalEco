export const PAGINATION = { DEFAULT_LIMIT: 20, MAX_LIMIT: 100 } as const

export const GIFT_AID_RATE = 0.25 // 25p per £1
export const UK_BASIC_TAX_RATE = 0.20
export const UK_HIGHER_TAX_RATE = 0.40
export const UK_ADDITIONAL_TAX_RATE = 0.45
export const NI_EMPLOYEE_RATE = 0.08
export const NI_EMPLOYER_RATE = 0.138
export const AUTO_ENROLMENT_EMPLOYEE_MIN = 0.05
export const AUTO_ENROLMENT_EMPLOYER_MIN = 0.03

export const ROLES = [
  'SUPER_ADMIN',
  'TRUSTEE',
  'ACCOUNTANT',
  'HR_MANAGER',
  'BRANCH_MANAGER',
  'STAFF',
  'VOLUNTEER',
  'DEVOTEE',
  'KIOSK',
  'AUDITOR',
] as const
export type Role = (typeof ROLES)[number]

export const CURRENCIES = ['GBP', 'USD', 'EUR', 'INR'] as const
export type Currency = (typeof CURRENCIES)[number]
export const DEFAULT_CURRENCY: Currency = 'GBP'

export const BRANCHES = { DEFAULT_BRANCH_ID: 'default' } as const

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days
export const OTP_TTL_SECONDS = 300 // 5 minutes
export const MAX_LOGIN_ATTEMPTS = 5
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 min
