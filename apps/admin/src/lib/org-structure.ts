/**
 * Organisation structure — single source of truth for the temple's reporting
 * lines, aligned with UK Charity Commission guidance:
 *
 *   • CC3   "The essential trustee"          — trustees collectively responsible
 *   • CC8   "Internal financial controls"    — separation of duties
 *   • CC9   "Speaking out"                   — independent whistleblowing
 *   • CC30  "Finding new trustees"           — Nominations Committee
 *   • CC50  "Charities and meetings"         — board / sub-committee structure
 *
 * The four governance principles every node here observes:
 *
 *   1. ONE LEGAL ENTITY. Branches and LMCs operate under delegated authority
 *      from the main Board — they are NOT separate registered charities. All
 *      money, contracts, and liabilities sit with the parent charity.
 *
 *   2. TRUSTEES vs STAFF. The Board (volunteer, non-executive) governs; the
 *      CEO and staff (paid, executive) operate. The line never blurs — the
 *      CEO reports to the Board collectively, never to the Chair personally.
 *
 *   3. AUDITOR INDEPENDENCE. The external auditor and the Audit Committee
 *      report to the full Board, NOT through the CEO. Bypass arrow on the
 *      chart is deliberate.
 *
 *   4. LOCAL AUTONOMY, CENTRAL CONTROL. LMCs run day-to-day branch life
 *      (events, rota, local fundraising) under their LMC Chair; finance,
 *      HR, safeguarding, and IT are centralised so policy is uniform and
 *      consolidated accounts are possible (Charities Act 2011 § 132).
 *
 * Visual rendering of this tree lives at /board/structure.
 */

export interface OrgNode {
  /** Stable identifier used as the tree key and for "reports_to" links. */
  id:            string
  /** Display label on the chart card. */
  label:         string
  /** One- or two-sentence charter — what this unit is responsible for. */
  charter:       string
  /** Which roles from lib/roles.ts can hold a seat in this unit. */
  acceptsRoles:  string[]
  /** Tier badge (matches lib/roles tier names where possible). */
  kind:          'governance' | 'committee' | 'executive' | 'department' | 'branch' | 'independent'
  /** Parent node id. null = top of tree (only the charity itself). */
  reportsTo:     string | null
  /** Optional dotted-line accountability for matrix relationships (e.g.
   *  Finance Manager solid-lines to CEO, dotted-lines to Treasurer). */
  dottedTo?:     string[]
  /** Charity Commission / Charities Act reference for this node. */
  cite?:         string
}

// Avoid a circular import by inlining the RoleId type as `string`. The actual
// role registry lives in @/lib/roles; we only need the ids here.

export const ORG_STRUCTURE: OrgNode[] = [
  // ─── The charity itself ──────────────────────────────────────────────
  {
    id:           'charity',
    label:        'Shri Shirdi Saibaba Temple Association (SHITAL)',
    charter:      'The registered charity. All branches operate under this single legal entity. Trustees are jointly and severally responsible for everything that happens in its name.',
    acceptsRoles: [],
    kind:         'governance',
    reportsTo:    null,
    cite:         'Charities Act 2011 § 1',
  },

  // ─── Board of Trustees (sovereign governance) ────────────────────────
  {
    id:           'board',
    label:        'Board of Trustees',
    charter:      'Sovereign governing body. Sets strategy, approves budgets, appoints the CEO, and is accountable to the Charity Commission and the public. Meets quarterly at minimum.',
    acceptsRoles: ['CHAIR', 'TREASURER', 'SECRETARY', 'TRUSTEE'],
    kind:         'governance',
    reportsTo:    'charity',
    cite:         'CC3 — collective responsibility',
  },
  {
    id:           'chair',
    label:        'Chair of the Board',
    charter:      'Presides over Board meetings, sets the agenda jointly with the CEO and Secretary, and is the spokesperson for the trustees. Does not hold executive authority over staff.',
    acceptsRoles: ['CHAIR'],
    kind:         'governance',
    reportsTo:    'board',
    cite:         'CC50 — Board meetings',
  },
  {
    id:           'treasurer',
    label:        'Honorary Treasurer',
    charter:      'Lead trustee for financial oversight. Chairs the Finance Sub-Committee, reviews monthly management accounts, and signs the annual return to the Charity Commission.',
    acceptsRoles: ['TREASURER'],
    kind:         'governance',
    reportsTo:    'board',
    cite:         'CC8 — financial controls',
  },
  {
    id:           'secretary',
    label:        'Honorary Secretary',
    charter:      'Keeps the Trustees Register and minutes, files the annual return + accounts at Companies House and the Charity Commission, ensures Board resolutions are properly recorded.',
    acceptsRoles: ['SECRETARY'],
    kind:         'governance',
    reportsTo:    'board',
  },

  // ─── Sub-committees of the Board ────────────────────────────────────
  {
    id:           'cmte_finance',
    label:        'Finance Sub-Committee',
    charter:      'Reviews monthly management accounts, scrutinises budgets and reserves, recommends investment decisions to the full Board. Meets monthly.',
    acceptsRoles: ['TREASURER', 'TRUSTEE'],
    kind:         'committee',
    reportsTo:    'board',
    cite:         'CC8',
  },
  {
    id:           'cmte_audit',
    label:        'Audit & Risk Committee',
    charter:      'Independent of management. Reviews the annual audit, the risk register, and internal controls; reports concerns directly to the Board. Chaired by a trustee who is NOT the Chair or Treasurer.',
    acceptsRoles: ['TRUSTEE'],
    kind:         'committee',
    reportsTo:    'board',
    cite:         'CC8 — independent review',
  },
  {
    id:           'cmte_safeguarding',
    label:        'Safeguarding Committee',
    charter:      'Owns the safeguarding policy, reviews every safeguarding incident, and reports serious cases to the Charity Commission within 24 hours.',
    acceptsRoles: ['TRUSTEE'],
    kind:         'committee',
    reportsTo:    'board',
    cite:         'CC9 — serious incident reporting',
  },
  {
    id:           'cmte_nominations',
    label:        'Nominations Committee',
    charter:      'Identifies and recommends new trustees, manages the recruitment process, oversees induction and term renewals.',
    acceptsRoles: ['CHAIR', 'TRUSTEE'],
    kind:         'committee',
    reportsTo:    'board',
    cite:         'CC30',
  },

  // ─── Executive (single leader, accountable to the Board) ────────────
  {
    id:           'ceo',
    label:        'Chief Executive Officer',
    charter:      'Sole executive officer. Runs the charity day-to-day under authority delegated by the Board, attends Board meetings in an advisory capacity, and is the only staff member with a direct line to the Board.',
    acceptsRoles: ['CEO'],
    kind:         'executive',
    reportsTo:    'board',
    cite:         'CC3 — separation of governance and management',
  },

  // ─── Senior Management Team (reports to CEO) ────────────────────────
  {
    id:           'finance_manager',
    label:        'Finance Manager',
    charter:      'Runs day-to-day finance — bookkeeping, payroll, Gift Aid, VAT. Solid line to CEO; dotted line to the Honorary Treasurer for technical sign-off.',
    acceptsRoles: ['ACCOUNTANT'],
    kind:         'department',
    reportsTo:    'ceo',
    dottedTo:     ['treasurer', 'cmte_finance'],
  },
  {
    id:           'hr_manager',
    label:        'HR Manager',
    charter:      'Employment contracts, recruitment, training, performance, employee relations across all branches. Maintains DBS / RTW records.',
    acceptsRoles: ['HR_MANAGER'],
    kind:         'department',
    reportsTo:    'ceo',
  },
  {
    id:           'safeguarding_officer',
    label:        'Designated Safeguarding Lead',
    charter:      'Day-to-day safeguarding contact for staff, volunteers and the public. Logs and triages every concern; escalates to the Safeguarding Committee.',
    acceptsRoles: ['STAFF', 'HR_MANAGER'],
    kind:         'department',
    reportsTo:    'ceo',
    dottedTo:     ['cmte_safeguarding'],
    cite:         'CC9',
  },
  {
    id:           'compliance_officer',
    label:        'Compliance Officer',
    charter:      'Owns the policy register, GDPR/Data Protection, Charity Commission filings calendar, and the risk register. Reports issues directly to the Audit Committee where they touch internal control.',
    acceptsRoles: ['AUDITOR', 'STAFF'],
    kind:         'department',
    reportsTo:    'ceo',
    dottedTo:     ['cmte_audit'],
  },

  // ─── Branch Management ──────────────────────────────────────────────
  // Branch nodes are seeded by /branches API at render time — the
  // structure file declares the *template* node so it always appears in
  // the chart even when no branches exist yet.
  {
    id:           'branch_template',
    label:        'Branch Manager',
    charter:      'Runs a temple branch day-to-day under standardised charity-wide policies. Manages local staff and volunteers, reports monthly KPIs to the CEO. Each branch has its own card on this chart, generated from the Branches register.',
    acceptsRoles: ['BRANCH_MANAGER'],
    kind:         'branch',
    reportsTo:    'ceo',
  },
  {
    id:           'lmc_template',
    label:        'Local Management Committee',
    charter:      'Local governance for each branch — sets the local events calendar, manages the branch volunteer rota, and runs local fundraising. Accountable to the Board via its LMC Chair, NOT to the CEO. Operational matters route through the Branch Manager.',
    acceptsRoles: ['LMC_CHAIR', 'LMC_TREASURER', 'LMC_MEMBER'],
    kind:         'governance',
    reportsTo:    'board',
    dottedTo:     ['branch_template'],
    cite:         'CC50 — sub-committees',
  },
  {
    id:           'branch_staff',
    label:        'Branch Staff',
    charter:      'Paid staff at a specific branch — kiosk operators, event coordinators, kitchen, cleaning. Report to the Branch Manager.',
    acceptsRoles: ['STAFF'],
    kind:         'department',
    reportsTo:    'branch_template',
  },
  {
    id:           'volunteers',
    label:        'Volunteers',
    charter:      'Unpaid contributors at all branches and charity-wide. Coordinated by the Branch Manager locally; safeguarding-screened by HR centrally.',
    acceptsRoles: ['VOLUNTEER'],
    kind:         'department',
    reportsTo:    'branch_template',
  },

  // ─── Independent / external ─────────────────────────────────────────
  {
    id:           'external_auditor',
    label:        'External Auditor',
    charter:      'Independent statutory auditor. Engaged by and reports to the Audit & Risk Committee — NOT through the CEO or Finance Manager. Required for charities with income >£1m or assets >£3.26m.',
    acceptsRoles: [],
    kind:         'independent',
    reportsTo:    'cmte_audit',
    cite:         'Charities Act 2011 § 144',
  },
  {
    id:           'contractors',
    label:        'External Contractors & Temp Workers',
    charter:      'Engaged on time-limited contracts for specific scopes (IT, catering, building works). Not employees, not on the board. Procured through the CEO with thresholds requiring Treasurer or full-Board sign-off.',
    acceptsRoles: ['EXTERNAL_CONTRACTOR', 'TEMP_WORKER'],
    kind:         'independent',
    reportsTo:    'ceo',
  },
]

export const KIND_LABELS: Record<OrgNode['kind'], string> = {
  governance:  'Governance',
  committee:   'Sub-Committee',
  executive:   'Executive',
  department:  'Department / Function',
  branch:      'Branch',
  independent: 'Independent',
}

export const KIND_STYLES: Record<OrgNode['kind'], { badge: string; border: string }> = {
  governance:  { badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',   border: 'border-amber-500/40' },
  committee:   { badge: 'bg-sky-500/15   text-sky-300   border-sky-500/30',     border: 'border-sky-500/40'   },
  executive:   { badge: 'bg-rose-500/15  text-rose-300  border-rose-500/30',    border: 'border-rose-500/40'  },
  department:  { badge: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',border: 'border-indigo-500/40'},
  branch:      { badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', border: 'border-emerald-500/40' },
  independent: { badge: 'bg-slate-500/15 text-slate-300 border-slate-500/30',   border: 'border-slate-500/40' },
}

/** Returns the direct children of `parentId` in declaration order. */
export function childrenOf(parentId: string | null): OrgNode[] {
  return ORG_STRUCTURE.filter(n => n.reportsTo === parentId)
}

/** Returns the node for an id, or undefined. */
export function nodeById(id: string): OrgNode | undefined {
  return ORG_STRUCTURE.find(n => n.id === id)
}

