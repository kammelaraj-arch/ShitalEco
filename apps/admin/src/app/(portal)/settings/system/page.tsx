'use client'

const card = 'rounded-2xl p-6 space-y-4'
const cardStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }
const dangerStyle = { background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.25)' }
const safeStyle = { background: 'rgba(21,128,61,0.08)', border: '1px solid rgba(21,128,61,0.25)' }
const code = 'block bg-black/40 rounded-xl px-4 py-3 font-mono text-xs text-green-300 whitespace-pre overflow-x-auto'

export default function SystemPage() {
  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-white font-black text-2xl">System & Backups</h1>
        <p className="text-white/40 text-sm mt-1">
          Production safety rules, backup schedule and restore procedures.
          SUPER_ADMIN eyes only.
        </p>
      </div>

      {/* ── Backup schedule ───────────────────────────────────────────────── */}
      <div className={card} style={safeStyle}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">📦</span>
          <div>
            <h2 className="text-white font-bold text-base">Automated Backups</h2>
            <p className="text-white/40 text-xs">Running automatically — no action needed</p>
          </div>
          <span className="ml-auto text-xs font-bold px-3 py-1 rounded-full" style={{ background: 'rgba(21,128,61,0.2)', color: '#4ade80' }}>ACTIVE</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          {[
            { label: 'Schedule', value: 'Daily at 2:00 AM' },
            { label: 'Retention', value: '30 days' },
            { label: 'Location', value: '/opt/shitaleco/backups/' },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <p className="text-white/40 text-xs uppercase tracking-wide">{label}</p>
              <p className="text-white font-semibold mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        <div>
          <p className="text-white/50 text-xs mb-2">Pre-deploy backups are also saved automatically before every deployment.</p>
          <p className="text-white/40 text-xs">To trigger a manual backup now, run on the server:</p>
          <code className={code}>bash /opt/shitaleco/backup-db.sh</code>
        </div>
      </div>

      {/* ── Restore ───────────────────────────────────────────────────────── */}
      <div className={card} style={cardStyle}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔄</span>
          <h2 className="text-white font-bold text-base">Restore from Backup</h2>
        </div>

        <p className="text-white/50 text-sm">
          To restore the database from a backup file, run this on the server.
          Replace the filename with the backup you want to restore.
        </p>

        <code className={code}>{`# List available backups
ls -lh /opt/shitaleco/backups/

# Restore a specific backup (replace filename)
gunzip -c /opt/shitaleco/backups/pre-deploy-20260410-164100.sql.gz | \\
  docker exec -i shital-postgres psql -U shital shital`}</code>

        <p className="text-white/40 text-xs">
          ⚠ Restoring overwrites current data. Always take a fresh backup first before restoring.
        </p>
      </div>

      {/* ── Safe deploy ───────────────────────────────────────────────────── */}
      <div className={card} style={safeStyle}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">🚀</span>
          <h2 className="text-white font-bold text-base">Safe Deployment</h2>
        </div>

        <p className="text-white/50 text-sm">
          Always use <code className="text-green-400 font-mono">update.sh</code> to deploy.
          It backs up the database before touching anything, then rebuilds only what you specify.
        </p>

        <code className={code}>{`cd /opt/shitaleco

bash update.sh                    # rebuild all apps
bash update.sh admin              # rebuild only admin
bash update.sh admin kiosk        # rebuild specific apps`}</code>
      </div>

      {/* ── DANGER zone ───────────────────────────────────────────────────── */}
      <div className={card} style={dangerStyle}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">⛔</span>
          <h2 className="font-bold text-base" style={{ color: '#f87171' }}>NEVER Run These Commands</h2>
        </div>

        <p className="text-white/60 text-sm">
          These commands <strong className="text-red-400">permanently delete all database data</strong> —
          API keys, users, orders, donations, everything. There is no undo.
        </p>

        <code className="block rounded-xl px-4 py-3 font-mono text-xs text-red-400 whitespace-pre overflow-x-auto" style={{ background: 'rgba(185,28,28,0.15)' }}>{`docker compose down -v           ← DELETES ALL DATA
docker compose down --volumes    ← DELETES ALL DATA
docker volume rm shital_postgres_data`}</code>

        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(185,28,28,0.1)' }}>
          <p className="text-white/70">
            <strong className="text-white">Safe alternatives:</strong>
          </p>
          <ul className="text-white/50 text-xs mt-2 space-y-1 list-disc list-inside">
            <li>Restart a service: <code className="text-green-300 font-mono">docker compose restart backend</code></li>
            <li>Update code: <code className="text-green-300 font-mono">bash update.sh</code></li>
            <li>Rebuild one app: <code className="text-green-300 font-mono">bash update.sh admin</code></li>
          </ul>
        </div>
      </div>

      {/* ── Schema changes ────────────────────────────────────────────────── */}
      <div className={card} style={cardStyle}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">🗄️</span>
          <h2 className="text-white font-bold text-base">Database Schema Changes</h2>
        </div>
        <p className="text-white/50 text-sm">
          All schema changes go in <code className="text-blue-300 font-mono">backend/src/shital/main.py</code> → <code className="text-blue-300 font-mono">_patch_schema()</code>.
          The patch runs automatically on every backend startup.
        </p>
        <ul className="text-white/50 text-sm space-y-1.5 list-disc list-inside">
          <li>✅ Use <code className="text-green-300 font-mono">CREATE TABLE IF NOT EXISTS</code></li>
          <li>✅ Use <code className="text-green-300 font-mono">ALTER TABLE ADD COLUMN IF NOT EXISTS</code></li>
          <li>❌ Never use <code className="text-red-400 font-mono">DROP TABLE</code> or <code className="text-red-400 font-mono">DROP COLUMN</code></li>
          <li>❌ Never use <code className="text-red-400 font-mono">TRUNCATE</code></li>
        </ul>
      </div>
    </div>
  )
}
