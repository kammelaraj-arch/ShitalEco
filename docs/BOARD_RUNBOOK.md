# Board Resolutions — Setup, Verify, Operate

This runbook covers every piece of configuration the admin needs
to turn on, and an end-to-end smoke test that walks a single
resolution from draft to signed-off PDF.

---

## 1. Configuration

All settings can be set as **env vars on the backend** or via **Admin → Settings → API Keys** (preferred because a rotation takes effect without a restart). Admin values win over env.

### 1.1 Email (transactional + announcements)

Three providers — pick one:

| `MAIL_PROVIDER` | What it needs | Cost |
|---|---|---|
| `office365` (default) | `OFFICE365_EMAIL`, `OFFICE365_PASSWORD` | your O365 licence |
| `ses` | `AWS_SES_SMTP_HOST`, `AWS_SES_SMTP_USER`, `AWS_SES_SMTP_PASSWORD`, `AWS_SES_FROM` | ~£0.0008/email |
| `notify` | `NOTIFY_API_KEY`, `NOTIFY_EMAIL_TEMPLATE_ID` | **free** for UK charities up to 250k/yr |

**GOV.UK Notify setup (recommended for SHITAL)**

1. Sign up at [https://www.notifications.service.gov.uk](https://www.notifications.service.gov.uk) — pick "Local authority or charity".
2. Prove charity registration **1138530** — Notify approves in ~1 working day.
3. Create one email template with two personalisations:
   - Subject: `((subject))`
   - Body: `((body))`
4. Copy its template UUID — this is `NOTIFY_EMAIL_TEMPLATE_ID`.
5. Issue an API key under *API integration → API keys* — the full string looks like `live-abcd1234-abcd-1234-...`. This is `NOTIFY_API_KEY`.
6. Set in Admin → Settings → API Keys:
   ```
   MAIL_PROVIDER           = notify
   NOTIFY_API_KEY          = live-xxxxxxxx-....
   NOTIFY_EMAIL_TEMPLATE_ID = <uuid>
   ```

### 1.2 SMS (trustee invites, SMS campaigns)

| `SMS_PROVIDER` | Needs | Cost |
|---|---|---|
| `notify` (default) | `NOTIFY_API_KEY`, `NOTIFY_TEMPLATE_ID` | **free** for UK charities up to 250k/yr, then £0.0202/SMS |
| `twilio` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | ~£0.045/SMS |

**Notify SMS setup**

Follow steps 1–2 above (same account covers email + SMS). Then:

1. Create one SMS template with body `((body))`.
2. Copy its template UUID — this is `NOTIFY_TEMPLATE_ID` (separate from the email one).
3. If you have a reserved sender id, note it as `NOTIFY_SMS_SENDER_ID` (optional).
4. Set:
   ```
   SMS_PROVIDER         = notify
   NOTIFY_TEMPLATE_ID   = <sms-uuid>
   NOTIFY_SMS_SENDER_ID = <optional>
   ```

### 1.3 PDF signing (Ed25519, optional but recommended)

The sign-off PDF ships with an `.pdf.sig` sidecar. Without a key, the
signature is HMAC-SHA256 of JWT_SECRET — tamper-evident but not
publicly verifiable. For a real asymmetric signature anyone can verify
offline:

```bash
# Generate a one-time Ed25519 keypair
openssl genpkey -algorithm ed25519 -out board-pdf-signing.pem
openssl pkey -in board-pdf-signing.pem -pubout -out board-pdf-signing.pub

# Backend side: paste the private key PEM into
#   BOARD_PDF_SIGNING_KEY_PEM
# in Admin → Settings → API Keys.

# Publish board-pdf-signing.pub somewhere stable (charity website
# /trust-page) so anyone can verify a resolution PDF offline.
```

### 1.4 Cert coverage

Make sure the live cert on nginx covers every Board-facing host:

```
shital.org.uk · admin.shital.org.uk · campaigns.shital.org.uk ·
service.shital.org.uk · kiosk.shital.org.uk · donate.shital.org.uk
```

See `deploy-vultr.yml`'s certbot renew step. On a fresh host, the
`certbot certonly --webroot --expand --cert-name shital.org.uk -d …`
command covers all of them from one cert.

---

## 2. End-to-end smoke test

A 10-minute walkthrough. Uses the live admin at **admin.shital.org.uk**.

### Step 0 — Preconditions

- At least one trustee row exists (`/admin/board/trustees`), with role `CHAIR` on one of them.
- Chair has set a PIN at least once (first magic-link visit).

### Step 1 — Create a draft

1. Admin → Board → Resolutions → **New resolution**.
2. Link a meeting (any), fill title + category.
3. Open **Context** step.
4. **Background** / **Recommendation** — write a sentence; verify the Tiptap toolbar works (bold / list / link).
5. **Collaboration** panel → **External links** tab → add `https://example.com` with a label; verify it saves and re-lists.
6. **Information Requests** tab → add one with `example@example.com` as target, prompt "please confirm X", type `text`, toggle Required. Verify invite URL is shown.
7. Open the invite URL in a private window — expect the `/board/info?t=...` page. Set a PIN. Submit a short response. Verify "Submitted" + content hash shows.
8. Back on admin: the request now reads SUBMITTED; **Publish for voting** button is enabled (no red warning).

### Step 2 — Publish & vote

1. Click **Publish for voting**. Status → OPEN.
2. In Admin → Board → Trustees, open the chair; click "Send magic link". Grab the URL from the email (or server log).
3. Open the magic link in a private window. Enter PIN.
4. Try **Review & complete later** — the status pill flips to DEFERRED on return.
5. Reload. Choose **For — with conditions**. Add one condition "subject to X". Enter PIN → confirm.
6. In the **Discussion** section below, post one review comment. Verify it renders on another trustee's view.

### Step 3 — Chair resolves, closes, signs off

1. Admin → Board → Resolutions → open the live resolution → **Vote & Close**.
2. Under **Trustee conditions**, pick **Accept** on the single condition with a one-line reason.
3. Click **Close voting** (existing button). Status → CLOSED.
4. **Chair sign-off** panel appears. If external audience was picked in the Announcement step, hit **Approve external audience** first.
5. Draw a signature in the canvas → **Save signature**.
6. Enter chair PIN → **Sign off**.
7. After ~10s you'll see the download link to the **signed PDF** and a results panel from the announcement fan-out.

### Step 4 — Verify the PDF

```bash
# Download the PDF and its .sig sidecar from Admin → attachments.
# The sidecar is a plain-text file:
cat resolution-abcdef12.pdf.sig
# algorithm:       ed25519
# pdf_sha256:      <hex>
# signature_b64:   <64-byte base64>

# Verify the SHA-256 digest matches:
sha256sum resolution-abcdef12.pdf
# must equal the pdf_sha256 line.

# If BOARD_PDF_SIGNING_KEY_PEM is set, verify the signature:
python3 - <<'PY'
import base64
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

pub = serialization.load_pem_public_key(open('board-pdf-signing.pub','rb').read())
pdf = open('resolution-abcdef12.pdf','rb').read()
sig = base64.b64decode('<signature_b64 from the sidecar>')
pub.verify(sig, pdf)   # throws InvalidSignature on tamper
print("OK")
PY
```

### Step 5 — Check the announcement fan-out

Admin → Settings → Email Templates → **Sent** — filter by
`related_type = resolution_announcement`. Every opt-in recipient of the
selected audience should have a row with status SENT. Skipped (opted
out) rows do NOT appear — the fan-out stats panel on the resolution
tells you the count.

---

## 3. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Invite email never arrives | `MAIL_PROVIDER` creds wrong | Check backend logs for `router_mount_failed` or SMTP error; re-send from Admin → Email Templates → Sent. |
| SMS doesn't fire | `SMS_PROVIDER=notify` but no template id | Create one with `((body))` placeholder, set `NOTIFY_TEMPLATE_ID`. |
| "Publish for voting" disabled with amber warning | Required info-request still OPEN | Fulfill or cancel in the Context step. |
| Chair sign-off blocked on "pending conditions" | One or more `FOR_WITH_CONDITIONS` votes still PENDING | Chair opens Vote & Close, hits Accept/Reject on each. |
| `.pdf.sig` says `algorithm: hmac-sha256` | `BOARD_PDF_SIGNING_KEY_PEM` not set | Generate an Ed25519 key, set the PEM in Admin → API Keys. |
| Fan-out sends 0 emails | Audience resolves to 0 unique or all opted out | Preview-count endpoint; verify `contact_channel_prefs`. |

---

## 4. Endpoints (reference)

Admin-gated — SUPER_ADMIN / ADMIN / CHAIR:

```
GET  /api/v1/admin/board/meetings                     
POST /api/v1/admin/board/meetings
...
GET  /api/v1/admin/board/resolutions/{rid}/signoff
POST /api/v1/admin/board/resolutions/{rid}/signoff/signature
POST /api/v1/admin/board/resolutions/{rid}/signoff/finalise
POST /api/v1/admin/board/resolutions/{rid}/announcement/approve
POST /api/v1/admin/board/resolutions/{rid}/conditions/{cid}/resolve
GET  /api/v1/admin/board/resolutions/{rid}/conditions
POST /api/v1/admin/board/resolutions/{rid}/info-requests
POST /api/v1/admin/board/resolutions/{rid}/info-requests/{req}/send-invite
POST /api/v1/admin/board/resolutions/{rid}/send-sms-invites
GET  /api/v1/admin/board/resolutions/{rid}/external-links
GET  /api/v1/admin/board/resolutions/{rid}/comments
GET  /api/v1/admin/board/resolutions/{rid}/announcement
POST /api/v1/admin/board/resolutions/{rid}/announcement/audiences
POST /api/v1/admin/board/resolutions/{rid}/announcement/preview-count
```

Public — magic-link token (`?t=<jwt>`):

```
GET  /api/v1/public/board/vote/{token}
POST /api/v1/public/board/vote/{token}            (cast / change vote)
POST /api/v1/public/board/vote/{token}/comment    (review comment)
POST /api/v1/public/board/vote/{token}/upload     (evidence attachment)
GET  /api/v1/public/board/vote/{token}/review     (comments + my vote)

GET  /api/v1/public/board/info/{token}
POST /api/v1/public/board/info/set-pin
POST /api/v1/public/board/info/upload
POST /api/v1/public/board/info/submit             (sealed + content_hash)
```

Marketing (same host) — admin / marketing role:

```
GET  /api/v1/marketing/segments
GET  /api/v1/marketing/templates
GET  /api/v1/marketing/campaigns
POST /api/v1/marketing/send-test
POST /api/v1/marketing/campaigns/{cid}/send-now
POST /api/v1/marketing/campaigns/{cid}/schedule
GET  /api/v1/marketing/campaigns/{cid}/tracking
```

Webhooks (no auth, bound by signed token or source):

```
POST /api/v1/webhooks/marketing/ses               (SES bounce / complaint)
GET  /api/v1/webhooks/marketing/open?t=<jwt>      (pixel)
GET  /api/v1/webhooks/marketing/click?t=<jwt>&u=  (click redirect)
```

Preference centre (public, signed token):

```
GET  /api/v1/me/prefs?t=<jwt>
POST /api/v1/me/prefs?t=<jwt>
POST /api/v1/me/prefs/unsubscribe?t=<jwt>
```
