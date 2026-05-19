/**
 * Centralized role registry — single source of truth for both kinds of "role"
 * the admin app talks about.
 *
 *   1. SYSTEM_ROLES — permission/auth roles (what a user can do in the system).
 *      Owned by Settings → Users.
 *
 *   2. BOARD_POSITIONS — governance positions a trustee can hold (what seat
 *      they occupy on the board). Grouped by tier: main board, LMC, non-officer.
 *      Owned by Settings → Users (the "Board Positions" section), referenced
 *      by Board → Trustees so trustees only ever pick from this list.
 *
 * Previously the trustees page hardcoded its own copy of the board positions
 * list. That meant adding a new board position required editing the trustees
 * module instead of the settings/users module where users expect to manage
 * roles. This file is the fix.
 */

export interface SystemRoleDef {
  id:    string
  label: string
  desc:  string
  /** Hex foreground/border tint */
  color: string
  /** Hex background tint */
  bg:    string
  /** Sort order — higher means more privileged */
  level: number
}

export const SYSTEM_ROLES: SystemRoleDef[] = [
  { id: 'SUPER_ADMIN',    label: 'Super Admin',    desc: 'Full system access',                color: '#ef4444', bg: '#fef2f2', level: 100 },
  { id: 'TRUSTEE',        label: 'Trustee',        desc: 'Governance & finance oversight',    color: '#d97706', bg: '#fffbeb', level:  80 },
  { id: 'ACCOUNTANT',     label: 'Accountant',     desc: 'Finance read/write access',         color: '#7c3aed', bg: '#f5f3ff', level:  70 },
  { id: 'HR_MANAGER',     label: 'HR Manager',     desc: 'HR, payroll, employees',            color: '#0891b2', bg: '#ecfeff', level:  65 },
  { id: 'AUDITOR',        label: 'Auditor',        desc: 'Read-only compliance & finance',    color: '#475569', bg: '#f8fafc', level:  60 },
  { id: 'BRANCH_MANAGER', label: 'Branch Manager', desc: 'Branch operations & bookings',      color: '#059669', bg: '#f0fdf4', level:  50 },
  { id: 'STAFF',          label: 'Staff',          desc: 'Bookings, kiosk, general ops',      color: '#2563eb', bg: '#eff6ff', level:  30 },
  { id: 'VOLUNTEER',      label: 'Volunteer',      desc: 'Limited operational access',        color: '#16a34a', bg: '#f0fdf4', level:  20 },
  { id: 'DEVOTEE',        label: 'Devotee',        desc: 'Self-service donations & bookings', color: '#9333ea', bg: '#fdf4ff', level:  10 },
  { id: 'KIOSK',          label: 'Kiosk',          desc: 'Kiosk terminal access only',        color: '#64748b', bg: '#f8fafc', level:   5 },
]

export type SystemRoleId = string

export function systemRoleInfo(id: string): SystemRoleDef {
  return SYSTEM_ROLES.find(r => r.id === id)
    ?? { id, label: id, desc: '', color: '#6b7280', bg: '#f9fafb', level: 0 }
}

// ──────────────────────────────────────────────────────────────────────────

export type BoardPositionTier = 'main_board' | 'lmc' | 'non_officer'

export interface BoardPositionDef {
  id:    string                // UPPER_SNAKE — stable API contract
  label: string                // Human label shown on buttons/badges
  tier:  BoardPositionTier
  /** Optional short description for the settings page */
  desc?: string
}

export const BOARD_POSITIONS: BoardPositionDef[] = [
  // Main board officers + general trustees
  { id: 'CHAIR',               label: 'Chair',               tier: 'main_board',  desc: 'Chair of the Board of Trustees' },
  { id: 'TREASURER',           label: 'Treasurer',           tier: 'main_board',  desc: 'Lead trustee for finance' },
  { id: 'SECRETARY',           label: 'Secretary',           tier: 'main_board',  desc: 'Board records and resolutions' },
  { id: 'CEO',                 label: 'CEO',                 tier: 'main_board',  desc: 'Chief Executive (staff officer)' },
  { id: 'TRUSTEE',             label: 'Trustee',             tier: 'main_board',  desc: 'General trustee — no specific portfolio' },

  // Local Management Committee
  { id: 'LMC_CHAIR',           label: 'LMC Chair',           tier: 'lmc',         desc: 'Chair of a Local Management Committee' },
  { id: 'LMC_TREASURER',       label: 'LMC Treasurer',       tier: 'lmc',         desc: 'Treasurer of a Local Management Committee' },
  { id: 'LMC_MEMBER',          label: 'LMC Member',          tier: 'lmc',         desc: 'Member of a Local Management Committee' },

  // Non-officer roles still shown on the board page for traceability
  { id: 'EXTERNAL_CONTRACTOR', label: 'External Contractor', tier: 'non_officer', desc: 'Contracted external party (not a trustee)' },
  { id: 'TEMP_WORKER',         label: 'Temp Worker',         tier: 'non_officer', desc: 'Short-term staffer (not a trustee)' },
]

export const BOARD_TIER_LABELS: Record<BoardPositionTier, string> = {
  main_board:  'Main Board',
  lmc:         'Local Management Committee',
  non_officer: 'Non-Officer',
}

export function boardPositionsByTier(): Record<BoardPositionTier, BoardPositionDef[]> {
  return {
    main_board:  BOARD_POSITIONS.filter(p => p.tier === 'main_board'),
    lmc:         BOARD_POSITIONS.filter(p => p.tier === 'lmc'),
    non_officer: BOARD_POSITIONS.filter(p => p.tier === 'non_officer'),
  }
}

export function boardPositionLabel(id: string): string {
  return BOARD_POSITIONS.find(p => p.id === id)?.label ?? id
}
