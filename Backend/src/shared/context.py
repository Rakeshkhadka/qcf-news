"""
Request-scoped context using Python contextvars.

This allows services deep in the call stack to access the current
user's ID without threading it through every function argument.
"""
import contextvars
from typing import Optional


class UserContext:
    _user_id: contextvars.ContextVar[Optional[int]] = contextvars.ContextVar(
        "user_id", default=None
    )

    def set(self, user_id: int) -> None:
        self._user_id.set(user_id)

    def get(self) -> Optional[int]:
        return self._user_id.get()

    def reset(self) -> None:
        self._user_id.set(None)
