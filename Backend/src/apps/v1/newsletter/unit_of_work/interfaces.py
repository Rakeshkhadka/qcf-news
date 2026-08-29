"""
Abstract Unit of Work interface for the Newsletter aggregate.
"""
from abc import ABC, abstractmethod
from typing import Any

from src.apps.v1.newsletter.repositories.interfaces import (
    INewsletterSubscriberRepository,
)


class INewsletterUnitOfWork(ABC):
    subscriber_repository: INewsletterSubscriberRepository

    async def commit(self) -> None:
        await self._commit()

    @abstractmethod
    async def __aenter__(self) -> "INewsletterUnitOfWork":
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
