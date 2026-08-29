"""
SQLAlchemy-based Unit of Work for Role & Permission aggregates.

Usage:
    async with RolePermissionSqlAlchemyUoW(session_factory) as uow:
        role = await uow.roles.get_by_id(1)
        perm = await uow.permissions.get_by_code("ART.CRT")
        # auto-commits on clean exit; rolls back on exception
"""
from typing import Any, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from src.apps.v1.users.repositories.permission_repository import (
    PermissionRepository,
    RoleRepository,
)
from src.apps.v1.users.unit_of_work.permission_interfaces import (
    IRolePermissionUnitOfWork,
)


class RolePermissionSqlAlchemyUoW(IRolePermissionUnitOfWork):

    def __init__(self, session_factory: Callable[[], AsyncSession]):
        self._session_factory = session_factory
        self._session: AsyncSession | None = None
        self.roles: RoleRepository | None = None
        self.permissions: PermissionRepository | None = None

    async def __aenter__(self) -> "RolePermissionSqlAlchemyUoW":
        self._session = self._session_factory()
        self.roles = RoleRepository(self._session)
        self.permissions = PermissionRepository(self._session)
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if exc_type:
            await self.rollback()
        else:
            await self._commit()
        await self._session.close()

    async def _commit(self) -> None:
        await self._session.commit()

    async def rollback(self) -> None:
        await self._session.rollback()
