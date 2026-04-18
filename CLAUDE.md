# ShitalEco — Project Memory for Claude

## Apps & Their URLs

| App | Directory | Live URL | Purpose |
|-----|-----------|----------|---------|
| **Service** | `apps/service` | `service.shital.org.uk` | Online donation website (PayPal) |
| **Quick Donation** | `apps/quick-donation` | `shital.org.uk/donate/` | Tap-and-go kiosk (Stripe Terminal card reader) |
| **Kiosk** | `apps/kiosk` | kiosk devices (Electron/browser) | Full self-service kiosk — **WORKING, do not touch card reader logic** |
| **Admin** | `apps/admin` | `admin.shital.org.uk` | Admin panel for managing devices, items, branches |
| **Backend** | `backend/` | API at `/api/v1/` | FastAPI Python backend |

## Key Rules

- **Kiosk card reader works fine** — do NOT change `apps/kiosk` card reader code
- **Quick Donation** (`apps/quick-donation`) is the one with card reader issues — login is at `POST /api/v1/kiosk/quick-donation/login`
- **Service app** (`apps/service`) uses PayPal only — no card reader
- The donate URL `shital.org.uk/donate/` = **Quick Donation app**, NOT the service app

## Card Reader Flow (Quick Donation)

1. Staff opens Admin screen on the device at `shital.org.uk/donate/admin`
2. Logs in with email/password → calls `POST /api/v1/kiosk/quick-donation/login`
3. Backend joins `kiosk_devices` → `terminal_devices` to find assigned Stripe reader
4. Returns `stripe_reader_id` and `reader_label` → stored in Zustand + localStorage

## Known Bugs Fixed (this session)

- `kiosk.py` line ~1362: `kd.status = 'active'` → `UPPER(kd.status) = 'ACTIVE'` (case mismatch, STATUSES are uppercase)
- `kiosk.py` line ~1366: device lookup used `user["branch_id"]` (UUID) but `kiosk_devices.branch_id` stores branch code → fixed to use `branch_code`
- Azure login endpoint was missing the device reader lookup entirely

## Branch IDs

- `kiosk_devices.branch_id` stores **branch code** (e.g. "wembley", "main") — NOT UUID
- `users.branch_id` stores **UUID** (FK to branches.id)
- `branches` table has both: `id` (UUID) and `branch_id`/`code` (short code)

## Device Status Values

- `kiosk_devices.status`: `ACTIVE | INACTIVE | MAINTENANCE` (uppercase)
- `terminal_devices.status`: `online | offline | busy` (lowercase)

## Theme System (Service App)

- 5 themes defined in `apps/service/src/themes.ts`
- Applied via CSS custom properties on `:root`
- Default theme: `dark` (NOT crimson)
- Theme persisted to localStorage via Zustand

## Working Branch

`claude/shital-erp-platform-iR2UF`
