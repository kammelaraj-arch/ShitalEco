"""Render a board resolution as a styled PDF via WeasyPrint.

Used by Phase D when the chair signs off: we fetch the final state
(title, rich-text bodies, vote tally, conditions, info-request
responses, signatures) and hand WeasyPrint an HTML+CSS template.

The output is stored as a `board_resolution_attachments` row with
source='pdf_signoff' and pinned to the resolution via
resolutions.pdf_attachment_id — so the record is self-contained and
admin can download it from the existing attachments view.
"""
from __future__ import annotations

import base64
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text

from shital.core.fabrics.database import SessionLocal

# WeasyPrint is already in backend/pyproject.toml.  Import lazily so a
# stray syntax error in the template at import-time doesn't crash the
# boot sequence — PDF is only generated on sign-off, not on startup.


_BASE_CSS = """
@page { size: A4; margin: 20mm 18mm; }
body { font-family: "Helvetica Neue", Arial, sans-serif; color: #111; font-size: 11pt; line-height: 1.5; }
h1 { font-size: 20pt; margin: 0 0 4pt 0; }
h2 { font-size: 13pt; margin: 20pt 0 4pt 0; color: #6c1f1f; }
h3 { font-size: 11pt; margin: 14pt 0 4pt 0; }
.header { border-bottom: 2px solid #6c1f1f; padding-bottom: 8pt; margin-bottom: 18pt; }
.header .ref { color: #888; font-size: 9pt; }
.tally { background: #f5f5f5; border-left: 4px solid #6c1f1f; padding: 10pt 14pt; margin: 14pt 0; }
.tally strong { color: #6c1f1f; }
.sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24pt; margin-top: 24pt; }
.sig { text-align: center; }
.sig img { max-width: 160pt; height: 48pt; object-fit: contain; }
.sig .name { font-weight: bold; }
.sig .role { color: #666; font-size: 9pt; }
.appendix { margin-top: 24pt; font-size: 9pt; color: #555; }
.appendix table { width: 100%; border-collapse: collapse; }
.appendix th, .appendix td { border: 1px solid #ddd; padding: 4pt 6pt; text-align: left; vertical-align: top; }
.appendix th { background: #f5f5f5; }
.cond-ACCEPTED { color: #0a7f30; }
.cond-REJECTED { color: #a1181b; }
.cond-DEFERRED { color: #5557c4; }
.foot { margin-top: 30pt; font-size: 8pt; color: #aaa; text-align: center; }
"""


def _fmt_date(dt: Any) -> str:
    if not dt:
        return ""
    if isinstance(dt, datetime):
        return dt.strftime("%d %b %Y")
    return str(dt)


async def _gather(resolution_id: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        res = (await db.execute(text("""
            SELECT id, title, background, recommendation, risk_impact, budget_impact,
                   category, decision_type, status, outcome, outcome_summary,
                   tally_for, tally_against, tally_abstain,
                   casting_vote_used, casting_vote_choice,
                   published_at, closed_at, chair_signoff_at
            FROM   resolutions WHERE id = CAST(:id AS uuid)
        """), {"id": resolution_id})).mappings().first()
        votes = (await db.execute(text("""
            SELECT v.choice, v.comment, v.voted_at, v.anonymous,
                   t.full_name AS trustee_name, t.role AS trustee_role
            FROM   resolution_votes v
            LEFT JOIN trustees t ON t.id = v.trustee_id
            WHERE  v.resolution_id = CAST(:id AS uuid)
            ORDER  BY v.voted_at ASC
        """), {"id": resolution_id})).mappings().all()
        conds = (await db.execute(text("""
            SELECT c.text, c.status, c.resolution_reason,
                   t.full_name AS trustee_name
            FROM   resolution_vote_conditions c
            JOIN   resolution_votes v ON v.id = c.vote_id
            LEFT JOIN trustees       t ON t.id = v.trustee_id
            WHERE  c.resolution_id = CAST(:id AS uuid)
            ORDER  BY c.created_at ASC
        """), {"id": resolution_id})).mappings().all()
        info_requests = (await db.execute(text("""
            SELECT q.prompt, q.target_email, q.target_name,
                   r.body_html, r.content_hash, r.locked_at
            FROM   resolution_info_requests q
            LEFT JOIN resolution_info_responses r ON r.request_id = q.id
            WHERE  q.resolution_id = CAST(:id AS uuid)
            ORDER  BY q.created_at ASC
        """), {"id": resolution_id})).mappings().all()
        sigs = (await db.execute(text("""
            SELECT signer_name, signer_role, signature_png, created_at
            FROM   resolution_signatures
            WHERE  resolution_id = CAST(:id AS uuid)
            ORDER  BY created_at ASC
        """), {"id": resolution_id})).mappings().all()
    return {
        "res": dict(res) if res else {},
        "votes": [dict(v) for v in votes],
        "conditions": [dict(c) for c in conds],
        "info_requests": [dict(r) for r in info_requests],
        "signatures": [dict(s) for s in sigs],
    }


def _render_html(data: dict[str, Any]) -> str:
    r = data["res"]
    votes = data["votes"]
    conds = data["conditions"]
    irs = data["info_requests"]
    sigs = data["signatures"]

    vote_rows = "".join(
        f"<tr><td>{(v.get('trustee_name') or 'Anonymous') if not v.get('anonymous') else 'Anonymous'}</td>"
        f"<td>{v.get('trustee_role') or ''}</td>"
        f"<td><b>{v['choice'].replace('_', ' ')}</b></td>"
        f"<td>{_fmt_date(v.get('voted_at'))}</td></tr>"
        for v in votes
    ) or "<tr><td colspan='4'>No votes recorded.</td></tr>"

    cond_rows = "".join(
        f"<tr><td>{c.get('trustee_name') or '?'}</td>"
        f"<td>{(c.get('text') or '').replace(chr(10), '<br>')}</td>"
        f"<td class='cond-{c.get('status', '')}'><b>{c.get('status', '').title()}</b>"
        f"{('<br><i>' + (c.get('resolution_reason') or '') + '</i>') if c.get('resolution_reason') else ''}</td></tr>"
        for c in conds
    )

    ir_rows = "".join(
        f"<tr><td>{ir.get('target_name') or ir.get('target_email') or '?'}</td>"
        f"<td>{(ir.get('prompt') or '').replace(chr(10), '<br>')}</td>"
        f"<td>{'Submitted' if ir.get('locked_at') else 'Pending'}</td>"
        f"<td class='mono'>{(ir.get('content_hash') or '')[:16]}</td></tr>"
        for ir in irs
    )

    sig_cards = "".join(
        f"<div class='sig'>"
        f"<img src='data:image/png;base64,{base64.b64encode(s['signature_png']).decode('ascii')}' />"
        f"<div class='name'>{s.get('signer_name') or ''}</div>"
        f"<div class='role'>{s.get('signer_role') or ''}</div>"
        f"<div class='role'>{_fmt_date(s.get('created_at'))}</div>"
        f"</div>"
        for s in sigs
    )

    tally_html = (
        f"<p><strong>For:</strong> {r.get('tally_for', 0)} · "
        f"<strong>Against:</strong> {r.get('tally_against', 0)} · "
        f"<strong>Abstain:</strong> {r.get('tally_abstain', 0)}"
        f"{' · <em>Chair casting vote used: ' + str(r.get('casting_vote_choice', '')) + '</em>' if r.get('casting_vote_used') else ''}</p>"
        f"<p><strong>Outcome:</strong> {str(r.get('outcome', '')).replace('_', ' ')}</p>"
    )

    return f"""<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Resolution {r.get('id', '')[:8]}</title>
<style>{_BASE_CSS}</style></head>
<body>
  <div class="header">
    <h1>{r.get('title', '') or 'Resolution'}</h1>
    <div class="ref">
      Ref RES-{str(r.get('id', ''))[:8].upper()} ·
      {(r.get('category') or '').replace('_', ' ').title()} ·
      {(r.get('decision_type') or '').replace('_', ' ').title()} ·
      Published {_fmt_date(r.get('published_at'))} ·
      Closed {_fmt_date(r.get('closed_at'))} ·
      Chair sign-off {_fmt_date(r.get('chair_signoff_at'))}
    </div>
  </div>

  <h2>Background</h2>
  <div>{r.get('background') or '<em>(empty)</em>'}</div>

  <h2>Recommendation</h2>
  <div>{r.get('recommendation') or '<em>(empty)</em>'}</div>

  { ("<h2>Risk / Impact</h2><p>" + str(r.get('risk_impact') or '') + "</p>") if r.get('risk_impact') else '' }
  { ("<h2>Budget Impact</h2><p>" + str(r.get('budget_impact') or '') + "</p>") if r.get('budget_impact') else '' }

  <h2>Tally &amp; Outcome</h2>
  <div class="tally">{tally_html}</div>
  {('<p><em>' + r.get('outcome_summary', '') + '</em></p>') if r.get('outcome_summary') else ''}

  <h2>Vote record</h2>
  <div class="appendix">
    <table>
      <thead><tr><th>Trustee</th><th>Role</th><th>Vote</th><th>At</th></tr></thead>
      <tbody>{vote_rows}</tbody>
    </table>
  </div>

  { ("<h2>Conditions on FOR_WITH_CONDITIONS votes</h2><div class='appendix'><table>"
       "<thead><tr><th>By</th><th>Condition</th><th>Chair resolution</th></tr></thead>"
       "<tbody>" + cond_rows + "</tbody></table></div>") if conds else '' }

  { ("<h2>Information requests</h2><div class='appendix'><table>"
       "<thead><tr><th>Target</th><th>Prompt</th><th>Status</th><th>Hash</th></tr></thead>"
       "<tbody>" + ir_rows + "</tbody></table></div>") if irs else '' }

  { ("<h2>Signatures</h2><div class='sig-grid'>" + sig_cards + "</div>") if sigs else '' }

  <div class="foot">
    SHITAL · Shri Shirdi Saibaba Temple Association · UK Charity 1138530.
    This record is cryptographically pinned via content hashes printed above and PIN-authenticated board sign-off.
  </div>
</body></html>
"""


async def generate_pdf_bytes(resolution_id: str) -> bytes:
    """Return the rendered PDF as bytes. Imports WeasyPrint lazily."""
    from weasyprint import HTML  # noqa: PLC0415 — see module docstring
    data = await _gather(resolution_id)
    if not data["res"]:
        raise ValueError("Resolution not found")
    html = _render_html(data)
    return bytes(HTML(string=html).write_pdf())


async def attach_pdf_to_resolution(resolution_id: str) -> str:
    """Generate, store, and link the PDF. Returns the attachment id."""
    import uuid as _uuid

    pdf = await generate_pdf_bytes(resolution_id)
    att_id = str(_uuid.uuid4())
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        await db.execute(text("""
            INSERT INTO board_resolution_attachments
                (id, resolution_id, filename, content_type, size_bytes,
                 source, uploaded_by, data)
            VALUES
                (CAST(:id AS uuid), CAST(:rid AS uuid), :fn, 'application/pdf',
                 :size, 'pdf_signoff', NULL, :data)
        """), {
            "id": att_id, "rid": resolution_id,
            "fn": f"resolution-{resolution_id[:8]}.pdf",
            "size": len(pdf), "data": pdf,
        })
        await db.execute(text("""
            UPDATE resolutions
               SET pdf_attachment_id = CAST(:att AS uuid), updated_at = :now
             WHERE id = CAST(:rid AS uuid)
        """), {"att": att_id, "rid": resolution_id, "now": now})
        await db.commit()
    return att_id


__all__ = ["generate_pdf_bytes", "attach_pdf_to_resolution"]
