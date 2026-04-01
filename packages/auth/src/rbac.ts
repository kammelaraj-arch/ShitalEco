import type { Role } from '@shital/config'

// Define which roles have which permissions
const ROLE_HIERARCHY: Record<Role, number> = {
  SUPER_ADMIN: 100,
  TRUSTEE: 80,
  ACCOUNTANT: 70,
  HR_MANAGER: 65,
  AUDITOR: 60,
  BRANCH_MANAGER: 50,
  STAFF: 30,
  VOLUNTEER: 20,
  DEVOTEE: 10,
  KIOSK: 5,
}

export function hasMinimumRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole]
}

// Permissions map
export const PERMISSIONS = {
  // Finance
  'finance:read': ['SUPER_ADMIN', 'TRUSTEE', 'ACCOUNTANT', 'AUDITOR', 'BRANCH_MANAGER'],
  'finance:write': ['SUPER_ADMIN', 'TRUSTEE', 'ACCOUNTANT'],
  'finance:void': ['SUPER_ADMIN', 'TRUSTEE', 'ACCOUNTANT'],
  'payroll:read': ['SUPER_ADMIN', 'TRUSTEE', 'HR_MANAGER', 'ACCOUNTANT'],
  'payroll:run': ['SUPER_ADMIN', 'HR_MANAGER', 'ACCOUNTANT'],
  // HR
  'hr:read': ['SUPER_ADMIN', 'TRUSTEE', 'HR_MANAGER', 'BRANCH_MANAGER'],
  'hr:write': ['SUPER_ADMIN', 'HR_MANAGER'],
  // Assets
  'assets:read': ['SUPER_ADMIN', 'TRUSTEE', 'BRANCH_MANAGER', 'STAFF', 'ACCOUNTANT'],
  'assets:write': ['SUPER_ADMIN', 'BRANCH_MANAGER'],
  // Compliance
  'compliance:read': ['SUPER_ADMIN', 'TRUSTEE', 'AUDITOR'],
  'compliance:write': ['SUPER_ADMIN', 'TRUSTEE'],
  // Admin
  'admin:users': ['SUPER_ADMIN'],
  'admin:branches': ['SUPER_ADMIN', 'TRUSTEE'],
  // Bookings
  'bookings:read': ['SUPER_ADMIN', 'BRANCH_MANAGER', 'STAFF'],
  'bookings:write': ['SUPER_ADMIN', 'BRANCH_MANAGER', 'STAFF'],
} as const

export type Permission = keyof typeof PERMISSIONS

export function hasPermission(userRole: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).includes(userRole)
}

export function requireBranchScope(role: Role): boolean {
  return ['BRANCH_MANAGER', 'STAFF'].includes(role)
}
