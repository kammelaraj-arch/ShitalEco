# Governance backlog — best-practice features for the admin app

Captured during the 2026 governance review. Not actively in build —
revisit when prioritised.

Source conversation: the "ten governance best practices" framework, agreed
to hold as backlog while focus shifts to email reading / mail agent.

## The ten principles

| # | Principle | Status today | Build needed |
|---|---|---|---|
| 1 | Decisions exist only in writing | 🟢 Resolutions module + magic-link voting | Surface COC-01 reminder at admin login |
| 2 | Authority Matrix — every spend/hire/contract has a defined approval level | 🟡 `purchase_invoices.status = PENDING_APPROVAL` exists | Build `lib/authority-matrix.ts`; enforce thresholds on spend / PO / contract forms |
| 3 | Restricted funds sacrosanct | 🟡 `fund_type` column exists | Tag every donation with `restricted_purpose` at intake; validate at spend; show live restricted balance |
| 4 | Conflicts of interest declared every meeting | 🔴 Not built | Auto-open agenda with COI declaration; voting module honours conflicts |
| 5 | Three-warning Code of Conduct cycle | 🔴 Not built | Warning tracker on trustee profile; W1 → W2 → W3 → "draft removal resolution" button |
| 6 | Constitutional rules automated | 🟡 Role registry cites M&A clauses | Tenure tracker (warn at 8 yrs / §27.5), 1/3 retirement rota, anti-nepotism check, faith attestation field, block-below-3-trustees |
| 7 | Reporting cadence enforced by calendar | 🔴 Not built | Branch Mgr weekly prompt; CEO monthly; sub-cmte minutes within 48h; missed reports red on CEO dashboard |
| 8 | Auditor independence — bypass CEO | 🔴 Not built | Audit findings module; auditor uploads direct; only Audit Cmte + Board can view |
| 9 | Whistleblowing channel — bypass CEO & Chair | 🔴 Not built | `/whistleblow` form direct to Audit Cmte chair; anonymous option |
| 10 | Equal trustee access | 🟢 All trustees see the same admin | Maintain; resist any "Chair-only" feature requests |

## Recommended build order when revisited

Forget building everything at once. Order that maximises impact-per-week:

1. **Weeks 1-2**: Surface Code of Conduct at admin login; Authority Matrix as published doc on structure page; Warning tracker on trustee profile (principles 1, 2, 5)
2. **Month 1-2**: Conflicts-of-interest declarations on every meeting agenda; restricted-funds tagging enforced at donation intake; auditor-only viewing area (principles 3, 4, 8)
3. **Month 3-6**: Reporting cadence prompts; tenure tracker; anti-nepotism check at onboarding; faith attestation field (principles 6, 7)
4. **Month 6+**: Whistleblowing channel (only meaningful once 5+ trustees + Audit Cmte chair exists separate from Chair) (principle 9)

## Underlying philosophy

**Make the right path the easiest path.** Today a trustee can phone a
contractor because nothing in the system makes the proper
Board-resolution path easier. Once contractor engagements *can only* be
initiated through a Board-approved PO with a resolution number, the
bypass attempt becomes obviously off-script — both to the trustee, the
contractor, and any future auditor.

## Triggers to revisit this backlog

- A new trustee bypass incident (any of COC-01 through COC-12 breached)
- 5th trustee recruited (unlocks proper sub-committees → triggers principles 4, 8)
- Annual income crosses £1m (statutory audit kicks in → triggers principle 8)
- Charity Commission concerns letter or compliance review
