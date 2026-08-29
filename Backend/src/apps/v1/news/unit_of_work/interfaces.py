"""
Abstract Unit of Work interface for the News aggregate.
"""
from abc import ABC, abstractmethod
from typing import Any

from src.apps.v1.news.repositories.interfaces import (
    IArticleRepository,
    ICategoryRepository,
)


class INewsUnitOfWork(ABC):
    category_repository: ICategoryRepository
    article_repository: IArticleRepository

    async def commit(self) -> None:
        await self._commit()

    @abstractmethod
    async def __aenter__(self) -> "INewsUnitOfWork":
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
