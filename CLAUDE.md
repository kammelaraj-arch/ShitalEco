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

## Production-Grade Development — No Guesswork, Truth Only

These rules are mandatory. The goal is shippable, correct code — not plausible-looking code.

### 1. Verify before you claim
- **Never guess.** If you don't know, read the actual file, run the actual query, or run the actual command. Do not infer behaviour from a name.
- Before saying something is "fixed" or "working", **prove it**: run the test, hit the endpoint, check the DB, or show the output. No "this should work."
- Report outcomes truthfully. If a test fails, say it failed and paste the output. If you skipped a step, say so. Never hedge a done-and-verified result, never overstate an unverified one.

### 2. Ground every change in the real codebase
- Read the surrounding code before editing. Match its existing patterns, naming, error handling, and style — don't introduce a new convention.
- Check the real schema/types before touching data. (e.g. `kiosk_devices.branch_id` = branch code, `users.branch_id` = UUID — assumptions here have already caused bugs.)
- Trace the full path (frontend → API → DB and back) before changing any link in it. Confirm the contract on both sides of an API boundary.
- Don't touch code marked working (e.g. `apps/kiosk` card reader) unless explicitly asked.

### 3. Make changes minimal and reversible
- Smallest change that correctly solves the problem. No drive-by refactors, no unrequested rewrites.
- One logical change per commit, with a clear message describing what and why.
- Never delete or overwrite something you didn't create or don't understand without surfacing it first.

### 4. Handle reality, not the happy path
- Validate inputs. Handle errors, nulls, empty results, timeouts, and auth failures explicitly — don't assume success.
- Never hardcode secrets. Use env vars / existing config. Don't log secrets, tokens, or card/PII data.
- Consider case sensitivity, types, and timezones (the `status` casing bugs above came from ignoring this).

### 5. Verify before pushing
- Run the build, linter, type-checker, and tests that exist for the app you changed. Green locally before push.
- For backend changes, exercise the endpoint. For frontend, confirm it renders/behaves. For data changes, confirm against the actual DB.
- If you can't verify something, **say exactly what is unverified and why** — never paper over the gap.

### 6. When unsure, ask — don't assume
- If requirements are ambiguous or a decision is genuinely the user's, ask a focused question rather than guessing and building the wrong thing.
- State your assumptions explicitly when you must proceed on one.

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
