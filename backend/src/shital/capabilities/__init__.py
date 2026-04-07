# Import all capability modules to register them with DigitalDNA
from shital.capabilities import (
    assets,
    auth,
    basket,
    compliance,
    documents,
    finance,
    hr,
    notifications,
    payments,
    payroll,
)

__all__ = [
    "finance",
    "hr",
    "payroll",
    "assets",
    "compliance",
    "auth",
    "notifications",
    "payments",
    "basket",
    "documents",
]
