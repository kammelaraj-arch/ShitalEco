"""Card Reader health check + auto-heal.

Reads the fleet and reports anomalies that the admin should know about;
offers a one-click heal for the subset that can be fixed automatically
without judgement calls.

Four classes of anomaly it finds:

1. ``misclassified_terminal_device`` — a row in ``terminal_devices`` whose
   ``provider`` disagrees with its own identifier columns. Example that
   bit us at Wembley: ``sumup_reader_serial = '200101578509'`` (SumUp
   Solo serial, format ``20010XXXXXXX``) but ``provider = 'stripe_terminal'``.
   The serial is unambiguous — SumUp owns the 20010* / 20011* serial
   space — so we can flip ``provider`` to ``sumup`` with zero risk.

2. ``device_wrong_provider`` — a ``kiosk_devices`` row whose assigned
   reader has the wrong provider for the device type:
     * ``QUICK_DONATION`` devices should only pair SumUp readers
       (operator rule 23 Oct). Any other provider is a bug.
     * Full ``KIOSK`` devices normally use Stripe Terminal, but SumUp
       is allowed too — only flagged when the actual donations on the
       device show the OTHER provider (configured ≠ in-use).

3. ``device_unpaired`` — a ``kiosk_devices`` row with ``card_reader_id``
   NULL, so payments on that device will fail at tap time.

4. ``device_dangling_pairing`` — ``kiosk_devices.card_reader_id`` points
   at a ``terminal_devices`` row that is soft-deleted or missing. The
   kiosk will try to use it and fail.

Heal action does ONLY (1) — the serial-format classifier is deterministic
and auditable. Fixes to (2)/(3)/(4) need operator judgement (which reader
should the device actually use?) so they're reported but not auto-fixed.

Each heal writes a row to ``audit_log`` via ``services.audit.record_audit``
so the Settings → System → Audit Log page shows exactly what was changed,
by whom, when.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from shital.api.deps import CurrentSpace
from shital.core.fabrics.database import SessionLocal
from shital.services.audit import record_audit, snapshot

router = APIRouter(prefix="/admin/card-reader-health", tags=["card-reader-health"])


def _require_admin(ctx) -> None:
    if ctx.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(403, detail="SUPER_ADMIN or ADMIN required")


import re

# SumUp Solo / Air Plus serials start with 2001 / 2002 (observed in prod).
# Stripe Terminal readers use IDs like `tmr_abcDEF...`.
# This classifier is intentionally conservative — unknown formats stay
# "unknown" and are not touched by the heal.
#
# IMPORTANT (26 Oct): some older rows have the SumUp serial baked into the
# `label` string (e.g. "honeydew-everyone-then Solo 200101578509") without
# the dedicated `sumup_reader_serial` column being populated. The classifier
# ALSO parses the label as a last-resort evidence source so those rows get
# healed and the serial can be back-filled into the proper column.

_SUMUP_SERIAL_RE = re.compile(r"\b(2001\d{7,8}|2002\d{7,8})\b")


def _classify_serial(serial: str, stripe_id: str, clover_id: str,
                     label: str = "") -> str:
    s = (serial or "").strip()
    if s.startswith("2001") or s.startswith("2002"):
        return "sumup"
    if (clover_id or "").strip():
        return "clover"
    if (stripe_id or "").strip().startswith("tmr_"):
        return "stripe_terminal"
    # Last-resort evidence: scan the label for a SumUp Solo serial pattern.
    if label and _SUMUP_SERIAL_RE.search(label):
        return "sumup"
    # Second last-resort: if the human label clearly says "Solo" or "SumUp",
    # treat as SumUp even without a serial match (the backfill below will
    # populate the serial column from the label match when it finds one).
    low = (label or "").lower()
    if "sumup" in low or re.search(r"\bsolo\b", low):
        return "sumup"
    return "unknown"


def _extract_sumup_serial_from_label(label: str) -> str:
    """Pull a SumUp Solo serial out of a label like
    'honeydew-everyone-then Solo 200101578509'. Returns '' if not found."""
    m = _SUMUP_SERIAL_RE.search(label or "")
    return m.group(1) if m else ""


@router.get("/scan")
async def scan_health(ctx: CurrentSpace) -> dict[str, Any]:
    """Scan the fleet and return anomalies. Read-only, safe to run anytime."""
    _require_admin(ctx)

    out: dict[str, Any] = {
        "misclassified_terminal_devices": [],
        "device_wrong_provider":          [],
        "device_unpaired":                [],
        "device_dangling_pairing":        [],
        "summary":                        {},
    }

    async with SessionLocal() as db:
        # ── 1. misclassified terminal_devices rows ──────────────────────────
        rows = (await db.execute(text("""
            SELECT id::text AS id, label, provider,
                   COALESCE(stripe_reader_id,'')    AS stripe_reader_id,
                   COALESCE(sumup_reader_serial,'') AS sumup_reader_serial,
                   COALESCE(clover_device_id,'')    AS clover_device_id,
                   branch_id
            FROM terminal_devices
            WHERE deleted_at IS NULL
        """))).mappings().all()
        for r in rows:
            expected = _classify_serial(
                r["sumup_reader_serial"], r["stripe_reader_id"], r["clover_device_id"],
                label=r["label"],
            )
            if expected != "unknown" and expected != (r["provider"] or "").lower():
                # Build evidence string — prefer the dedicated column, fall
                # back to the label-extracted serial for sumup when the
                # column itself is blank.
                if expected == "sumup":
                    serial_evidence = (
                        r["sumup_reader_serial"]
                        or _extract_sumup_serial_from_label(r["label"] or "")
                    )
                    evidence = (
                        f"sumup_reader_serial='{serial_evidence}'"
                        if serial_evidence
                        else f"label contains SumUp marker: '{r['label']}'"
                    )
                elif expected == "stripe_terminal":
                    evidence = f"stripe_reader_id='{r['stripe_reader_id']}'"
                else:
                    evidence = f"clover_device_id='{r['clover_device_id']}'"
                out["misclassified_terminal_devices"].append({
                    "id":              r["id"],
                    "label":           r["label"],
                    "branch_id":       r["branch_id"],
                    "current_provider": r["provider"],
                    "expected_provider": expected,
                    "evidence":        evidence,
                })

        # ── 2. kiosk_devices with wrong-provider pairing ────────────────────
        # Rule: QUICK_DONATION devices must pair SumUp (per 23 Oct policy).
        # KIOSK + others: flagged only when "configured" ≠ "actual" (last
        # completed donation's payment_provider).
        rows = (await db.execute(text("""
            SELECT kd.id::text          AS kd_id,
                   kd.name              AS device_name,
                   kd.device_type       AS device_type,
                   kd.branch_id         AS branch_id,
                   kd.card_reader_id::text AS card_reader_id,
                   td.id::text          AS td_id,
                   td.label             AS reader_label,
                   LOWER(COALESCE(td.provider,'')) AS reader_provider,
                   td.deleted_at        AS reader_deleted,
                   (SELECT UPPER(payment_provider)
                      FROM donations
                     WHERE kiosk_device_id = kd.id
                       AND deleted_at IS NULL
                       AND UPPER(COALESCE(status,'')) = 'COMPLETED'
                     ORDER BY created_at DESC
                     LIMIT 1) AS last_actual_provider
            FROM kiosk_devices kd
            LEFT JOIN terminal_devices td ON td.id = kd.card_reader_id
            WHERE kd.deleted_at IS NULL
              AND UPPER(COALESCE(kd.status,'')) = 'ACTIVE'
        """))).mappings().all()
        for r in rows:
            dt = (r["device_type"] or "").upper()
            if not r["card_reader_id"]:
                out["device_unpaired"].append({
                    "kiosk_device_id": r["kd_id"],
                    "device_name":     r["device_name"],
                    "device_type":     dt,
                    "branch_id":       r["branch_id"],
                    "reason":          "no card_reader_id set",
                })
                continue
            if r["td_id"] is None or r["reader_deleted"]:
                out["device_dangling_pairing"].append({
                    "kiosk_device_id": r["kd_id"],
                    "device_name":     r["device_name"],
                    "device_type":     dt,
                    "branch_id":       r["branch_id"],
                    "stale_card_reader_id": r["card_reader_id"],
                    "reason": (
                        "terminal_devices row soft-deleted"
                        if r["reader_deleted"] else "terminal_devices row missing"
                    ),
                })
                continue
            provider = r["reader_provider"] or ""
            if dt == "QUICK_DONATION" and provider != "sumup":
                out["device_wrong_provider"].append({
                    "kiosk_device_id":   r["kd_id"],
                    "device_name":       r["device_name"],
                    "device_type":       dt,
                    "branch_id":         r["branch_id"],
                    "reader_label":      r["reader_label"],
                    "configured_provider": provider or "(none)",
                    "expected_provider":   "sumup",
                    "reason": "Quick Donation devices must pair SumUp (per 23 Oct rule)",
                })
            elif r["last_actual_provider"]:
                actual = r["last_actual_provider"].lower()
                if actual == "kiosk":
                    actual = "stripe_terminal"
                if provider and provider != actual:
                    out["device_wrong_provider"].append({
                        "kiosk_device_id":   r["kd_id"],
                        "device_name":       r["device_name"],
                        "device_type":       dt,
                        "branch_id":         r["branch_id"],
                        "reader_label":      r["reader_label"],
                        "configured_provider": provider,
                        "expected_provider":   actual,
                        "reason": (
                            f"last successful donation on this device used "
                            f"{actual.upper()} — configured reader is {provider.upper()}"
                        ),
                    })

    out["summary"] = {
        "misclassified_terminal_devices": len(out["misclassified_terminal_devices"]),
        "device_wrong_provider":          len(out["device_wrong_provider"]),
        "device_unpaired":                len(out["device_unpaired"]),
        "device_dangling_pairing":        len(out["device_dangling_pairing"]),
        "auto_healable":                  len(out["misclassified_terminal_devices"]),
    }
    return out


@router.post("/heal-misclassified")
async def heal_misclassified(ctx: CurrentSpace) -> dict[str, Any]:
    """Auto-fix the serial-format misclassifications. The other three
    categories are left for the operator to resolve in Admin → Devices
    because they involve a judgement call (which reader SHOULD the device
    use?). Each healed row writes an audit_log entry."""
    _require_admin(ctx)

    scan = await scan_health(ctx)
    healed: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for item in scan["misclassified_terminal_devices"]:
        async with SessionLocal() as db:
            before = await snapshot(db, "terminal_devices", item["id"])
            if not before:
                skipped.append({**item, "reason": "row vanished between scan and heal"})
                continue
            # When healing a SumUp row that had its serial trapped in the
            # label field, backfill `sumup_reader_serial` so the Admin →
            # Devices Card Reader dropdown + the kiosk's lookup join start
            # finding the row by its proper key. Also wipe the stale
            # `stripe_reader_id` so a future provider-match query doesn't
            # cross-wire it with a real Stripe row.
            label_serial = _extract_sumup_serial_from_label(before.get("label") or "")
            backfill_sumup = (
                item["expected_provider"] == "sumup"
                and not (before.get("sumup_reader_serial") or "").strip()
                and label_serial
            )
            if backfill_sumup:
                result = await db.execute(text("""
                    UPDATE terminal_devices
                    SET provider            = :prov,
                        sumup_reader_serial = :serial,
                        stripe_reader_id    = NULL,
                        clover_device_id    = NULL,
                        updated_at          = NOW()
                    WHERE id = CAST(:id AS uuid)
                      AND deleted_at IS NULL
                      AND provider = :old_prov
                    RETURNING id
                """), {
                    "id": item["id"],
                    "prov": item["expected_provider"],
                    "old_prov": item["current_provider"],
                    "serial": label_serial,
                })
            else:
                result = await db.execute(text("""
                    UPDATE terminal_devices
                    SET provider = :prov, updated_at = NOW()
                    WHERE id = CAST(:id AS uuid)
                      AND deleted_at IS NULL
                      AND provider = :old_prov
                    RETURNING id
                """), {
                    "id": item["id"],
                    "prov": item["expected_provider"],
                    "old_prov": item["current_provider"],
                })
            row = result.first()
            await db.commit()
            after = await snapshot(db, "terminal_devices", item["id"])

        if not row:
            skipped.append({**item, "reason": "provider changed between scan and heal"})
            continue
        await record_audit(
            actor_email=getattr(ctx, "user_email", "") or "",
            actor_role=getattr(ctx, "role", None),
            action="auto_heal_misclassified",
            entity_type="terminal_devices",
            entity_id=item["id"],
            branch_id=item.get("branch_id"),
            source_endpoint="POST /admin/card-reader-health/heal-misclassified",
            before=before, after=after,
            diff_summary=(
                f"auto-healed misclassified reader: provider "
                f"'{item['current_provider']}' → '{item['expected_provider']}' "
                f"(evidence: {item['evidence']})"
            ),
        )
        healed.append(item)

    return {
        "healed":        healed,
        "healed_count":  len(healed),
        "skipped":       skipped,
        "skipped_count": len(skipped),
    }
