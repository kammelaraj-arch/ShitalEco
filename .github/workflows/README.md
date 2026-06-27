# CI/CD & Ops Workflows — canonical set

Keep this directory lean. **Do not commit one-off diagnostic / recovery
workflows** — run those ad-hoc and delete them, or use the SSH tooling. This
directory is the *permanent* deploy, backup, and recovery surface only.
(33 → 11 cleanup on 2026-06-27 removed ~22 firefighting one-offs.)

## Deployment

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | push / PR | Lint + test, and on **main** build & push `:latest` images to GHCR. Feature branches do NOT build `:dev` (prevents poisoning). |
| `deploy-dev.yml` | push to main | Auto-deploys main to **dev** (`dev.shital.org.uk`). |
| `deploy-vultr.yml` | manual / System Ops button | **Promote to Prod** — pulls `:latest`, recreates, health-gates, snapshots. |
| `require-rebase.yml` | PR / push | Fails if the branch is behind `main` (stops old files overwriting newer ones). |
| `cutover-bluegreen.yml` | manual | One-time blue/green host cutover (dormant until enabled). |
| `build-kiosk.yml` | manual / tag | Builds the Kiosk + Quick-Donation Android APKs → `kiosk-latest` release. |

**Promote flow:** merge PR → main → `ci.yml` builds `:latest` → click *Promote
to Prod* → `deploy.sh` snapshots, recreates backend, health-gates, self-heals
nginx. The backend serves `/health` immediately (migrations run in a background
task) so the gate passes fast instead of rolling back.

## Backup (two complementary layers — NOT duplicated)

1. **Daily rotation** — `infra/backup.sh` via host cron (`infra/cron/crontab`,
   02:00 UK). Daily (30d) + weekly (12w) + monthly (12m), uploaded to Azure
   Blob if `AZURE_STORAGE_*` is set. Logs to `backups/cron.log`.
2. **Per-promote snapshot** — `deploy.sh take_snapshot()` runs `pg_dump` +
   tags the about-to-be-replaced images as `:promote-<ts>` before every
   promote, so a promote is always reversible. Last 10 kept.

**Restore:** `bash infra/backup.sh restore <file>` (daily backups) or the
**Restore** button on System Ops → Promote Snapshots (per-promote, PIN-gated).

## Recovery (manual safety nets — deploy.sh self-heals first)

| Workflow | Use when |
|----------|----------|
| `recover-nginx.yml` | nginx missing/not serving after a promote (deploy.sh's EXIT-trap + host watchdog should catch this first). |
| `rollback.yml` | roll an image back to its `:promote-<ts>` checkpoint. |
| `db-recover.yml` | restore the DB from a backup. |
| `open-ports.yml` | re-open host firewall ports if locked out. |
| `sync-deploy-sh.yml` | push an updated `deployer/deploy.sh` to the host (bind-mounted; next deploy picks it up). |

## Rule of thumb
- **Diagnostics** (check-*, diag-*, dump-*, verify-*): run ad-hoc, never commit.
- **Recovery one-offs**: fold the logic into `deploy.sh` self-heal or the
  workflows above instead of adding a new `*-now.yml`.
