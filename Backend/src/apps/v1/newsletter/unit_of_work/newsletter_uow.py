"""
SQLAlchemy-based Unit of Work for the Newsletter aggregate.
"""
from typing import Any, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from src.apps.v1.newsletter.repositories.subscriber_repository import (
    NewsletterSubscriberRepository,
)
from src.apps.v1.newsletter.unit_of_work.interfaces import INewsletterUnitOfWork


class NewsletterSqlAlchemyUnitOfWork(INewsletterUnitOfWork):

    def __init__(self, session_factory: Callable[[], AsyncSession]):
        self._session_factory = session_factory
        self._session: AsyncSession | None = None
        self.subscriber_repository: NewsletterSubscriberRepository | None = None

    async def __aenter__(self) -> "NewsletterSqlAlchemyUnitOfWork":
        self._session = self._session_factory()
        self.subscriber_repository = NewsletterSubscriberRepository(self._session)
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
