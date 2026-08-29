"""
SQLAlchemy-based Unit of Work for the User aggregate.

Usage:
    async with UserSqlAlchemyUnitOfWork(session_factory) as uow:
        user_id = await uow.user_repository.create(user_data)
        await uow.refresh_session_repository.create_session(session)
        # auto-commits on exit; rolls back on exception
"""
from typing import Any, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from src.apps.v1.users.repositories.refresh_session_repository import (
    RefreshSessionRepository,
)
from src.apps.v1.users.repositories.user_repository import UserRepository
from src.apps.v1.users.unit_of_work.interfaces import IUserUnitOfWork


class UserSqlAlchemyUnitOfWork(IUserUnitOfWork):

    def __init__(self, session_factory: Callable[[], AsyncSession]):
        self._session_factory = session_factory
        self._session: AsyncSession | None = None
        self.user_repository: UserRepository | None = None
        self.refresh_session_repository: RefreshSessionRepository | None = None

    async def __aenter__(self) -> "UserSqlAlchemyUnitOfWork":
        self._session = self._session_factory()
        self.user_repository = UserRepository(self._session)
        self.refresh_session_repository = RefreshSessionRepository(self._session)
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
