"""
Abstract Unit of Work interface for the User aggregate.

Defines the transaction boundary: all repository operations within
a single `async with uow:` block share the same DB session and
are committed or rolled back atomically.
"""
from abc import ABC, abstractmethod
from typing import Any

from src.apps.v1.users.repositories.interfaces import (
    IRefreshSessionRepository,
    IUserRepository,
)


class IUserUnitOfWork(ABC):
    """Unit of Work interface for the User aggregate."""

    user_repository: IUserRepository
    refresh_session_repository: IRefreshSessionRepository

    async def commit(self) -> None:
        await self._commit()

    @abstractmethod
    async def __aenter__(self) -> "IUserUnitOfWork":
        ...

    @abstractmethod
    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        ...

    @abstractmethod
    async def _commit(self) -> None:
        ...

    @abstractmethod
    async def rollback(self) -> None:
        ...
