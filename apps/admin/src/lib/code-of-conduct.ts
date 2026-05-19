/**
 * Code of Conduct for Trustees — verbatim from the SHITAL 2022 Roadmap
 * "Board resolution" page, restated as a binding rules document.
 *
 * Why this lives in code: trustees can dispute "what was meant" by a slide
 * deck. They cannot dispute the text of a Code of Conduct that has been
 * adopted by Board resolution (M&A §34.5 + §38.1) and signed via the
 * existing magic-link voting flow. The same text rendered on the org
 * structure page sets the expectation visibly for staff and volunteers.
 *
 * Charity Commission alignment:
 *   • M&A §21.1   — "The business of the Charity is managed by the Board"
 *   • M&A §34.5   — "Trustees shall observe... such other rules as the Board adopts"
 *   • M&A §38.1   — written resolutions signed by all trustees are valid
 *   • CC3         — collective responsibility of trustees
 *   • CC9         — speaking out / whistleblowing
 */

export interface CodeOfConductRule {
  /** Numeric reference used in warning letters and resolutions. */
  id:          string
  /** Verbatim rule text — sourced from the 2022 Roadmap unless otherwise noted. */
  text:        string
  /** Plain-English clarification for staff / volunteers reading the org chart. */
  plain:       string
  /** Source citation (which document and clause). */
  source:      string
}

export const CODE_OF_CONDUCT: CodeOfConductRule[] = [
  {
    id:     'COC-01',
    text:   'Trustees cannot make or implement individual decisions without approval from the Board.',
    plain:  'No single trustee — including the Chair — can act on behalf of the charity alone. Decisions require a Board resolution at a quorate meeting (M&A §33.2, §36.1) or a written resolution signed by all trustees (M&A §38.1).',
    source: '2022 Roadmap — Board resolution',
  },
  {
    id:     'COC-02',
    text:   'No trustee shall act on behalf of another trustee unless there is a written instruction from his/her fellow trustee.',
    plain:  'Speaking for someone else, voting on their behalf, signing for them — all require their written authorisation. Verbal "they said it was fine" does not count.',
    source: '2022 Roadmap — Board resolution',
  },
  {
    id:     'COC-03',
    text:   'All trustees must be updated of all matters related to the charity through regular communications. Systematic failure to inform and update other Board members can attract disciplinary actions.',
    plain:  'Concealing information from fellow trustees is itself a breach — even if the underlying action would have been legitimate. Information asymmetry destroys collective decision-making.',
    source: '2022 Roadmap — Board resolution',
  },
  {
    id:     'COC-04',
    text:   'Trustees, LMC members, and employees shall receive three warnings for violation of their Code of Conduct before they are removed by the Board. In the event of serious misconduct, Trustees, LMC members, and employees can be removed by the Board without prior notice.',
    plain:  'A graduated three-warning system applies to ordinary breaches. Removal without warning is reserved for serious misconduct (fraud, safeguarding failure, knowingly misleading the Board).',
    source: '2022 Roadmap — Board resolution',
  },
  {
    id:     'COC-05',
    text:   'Board must meet at least once a month.',
    plain:  'Twelve Board meetings per year, scheduled in advance. Quorum is one third of trustees, minimum three (M&A §36.1).',
    source: '2022 Roadmap — Board resolution',
  },
  {
    id:     'COC-06',
    text:   'Trustees / LMCs should follow Board decisions and not implement unauthorised changes.',
    plain:  'Once the Board has decided, individual trustees do not get to override or quietly reverse the decision later.',
    source: '2022 Roadmap — Areas for improvement',
  },
  {
    id:     'COC-07',
    text:   'Trustees / LMCs should not leak Board resolution voting details externally even when their personal views are different.',
    plain:  'How any individual trustee voted is confidential to the Board. Public discussion of who voted which way is itself a breach.',
    source: '2022 Roadmap — Areas for improvement',
  },
  {
    id:     'COC-08',
    text:   'Trustees / LMCs should not establish, manage groups, or factions that have conflicting interest and division among the devotees or volunteers / staff members.',
    plain:  'Running parallel WhatsApp groups, side-meetings, or off-the-record alliances designed to undermine Board decisions is a breach.',
    source: '2022 Roadmap — Areas for improvement',
  },
  {
    id:     'COC-09',
    text:   'Trustees / LMCs should not create or manage unauthorised parallel operations.',
    plain:  'Starting a new branch, programme, fundraising stream, or supplier relationship without Board approval is acting outside delegated authority (M&A §40).',
    source: '2022 Roadmap — Areas for improvement',
  },
  {
    id:     'COC-10',
    text:   'Trustees / LMCs should not do unauthorised fundraising as per their own views and beliefs.',
    plain:  'All fundraising is in the name of the charity and must be Board-approved. Personal fundraising drives, even with good intentions, cannot use SHITAL\'s name or accounts without approval.',
    source: '2022 Roadmap — Areas for improvement',
  },
  {
    id:     'COC-11',
    text:   'Trustees / LMCs must not facilitate any individuals to restore their position within the charity who had been removed by the Board because of their involvement in serious matters and badmouthing against the organisation.',
    plain:  'Helping someone the Board has removed to re-enter — through a side-door appointment, an LMC role, or by representing them to other trustees — is itself a removal-grade breach.',
    source: '2022 Roadmap — Areas for improvement',
  },
  {
    id:     'COC-12',
    text:   'All organisation\'s documents must be stored on SharePoint at an agreed location.',
    plain:  'Records held only on personal devices, personal email, or external storage are not the charity\'s records. Every decision, contract, and policy must be on SharePoint.',
    source: '2022 Roadmap — Board resolution',
  },
]

/** Header text for the Code of Conduct page / printed resolution. */
export const CODE_OF_CONDUCT_PREAMBLE = `\
Adopted by the Board of Trustees of Shri Shirdi Saibaba Temple Association \
(SHITAL) under the authority of Articles of Association §34.5 ("Trustees \
shall observe... such other rules as the Board adopts") and §38.1 (written \
resolutions). All rules below are sourced verbatim from the SHITAL 2022 \
Roadmap document presented to and approved by the Board.

Breach of any rule triggers the three-warning process set out in COC-04. \
Three warnings in any rolling twelve-month period are grounds for a \
resolution to remove the offending trustee (M&A §27, §32 + Charities Act \
2011 §190 powers reserved to the Charity Commission). Serious misconduct \
permits immediate removal without prior warning.`
