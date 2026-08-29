"""
Structured exception hierarchy for the domain layer.

All business-rule violations should raise a `DomainException` subclass.
The error-handler middleware translates these into JSON responses automatically.
"""
from enum import Enum
from typing import Any, Optional


class ErrorCode(Enum):
    """
    Each member is a (code, default_message, http_status) triple.
    """

    # Generic
    NOT_FOUND = ("EXC_001", "Not found", 404)
    ALREADY_EXISTS = ("EXC_002", "Already exists", 409)
    INVALID_DATA = ("EXC_003", "Invalid data", 400)

    # Auth
    UNAUTHORIZED = ("AUTH_001", "Unauthorized access", 401)
    INVALID_TOKEN = ("AUTH_002", "Invalid or expired token", 401)
    FORBIDDEN = ("AUTH_003", "Insufficient privileges", 403)

    # Database
    DATABASE_ERROR = ("DB_001", "Database operation failed", 500)
    TRANSACTION_ERROR = ("DB_002", "Transaction failed", 500)

    # General
    INTERNAL_SERVER_ERROR = ("GEN_001", "Internal server error", 500)
    VALIDATION_ERROR = ("GEN_002", "Validation error", 400)
    RATE_LIMIT_EXCEEDED = ("GEN_003", "Too many requests", 429)
    SERVICE_UNAVAILABLE = ("GEN_004", "Service unavailable", 503)

    def __init__(self, code: str, message: str, status_code: int):
        self.code = code
        self.message = message
        self.status_code = status_code

    def __str__(self) -> str:
        return self.code


class DomainException(Exception):
    """Base exception for all business-logic errors."""

    def __init__(
        self,
        error_code: ErrorCode,
        detail: Optional[str] = None,
        data: Optional[dict[str, Any]] = None,
    ):
        self.error_code = error_code
        self.detail = detail or error_code.message
        self.data = data or {}
        super().__init__(self.detail)


class NotFoundException(DomainException):
    def __init__(
        self, detail: Optional[str] = None, data: Optional[dict[str, Any]] = None
    ):
        super().__init__(ErrorCode.NOT_FOUND, detail, data)


class AlreadyExistsException(DomainException):
    def __init__(
        self, detail: Optional[str] = None, data: Optional[dict[str, Any]] = None
    ):
        super().__init__(ErrorCode.ALREADY_EXISTS, detail, data)


class InvalidDataException(DomainException):
    def __init__(
        self, detail: Optional[str] = None, data: Optional[dict[str, Any]] = None
    ):
        super().__init__(ErrorCode.INVALID_DATA, detail, data)


class UnauthorizedException(DomainException):
    def __init__(
        self, detail: Optional[str] = None, data: Optional[dict[str, Any]] = None
    ):
        super().__init__(ErrorCode.UNAUTHORIZED, detail, data)


class ForbiddenException(DomainException):
    def __init__(
        self, detail: Optional[str] = None, data: Optional[dict[str, Any]] = None
    ):
        super().__init__(ErrorCode.FORBIDDEN, detail, data)


class ServiceUnavailableException(DomainException):
    """
    A dependency the endpoint cannot work without is down or unconfigured.

    Distinct from a 500: nothing is broken in the request, and retrying later
    is the right response — which is exactly what a 503 tells the caller and a
    500 does not.
    """

    def __init__(
        self, detail: Optional[str] = None, data: Optional[dict[str, Any]] = None
    ):
        super().__init__(ErrorCode.SERVICE_UNAVAILABLE, detail, data)
