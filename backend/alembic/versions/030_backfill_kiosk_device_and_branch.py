"""030 backfill donations.kiosk_device_id + branch consistency

Two data fixes the operator confirmed are safe to run automatically:

1. Backfill donations.kiosk_device_id for historic rows. The operator
   confirmed exactly ONE active full-kiosk device (apps/kiosk, Stripe)
   and ONE active quick-donation device (apps/quick-donation, SumUp).
   For each, fill in the device id on every donation row that came from
   that source and has NULL kiosk_device_id. If we ever see >1 active
   device of the same type, we SKIP backfill for that type (we can't
   safely guess which device produced which donation).

2. Branch consistency in donations. Whitespace + case noise in
   donations.branch_id has been showing up as different branch labels
   in different apps for what is actually the same branch. Lowercase +
   trim every donations.branch_id that resolves to a known branches
   row by case-insensitive match.

Wrapped in lock_timeout / statement_timeout / per-table savepoints so
this can never hang container startup (same defensive pattern as 029).
Idempotent — re-running is a no-op once the data is clean.
"""
from sqlalchemy import text

from alembic import op

revision = '030'
down_revision = '029'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Same defensive caps as 029 — this migration runs synchronously before
    # uvicorn on every boot via `alembic upgrade head` in the Docker CMD.
    conn.execute(text("SET lock_timeout = '3s'"))
    conn.execute(text("SET statement_timeout = '20s'"))

    # ── 1. Backfill kiosk_device_id ──────────────────────────────────────────
    #
    # Match donations to devices by source + device_type:
    #   source = 'kiosk'          → kiosk_devices.device_type = 'KIOSK'
    #   source = 'quick-donation' → kiosk_devices.device_type = 'QUICK_DONATION'
    #
    # Only safe when exactly one ACTIVE device of that type exists in the
    # whole DB. If there are 0 or >1, we skip — picking the wrong one would
    # corrupt the by-device dashboard.
    for src, dtype in (("kiosk", "KIOSK"), ("quick-donation", "QUICK_DONATION")):
        try:
            with conn.begin_nested():
                device_id = conn.execute(text("""
                    SELECT id::text AS id
                    FROM kiosk_devices
                    WHERE UPPER(device_type) = :dtype
                      AND UPPER(status)      = 'ACTIVE'
                      AND deleted_at IS NULL
                    LIMIT 2
                """), {"dtype": dtype}).scalars().all()
                if len(device_id) != 1:
                    # 0 = nothing to backfill against; 2+ = ambiguous.
                    continue
                conn.execute(text("""
                    UPDATE donations
                    SET kiosk_device_id = CAST(:did AS UUID)
                    WHERE kiosk_device_id IS NULL
                      AND source = :src
                """), {"did": device_id[0], "src": src})
        except Exception:
            # Lock wait / timeout / transient — leave for the next boot.
            continue

    # ── 2. Normalise donations.branch_id to canonical branches.branch_id ────
    #
    # Lowercase + trim mismatches mean different apps fetch different display
    # names ("Main" vs "main", "wembley " vs "wembley"). Replace any
    # non-canonical value with the matching branches.branch_id when one
    # exists case-insensitively. Rows that don't match any branch are left
    # alone so we don't silently relabel data we can't identify.
    try:
        with conn.begin_nested():
            conn.execute(text("""
                UPDATE donations AS d
                SET branch_id = b.branch_id
                FROM branches AS b
                WHERE d.branch_id IS NOT NULL
                  AND d.branch_id <> b.branch_id
                  AND LOWER(TRIM(d.branch_id)) = LOWER(b.branch_id)
            """))
    except Exception:
        pass


def downgrade() -> None:
    # Irreversible — we don't keep the pre-backfill NULLs / pre-normalisation
    # strings. After upgrade the data is canonical; reverting would re-
    # introduce the inconsistencies the migration was written to fix.
    pass
