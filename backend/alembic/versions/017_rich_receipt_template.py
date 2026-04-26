"""017 rich email templates — sleek modern designs for all purposes"""
from alembic import op

revision = '017'
down_revision = '016'
branch_labels = None
depends_on = None

# ── Shared header/footer snippets ─────────────────────────────────────────────

def _header(title: str, subtitle: str = "", accent: str = "#FF9933,#e8590c") -> str:
    sub = f'<div style="display:inline-block;background:rgba(255,255,255,0.18);color:#fff;font-size:13px;font-weight:600;padding:4px 16px;border-radius:100px;margin-top:6px;">{subtitle}</div>' if subtitle else ""
    return f"""\
    <tr>
      <td style="background:linear-gradient(135deg,{accent});padding:44px 40px 36px;text-align:center;">
        <div style="font-size:52px;line-height:1;margin-bottom:14px;">🕉</div>
        <div style="color:#ffffff;font-size:30px;font-weight:900;letter-spacing:-0.5px;margin-bottom:4px;">Shital Temple</div>
        {sub}
      </td>
    </tr>"""

def _banner(text: str, color: str = "#16a34a") -> str:
    return f"""\
    <tr>
      <td style="background:{color};padding:13px 40px;text-align:center;">
        <span style="color:#ffffff;font-size:14px;font-weight:700;">{text}</span>
      </td>
    </tr>"""

FOOTER = """\
    <tr>
      <td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:22px 40px;text-align:center;">
        <p style="margin:0 0 6px;font-size:12px;color:#9ca3af;font-weight:500;">{{ branch_name }} &middot; Registered UK Charity</p>
        <p style="margin:0;font-size:12px;">
          <a href="https://shital.org.uk/terms" style="color:#FF9933;text-decoration:none;font-weight:500;">Terms &amp; Conditions</a>
          &nbsp;&middot;&nbsp;
          <a href="https://shital.org.uk/privacy" style="color:#FF9933;text-decoration:none;font-weight:500;">Privacy Policy</a>
        </p>
      </td>
    </tr>"""

SIGNOFF = """\
    <tr>
      <td style="padding:0 40px 40px;text-align:center;">
        <div style="width:60px;height:3px;background:linear-gradient(90deg,#FF9933,#FF6600);border-radius:2px;margin:0 auto 24px;"></div>
        <p style="font-size:22px;font-weight:900;color:#FF9933;margin:0 0 6px;">🙏 Jay Shri Krishna</p>
        <p style="font-size:13px;color:#9ca3af;margin:0;">With gratitude from the Shital Temple family</p>
      </td>
    </tr>"""

def _wrap(inner: str) -> str:
    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 16px;">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.10);">
{inner}
  </table>
  </td></tr>
</table>
</body>
</html>"""


# ── 1. Donation Receipt ───────────────────────────────────────────────────────

RECEIPT_SUBJECT = "Your Donation Receipt — {{ branch_name }} ({{ order_ref }})"

RECEIPT_HTML = _wrap(
    _header("Shital Temple", "{{ branch_name }}") +
    _banner("✓ &nbsp; Donation Confirmed — Thank You!") +
    """
    <tr><td style="padding:40px 40px 32px;">
      {% if customer_name %}
      <p style="margin:0 0 20px;font-size:17px;color:#111827;font-weight:700;">Dear {{ customer_name }},</p>
      {% endif %}
      <p style="margin:0 0 32px;font-size:15px;color:#4b5563;line-height:1.7;">
        Thank you for your generous donation to <strong style="color:#111827;">{{ branch_name }}</strong>.
        Your contribution helps us serve our community and maintain our sacred spaces.
      </p>

      <!-- Reference card -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#fff7ed,#fff3e0);border-radius:14px;border-left:5px solid #FF9933;margin-bottom:32px;">
        <tr><td style="padding:22px 26px;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:8px;">Order Reference</div>
          <div style="font-size:24px;font-weight:900;color:#1f2937;letter-spacing:4px;font-family:'Courier New',Courier,monospace;">{{ order_ref }}</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:8px;font-weight:500;">{{ date }}</div>
        </td></tr>
      </table>

      <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:12px;">Donation Summary</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <th align="left" style="font-size:11px;color:#d1d5db;text-transform:uppercase;letter-spacing:1px;padding-bottom:10px;border-bottom:2px solid #f3f4f6;font-weight:600;">Item</th>
          <th align="center" style="font-size:11px;color:#d1d5db;text-transform:uppercase;letter-spacing:1px;padding-bottom:10px;border-bottom:2px solid #f3f4f6;font-weight:600;width:44px;">Qty</th>
          <th align="right" style="font-size:11px;color:#d1d5db;text-transform:uppercase;letter-spacing:1px;padding-bottom:10px;border-bottom:2px solid #f3f4f6;font-weight:600;">Amount</th>
        </tr>
        {% for item in items %}
        <tr>
          <td style="padding:13px 0;font-size:14px;color:#374151;border-bottom:1px solid #f9fafb;font-weight:500;">{{ item.name }}</td>
          <td align="center" style="padding:13px 0;font-size:14px;color:#9ca3af;border-bottom:1px solid #f9fafb;">{{ item.quantity }}</td>
          <td align="right" style="padding:13px 0;font-size:14px;font-weight:700;color:#1f2937;border-bottom:1px solid #f9fafb;white-space:nowrap;">£{{ "%.2f"|format(item.unitPrice * item.quantity) }}</td>
        </tr>
        {% endfor %}
        <tr>
          <td colspan="2" style="padding-top:18px;font-size:16px;font-weight:900;color:#111827;">Total Donated</td>
          <td align="right" style="padding-top:18px;font-size:26px;font-weight:900;color:#e8590c;white-space:nowrap;">£{{ "%.2f"|format(total) }}</td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 40px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:14px;">
        <tr><td style="padding:20px 24px;">
          <div style="font-size:14px;font-weight:800;color:#15803d;margin-bottom:6px;">🎁 Gift Aid — Boost Your Donation by 25%</div>
          <div style="font-size:13px;color:#166534;line-height:1.6;">If you are a UK taxpayer, we can reclaim Gift Aid on your donation at <strong>no extra cost to you</strong>. Please speak to our staff to complete a simple declaration.</div>
        </td></tr>
      </table>
    </td></tr>""" +
    SIGNOFF + FOOTER
)

RECEIPT_TEXT = """\
Shital Temple — {{ branch_name }}
{% if customer_name %}Dear {{ customer_name }},{% endif %}

Thank you for your generous donation!

Order Reference : {{ order_ref }}
Date            : {{ date }}

-----------------------------------------
{% for item in items %}{{ item.name }} x{{ item.quantity }}  £{{ "%.2f"|format(item.unitPrice * item.quantity) }}
{% endfor %}-----------------------------------------
Total Donated   : £{{ "%.2f"|format(total) }}

🎁 Gift Aid: If you are a UK taxpayer, ask our staff to add Gift Aid — worth 25% extra at no cost to you.

🙏 Jay Shri Krishna
{{ branch_name }} · Registered UK Charity

Terms: https://shital.org.uk/terms  |  Privacy: https://shital.org.uk/privacy"""


# ── 2. Gift Aid Confirmation ──────────────────────────────────────────────────

GIFT_AID_SUBJECT = "Gift Aid Declaration Confirmed — {{ order_ref }}"

GIFT_AID_HTML = _wrap(
    _header("Shital Temple", "{{ branch_name }}", "#16a34a,#15803d") +
    _banner("🎁 Gift Aid Declaration Received", "#16a34a") +
    """
    <tr><td style="padding:40px 40px 32px;">
      {% if customer_name %}
      <p style="margin:0 0 20px;font-size:17px;color:#111827;font-weight:700;">Dear {{ customer_name }},</p>
      {% endif %}
      <p style="margin:0 0 28px;font-size:15px;color:#4b5563;line-height:1.7;">
        Thank you for completing your <strong style="color:#111827;">Gift Aid declaration</strong> for your donation to
        <strong style="color:#111827;">{{ branch_name }}</strong>. We can now reclaim 25p of tax for every £1 you donate —
        at absolutely no extra cost to you.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border-radius:14px;border-left:5px solid #16a34a;margin-bottom:32px;">
        <tr><td style="padding:22px 26px;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:8px;">Order Reference</div>
          <div style="font-size:24px;font-weight:900;color:#1f2937;letter-spacing:4px;font-family:'Courier New',Courier,monospace;">{{ order_ref }}</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:8px;font-weight:500;">{{ date }}</div>
        </td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fefce8;border:1.5px solid #fde68a;border-radius:14px;margin-bottom:28px;">
        <tr><td style="padding:20px 24px;">
          <div style="font-size:13px;font-weight:700;color:#92400e;margin-bottom:6px;">ℹ️ What this means</div>
          <div style="font-size:13px;color:#78350f;line-height:1.6;">
            For every <strong>£1</strong> you donate, Shital Temple can claim an extra <strong>25p</strong> from HMRC.
            On a donation of <strong>£{{ "%.2f"|format(total) }}</strong>, we can reclaim <strong>£{{ "%.2f"|format(total * 0.25) }}</strong> — making your total impact <strong>£{{ "%.2f"|format(total * 1.25) }}</strong>.
          </div>
        </td></tr>
      </table>

      <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0;">
        This declaration applies to this donation and any future donations until you notify us otherwise.
        If you pay less Income Tax and/or Capital Gains Tax than the amount of Gift Aid claimed, please contact us.
      </p>
    </td></tr>""" +
    SIGNOFF + FOOTER
)

GIFT_AID_TEXT = """\
Shital Temple — {{ branch_name }}
{% if customer_name %}Dear {{ customer_name }},{% endif %}

Thank you for completing your Gift Aid declaration!

Order Reference : {{ order_ref }}
Date            : {{ date }}
Donation Amount : £{{ "%.2f"|format(total) }}
Gift Aid Value  : £{{ "%.2f"|format(total * 0.25) }}
Total Impact    : £{{ "%.2f"|format(total * 1.25) }}

This declaration applies to this and any future donations until you notify us otherwise.

🙏 Jay Shri Krishna
{{ branch_name }} · Registered UK Charity"""


# ── 3. Event / Class Booking Confirmation ────────────────────────────────────

BOOKING_SUBJECT = "Booking Confirmed — {{ event_name }} ({{ order_ref }})"

BOOKING_HTML = _wrap(
    _header("Shital Temple", "{{ branch_name }}", "#6366f1,#4f46e5") +
    _banner("✓ &nbsp; Booking Confirmed!", "#6366f1") +
    """
    <tr><td style="padding:40px 40px 32px;">
      {% if customer_name %}
      <p style="margin:0 0 20px;font-size:17px;color:#111827;font-weight:700;">Dear {{ customer_name }},</p>
      {% endif %}
      <p style="margin:0 0 32px;font-size:15px;color:#4b5563;line-height:1.7;">
        Your booking for <strong style="color:#111827;">{{ event_name }}</strong> at <strong style="color:#111827;">{{ branch_name }}</strong> is confirmed.
        We look forward to seeing you!
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#eef2ff,#e0e7ff);border-radius:14px;border-left:5px solid #6366f1;margin-bottom:32px;">
        <tr><td style="padding:22px 26px;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:12px;">Booking Details</div>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:13px;color:#6b7280;padding-bottom:8px;width:120px;">Event</td><td style="font-size:13px;font-weight:700;color:#1f2937;padding-bottom:8px;">{{ event_name }}</td></tr>
            {% if event_date %}<tr><td style="font-size:13px;color:#6b7280;padding-bottom:8px;">Date</td><td style="font-size:13px;font-weight:700;color:#1f2937;padding-bottom:8px;">{{ event_date }}</td></tr>{% endif %}
            {% if event_time %}<tr><td style="font-size:13px;color:#6b7280;padding-bottom:8px;">Time</td><td style="font-size:13px;font-weight:700;color:#1f2937;padding-bottom:8px;">{{ event_time }}</td></tr>{% endif %}
            {% if event_location %}<tr><td style="font-size:13px;color:#6b7280;padding-bottom:8px;">Location</td><td style="font-size:13px;font-weight:700;color:#1f2937;padding-bottom:8px;">{{ event_location }}</td></tr>{% endif %}
            {% if seats %}<tr><td style="font-size:13px;color:#6b7280;padding-bottom:8px;">Seats</td><td style="font-size:13px;font-weight:700;color:#1f2937;padding-bottom:8px;">{{ seats }}</td></tr>{% endif %}
            <tr><td style="font-size:13px;color:#6b7280;">Reference</td><td style="font-size:13px;font-weight:900;color:#1f2937;letter-spacing:2px;font-family:monospace;">{{ order_ref }}</td></tr>
          </table>
        </td></tr>
      </table>

      {% if total and total > 0 %}
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td style="font-size:15px;color:#374151;font-weight:600;">Amount Paid</td>
          <td align="right" style="font-size:22px;font-weight:900;color:#6366f1;">£{{ "%.2f"|format(total) }}</td>
        </tr>
      </table>
      {% endif %}

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fefce8;border:1.5px solid #fde68a;border-radius:14px;">
        <tr><td style="padding:16px 22px;">
          <div style="font-size:13px;color:#78350f;line-height:1.6;">📌 Please bring this email or your reference number on the day. Doors open 15 minutes before the start time.</div>
        </td></tr>
      </table>
    </td></tr>""" +
    SIGNOFF + FOOTER
)

BOOKING_TEXT = """\
Shital Temple — {{ branch_name }}
{% if customer_name %}Dear {{ customer_name }},{% endif %}

Your booking is confirmed!

Event     : {{ event_name }}
{% if event_date %}Date      : {{ event_date }}{% endif %}
{% if event_time %}Time      : {{ event_time }}{% endif %}
{% if event_location %}Location  : {{ event_location }}{% endif %}
Reference : {{ order_ref }}
{% if total and total > 0 %}Amount    : £{{ "%.2f"|format(total) }}{% endif %}

Please bring this email or your reference number on the day.

🙏 Jay Shri Krishna
{{ branch_name }} · Registered UK Charity"""


# ── 4. Welcome / First Donation ──────────────────────────────────────────────

WELCOME_SUBJECT = "Welcome to the Shital Temple Family 🙏"

WELCOME_HTML = _wrap(
    _header("Shital Temple", "{{ branch_name }}", "#FF9933,#e8590c") +
    _banner("🙏 &nbsp; Welcome to Our Community!", "#FF9933") +
    """
    <tr><td style="padding:40px 40px 32px;">
      {% if customer_name %}
      <p style="margin:0 0 20px;font-size:17px;color:#111827;font-weight:700;">Dear {{ customer_name }},</p>
      {% endif %}
      <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.7;">
        Welcome to the <strong style="color:#111827;">Shital Temple</strong> family! We are so grateful for your first donation
        to <strong style="color:#111827;">{{ branch_name }}</strong>. Your generosity makes a real difference to our community.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#fff7ed,#fff3e0);border-radius:14px;border-left:5px solid #FF9933;margin-bottom:32px;">
        <tr><td style="padding:22px 26px;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:8px;">Your First Donation</div>
          <div style="font-size:26px;font-weight:900;color:#e8590c;">£{{ "%.2f"|format(total) }}</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:6px;">Ref: {{ order_ref }} &nbsp;·&nbsp; {{ date }}</div>
        </td></tr>
      </table>

      <div style="font-size:14px;font-weight:700;color:#374151;margin-bottom:14px;">What your donation supports:</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        {% for item in items %}
        <tr>
          <td style="padding:8px 0;font-size:14px;color:#4b5563;border-bottom:1px solid #f9fafb;">
            <span style="color:#FF9933;font-weight:700;">✦</span> &nbsp;{{ item.name }}
          </td>
        </tr>
        {% endfor %}
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:14px;">
        <tr><td style="padding:20px 24px;">
          <div style="font-size:14px;font-weight:800;color:#15803d;margin-bottom:6px;">🎁 Did you know about Gift Aid?</div>
          <div style="font-size:13px;color:#166534;line-height:1.6;">As a UK taxpayer, you can boost your donation by 25% at no extra cost. Ask our staff next time you visit.</div>
        </td></tr>
      </table>
    </td></tr>""" +
    SIGNOFF + FOOTER
)

WELCOME_TEXT = """\
Shital Temple — {{ branch_name }}
{% if customer_name %}Dear {{ customer_name }},{% endif %}

Welcome to the Shital Temple family!

Thank you for your first donation of £{{ "%.2f"|format(total) }} on {{ date }}.

Your generosity supports:
{% for item in items %}- {{ item.name }}
{% endfor %}
🎁 Gift Aid tip: As a UK taxpayer, you can boost your donation by 25% at no cost to you. Ask our staff next time.

🙏 Jay Shri Krishna
{{ branch_name }} · Registered UK Charity"""


# ── 5. General Enquiry Auto-Reply ────────────────────────────────────────────

ENQUIRY_SUBJECT = "Thank you for contacting Shital Temple — We'll be in touch shortly"

ENQUIRY_HTML = _wrap(
    _header("Shital Temple", "{{ branch_name }}", "#0ea5e9,#0284c7") +
    _banner("✉️ &nbsp; Message Received", "#0ea5e9") +
    """
    <tr><td style="padding:40px 40px 32px;">
      {% if customer_name %}
      <p style="margin:0 0 20px;font-size:17px;color:#111827;font-weight:700;">Dear {{ customer_name }},</p>
      {% endif %}
      <p style="margin:0 0 28px;font-size:15px;color:#4b5563;line-height:1.7;">
        Thank you for contacting <strong style="color:#111827;">{{ branch_name }}</strong>.
        We have received your message and a member of our team will be in touch with you shortly.
      </p>

      {% if message %}
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:14px;border-left:5px solid #0ea5e9;margin-bottom:28px;">
        <tr><td style="padding:20px 24px;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:10px;">Your Message</div>
          <div style="font-size:14px;color:#374151;line-height:1.6;font-style:italic;">"{{ message }}"</div>
        </td></tr>
      </table>
      {% endif %}

      <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0;">
        We aim to respond within <strong>2 working days</strong>. If your matter is urgent, please call us directly.
      </p>
    </td></tr>""" +
    SIGNOFF + FOOTER
)

ENQUIRY_TEXT = """\
Shital Temple — {{ branch_name }}
{% if customer_name %}Dear {{ customer_name }},{% endif %}

Thank you for contacting us. We have received your message and will be in touch shortly.

{% if message %}Your message: "{{ message }}"{% endif %}

We aim to respond within 2 working days.

🙏 Jay Shri Krishna
{{ branch_name }} · Registered UK Charity"""


# ── 6. Recurring Giving Setup Confirmation ───────────────────────────────────

RECURRING_SUBJECT = "Your Regular Giving is Set Up — Thank You, {{ customer_name or 'Valued Donor' }}!"

RECURRING_HTML = _wrap(
    _header("Shital Temple", "{{ branch_name }}", "#8b5cf6,#7c3aed") +
    _banner("💜 &nbsp; Regular Giving Confirmed", "#8b5cf6") +
    """
    <tr><td style="padding:40px 40px 32px;">
      {% if customer_name %}
      <p style="margin:0 0 20px;font-size:17px;color:#111827;font-weight:700;">Dear {{ customer_name }},</p>
      {% endif %}
      <p style="margin:0 0 32px;font-size:15px;color:#4b5563;line-height:1.7;">
        Thank you for setting up a regular donation to <strong style="color:#111827;">{{ branch_name }}</strong>.
        Your ongoing support means the world to us and helps us plan for the future.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#f5f3ff,#ede9fe);border-radius:14px;border-left:5px solid #8b5cf6;margin-bottom:32px;">
        <tr><td style="padding:22px 26px;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:12px;">Your Regular Gift</div>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:13px;color:#6b7280;padding-bottom:8px;width:120px;">Amount</td><td style="font-size:26px;font-weight:900;color:#7c3aed;padding-bottom:8px;">£{{ "%.2f"|format(amount) }}</td></tr>
            {% if frequency %}<tr><td style="font-size:13px;color:#6b7280;padding-bottom:8px;">Frequency</td><td style="font-size:13px;font-weight:700;color:#1f2937;padding-bottom:8px;text-transform:capitalize;">{{ frequency }}</td></tr>{% endif %}
            {% if next_date %}<tr><td style="font-size:13px;color:#6b7280;padding-bottom:8px;">Next Payment</td><td style="font-size:13px;font-weight:700;color:#1f2937;padding-bottom:8px;">{{ next_date }}</td></tr>{% endif %}
            <tr><td style="font-size:13px;color:#6b7280;">Reference</td><td style="font-size:13px;font-weight:900;color:#1f2937;letter-spacing:2px;font-family:monospace;">{{ order_ref }}</td></tr>
          </table>
        </td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:14px;">
        <tr><td style="padding:20px 24px;">
          <div style="font-size:14px;font-weight:800;color:#15803d;margin-bottom:6px;">🎁 Gift Aid on Regular Giving</div>
          <div style="font-size:13px;color:#166534;line-height:1.6;">If you are a UK taxpayer and have not yet completed a Gift Aid declaration, this could increase the value of your regular giving by 25% — speak to our staff to get it set up.</div>
        </td></tr>
      </table>
    </td></tr>""" +
    SIGNOFF + FOOTER
)

RECURRING_TEXT = """\
Shital Temple — {{ branch_name }}
{% if customer_name %}Dear {{ customer_name }},{% endif %}

Your regular giving is confirmed!

Amount     : £{{ "%.2f"|format(amount) }}
{% if frequency %}Frequency  : {{ frequency }}{% endif %}
{% if next_date %}Next Payment: {{ next_date }}{% endif %}
Reference  : {{ order_ref }}

Thank you for your ongoing support. It means the world to us.

🙏 Jay Shri Krishna
{{ branch_name }} · Registered UK Charity"""


# ── Migration ─────────────────────────────────────────────────────────────────

TEMPLATES = [
    ("donation_receipt",       "Donation Receipt",                     RECEIPT_SUBJECT,   RECEIPT_HTML,   RECEIPT_TEXT,   '["order_ref","customer_name","total","items","branch_name","date"]'),
    ("gift_aid_confirmation",  "Gift Aid Confirmation",                GIFT_AID_SUBJECT,  GIFT_AID_HTML,  GIFT_AID_TEXT,  '["order_ref","customer_name","total","branch_name","date"]'),
    ("event_booking",          "Event / Class Booking Confirmation",   BOOKING_SUBJECT,   BOOKING_HTML,   BOOKING_TEXT,   '["order_ref","customer_name","event_name","event_date","event_time","event_location","seats","total","branch_name","date"]'),
    ("welcome_donor",          "Welcome — First Donation",             WELCOME_SUBJECT,   WELCOME_HTML,   WELCOME_TEXT,   '["order_ref","customer_name","total","items","branch_name","date"]'),
    ("general_enquiry",        "General Enquiry Auto-Reply",           ENQUIRY_SUBJECT,   ENQUIRY_HTML,   ENQUIRY_TEXT,   '["customer_name","message","branch_name","date"]'),
    ("recurring_giving_setup", "Recurring Giving Setup Confirmation",  RECURRING_SUBJECT, RECURRING_HTML, RECURRING_TEXT, '["order_ref","customer_name","amount","frequency","next_date","branch_name","date"]'),
]


def upgrade() -> None:
    for key, name, subject, html_body, text_body, variables in TEMPLATES:
        op.execute(f"""
            INSERT INTO email_templates (template_key, name, subject, html_body, text_body, variables, is_active)
            VALUES (
                $k${key}$k$,
                $n${name}$n$,
                $s${subject}$s$,
                $h${html_body}$h$,
                $t${text_body}$t$,
                '{variables}'::jsonb,
                true
            )
            ON CONFLICT (template_key) DO UPDATE
                SET name       = EXCLUDED.name,
                    subject    = EXCLUDED.subject,
                    html_body  = EXCLUDED.html_body,
                    text_body  = EXCLUDED.text_body,
                    variables  = EXCLUDED.variables,
                    is_active  = true,
                    updated_at = NOW()
        """)


def downgrade() -> None:
    pass
