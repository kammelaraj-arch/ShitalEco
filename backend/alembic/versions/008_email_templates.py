"""008 email_templates — store and manage email templates in DB

Revision ID: 008_email_templates
Revises: 007_item_scheduling
Create Date: 2026-04-04
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '008_email_templates'
down_revision = '007_item_scheduling'
branch_labels = None
depends_on = None

DEFAULT_RECEIPT_HTML = """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Donation Receipt</title></head>
<body style="font-family:Inter,Arial,sans-serif;background:#f7f3ee;margin:0;padding:32px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <div style="background:linear-gradient(135deg,#B91C1C,#7f1010);padding:32px 40px;text-align:center;">
    <div style="font-size:48px;">🕉</div>
    <h1 style="color:#fff;margin:12px 0 4px;font-size:24px;">Thank You, {{ customer_name or 'Valued Devotee' }}!</h1>
    <p style="color:rgba(255,255,255,.8);margin:0;font-size:14px;">Your generous donation has been received</p>
  </div>
  <div style="padding:32px 40px;">
    <div style="background:#f9fafb;border-radius:12px;padding:20px;margin-bottom:24px;">
      <p style="margin:0 0 8px;color:#6b7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Order Reference</p>
      <p style="margin:0;color:#111827;font-size:22px;font-weight:800;font-family:monospace;">{{ order_ref }}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <thead>
        <tr style="border-bottom:2px solid #f3f4f6;">
          <th style="text-align:left;padding:8px 0;color:#6b7280;font-size:12px;font-weight:600;text-transform:uppercase;">Item</th>
          <th style="text-align:right;padding:8px 0;color:#6b7280;font-size:12px;font-weight:600;text-transform:uppercase;">Amount</th>
        </tr>
      </thead>
      <tbody>
        {% for item in items %}
        <tr style="border-bottom:1px solid #f9fafb;">
          <td style="padding:10px 0;color:#374151;font-size:14px;">{{ item.name }} {% if item.quantity > 1 %}x{{ item.quantity }}{% endif %}</td>
          <td style="padding:10px 0;color:#111827;font-weight:700;font-size:14px;text-align:right;">£{{ '%.2f'|format(item.unitPrice * item.quantity) }}</td>
        </tr>
        {% endfor %}
      </tbody>
      <tfoot>
        <tr>
          <td style="padding:12px 0 0;color:#111827;font-weight:800;font-size:16px;">Total</td>
          <td style="padding:12px 0 0;color:#B91C1C;font-weight:800;font-size:20px;text-align:right;">£{{ '%.2f'|format(total) }}</td>
        </tr>
      </tfoot>
    </table>
    <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:12px;padding:16px;margin-bottom:24px;">
      <p style="margin:0;color:#92400e;font-size:13px;">🙏 <strong>Jay Shri Krishna</strong> — May this act of generosity bring divine blessings to you and your family.</p>
    </div>
    <p style="color:#6b7280;font-size:12px;text-align:center;margin:0;">{{ branch_name }} · Registered UK Charity · {{ date }}</p>
  </div>
</div>
</body>
</html>"""

DEFAULT_RECEIPT_TEXT = """Thank you, {{ customer_name or 'Valued Devotee' }}!

Your donation to {{ branch_name }} has been received.

Order Reference: {{ order_ref }}
Date: {{ date }}

Items:
{% for item in items %}- {{ item.name }} {% if item.quantity > 1 %}x{{ item.quantity }}{% endif %} = £{{ '%.2f'|format(item.unitPrice * item.quantity) }}
{% endfor %}

Total: £{{ '%.2f'|format(total) }}

Jay Shri Krishna 🙏
{{ branch_name }} · Registered UK Charity"""

DEFAULT_RECEIPT_SUBJECT = "Your donation receipt — {{ order_ref }}"

DEFAULT_GIFT_AID_HTML = """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Gift Aid Confirmation</title></head>
<body style="font-family:Inter,Arial,sans-serif;background:#f0fdf4;margin:0;padding:32px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <div style="background:linear-gradient(135deg,#15803d,#166534);padding:32px 40px;text-align:center;">
    <div style="font-size:48px;">🇬🇧</div>
    <h1 style="color:#fff;margin:12px 0 4px;font-size:22px;">Gift Aid Confirmed</h1>
    <p style="color:rgba(255,255,255,.8);margin:0;font-size:14px;">{{ branch_name }} can now claim 25% extra from HMRC</p>
  </div>
  <div style="padding:32px 40px;">
    <p style="color:#374151;font-size:14px;">Dear {{ customer_name }},</p>
    <p style="color:#374151;font-size:14px;">Thank you for completing your Gift Aid declaration for order <strong>{{ order_ref }}</strong>.</p>
    <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:12px;padding:20px;margin:20px 0;">
      <p style="margin:0 0 8px;color:#166534;font-weight:700;">Your donation of £{{ '%.2f'|format(total) }}</p>
      <p style="margin:0;color:#15803d;font-size:13px;">will generate an additional <strong>£{{ '%.2f'|format(total * 0.25) }}</strong> for {{ branch_name }} through Gift Aid — at no extra cost to you!</p>
    </div>
    <p style="color:#6b7280;font-size:12px;text-align:center;margin:0;">{{ branch_name }} · Registered UK Charity · {{ date }}</p>
  </div>
</div>
</body>
</html>"""


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS email_templates (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            template_key VARCHAR(100) UNIQUE NOT NULL,
            name VARCHAR(200) NOT NULL,
            subject TEXT NOT NULL,
            html_body TEXT NOT NULL,
            text_body TEXT NOT NULL DEFAULT '',
            variables JSONB NOT NULL DEFAULT '[]',
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)

    # Seed default templates
    op.execute(f"""
        INSERT INTO email_templates (template_key, name, subject, html_body, text_body, variables)
        VALUES (
            'donation_receipt',
            'Donation Receipt',
            $template_subject${DEFAULT_RECEIPT_SUBJECT}$template_subject$,
            $template_html${DEFAULT_RECEIPT_HTML}$template_html$,
            $template_text${DEFAULT_RECEIPT_TEXT}$template_text$,
            '["order_ref","customer_name","total","items","branch_name","date"]'::jsonb
        )
        ON CONFLICT (template_key) DO NOTHING
    """)

    op.execute(f"""
        INSERT INTO email_templates (template_key, name, subject, html_body, text_body, variables)
        VALUES (
            'gift_aid_confirmation',
            'Gift Aid Confirmation',
            'Gift Aid Declaration Confirmed — {{{{ order_ref }}}}',
            $template_html${DEFAULT_GIFT_AID_HTML}$template_html$,
            '',
            '["order_ref","customer_name","total","branch_name","date"]'::jsonb
        )
        ON CONFLICT (template_key) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS email_templates")
