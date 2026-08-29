"""
Abstract repository interface for the Newsletter domain.
"""
from abc import ABC, abstractmethod
from typing import Optional

from src.apps.v1.newsletter.models.subscriber import NewsletterSubscriber


class INewsletterSubscriberRepository(ABC):
    @abstractmethod
    async def get_by_email(self, email: str) -> Optional[NewsletterSubscriber]:
        ...

    @abstractmethod
    async def get_by_confirm_token_hash(
        self, token_hash: str
    ) -> Optional[NewsletterSubscriber]:
        ...

    @abstractmethod
    async def get_by_id(self, subscriber_id: int) -> Optional[NewsletterSubscriber]:
        ...

    @abstractmethod
    async def add(self, subscriber: NewsletterSubscriber) -> int:
        ...

    @abstractmethod
    async def get_all(
        self,
        *,
        status: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[NewsletterSubscriber], int]:
        """Returns (subscribers, total_count), newest signup first."""
        ...

    @abstractmethod
    async def delete(self, subscriber: NewsletterSubscriber) -> None:
        """
        Erase the row outright.

        A hard delete, unlike everywhere else in this codebase: a request to be
        forgotten is not answered by a hidden row.  See the model docstring.
        """
        ...
