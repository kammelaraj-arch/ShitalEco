# Deploying ShitalEco — Production Rules

## ✅ Safe deploy (always use this)
```bash
cd /opt/shitaleco
bash update.sh                  # rebuild all apps
bash update.sh admin            # rebuild only admin
bash update.sh admin kiosk      # rebuild specific apps
```
This script always backs up the database first, then rebuilds only what you specify.

## ⛔ NEVER run these — they delete all data
```
docker compose down -v          ← DESTROYS database, API keys, users, orders
docker compose down --volumes   ← same
docker volume rm shital_postgres_data  ← same
```

## 🔁 Safe restart (no data loss)
```bash
docker compose -f infra/docker-compose.yml restart backend
docker compose -f infra/docker-compose.yml up -d --force-recreate admin
```

## 📦 Manual backup
```bash
/opt/shitaleco/backup-db.sh
```
Backups are at `/opt/shitaleco/backups/`. Runs automatically every day at 2am.

## 🔄 Restore from backup
```bash
gunzip -c /opt/shitaleco/backups/shital-YYYYMMDD-HHMM.sql.gz | \
  docker exec -i shital-postgres psql -U shital shital
```

## Schema changes
- All schema changes go in `backend/src/shital/main.py` → `_patch_schema()`
- Only use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- **Never** use `DROP TABLE`, `DROP COLUMN`, or `TRUNCATE` in patches
- The patch runs automatically on every backend startup — it is additive only
