"""
SQLAlchemy implementation of the newsletter subscriber repository.
"""
from typing import Optional

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from src.apps.v1.newsletter.models.subscriber import NewsletterSubscriber
from src.apps.v1.newsletter.repositories.interfaces import (
    INewsletterSubscriberRepository,
)
from src.utils.filter_and_sort import apply_search

SUBSCRIBER_SEARCH_COLUMNS = (NewsletterSubscriber.email,)


class NewsletterSubscriberRepository(INewsletterSubscriberRepository):
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_email(self, email: str) -> Optional[NewsletterSubscriber]:
        stmt = select(NewsletterSubscriber).where(
            NewsletterSubscriber.email == email
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_by_confirm_token_hash(
        self, token_hash: str
    ) -> Optional[NewsletterSubscriber]:
        stmt = select(NewsletterSubscriber).where(
            NewsletterSubscriber.confirm_token_hash == token_hash
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_by_id(self, subscriber_id: int) -> Optional[NewsletterSubscriber]:
        stmt = select(NewsletterSubscriber).where(
            NewsletterSubscriber.id == subscriber_id
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def add(self, subscriber: NewsletterSubscriber) -> int:
        self.session.add(subscriber)
        await self.session.flush()
        await self.session.refresh(subscriber)
        return subscriber.id

    async def get_all(
        self,
        *,
        status: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[NewsletterSubscriber], int]:
        stmt = select(NewsletterSubscriber)
        if status:
            stmt = stmt.where(NewsletterSubscriber.status == status)
        stmt = apply_search(stmt, SUBSCRIBER_SEARCH_COLUMNS, search)

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await self.session.execute(count_stmt)).scalar() or 0

        stmt = (
            stmt.order_by(NewsletterSubscriber.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all()), total

    async def delete(self, subscriber: NewsletterSubscriber) -> None:
        await self.session.delete(subscriber)
