"""
Abstract repository interfaces for the News domain.
"""
from abc import ABC, abstractmethod
from typing import Optional

from src.apps.v1.news.models.news import Article, ArticleImage, Category


class ICategoryRepository(ABC):
    @abstractmethod
    async def get_all(
        self,
        *,
        include_inactive: bool = False,
        search: Optional[str] = None,
        limit: int = 10,
        offset: int = 0,
    ) -> tuple[list[Category], int]:
        ...

    @abstractmethod
    async def get_by_id(self, category_id: int) -> Optional[Category]:
        ...

    @abstractmethod
    async def get_by_slug(self, slug: str) -> Optional[Category]:
        ...

    @abstractmethod
    async def create(self, category: Category) -> int:
        ...

    @abstractmethod
    async def update(self, category_id: int, data: dict) -> None:
        ...

    @abstractmethod
    async def delete(self, category_id: int, *, user_id: int) -> None:
        ...


class IArticleRepository(ABC):
    @abstractmethod
    async def get_all(
        self,
        *,
        category_id: Optional[int] = None,
        is_published: Optional[bool] = None,
        search: Optional[str] = None,
        limit: int = 10,
        offset: int = 0,
    ) -> tuple[list[Article], int]:
        """Returns (articles, total_count). `search` matches title/summary/body."""
        ...

    @abstractmethod
    async def get_by_id(
        self, article_id: int, *, published_only: bool = False
    ) -> Optional[Article]:
        ...

    @abstractmethod
    async def get_by_slug(
        self, slug: str, *, published_only: bool = False
    ) -> Optional[Article]:
        ...

    @abstractmethod
    async def create(self, article: Article) -> int:
        ...

    @abstractmethod
    async def update(self, article_id: int, data: dict) -> None:
        ...

    @abstractmethod
    async def delete(self, article_id: int, *, user_id: int) -> None:
        ...

    @abstractmethod
    async def replace_images(
        self, article_id: int, images: list[dict]
    ) -> list[ArticleImage]:
        """Replace the article's gallery with `images`, ordered as given."""
        ...

    @abstractmethod
    async def get_images(self, article_id: int) -> list[ArticleImage]:
        ...

    @abstractmethod
    async def bulk_update_publish_status(
        self, article_ids: list[int], is_published: bool, *, user_id: int
    ) -> int:
        """Set is_published for multiple articles. Returns count updated."""
        ...
