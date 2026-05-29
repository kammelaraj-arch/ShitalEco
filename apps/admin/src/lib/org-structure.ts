/**
 * SHITAL organisation structure — single source of truth for reporting lines.
 *
 * Sources (in order of authority):
 *   1. SHITAL Memorandum & Articles of Association 2009 (Company 06885384)
 *      — the binding constitution. Every node below cites the specific
 *      §-clause that authorises it.
 *   2. SHITAL 2022 Roadmap (Board resolution + Areas for improvement) —
 *      authored by the Chair, presented to the Board. Encodes the
 *      Code of Conduct, the LMC operational model, and the multi-branch
 *      strategy. Verbatim Code of Conduct rules live in lib/code-of-conduct.ts.
 *   3. UK Charity Commission guidance — CC3 (essential trustee), CC8
 *      (financial controls), CC9 (serious incident reporting), CC11 (paid
 *      trustees), CC30 (finding new trustees), CC50 (committees / meetings).
 *   4. NCVO / Association of Chairs guidance on the Chair role and Vice-Chair
 *      succession.
 *
 * The four governance principles every node observes:
 *
 *   1. ONE LEGAL ENTITY (M&A §1). Branches and LMCs operate under DELEGATED
 *      authority from the main Board (M&A §40) — they are NOT separate
 *      registered charities. All money, contracts, and liabilities sit with
 *      SHITAL.
 *
 *   2. TRUSTEES GOVERN, CEO EXECUTES (M&A §21.1 + CC3). The Board governs
 *      collectively; the CEO operates. The CEO reports to the FULL BOARD,
 *      never to the Chair personally. No individual trustee — including the
 *      Chair — can direct staff outside of a Board resolution (COC-01).
 *
 *   3. AUDITOR INDEPENDENCE (Charities Act 2011 §144). The external auditor
 *      and the Audit & Risk Committee report to the full Board, bypassing
 *      the CEO. Chaired by a trustee who is neither the Chair nor the
 *      Treasurer.
 *
 *   4. LOCAL AUTONOMY, CENTRAL CONTROL (2022 Roadmap). LMCs run day-to-day
 *      branch life with local people and local resources. Finance, HR,
 *      safeguarding, and IT are centralised so policy is uniform and
 *      consolidated accounts are possible (Charities Act 2011 §132).
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
    charter:      'Sovereign governing body. "The business of the Charity is managed by the Board" — M&A §21.1. Sets strategy, approves budgets, appoints the CEO, accountable to the Charity Commission and the public. Per the 2022 Roadmap, MUST meet at least monthly (COC-05). Quorum is one third of trustees, minimum 3 (M&A §36.1). Minimum 3 trustees at all times (M&A §28.1).',
    acceptsRoles: ['CHAIR', 'TREASURER', 'SECRETARY', 'TRUSTEE'],
    kind:         'governance',
    reportsTo:    'charity',
    cite:         'M&A §21.1, §28.1, §36.1 + CC3',
  },
  {
    id:           'chair',
    label:        'Chair of the Board',
    charter:      'The only constitutionally named officer (M&A §35.1). Primus inter pares — first among equals, one vote. Presides at meetings, sets the agenda, signs minutes, holds the casting vote on ties (M&A §33.2), represents the Board externally, and is the named Charity Commission contact. Performance-manages the CEO on behalf of the full Board. Does NOT direct staff individually — that authority lies only with a Board resolution.',
    acceptsRoles: ['CHAIR'],
    kind:         'governance',
    reportsTo:    'board',
    cite:         'M&A §33.2, §35.1',
  },
  {
    id:           'vice_chair',
    label:        'Vice-Chair (Chair-in-Waiting)',
    charter:      'Deputises for the Chair when absent, chairs Board meetings on items where the Chair has a conflict of interest (M&A §34), and is the designated Senior Independent Trustee for any oversight of the Chair. Recruited as part of succession planning per NCVO guidance — the Vice-Chair is the natural successor when the 9-year tenure cap is reached (M&A §27.5).',
    acceptsRoles: ['CHAIR', 'TRUSTEE'],
    kind:         'governance',
    reportsTo:    'board',
    cite:         'M&A §34 + NCVO — succession & SIT role',
  },
  {
    id:           'treasurer',
    label:        'Honorary Treasurer',
    charter:      'Board-elected officer (M&A §35.1 — not constitutionally required, elected by the Board as it wishes). Lead trustee for financial oversight, chairs the Finance Sub-Committee, reviews monthly management accounts, signs the annual return to the Charity Commission. Unpaid (M&A §24.1).',
    acceptsRoles: ['TREASURER'],
    kind:         'governance',
    reportsTo:    'board',
    cite:         'M&A §24.1, §35.1 + CC8',
  },
  {
    id:           'secretary',
    label:        'Honorary Secretary',
    charter:      'Board-elected officer (M&A §35.1). Keeps the Trustees Register, signs and files all minutes within 48 hours of each Board meeting (M&A §25), files the annual return and accounts at Companies House and the Charity Commission. The "documents on SharePoint" rule (COC-12) is enforced by the Secretary.',
    acceptsRoles: ['SECRETARY'],
    kind:         'governance',
    reportsTo:    'board',
    cite:         'M&A §25, §35.1',
  },

  // ─── Sub-committees of the Board ────────────────────────────────────
  // Established under M&A §40.1 — "The Board may delegate the administration
  // of any of its powers to individual Trustees or committees of Trustees".
  // Non-trustees may be co-opted (§40.2). All acts reported to the Board
  // (§40.3). Activated as trustee numbers grow to 5+ — at 3 trustees, the
  // full Board acts as the sole committee.
  {
    id:           'cmte_finance',
    label:        'Finance Sub-Committee',
    charter:      'Reviews monthly management accounts, scrutinises budgets and reserves, recommends investment decisions to the full Board. Chaired by the Treasurer. Activates at 5+ trustees.',
    acceptsRoles: ['TREASURER', 'TRUSTEE'],
    kind:         'committee',
    reportsTo:    'board',
    cite:         'M&A §40 + CC8',
  },
  {
    id:           'cmte_audit',
    label:        'Audit & Risk Committee',
    charter:      'Independent of management. Reviews the annual audit, the risk register, and internal controls; reports concerns directly to the Board, bypassing the CEO and Treasurer. Chaired by a trustee who is NEITHER the Chair NOR the Treasurer. Triggered by Charities Act 2011 §144 once income exceeds £1m — separate at SHITAL\'s £500-£800k income for readiness.',
    acceptsRoles: ['TRUSTEE'],
    kind:         'committee',
    reportsTo:    'board',
    cite:         'M&A §40 + Charities Act §144 + CC8',
  },
  {
    id:           'cmte_safeguarding',
    label:        'Safeguarding Committee',
    charter:      'Owns the safeguarding policy, reviews every safeguarding incident, and reports serious cases to the Charity Commission within 24 hours per CC9 / SI reporting. Essential given the temple\'s public-facing context with children present.',
    acceptsRoles: ['TRUSTEE'],
    kind:         'committee',
    reportsTo:    'board',
    cite:         'M&A §40 + CC9',
  },
  {
    id:           'cmte_nominations',
    label:        'Nominations Committee',
    charter:      'Identifies and recommends new trustees per the constitutional requirements: adherence to the teachings of Shirdi Sai Baba (M&A §26.2), no relation by birth or marriage to a current serving trustee including uncles/aunts/first cousins (M&A §26.3), and the 9-year maximum tenure cap (M&A §27.5). Manages induction, term renewals, and the one-third annual retirement rotation (M&A §27.2).',
    acceptsRoles: ['CHAIR', 'TRUSTEE'],
    kind:         'committee',
    reportsTo:    'board',
    cite:         'M&A §26.2, §26.3, §27.2, §27.5 + CC30',
  },
  {
    id:           'cmte_conduct',
    label:        'Conduct & Disciplinary Panel',
    charter:      'Ad-hoc panel convened when a Code of Conduct breach is reported. Issues written warnings (COC-04 three-warning process), reviews evidence, and recommends removal resolutions to the Board where warranted. Cannot include the trustee whose conduct is under review (M&A §34 conflict procedure).',
    acceptsRoles: ['TRUSTEE'],
    kind:         'committee',
    reportsTo:    'board',
    cite:         '2022 Roadmap COC-04 + M&A §34',
  },

  // ─── Executive (single leader, accountable to the Board) ────────────
  {
    id:           'ceo',
    label:        'Chief Executive Officer',
    charter:      'Sole executive officer — single point of accountability for all charity operations. Runs the charity day-to-day under authority delegated by the Board (M&A §40), attends Board meetings as a non-voting senior staff officer (CC11 best practice — paid trustees are discouraged), and is the ONLY staff member with a direct line to the Board. All trustee operational asks must route through the CEO. For SHITAL at £500-£800k income / 25 staff / 4 branches, a part-time CEO (2-3 days/week) is the right scale; aim to appoint within 6 months.',
    acceptsRoles: ['CEO'],
    kind:         'executive',
    reportsTo:    'board',
    cite:         'M&A §40 + CC3, CC11',
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
  // SHITAL operates a multi-branch model committed by the 2022 Roadmap:
  // Wembley, Dratford, Milton Keynes (MK), plus a 4th planned branch.
  // Branch nodes are also seeded dynamically from /branches API at render
  // time so newly-added branches appear automatically.
  {
    id:           'branch_template',
    label:        'Branch Manager',
    charter:      'Single accountable manager for one temple branch. Per the 2022 Roadmap, branches are self-sustaining under the SHITAL framework with local people running local resources. Manages local staff and volunteers, files a weekly written ops report to the CEO. Cannot make charity-wide policy decisions (per COC-01) — those flow from the Board through the CEO. Each branch is an instance of this template; see the live Branches register for current sites.',
    acceptsRoles: ['BRANCH_MANAGER'],
    kind:         'branch',
    reportsTo:    'ceo',
    cite:         '2022 Roadmap — self-sustaining temples + COC-01',
  },
  {
    id:           'lmc_template',
    label:        'Local Management Committee (LMC)',
    charter:      '"LMCs will eventually be responsible for all income and expenses, day-to-day management, and maintaining themselves within the framework (as branch) with the help of local people, local resources" — 2022 Roadmap, verbatim. LMCs are the governance layer for each branch: they set the local events calendar, manage the volunteer rota, run local fundraising under Board-approved policies. Accountable to the FULL Board via the LMC Chair — NOT to the CEO. Operational coordination with the Branch Manager is dotted-line. All COC-01 through COC-12 rules apply to LMC members identically to trustees.',
    acceptsRoles: ['LMC_CHAIR', 'LMC_TREASURER', 'LMC_MEMBER'],
    kind:         'governance',
    reportsTo:    'board',
    dottedTo:     ['branch_template'],
    cite:         '2022 Roadmap — LMC charter + M&A §40',
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

