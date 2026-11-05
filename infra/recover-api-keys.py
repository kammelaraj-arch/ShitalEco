#!/usr/bin/env python3
"""
Recover api_keys_store rows from a pg_dump backup.

Why this exists: the SecretsManager encrypts every API key with a Fernet key
derived from JWT_SECRET (backend/src/shital/core/fabrics/secrets.py). If
JWT_SECRET has changed since a value was saved, the backend can no longer
decrypt it — it silently treats the value as "" and every send path reports
"not configured". The DB row is still there; it just can't be read.

This script opens one backup file, extracts the api_keys_store rows,
attempts to decrypt each encrypted_value with one or more candidate
JWT_SECRETs, and either:

  • prints the recovered (key_name → plaintext) pairs for you to re-save by
    hand in Admin → Settings → API Keys, OR

  • with --write, re-encrypts each recovered value with the CURRENT
    JWT_SECRET and upserts it straight into the live api_keys_store
    (overwriting the unreadable rows). Only --write touches the DB.

Usage examples
──────────────

  # List available backups on the VPS
  ls -lh /opt/shitaleco/backups/daily/

  # Dry run — try to decrypt with the CURRENT backend's JWT_SECRET
  # (this works when JWT_SECRET hasn't changed; nothing is written)
  python3 infra/recover-api-keys.py \\
      --backup /opt/shitaleco/backups/daily/shitaleco-YYYYMMDD-HHMMSS.sql.gz

  # Same dump, but also try an older JWT_SECRET you remember
  python3 infra/recover-api-keys.py \\
      --backup /opt/shitaleco/backups/daily/shitaleco-YYYYMMDD-HHMMSS.sql.gz \\
      --try-secret 'shital-temple-erp-jwt-secret-2024-london-prod' \\
      --try-secret 'another-old-secret'

  # When the dry run successfully recovered values, write them back
  # (re-encrypted with the current JWT_SECRET) so send_raw_email works:
  python3 infra/recover-api-keys.py \\
      --backup /opt/shitaleco/backups/daily/shitaleco-YYYYMMDD-HHMMSS.sql.gz \\
      --write --only OFFICE365_PASSWORD --only OFFICE365_EMAIL

  # Recover everything the backup held (Stripe, PayPal, Azure etc.)
  python3 infra/recover-api-keys.py \\
      --backup /opt/shitaleco/backups/daily/shitaleco-YYYYMMDD-HHMMSS.sql.gz \\
      --write

Requirements (both on the VPS):
  • Python 3.11+ with the 'cryptography' package (already installed in the
    backend venv — either activate it or run as:
    `docker exec -i shitaleco-backend-1 python3 /opt/shitaleco/infra/recover-api-keys.py ...`)
  • The current JWT_SECRET readable from either /opt/shitaleco/.env or the
    JWT_SECRET env var in the backend container.
  • --write also needs DATABASE_URL (same file / container env).

Safety:
  • Without --write the DB is NEVER touched. Default is dry-run.
  • With --write, each row is upserted via `ON CONFLICT DO UPDATE`.
    Only rows whose plaintext was recovered are written — unreadable rows
    are left alone.
  • Plaintext is never written to disk.
  • Lines printed with --show-values can expose secrets to the terminal /
    scrollback — rerun without --show-values after confirming the key
    names you needed.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import io
import os
import re
import sys
from pathlib import Path
from typing import Iterator

try:
    from cryptography.fernet import Fernet, InvalidToken
except ImportError:
    sys.stderr.write(
        "cryptography is not installed. Either:\n"
        "  • activate the backend venv:  source /opt/shitaleco/.venv/bin/activate\n"
        "  • or run inside the backend container:\n"
        "      docker exec -i shitaleco-backend-1 python3 /opt/shitaleco/infra/recover-api-keys.py ...\n"
    )
    sys.exit(2)


SALT = b"shital-api-keys-v1-salt"


def fernet_for(jwt_secret: str) -> Fernet:
    """Mirrors backend/src/shital/core/fabrics/secrets.py:_get_fernet()."""
    raw = jwt_secret.encode()
    key_bytes = hashlib.pbkdf2_hmac("sha256", raw, SALT, 100_000, dklen=32)
    return Fernet(base64.urlsafe_b64encode(key_bytes))


def load_env_file(path: Path) -> dict[str, str]:
    """Minimal KEY=VALUE loader; only used to find JWT_SECRET & DATABASE_URL."""
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def resolve_current_jwt_secret(cli_value: str | None) -> str | None:
    if cli_value:
        return cli_value
    for candidate in (
        os.environ.get("JWT_SECRET", ""),
        load_env_file(Path("/opt/shitaleco/.env")).get("JWT_SECRET", ""),
        load_env_file(Path.cwd() / ".env").get("JWT_SECRET", ""),
    ):
        if candidate:
            return candidate
    return None


def resolve_database_url(cli_value: str | None) -> str | None:
    if cli_value:
        return cli_value
    for candidate in (
        os.environ.get("DATABASE_URL", ""),
        load_env_file(Path("/opt/shitaleco/.env")).get("DATABASE_URL", ""),
        load_env_file(Path.cwd() / ".env").get("DATABASE_URL", ""),
    ):
        if candidate:
            return candidate
    return None


def open_backup(path: Path) -> io.TextIOBase:
    """Return a text stream over a possibly gzipped SQL dump."""
    if path.suffix == ".gz" or path.name.endswith(".sql.gz"):
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8", errors="replace")
    return path.open("r", encoding="utf-8", errors="replace")


# ── pg_dump produces one of two shapes for api_keys_store ─────────────────────
#
# 1) INSERT INTO api_keys_store (col, col, ...) VALUES ('...', '...', ...);
#
# 2) COPY api_keys_store (col, col, ...) FROM stdin;
#    OFFICE365_PASSWORD\tgAAAAABk...\t...\n
#    \.
#
# We handle both.


_COPY_START = re.compile(
    r"^COPY\s+(?:public\.)?api_keys_store\s*\((?P<cols>[^)]*)\)\s+FROM\s+stdin;",
    re.IGNORECASE,
)
_INSERT_LINE = re.compile(
    r"^INSERT\s+INTO\s+(?:public\.)?api_keys_store\s*\((?P<cols>[^)]*)\)\s+VALUES\s*\((?P<vals>.+)\);\s*$",
    re.IGNORECASE,
)


def split_insert_values(raw: str) -> list[str]:
    """Split the VALUES (...) tuple of a single INSERT, handling '' escaping."""
    out: list[str] = []
    buf: list[str] = []
    in_str = False
    i = 0
    while i < len(raw):
        ch = raw[i]
        if in_str:
            if ch == "'":
                if i + 1 < len(raw) and raw[i + 1] == "'":
                    buf.append("'")
                    i += 2
                    continue
                in_str = False
            else:
                buf.append(ch)
            i += 1
            continue
        if ch == "'":
            in_str = True
            i += 1
            continue
        if ch == ",":
            out.append("".join(buf).strip())
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    if buf:
        out.append("".join(buf).strip())
    return [v if v != "NULL" else "" for v in out]


def unescape_copy(raw: str) -> str:
    """Postgres COPY escapes \\t \\n \\\\ etc. Unescape the bits we care about."""
    return (
        raw.replace("\\t", "\t")
        .replace("\\n", "\n")
        .replace("\\r", "\r")
        .replace("\\\\", "\\")
    )


def iter_api_keys_rows(stream: io.TextIOBase) -> Iterator[dict[str, str]]:
    """Yield {column: value} dicts for every api_keys_store row found."""
    in_copy = False
    copy_cols: list[str] = []
    for line in stream:
        if not in_copy:
            m = _COPY_START.match(line)
            if m:
                copy_cols = [c.strip().strip('"') for c in m.group("cols").split(",")]
                in_copy = True
                continue
            m = _INSERT_LINE.match(line)
            if m:
                cols = [c.strip().strip('"') for c in m.group("cols").split(",")]
                vals = split_insert_values(m.group("vals"))
                if len(cols) != len(vals):
                    continue
                yield dict(zip(cols, vals, strict=False))
            continue
        # inside COPY
        if line.startswith("\\."):
            in_copy = False
            copy_cols = []
            continue
        parts = line.rstrip("\n").split("\t")
        if len(parts) != len(copy_cols):
            continue
        yield dict(zip(copy_cols, (unescape_copy(p) for p in parts), strict=False))


# ── Main ─────────────────────────────────────────────────────────────────────


def try_decrypt(token: str, secrets: list[str]) -> tuple[str, str] | None:
    """Return (plaintext, which_secret) or None."""
    if not token:
        return None
    for s in secrets:
        if not s:
            continue
        try:
            return (fernet_for(s).decrypt(token.encode()).decode(), s)
        except InvalidToken:
            continue
        except Exception:
            continue
    return None


def main() -> int:
    p = argparse.ArgumentParser(
        description="Recover api_keys_store rows from a pg_dump backup",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--backup", required=True, type=Path, help="Path to the .sql or .sql.gz dump")
    p.add_argument("--current-secret", default=None,
                   help="Override the current JWT_SECRET (default: /opt/shitaleco/.env or env)")
    p.add_argument("--try-secret", dest="try_secrets", action="append", default=[],
                   help="Also try this candidate as an OLD JWT_SECRET (repeatable)")
    p.add_argument("--only", action="append", default=[],
                   help="Only act on these key names (repeatable, case-sensitive)")
    p.add_argument("--show-values", action="store_true",
                   help="Print recovered plaintexts in full (default: masked)")
    p.add_argument("--write", action="store_true",
                   help="Re-encrypt recovered rows with the CURRENT JWT_SECRET and upsert to DB")
    p.add_argument("--database-url", default=None,
                   help="Override DATABASE_URL (only used with --write)")
    args = p.parse_args()

    if not args.backup.exists():
        sys.stderr.write(f"backup not found: {args.backup}\n")
        return 2

    current = resolve_current_jwt_secret(args.current_secret)
    if not current:
        sys.stderr.write(
            "Could not find the CURRENT JWT_SECRET (checked --current-secret, "
            "env var JWT_SECRET, /opt/shitaleco/.env, ./.env).\n"
        )
        return 2
    candidates = [current, *args.try_secrets]

    only = set(args.only)
    rows_total = 0
    rows_matched = 0
    recovered: list[tuple[str, str, str]] = []  # (key_name, plaintext, which_secret)
    unreadable: list[str] = []

    with open_backup(args.backup) as stream:
        for row in iter_api_keys_rows(stream):
            rows_total += 1
            key_name = row.get("key_name") or ""
            enc = row.get("encrypted_value") or ""
            if only and key_name not in only:
                continue
            rows_matched += 1
            if not enc:
                continue
            got = try_decrypt(enc, candidates)
            if got:
                recovered.append((key_name, got[0], got[1]))
            else:
                unreadable.append(key_name)

    print(f"Backup:      {args.backup}")
    print(f"Rows seen:   {rows_total} (matched filter: {rows_matched})")
    print(f"Recovered:   {len(recovered)}")
    print(f"Unreadable:  {len(unreadable)}")
    if unreadable:
        print(f"  → still encrypted with an unknown JWT_SECRET: {', '.join(unreadable)}")
        print("    Re-run with --try-secret '<old JWT_SECRET>' if you remember one.")
    print()

    for key_name, plaintext, which in recovered:
        if args.show_values:
            shown = plaintext
        elif not plaintext:
            shown = "(empty)"
        elif len(plaintext) <= 6:
            shown = "*" * len(plaintext)
        else:
            shown = plaintext[:2] + "*" * (len(plaintext) - 4) + plaintext[-2:]
        marker = "" if which == current else "   [encrypted with OLD secret — needs rewrite]"
        print(f"  {key_name:32s} {shown}{marker}")

    if not args.write:
        print()
        print("Dry run. Re-run with --write to re-encrypt and upsert these into the live DB,")
        print("or copy the values above into Admin → Settings → API Keys by hand.")
        return 0 if recovered else 1

    # ── --write path ────────────────────────────────────────────────────────
    db_url = resolve_database_url(args.database_url)
    if not db_url:
        sys.stderr.write(
            "--write needs DATABASE_URL. Pass --database-url or set it in the environment.\n"
        )
        return 2

    try:
        import psycopg2  # sync driver so we don't drag asyncpg into this tool
    except ImportError:
        sys.stderr.write(
            "psycopg2 not installed. Install it or run inside the backend container:\n"
            "  docker exec -i shitaleco-backend-1 python3 /opt/shitaleco/infra/recover-api-keys.py ... --write\n"
        )
        return 2

    f = fernet_for(current)
    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            for key_name, plaintext, _which in recovered:
                reenc = f.encrypt(plaintext.encode()).decode()
                cur.execute(
                    """
                    INSERT INTO api_keys_store (key_name, encrypted_value, updated_by, updated_at)
                    VALUES (%s, %s, %s, NOW())
                    ON CONFLICT (key_name)
                    DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value,
                                  updated_by = EXCLUDED.updated_by,
                                  updated_at = NOW()
                    """,
                    (key_name, reenc, "infra/recover-api-keys.py"),
                )
        conn.commit()
    finally:
        conn.close()

    print()
    print(f"✓ Upserted {len(recovered)} row(s) into api_keys_store, re-encrypted with the current JWT_SECRET.")
    print("  Restart the backend (or wait up to 5 min for the SecretsManager cache to expire)")
    print("  then fire the Donation Receipt test send from Admin → Email Templates.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
