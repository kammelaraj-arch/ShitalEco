/**
 * Unified role registry — one list, tier-grouped.
 *
 * Previously we split this into SYSTEM_ROLES (10 permission roles) and
 * BOARD_POSITIONS (10 governance positions) — two arrays, two mental models.
 * Users rightly pointed out these are all just "roles" in the organization
 * with different *scopes* (admin tools vs board governance vs operations).
 * Tier is now a property of each role rather than a different array.
 *
 *   Tier         Roles
 *   ─────        ─────
 *   admin        SUPER_ADMIN
 *   main_board   CHAIR, TREASURER, SECRETARY, CEO, TRUSTEE
 *   lmc          LMC_CHAIR, LMC_TREASURER, LMC_MEMBER
 *   operations   ACCOUNTANT, HR_MANAGER, AUDITOR, BRANCH_MANAGER, STAFF
 *   volunteer    VOLUNTEER
 *   public       DEVOTEE
 *   external     EXTERNAL_CONTRACTOR, TEMP_WORKER
 *   system       KIOSK
 *
 * Two slices are useful at different call sites:
 *   • Settings → Users / App Permissions read every role, grouped by tier.
 *   • Board → Trustees filters to governance tiers (main_board / lmc /
 *     external) because those are the only positions a trustee record can
 *     hold.
 *
 * To rename / add / remove a role: edit ROLES below. Both pages re-render.
 */

export type RoleTier =
  | 'admin'
  | 'main_board'
  | 'lmc'
  | 'operations'
  | 'volunteer'
  | 'public'
  | 'external'
  | 'system'

/**
 * Executive status — standard UK charity-governance distinction.
 *  • exec     — actively manages day-to-day operations (e.g. CEO).
 *               In larger charities this includes paid executive directors.
 *  • non_exec — governance / oversight only, typically unpaid (most trustees
 *               and board officers — Chair, Treasurer, Secretary).
 *  • na       — concept doesn't apply (employed staff, contractors, kiosks).
 *
 * This is independent of tier — both reflect different facets of the role.
 * Tier says WHERE in the org structure the role sits; exec says WHETHER the
 * holder is an executive director under Charity Commission terminology.
 */
export type ExecStatus = 'exec' | 'non_exec' | 'na'

export interface RoleDef {
  /** UPPER_SNAKE stable identifier — never change after rollout (it's
   *  written to users.role and trustees.role). */
  id:    string
  /** Human label shown on buttons and badges. */
  label: string
  /** Short one-line description for the Settings page. */
  desc:  string
  /** Tier — drives grouping on the UI and which call sites surface it. */
  tier:  RoleTier
  /** Executive status under UK charity governance terminology. */
  exec:  ExecStatus
  /** Sort order — higher = more privileged. Drives the legend order. */
  level: number
  /** Hex foreground/border tint. */
  color: string
  /** Hex background tint. */
  bg:    string
}

export const ROLES: RoleDef[] = [
  // ─── Admin ────────────────────────────────────────────────────────────
  { id: 'SUPER_ADMIN',         label: 'Super Admin',         desc: 'Full system access',                      tier: 'admin',      exec: 'na',       level: 100, color: '#ef4444', bg: '#fef2f2' },

  // ─── Main board ──────────────────────────────────────────────────────
  // Exec / non-exec follows Charity Commission convention: the CEO is the
  // sole executive trustee; Chair / Treasurer / Secretary / lay trustees
  // are all non-executive officers whose job is oversight, not management.
  { id: 'CHAIR',               label: 'Chair',               desc: 'Chair of the Board of Trustees',          tier: 'main_board', exec: 'non_exec', level:  95, color: '#d97706', bg: '#fffbeb' },
  { id: 'CEO',                 label: 'CEO',                 desc: 'Chief Executive (executive trustee)',     tier: 'main_board', exec: 'exec',     level:  90, color: '#d97706', bg: '#fffbeb' },
  { id: 'TREASURER',           label: 'Treasurer',           desc: 'Lead trustee for finance',                 tier: 'main_board', exec: 'non_exec', level:  88, color: '#d97706', bg: '#fffbeb' },
  { id: 'SECRETARY',           label: 'Secretary',           desc: 'Board records and resolutions',            tier: 'main_board', exec: 'non_exec', level:  85, color: '#d97706', bg: '#fffbeb' },
  { id: 'TRUSTEE',             label: 'Trustee',             desc: 'General trustee — no specific portfolio',  tier: 'main_board', exec: 'non_exec', level:  80, color: '#d97706', bg: '#fffbeb' },

  // ─── Local Management Committee ──────────────────────────────────────
  { id: 'LMC_CHAIR',           label: 'LMC Chair',           desc: 'Chair of a Local Management Committee',    tier: 'lmc',        exec: 'non_exec', level:  65, color: '#0ea5e9', bg: '#f0f9ff' },
  { id: 'LMC_TREASURER',       label: 'LMC Treasurer',       desc: 'Treasurer of an LMC',                      tier: 'lmc',        exec: 'non_exec', level:  62, color: '#0ea5e9', bg: '#f0f9ff' },
  { id: 'LMC_MEMBER',          label: 'LMC Member',          desc: 'Member of an LMC',                         tier: 'lmc',        exec: 'non_exec', level:  60, color: '#0ea5e9', bg: '#f0f9ff' },

  // ─── Operations / staff (employed, not board) ────────────────────────
  { id: 'ACCOUNTANT',          label: 'Accountant',          desc: 'Finance read/write access',                tier: 'operations', exec: 'na',       level:  70, color: '#7c3aed', bg: '#f5f3ff' },
  { id: 'HR_MANAGER',          label: 'HR Manager',          desc: 'HR, payroll, employees',                   tier: 'operations', exec: 'na',       level:  68, color: '#0891b2', bg: '#ecfeff' },
  { id: 'AUDITOR',             label: 'Auditor',             desc: 'Read-only compliance & finance',           tier: 'operations', exec: 'na',       level:  58, color: '#475569', bg: '#f8fafc' },
  { id: 'BRANCH_MANAGER',      label: 'Branch Manager',      desc: 'Branch operations & bookings',             tier: 'operations', exec: 'na',       level:  50, color: '#059669', bg: '#f0fdf4' },
  { id: 'STAFF',               label: 'Staff',               desc: 'Bookings, kiosk, general ops',             tier: 'operations', exec: 'na',       level:  30, color: '#2563eb', bg: '#eff6ff' },

  // ─── Volunteer ───────────────────────────────────────────────────────
  { id: 'VOLUNTEER',           label: 'Volunteer',           desc: 'Limited operational access',               tier: 'volunteer',  exec: 'na',       level:  20, color: '#16a34a', bg: '#f0fdf4' },

  // ─── Public ──────────────────────────────────────────────────────────
  { id: 'DEVOTEE',             label: 'Devotee',             desc: 'Self-service donations & bookings',        tier: 'public',     exec: 'na',       level:  10, color: '#9333ea', bg: '#fdf4ff' },

  // ─── External (not on the board) ─────────────────────────────────────
  { id: 'EXTERNAL_CONTRACTOR', label: 'External Contractor', desc: 'Contracted external party',                tier: 'external',   exec: 'na',       level:  25, color: '#94a3b8', bg: '#f8fafc' },
  { id: 'TEMP_WORKER',         label: 'Temp Worker',         desc: 'Short-term staffer',                       tier: 'external',   exec: 'na',       level:  25, color: '#94a3b8', bg: '#f8fafc' },

  // ─── System (terminals etc.) ─────────────────────────────────────────
  { id: 'KIOSK',               label: 'Kiosk',               desc: 'Kiosk terminal access only',               tier: 'system',     exec: 'na',       level:   5, color: '#64748b', bg: '#f8fafc' },
]

export const EXEC_LABELS: Record<ExecStatus, string> = {
  exec:     'Exec',
  non_exec: 'Non-Exec',
  na:       '',  // hidden when not applicable
}

export function isExecutiveRole(id: string): boolean {
  return ROLES.find(r => r.id === id)?.exec === 'exec'
}

export const TIER_LABELS: Record<RoleTier, string> = {
  admin:      'Admin',
  main_board: 'Main Board',
  lmc:        'Local Management Committee',
  operations: 'Operations & Staff',
  volunteer:  'Volunteer',
  public:     'Public',
  external:   'Non-Officer',
  system:     'System',
}

/** Tiers ordered as they should render on the settings page. */
export const TIER_ORDER: RoleTier[] = [
  'admin', 'main_board', 'lmc', 'operations', 'volunteer', 'public', 'external', 'system',
]

export function roleInfo(id: string): RoleDef {
  return ROLES.find(r => r.id === id) ?? {
    id, label: id, desc: '', tier: 'system', exec: 'na', level: 0, color: '#6b7280', bg: '#f9fafb',
  }
}

export function roleLabel(id: string): string {
  return ROLES.find(r => r.id === id)?.label ?? id
}

export function rolesByTier(): Record<RoleTier, RoleDef[]> {
  const out = Object.fromEntries(TIER_ORDER.map(t => [t, [] as RoleDef[]])) as Record<RoleTier, RoleDef[]>
  for (const r of ROLES) out[r.tier].push(r)
  return out
}

/**
 * Board positions = governance roles a trustee record can hold. The Trustees
 * module picks from this list rather than the full registry because a trustee
 * row in the DB represents a board seat, not a system access role.
 */
export const BOARD_TIERS: RoleTier[] = ['main_board', 'lmc', 'external']

export function boardPositionsByTier(): Record<RoleTier, RoleDef[]> {
  const all = rolesByTier()
  return {
    admin: [], main_board: all.main_board, lmc: all.lmc, operations: [],
    volunteer: [], public: [], external: all.external, system: [],
  }
}

// ─── Back-compat shims (old import names still work) ─────────────────────
export const SYSTEM_ROLES         = ROLES
export const BOARD_POSITIONS      = ROLES.filter(r => BOARD_TIERS.includes(r.tier))
export const BOARD_TIER_LABELS    = TIER_LABELS
export const systemRoleInfo       = roleInfo
export const boardPositionLabel   = roleLabel
