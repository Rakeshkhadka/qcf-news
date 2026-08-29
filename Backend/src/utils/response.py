"""
Standardized API response wrappers.

Every endpoint should return through `ResponseSuccess` or `ResponseFailure`
so the frontend always receives a predictable JSON envelope.
"""
from typing import Any, Optional

from fastapi import status
from fastapi.responses import JSONResponse


class ResponseSuccess:
    def __init__(
        self,
        message: str,
        data: Any = None,
        total_count: Optional[int] = None,
        status_code: int = status.HTTP_200_OK,
    ):
        self.message = message
        self.data = data if not hasattr(data, "model_dump") else data.model_dump()
        self.total_count = total_count
        self.status_code = status_code

    def to_response(self) -> JSONResponse:
        content: dict[str, Any] = {
            "success": True,
            "message": self.message,
            "data": self.data,
        }
        if self.total_count is not None:
            content["total_count"] = self.total_count
        return JSONResponse(status_code=self.status_code, content=content)


class ResponseFailure:
    def __init__(
        self,
        message: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        data: Any = None,
    ):
        self.message = message
        self.status_code = status_code
        self.data = data

    def to_response(self) -> JSONResponse:
        return JSONResponse(
            status_code=self.status_code,
            content={
                "success": False,
                "message": self.message,
                "data": self.data,
            },
        )
