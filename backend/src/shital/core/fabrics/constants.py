"""
Platform-wide constants — tax rates, NI thresholds, pension limits, roles, permissions.
All UK statutory figures are for the current tax year; update annually.
"""
from __future__ import annotations

# Gift Aid
GIFT_AID_RATE = 0.25

# UK Income Tax thresholds (2024/25)
UK_PERSONAL_ALLOWANCE = 12_570
UK_BASIC_RATE_THRESHOLD = 50_270
UK_HIGHER_RATE_THRESHOLD = 125_140
UK_BASIC_RATE = 0.20
UK_HIGHER_RATE = 0.40
UK_ADDITIONAL_RATE = 0.45

# National Insurance (employee, 2024/25)
NI_EMPLOYEE_LOWER = 12_570   # annual
NI_EMPLOYEE_UPPER = 50_270   # annual
NI_EMPLOYEE_RATE_MAIN = 0.08
NI_EMPLOYEE_RATE_ABOVE = 0.02

# National Insurance (employer, 2024/25)
NI_EMPLOYER_SECONDARY = 9_100  # annual
NI_EMPLOYER_RATE = 0.138

# Auto-Enrolment Pension (2024/25)
PENSION_QUALIFYING_LOWER = 6_240   # annual
PENSION_QUALIFYING_UPPER = 50_270  # annual
PENSION_EMPLOYEE_MIN = 0.05
PENSION_EMPLOYER_MIN = 0.03

# Currency
DEFAULT_CURRENCY = "GBP"

# Session / Auth
SESSION_TTL_SECONDS = 60 * 60 * 24 * 7   # 7 days
OTP_TTL_SECONDS = 300                      # 5 minutes
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION_SECONDS = 900            # 15 minutes

# Roles (ordered most → least privileged for display)
ROLES = [
    "SUPER_ADMIN",
    "TRUSTEE",
    "ACCOUNTANT",
    "HR_MANAGER",
    "BRANCH_MANAGER",
    "STAFF",
    "VOLUNTEER",
    "DEVOTEE",
    "KIOSK",
    "AUDITOR",
]

ROLE_HIERARCHY: dict[str, int] = {
    "SUPER_ADMIN": 100,
    "TRUSTEE": 80,
    "ACCOUNTANT": 70,
    "HR_MANAGER": 65,
    "AUDITOR": 60,
    "BRANCH_MANAGER": 50,
    "STAFF": 30,
    "VOLUNTEER": 20,
    "DEVOTEE": 10,
    "KIOSK": 5,
}

# Permission → roles that hold it
PERMISSIONS: dict[str, list[str]] = {
    "finance:read": ["SUPER_ADMIN", "TRUSTEE", "ACCOUNTANT", "AUDITOR", "BRANCH_MANAGER"],
    "finance:write": ["SUPER_ADMIN", "TRUSTEE", "ACCOUNTANT"],
    "finance:void": ["SUPER_ADMIN", "TRUSTEE", "ACCOUNTANT"],
    "payroll:read": ["SUPER_ADMIN", "TRUSTEE", "HR_MANAGER", "ACCOUNTANT"],
    "payroll:run": ["SUPER_ADMIN", "HR_MANAGER", "ACCOUNTANT"],
    "hr:read": ["SUPER_ADMIN", "TRUSTEE", "HR_MANAGER", "BRANCH_MANAGER"],
    "hr:write": ["SUPER_ADMIN", "HR_MANAGER"],
    "assets:read": ["SUPER_ADMIN", "TRUSTEE", "BRANCH_MANAGER", "STAFF", "ACCOUNTANT"],
    "assets:write": ["SUPER_ADMIN", "BRANCH_MANAGER"],
    "compliance:read": ["SUPER_ADMIN", "TRUSTEE", "AUDITOR"],
    "compliance:write": ["SUPER_ADMIN", "TRUSTEE"],
    "admin:users": ["SUPER_ADMIN"],
    "admin:branches": ["SUPER_ADMIN", "TRUSTEE"],
    "bookings:read": ["SUPER_ADMIN", "BRANCH_MANAGER", "STAFF"],
    "bookings:write": ["SUPER_ADMIN", "BRANCH_MANAGER", "STAFF"],
    "payments:create": ["SUPER_ADMIN", "BRANCH_MANAGER", "STAFF", "KIOSK", "DEVOTEE"],
    "super_admin": ["SUPER_ADMIN"],
}
