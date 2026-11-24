"""
Annual Report aggregator — reads every Governance Core source for a
reporting period and returns a dict keyed by SORP §1.21 section. The
router uses this to pre-fill `narrative_sections` on a new
`annual_reports` row; at finalise-time, the raw `data` payload is
frozen on `annual_reports.snapshot` so later edits to the underlying
data don't rewrite the TAR.

Section keys match the SORP §1.21 table of contents:
  public_benefit · objectives · activities · achievements
  · financial_review · reserves_policy · risk_management
  · investment_policy · structure_governance · trustees
  · related_parties · plans · fundraising_practices

Each section comes back as:
  { "data": { ...raw aggregated rows... },
    "draft_html": "<p>… pre-filled narrative …</p>" }
"""
from __future__ import annotations

from datetime import date
from typing import Any


def _h(text: str) -> str:
    """Escape user-supplied text when we interpolate into the draft."""
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


async def aggregate(period_start: str, period_end: str) -> dict[str, Any]:
    """Read every source for the period and return the TAR dict."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal
    out: dict[str, Any] = {}
    async with SessionLocal() as db:
        # ── Trustees in post during the period ──
        trustees = (await db.execute(text("""
            SELECT id, full_name, role, term_start, term_end, is_active
            FROM   trustees
            WHERE  is_active = true
               OR  term_end  >= :ps
            ORDER  BY role, full_name
        """), {"ps": period_start})).mappings().all()

        # ── Resolutions carried in the period (CLOSED) ──
        resolutions = (await db.execute(text("""
            SELECT id, title, category, decision_type, outcome,
                   closed_at, published_at
            FROM   resolutions
            WHERE  closed_at BETWEEN :ps AND :pe
            ORDER  BY closed_at
        """), {"ps": period_start, "pe": period_end})).mappings().all()

        # ── Risk register (all OPEN) ──
        risks = (await db.execute(text("""
            SELECT risk_ref, title, category, scope, score,
                   treatment, mitigation_plan, status, review_date
            FROM   risk_register
            WHERE  status IN ('OPEN', 'MITIGATING')
            ORDER  BY score DESC, risk_ref
        """))).mappings().all()

        # ── Reserves (policy + latest snapshot in period) ──
        reserves_policy = (await db.execute(text(
            "SELECT target_months, trigger_action_below_months, "
            "free_reserves_definition, notes, next_review_date "
            "FROM reserves_policy WHERE is_current = true"
        ))).mappings().one_or_none()
        reserves_snap = (await db.execute(text("""
            SELECT as_of_date, free_reserves, monthly_run_cost,
                   months_of_cover, triggers_fired
            FROM   reserves_snapshots
            WHERE  as_of_date <= :pe
            ORDER  BY as_of_date DESC
            LIMIT  1
        """), {"pe": period_end})).mappings().one_or_none()

        # ── Attendance in the period ──
        attendance = (await db.execute(text("""
            SELECT t.full_name, t.role,
                   COUNT(*) FILTER (WHERE ma.status IN ('PRESENT','VIRTUAL','LATE')) AS present,
                   COUNT(*) FILTER (WHERE ma.status = 'APOLOGIES')                    AS apologies,
                   COUNT(*)                                                            AS total
            FROM   trustees t
            LEFT JOIN meeting_attendance ma ON ma.trustee_id = t.id
            LEFT JOIN board_meetings bm      ON bm.id = ma.meeting_id
                                          AND bm.scheduled_at BETWEEN :ps AND :pe
            WHERE  t.is_active = true
            GROUP  BY t.id, t.full_name, t.role
            ORDER  BY t.full_name
        """), {"ps": period_start, "pe": period_end})).mappings().all()

        # ── Skills matrix — list gap codes ──
        skills_max = (await db.execute(text("""
            SELECT rs.code, rs.label,
                   COALESCE(MAX(ts.self_rating), 0) AS top_rating
            FROM   required_skills rs
            LEFT JOIN trustee_skills ts ON ts.skill_code = rs.code
            WHERE  rs.is_active = true
            GROUP  BY rs.code, rs.label, rs.sort_order
            ORDER  BY rs.sort_order
        """))).mappings().all()
        skill_gaps = [s for s in skills_max if int(s["top_rating"]) < 3]

        # ── Policies with an adopted version ──
        policies = (await db.execute(text("""
            SELECT title, category, current_version, next_review_date, status
            FROM   policies
            WHERE  status IN ('ACTIVE', 'UNDER_REVIEW')
            ORDER  BY category, title
        """))).mappings().all()

        # ── Delegations (ACTIVE) ──
        delegations = (await db.execute(text("""
            SELECT title, area, delegate_name, delegate_role,
                   limit_amount_gbp, limit_period, review_date
            FROM   delegations
            WHERE  status = 'ACTIVE'
            ORDER  BY area, title
        """))).mappings().all()

        # ── Related parties ──
        related = (await db.execute(text("""
            SELECT t.full_name AS trustee_name, rp.related_name, rp.relationship, rp.notes
            FROM   trustee_related_parties rp
            JOIN   trustees t ON t.id = rp.trustee_id
            WHERE  t.is_active = true
            ORDER  BY t.full_name, rp.related_name
        """))).mappings().all()

        # ── Interests (used in conflicts narrative) ──
        interests_count = (await db.execute(text(
            "SELECT COUNT(*) FROM trustee_interests WHERE status = 'ACTIVE'"
        ))).scalar() or 0

        # ── Meetings held in the period ──
        meetings = (await db.execute(text("""
            SELECT id, meeting_type, scheduled_at, status
            FROM   board_meetings
            WHERE  scheduled_at BETWEEN :ps AND :pe
            ORDER  BY scheduled_at
        """), {"ps": period_start, "pe": period_end})).mappings().all()

    # ── Build narrative drafts ───────────────────────────────────────

    meetings_held = sum(
        1 for m in meetings if m["status"] in ("OPENED", "CLOSED")
    )
    resolutions_passed = sum(1 for r in resolutions if r["outcome"] == "CARRIED")
    resolutions_rejected = sum(1 for r in resolutions if r["outcome"] == "NOT_CARRIED")

    # Trustee list block (used by several sections).
    trustee_list_html = "<ul>" + "".join(
        f"<li>{_h(t['full_name'])} — {_h(t['role']).replace('_', ' ')}"
        + (f" (term ends {t['term_end']})" if t.get("term_end") else "")
        + "</li>"
        for t in trustees
    ) + "</ul>"

    out["public_benefit"] = {
        "data": {"trustees_count": len(trustees)},
        "draft_html": (
            "<p>The trustees have had regard to the Charity Commission's "
            "guidance on public benefit when planning and reviewing the "
            "charity's activities throughout the reporting period.</p>"
        ),
    }

    out["objectives"] = {
        "data": {"policies": [dict(p) for p in policies]},
        "draft_html": (
            "<p>The charity's objects, as set out in its governing "
            "document, remained unchanged during the period. The board "
            "reviewed the operating policies that give effect to these "
            "objects — see the policy register for the current list and "
            "review dates.</p>"
        ),
    }

    out["activities"] = {
        "data": {
            "meetings_held": meetings_held,
            "resolutions_passed": resolutions_passed,
            "resolutions_rejected": resolutions_rejected,
            "resolutions": [
                {"title": r["title"], "category": r["category"],
                 "outcome": r["outcome"], "closed_at": r["closed_at"].isoformat() if r["closed_at"] else None}
                for r in resolutions
            ],
        },
        "draft_html": (
            f"<p>The board met formally {meetings_held} time"
            f"{'s' if meetings_held != 1 else ''} during the year and "
            f"carried {resolutions_passed} resolutions"
            + (f" (with {resolutions_rejected} not carried)." if resolutions_rejected else ".")
            + "</p><p>Key decisions included:</p><ul>"
            + "".join(
                f"<li>{_h(r['title'])} — <em>{_h(r['category']).replace('_', ' ')}</em></li>"
                for r in resolutions[:10]
                if r["outcome"] == "CARRIED"
            )
            + "</ul>"
        ),
    }

    out["achievements"] = {
        "data": {
            "resolutions_passed": resolutions_passed,
            "attendance": [dict(a) for a in attendance],
        },
        "draft_html": (
            "<p>The year's achievements are measured against the "
            "strategic objectives set in the current strategy document "
            "(see the policy register). Highlights included:</p>"
            "<ul><li>— edit to add programme outcomes, service user "
            "numbers, grant delivery milestones —</li></ul>"
        ),
    }

    reserves_body = ""
    if reserves_policy and reserves_snap:
        reserves_body = (
            f"<p>The charity's reserves policy requires "
            f"<b>{reserves_policy['target_months']} months</b> of "
            "operating cover as free reserves; the trustees trigger "
            "corrective action below "
            f"<b>{reserves_policy['trigger_action_below_months']} months</b>. "
            f"As at {reserves_snap['as_of_date']}, free reserves stood at "
            f"£{float(reserves_snap['free_reserves']):,.0f}, equal to "
            f"<b>{float(reserves_snap['months_of_cover']):.1f} months</b> "
            "of cover.</p>"
        )
    else:
        reserves_body = (
            "<p>The reserves policy is under review by the trustees "
            "— the next reserves snapshot will be recorded in the "
            "finance module.</p>"
        )
    out["reserves_policy"] = {
        "data": {
            "policy": dict(reserves_policy) if reserves_policy else None,
            "latest_snapshot": dict(reserves_snap) if reserves_snap else None,
        },
        "draft_html": reserves_body,
    }

    out["financial_review"] = {
        "data": {
            "reserves_summary": dict(reserves_snap) if reserves_snap else None,
        },
        "draft_html": (
            "<p>Full audited accounts for the period accompany this "
            "report. In summary, the charity's financial position "
            "— including income, expenditure, movement in funds and "
            "reserves — is set out in the statement of financial "
            "activities. — edit to add income / expenditure totals —</p>"
        ),
    }

    risks_top = risks[:5]
    out["risk_management"] = {
        "data": {"open_risks_count": len(risks),
                 "top_5": [dict(r) for r in risks_top]},
        "draft_html": (
            f"<p>The trustees maintain a live organisation risk "
            f"register under the CC26 framework. {len(risks)} risk"
            f"{'s' if len(risks) != 1 else ''} remained OPEN or "
            "MITIGATING at the end of the period. The five most "
            "significant, ranked by inherent score, are:</p>"
            "<ul>"
            + "".join(
                f"<li><b>{_h(r['risk_ref'])}</b> — "
                f"{_h(r['title'])} ({_h(r['category']).replace('_', ' ')}, "
                f"score {r['score']}, treatment {_h(r['treatment']).lower()})</li>"
                for r in risks_top
            )
            + "</ul><p>The full register is reviewed quarterly.</p>"
        ),
    }

    out["structure_governance"] = {
        "data": {
            "trustees": [dict(t) for t in trustees],
            "policies": [dict(p) for p in policies],
            "delegations": [dict(d) for d in delegations],
            "skill_gaps": [dict(s) for s in skill_gaps],
            "interests_declared": int(interests_count),
        },
        "draft_html": (
            f"<p>The charity is governed by a board of "
            f"{len([t for t in trustees if t['is_active']])} active "
            "trustees. The board delegates specific authorities under "
            "formal terms to officers — see the delegations register — "
            "and maintains a standing conflicts-of-interest register "
            f"({interests_count} declared interests at year-end).</p>"
            "<h4>Current trustees</h4>"
            + trustee_list_html
            + (
                f"<h4>Skills gaps</h4><p>The board has identified "
                f"{len(skill_gaps)} skill area"
                f"{'s' if len(skill_gaps) != 1 else ''} where no "
                "trustee currently rates themselves at Proficient or "
                "above: "
                + ", ".join(_h(s['label']) for s in skill_gaps)
                + ". Recruitment for the next trustee intake will "
                "address these.</p>"
                if skill_gaps else ""
            )
        ),
    }

    out["trustees"] = {
        "data": {
            "trustees": [dict(t) for t in trustees],
            "attendance": [dict(a) for a in attendance],
        },
        "draft_html": (
            "<h4>Trustees in post during the period</h4>"
            + trustee_list_html
            + "<h4>Meeting attendance</h4>"
            "<table><thead><tr><th>Trustee</th><th>Present</th>"
            "<th>Apologies</th><th>Total</th></tr></thead><tbody>"
            + "".join(
                f"<tr><td>{_h(a['full_name'])}</td>"
                f"<td>{a['present']}</td><td>{a['apologies']}</td>"
                f"<td>{a['total']}</td></tr>"
                for a in attendance
            )
            + "</tbody></table>"
        ),
    }

    rel_rows = [
        f"<li>{_h(r['trustee_name'])} — {_h(r['related_name'])} "
        f"({_h(r['relationship']).replace('_', ' ')})</li>"
        for r in related
    ]
    out["related_parties"] = {
        "data": {"related_parties": [dict(r) for r in related]},
        "draft_html": (
            "<p>The trustees declared the following related parties "
            "during the period under SORP §9.14:</p><ul>"
            + ("".join(rel_rows) if rel_rows else "<li>None declared.</li>")
            + "</ul><p>No transactions with related parties above the "
            "SORP disclosure threshold took place during the period "
            "unless listed in the notes to the financial statements.</p>"
        ),
    }

    out["plans"] = {
        "data": {"delegations": [dict(d) for d in delegations]},
        "draft_html": (
            "<p>The trustees plan to focus on: — edit to add forward "
            "strategic priorities, capital projects, policy reviews, "
            "and trustee recruitment plans — </p>"
        ),
    }

    out["fundraising_practices"] = {
        "data": {},
        "draft_html": (
            "<p>The charity's fundraising practices are governed by the "
            "Code of Fundraising Practice and the Fundraising Regulator. "
            "The charity does not use third-party professional "
            "fundraisers. Complaints received during the period: — edit "
            "to add — . The trustees are satisfied that the charity's "
            "fundraising activities protect vulnerable people from "
            "undue pressure.</p>"
        ),
    }

    out["investment_policy"] = {
        "data": {},
        "draft_html": (
            "<p>The charity holds no listed investments. Cash reserves "
            "are held in interest-bearing current accounts with UK "
            "high-street banks. The reserves policy sets the target "
            "level of free reserves; the investment policy, listed in "
            "the policy register, is reviewed annually.</p>"
        ),
    }

    return {
        "period_start": period_start,
        "period_end": period_end,
        "sections": out,
    }


def section_order() -> list[tuple[str, str]]:
    """Canonical SORP ordering of the TAR. Returned as (key, label)."""
    return [
        ("public_benefit",         "Public benefit statement"),
        ("objectives",             "Objectives & activities"),
        ("activities",             "Activities undertaken"),
        ("achievements",           "Achievements & performance"),
        ("financial_review",       "Financial review"),
        ("reserves_policy",        "Reserves policy"),
        ("investment_policy",      "Investment policy"),
        ("risk_management",        "Risk management"),
        ("structure_governance",   "Structure, governance & management"),
        ("trustees",               "Trustees"),
        ("related_parties",        "Related-party disclosures"),
        ("plans",                  "Plans for future periods"),
        ("fundraising_practices",  "Fundraising practices"),
    ]


# Keep import used in older callers.
_ = date
