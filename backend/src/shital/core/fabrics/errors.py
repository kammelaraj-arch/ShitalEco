"""
Exception hierarchy for the Shital Temple ERP platform.
All domain errors descend from ShitalError for consistent handling.
"""
from __future__ import annotations


class ShitalError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class NotFoundError(ShitalError):
    def __init__(self, resource: str, id: str):
        super().__init__("NOT_FOUND", f"{resource} not found: {id}")


class ValidationError(ShitalError):
    def __init__(self, message: str, details: dict | None = None):
        super().__init__("VALIDATION_ERROR", message, details)


class UnauthorizedError(ShitalError):
    def __init__(self, message: str = "Unauthorized"):
        super().__init__("UNAUTHORIZED", message)


class ForbiddenError(ShitalError):
    def __init__(self, message: str = "Forbidden"):
        super().__init__("FORBIDDEN", message)


class ConflictError(ShitalError):
    def __init__(self, message: str):
        super().__init__("CONFLICT", message)


class PaymentError(ShitalError):
    def __init__(self, message: str, details: dict | None = None):
        super().__init__("PAYMENT_ERROR", message, details)


class ExternalServiceError(ShitalError):
    def __init__(self, service: str, message: str):
        super().__init__("EXTERNAL_SERVICE_ERROR", f"{service}: {message}")


class AccountingError(ShitalError):
    def __init__(self, message: str):
        super().__init__("ACCOUNTING_ERROR", message)


class IdempotencyError(ShitalError):
    def __init__(self, key: str):
        super().__init__("IDEMPOTENCY_ERROR", f"Duplicate request: {key}")
