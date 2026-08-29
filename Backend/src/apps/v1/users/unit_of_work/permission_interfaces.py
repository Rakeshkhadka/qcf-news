"""
Abstract Unit of Work interface for Role & Permission operations.
"""
from abc import ABC, abstractmethod
from typing import Any

from src.apps.v1.users.repositories.permission_interfaces import (
    IPermissionRepository,
    IRoleRepository,
)


class IRolePermissionUnitOfWork(ABC):
    """Transaction boundary for Role & Permission aggregates."""

    roles: IRoleRepository
    permissions: IPermissionRepository

    async def commit(self) -> None:
        await self._commit()

    @abstractmethod
    async def __aenter__(self) -> "IRolePermissionUnitOfWork":
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
