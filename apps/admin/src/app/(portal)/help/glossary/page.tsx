'use client'

// Glossary — single source of truth for project_type, fund_type, status,
// risk_level, and other discriminator enums used across the system. Linked
// from the Project edit form's (?) icons; also bookmarkable as a reference
// for new trustees / staff.

interface GlossaryRow {
  key: string
  label: string
  description: string
  examples: string
}

interface GlossarySection {
  id: string
  title: string
  icon: string
  intro: string
  rows: GlossaryRow[]
}

const SECTIONS: GlossarySection[] = [
  {
    id: 'project-type',
    title: 'Project Type',
    icon: '🏗️',
    intro:
      'What kind of work the project is. Drives the relevant approval rules and which financial reports the project rolls up into.',
    rows: [
      { key: 'GENERAL',         label: 'General',
        description: 'Default catch-all. Use when none of the others fit — ongoing operational work, internal improvements, anything not building / event / grant / outreach.',
        examples: 'Rebuild website · Volunteer training programme · Annual audit prep · Refresh kiosk branding' },
      { key: 'CAPITAL',         label: 'Capital',
        description: 'A multi-year build / equipment purchase / infrastructure investment. Creates a long-life asset that goes on the balance sheet. Trustee sign-off is required regardless of budget size.',
        examples: 'Wembley kitchen extension · New Stripe Terminal hardware rollout (50 readers) · Leicester car-park resurface · Solar panel install at Reading branch' },
      { key: 'RESTRICTED_FUND', label: 'Restricted Fund',
        description: 'A donor or grantor said the money must only be spent on a named purpose. The project name = the named purpose. Legally enforceable — overspend on something else is a charity-law breach.',
        examples: 'In-memory-of-X scholarship fund · Diwali sweets distribution — Smith family donation · Children\'s library books — Patel pledge' },
      { key: 'EVENT',           label: 'Event',
        description: 'A one-off / time-bounded occasion with a clear date and end. Budgets and accounts close shortly after the event.',
        examples: 'Diwali festival 2026 · Annual charity gala dinner · 5km sponsored walk · Mahashivratri seva' },
      { key: 'GRANT',           label: 'Grant',
        description: 'Funded by an external grant (Council, National Lottery, Esmée Fairbairn, etc.). The grantor has reporting requirements + a defined scope. Failure to comply means money clawed back.',
        examples: 'NHS England wellbeing-hub grant 2026 · Lottery Reaching Communities — youth programme · Wembley Borough small-grant: community kitchen' },
      { key: 'OUTREACH',        label: 'Outreach',
        description: 'A charitable programme delivered to beneficiaries outside the temple. Beneficiary tracking matters; volunteer + meal counts are KPIs.',
        examples: 'Weekly food bank — Wembley · Free yoga + meditation for over-65s · Hindi after-school classes · Hospice visiting service' },
    ],
  },
  {
    id: 'fund-type',
    title: 'Fund Type',
    icon: '💰',
    intro:
      'How the money is legally constrained. Separate from project type — every project carries BOTH. This drives the SORP-compliant annual accounts split that the Charity Commission expects.',
    rows: [
      { key: 'UNRESTRICTED', label: 'Unrestricted',
        description: 'Trustees can spend on anything within the charity\'s objects. Most general donations + collection-plate cash. The default.',
        examples: 'Anonymous SumUp kiosk donations · General Fund standing orders · Card-machine tap donations · Unspecified PayPal donations' },
      { key: 'RESTRICTED',   label: 'Restricted',
        description: 'Money the donor or grantor said must be spent on a stated purpose. Cannot be moved into general funds. Held as a separate fund line on the SOFA (Statement of Financial Activities) until spent.',
        examples: '"For the kitchen extension" donation · Lottery grant earmarked for youth work · Wedding-anniversary donation to library books · Most grants by definition' },
      { key: 'ENDOWMENT',    label: 'Endowment',
        description: 'Capital that must be preserved as a long-term investment — only the income (interest, dividends) is spendable. Two SORP sub-flavours (permanent vs expendable) but our schema doesn\'t distinguish — most charities won\'t have any.',
        examples: 'Founder bequest of £100k where the will says "only the income may be used" · Investment portfolio gifted with stipulations on capital preservation' },
    ],
  },
  {
    id: 'status',
    title: 'Project Status',
    icon: '📍',
    intro:
      'Where the project is in its lifecycle. DRAFT → ACTIVE requires an APPROVED \'START\' row when budget > £5,000, the project is CAPITAL, or the fund is RESTRICTED / ENDOWMENT.',
    rows: [
      { key: 'DRAFT',     label: 'Draft',     description: 'Being scoped — not yet authorised to spend. Initial owner + budget being defined.',                       examples: '' },
      { key: 'ACTIVE',    label: 'Active',    description: 'Approved and underway. Spending allowed against the budget. Activity log accumulates.',                     examples: '' },
      { key: 'ON_HOLD',   label: 'On Hold',   description: 'Temporarily paused. No new spend; existing commitments remain. Use for waiting-on-decisions / suppliers.', examples: '' },
      { key: 'COMPLETED', label: 'Completed', description: 'Work delivered. Final reports filed. Closes for new spend; may need a post-project review.',                examples: '' },
      { key: 'CANCELLED', label: 'Cancelled', description: 'Abandoned before completion. Restricted funds revert to donor or are repurposed by trustee resolution.',     examples: '' },
    ],
  },
  {
    id: 'risk-level',
    title: 'Risk Level (RAG)',
    icon: '🚦',
    intro:
      'Trustee-facing health indicator. Drives the dashboard colour-coding and surfaces high-risk projects on the home page.',
    rows: [
      { key: 'GREEN', label: 'Green', description: 'On track. No material concerns. Default for new projects.',                                                              examples: '' },
      { key: 'AMBER', label: 'Amber', description: 'Issues identified but being managed. Budget or schedule slipping by < 10%. Operator has a recovery plan.',              examples: '' },
      { key: 'RED',   label: 'Red',   description: 'Material problem. Budget / schedule slipping by ≥ 10%, or a high-severity risk realised. Trustee escalation required.', examples: '' },
    ],
  },
  {
    id: 'partner-relationship',
    title: 'Partner Relationship',
    icon: '🤝',
    intro:
      'On a project_partners row, the value of relationship — distinct from crm_accounts.account_type because the same account can be a partner here and a vendor on another project.',
    rows: [
      { key: 'PARTNER',     label: 'Partner',     description: 'Collaborating organisation (another charity, council department) co-delivering the work.',                examples: 'Wembley Council on a youth-club programme' },
      { key: 'GRANTOR',     label: 'Grantor',     description: 'Funded the project via grant. Has reporting requirements + clawback risk if we miss them.',                examples: 'National Lottery Community Fund · Esmée Fairbairn Foundation' },
      { key: 'BENEFICIARY', label: 'Beneficiary', description: 'The group the project is FOR — tracked for reporting, especially for outreach + grant projects.',          examples: 'Local food bank · Care home receiving free meals' },
      { key: 'SPONSOR',     label: 'Sponsor',     description: 'Gave cash or in-kind without legal restriction. Different from a grantor (no formal report-back contract).', examples: 'Local supermarket donating produce · Solicitor offering pro-bono legal review' },
      { key: 'SUPPLIER',    label: 'Supplier',    description: 'Sells to the project. Same as crm_accounts.account_type = supplier; recorded here so it\'s explicit on the project.', examples: 'Office stationery supplier · Catering company' },
    ],
  },
]

function Row({ row, accent }: { row: GlossaryRow; accent: string }) {
  return (
    <div className="glass rounded-2xl p-5 border-l-4" style={{ borderColor: accent }}>
      <div className="flex items-center gap-3 mb-2">
        <code className="text-xs font-mono font-bold bg-white/5 border border-white/10 px-2 py-1 rounded text-saffron-300">
          {row.key}
        </code>
        <h3 className="font-bold text-white">{row.label}</h3>
      </div>
      <p className="text-white/70 text-sm leading-relaxed">{row.description}</p>
      {row.examples && (
        <p className="text-white/40 text-xs mt-3 italic">
          <span className="text-white/30 font-bold uppercase tracking-wider not-italic mr-2">Examples</span>
          {row.examples}
        </p>
      )}
    </div>
  )
}

const ACCENTS = ['#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#ef4444', '#14b8a6']

export default function GlossaryPage() {
  return (
    <div className="space-y-8 animate-fade-in max-w-5xl">
      <div>
        <h1 className="text-3xl font-black text-white">📖 Glossary</h1>
        <p className="text-white/40 mt-1">
          Reference for the controlled-vocabulary fields used across the system —
          project types, fund types, statuses, RAG levels, and partner relationships.
          Linked from the (?) icons on project forms. Bookmark this page when onboarding a new trustee.
        </p>
      </div>

      {/* Table of contents */}
      <nav className="glass rounded-2xl p-4">
        <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Jump to</p>
        <div className="flex flex-wrap gap-2">
          {SECTIONS.map(s => (
            <a key={s.id} href={`#${s.id}`}
               className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10">
              {s.icon} {s.title}
            </a>
          ))}
        </div>
      </nav>

      {SECTIONS.map((section, sIdx) => (
        <section key={section.id} id={section.id} className="space-y-3 scroll-mt-6">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="text-2xl">{section.icon}</span>
              {section.title}
            </h2>
            <p className="text-white/50 text-sm mt-1">{section.intro}</p>
          </div>
          <div className="space-y-3">
            {section.rows.map((row, i) => (
              <Row key={row.key} row={row} accent={ACCENTS[(sIdx + i) % ACCENTS.length]} />
            ))}
          </div>
        </section>
      ))}

      {/* Combination cheatsheet */}
      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-2xl">🧮</span>
            Type × Fund — common combinations
          </h2>
          <p className="text-white/50 text-sm mt-1">
            Every project carries both a type and a fund — they answer different questions. Here are the realistic pairings.
          </p>
        </div>
        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              <tr className="text-left text-white/40 text-xs uppercase tracking-wider">
                <th className="px-3 py-2">Combination</th>
                <th className="px-3 py-2">Real-world example</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['CAPITAL + RESTRICTED',         'Building extension funded by a building-appeal donation — the most common capital case'],
                ['CAPITAL + UNRESTRICTED',       'Kiosk hardware paid from general funds at trustee discretion'],
                ['OUTREACH + RESTRICTED',        'Food-bank programme paid for by a council grant'],
                ['OUTREACH + UNRESTRICTED',      'Food-bank programme paid for by general donations'],
                ['EVENT + UNRESTRICTED',         'Diwali fundraising costs from general budget'],
                ['GRANT + RESTRICTED',           'Almost always — grants are inherently restricted to the funded purpose'],
                ['RESTRICTED_FUND + RESTRICTED', 'Donor-restricted fund — the project EXISTS to spend that restriction'],
                ['GENERAL + UNRESTRICTED',       'Normal operational improvement work'],
                ['GENERAL + ENDOWMENT',          'Rare — using endowment income on a non-restricted project'],
              ].map(([combo, example], i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-3 py-2 font-mono text-saffron-300 whitespace-nowrap">{combo}</td>
                  <td className="px-3 py-2 text-white/70">{example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
