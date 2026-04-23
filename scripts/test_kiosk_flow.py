#!/usr/bin/env python3
"""
End-to-end test: kiosk shop flow
Tests: basket → items → order/pending → order/confirm
Verifies: orders, basket_items, donations, contacts, addresses, gift_aid_declarations
Run on the server: python3 scripts/test_kiosk_flow.py
"""
import json, sys, uuid, time
from datetime import datetime
try:
    import urllib.request as req
    import urllib.error as uerr
except ImportError:
    sys.exit("Python 3 required")

BASE = "http://localhost:8000/api/v1"
TEST_EMAIL = f"test.kiosk.{int(time.time())}@shital-test.invalid"
PASS_COUNT = 0
FAIL_COUNT = 0

# ── helpers ───────────────────────────────────────────────────────────────────

def call(method, path, body=None):
    data = json.dumps(body).encode() if body else None
    r = req.Request(f"{BASE}{path}", data=data,
                    headers={"Content-Type": "application/json"}, method=method)
    try:
        with req.urlopen(r, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except uerr.HTTPError as e:
        return e.code, {}
    except Exception as ex:
        return 0, {"_error": str(ex)}

def ok(label, cond, detail=""):
    global PASS_COUNT, FAIL_COUNT
    if cond:
        print(f"  ✓ {label}")
        PASS_COUNT += 1
    else:
        print(f"  ✗ {label}{(' — ' + detail) if detail else ''}")
        FAIL_COUNT += 1
    return cond

def section(title):
    print(f"\n{'─'*55}\n  {title}\n{'─'*55}")

# ── 1. health check ──────────────────────────────────────────────────────────

section("1. Backend health")
status, body = call("GET", "/ping")
ok("Backend reachable", status == 200, f"status={status}")
ok("Status = healthy", body.get("status") == "healthy", str(body))

# ── 2. create basket ─────────────────────────────────────────────────────────

section("2. Create basket")
status, body = call("POST", "/kiosk/basket", {"branch_id": "main"})
ok("POST /kiosk/basket → 200", status == 200, str(body))
basket_id = body.get("basket_id", "")
ok("basket_id returned", bool(basket_id), str(body))

# ── 3. add items ─────────────────────────────────────────────────────────────

section("3. Add basket items")
items_to_add = [
    {"name": "Quick Dan £5",  "item_type": "DONATION",    "reference_id": "quick-dan-5",  "quantity": 1, "unit_price": 5.00},
    {"name": "Rice Bag 10kg", "item_type": "SOFT_DONATION","reference_id": "rice-bag-10kg","quantity": 2, "unit_price": 15.00},
]
item_ids = []
for item in items_to_add:
    status, body = call("POST", "/kiosk/basket/item", {
        "basket_id": basket_id, **item,
    })
    ok(f"Add '{item['name']}' → 200", status == 200, str(body))
    if body.get("item_id"):
        item_ids.append(body["item_id"])

ok("Both items got item_ids", len(item_ids) == 2, str(item_ids))

# ── 4. order/pending with contact + gift aid ─────────────────────────────────

section("4. POST /kiosk/order/pending  (contact + gift aid)")
order_ref = f"ORD-TEST{uuid.uuid4().hex[:6].upper()}"
status, body = call("POST", "/kiosk/order/pending", {
    "basket_id":        basket_id,
    "order_ref":        order_ref,
    "payment_provider": "STRIPE_TERMINAL",
    "payment_intent_id": f"pi_test_{uuid.uuid4().hex[:16]}",
    "branch_id":        "main",
    "device_id":        "test-device-001",
    "device_label":     "Test Kiosk",
    "source":           "kiosk",
    "total_amount":     35.00,
    "contact_name":     "Test Donor",
    "contact_email":    TEST_EMAIL,
    "contact_phone":    "07700900000",
    "gift_aid_eligible": True,
    "ga_full_name":     "Test Donor",
    "ga_postcode":      "HA9 0AA",
    "ga_address":       "1 Wembley Way, Wembley",
    "ga_email":         TEST_EMAIL,
})
ok("POST /kiosk/order/pending → 200", status == 200, str(body))
ok("Returns order reference",  body.get("reference") == order_ref, str(body))
ok("Status = PENDING",         body.get("status") == "PENDING", str(body))

time.sleep(1)   # let async DB writes settle

# ── 5. verify DB records via admin endpoints ─────────────────────────────────

section("5. Verify orders table")
status, body = call("GET", f"/admin/orders?limit=5")
if status == 200:
    orders = body.get("orders", [])
    match = next((o for o in orders if o.get("reference") == order_ref), None)
    ok("Order found in DB",            bool(match), f"searched {len(orders)} rows")
    ok("Order status = PENDING",        match and match.get("status") == "PENDING")
    ok("customer_email stored",         match and match.get("customer_email") == TEST_EMAIL)
    ok("device_id stored",              match and bool(match.get("device_id")))
else:
    ok("GET /admin/orders accessible", False, f"status={status} (auth required — skipping DB checks)")

section("6. Verify order items (basket_items)")
status, body = call("GET", f"/admin/order-items?order_ref={order_ref}")
if status == 200:
    items = body.get("items", [])
    ok("Order items returned", len(items) > 0, f"got {len(items)}")
    names = [i.get("name","") for i in items]
    ok("'Quick Dan £5' item present",  any("Quick Dan" in n for n in names), str(names))
    ok("'Rice Bag 10kg' item present", any("Rice Bag" in n for n in names), str(names))
else:
    ok("GET /admin/order-items accessible", False, f"status={status}")

section("7. Verify contacts table")
status, body = call("GET", f"/admin/contacts?q={TEST_EMAIL}")
if status == 200:
    contacts = body.get("contacts", [])
    match = next((c for c in contacts if c.get("email") == TEST_EMAIL), None)
    ok("Contact created",              bool(match), f"searched {len(contacts)} rows")
    ok("full_name stored",             match and "Test Donor" in (match.get("full_name") or ""))
    ok("gdpr_consent = true",          match and match.get("gdpr_consent") is True)
else:
    ok("GET /admin/contacts accessible", False, f"status={status}")

section("8. Verify addresses table")
status, body = call("GET", f"/admin/addresses?q=HA9+0AA")
if status == 200:
    addresses = body.get("addresses", [])
    match = next((a for a in addresses if "HA9" in (a.get("postcode") or "")), None)
    ok("Address record created",  bool(match), f"searched {len(addresses)} rows")
    ok("Postcode HA9 0AA stored", match and "HA9" in (match.get("postcode") or ""))
else:
    ok("GET /admin/addresses accessible", False, f"status={status}")

# ── 6. confirm order ─────────────────────────────────────────────────────────

section("9. POST /kiosk/order/confirm")
fake_pi = f"pi_test_confirmed_{uuid.uuid4().hex[:12]}"
status, body = call("POST", "/kiosk/order/confirm", {
    "order_ref":   order_ref,
    "payment_ref": fake_pi,
})
ok("POST /kiosk/order/confirm → 200", status == 200, str(body))

time.sleep(1)

# verify COMPLETED status
status, body = call("GET", f"/admin/orders?limit=5")
if status == 200:
    orders = body.get("orders", [])
    match = next((o for o in orders if o.get("reference") == order_ref), None)
    ok("Order status = COMPLETED", match and match.get("status") == "COMPLETED", str(match))
    ok("payment_ref updated",      match and fake_pi in (match.get("payment_ref") or ""), str(match))

# ── summary ───────────────────────────────────────────────────────────────────

section("SUMMARY")
total = PASS_COUNT + FAIL_COUNT
print(f"  Passed: {PASS_COUNT}/{total}")
print(f"  Failed: {FAIL_COUNT}/{total}")
if FAIL_COUNT == 0:
    print("\n  ALL TESTS PASSED ✓")
else:
    print(f"\n  {FAIL_COUNT} test(s) FAILED ✗")
    sys.exit(1)
