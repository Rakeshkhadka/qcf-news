"""
Global error-handler middleware.

Catches `DomainException` and converts it to a structured JSON response.
Unknown exceptions are caught and returned as 500s in production,
or with a traceback detail in DEBUG mode.
"""
import logging
import traceback

from fastapi import Request
from fastapi.responses import JSONResponse

from src.config.settings import settings
from src.utils.exceptions import DomainException, ErrorCode

logger = logging.getLogger(__name__)


class ErrorHandlerMiddleware:
    async def __call__(self, request: Request, call_next):
        try:
            return await call_next(request)
        except DomainException as exc:
            return self._handle_domain(exc)
        except Exception as exc:
            logger.exception("Unhandled exception on %s %s", request.method, request.url)
            return self._handle_unknown(exc)

    @staticmethod
    def _handle_domain(exc: DomainException) -> JSONResponse:
        detail = exc.detail
        if exc.data:
            try:
                detail = detail.format(**exc.data)
            except (KeyError, IndexError):
                pass

        return JSONResponse(
            status_code=exc.error_code.status_code,
            content={
                "success": False,
                "message": detail,
                "error_code": exc.error_code.code,
                "data": exc.data or None,
            },
        )

    @staticmethod
    def _handle_unknown(exc: Exception) -> JSONResponse:
        data: dict = {}
        if settings.DEBUG:
            data["detail"] = str(exc)
            data["traceback"] = traceback.format_exc()

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "message": "An unexpected error occurred",
                "error_code": ErrorCode.INTERNAL_SERVER_ERROR.code,
                "data": data,
            },
        )
