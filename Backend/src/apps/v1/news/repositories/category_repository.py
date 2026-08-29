"""
SQLAlchemy implementation of the Category repository.
"""
from typing import Optional

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from src.apps.v1.news.models.news import Category
from src.apps.v1.news.repositories.interfaces import ICategoryRepository
from src.utils.filter_and_sort import apply_search

CATEGORY_SEARCH_COLUMNS = (Category.name, Category.slug, Category.description)


class CategoryRepository(ICategoryRepository):
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_all(
        self,
        *,
        include_inactive: bool = False,
        search: Optional[str] = None,
        limit: int = 10,
        offset: int = 0,
    ) -> tuple[list[Category], int]:
        stmt = select(Category)
        if not include_inactive:
            stmt = stmt.where(Category.is_active.is_(True))
        stmt = apply_search(stmt, CATEGORY_SEARCH_COLUMNS, search)

        # Count query
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await self.session.execute(count_stmt)).scalar() or 0

        # Paginated results
        stmt = stmt.order_by(Category.name.asc()).limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        return list(result.scalars().all()), total

    async def get_by_id(self, category_id: int) -> Optional[Category]:
        stmt = select(Category).where(Category.id == category_id)
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_by_slug(self, slug: str) -> Optional[Category]:
        stmt = select(Category).where(Category.slug == slug)
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def create(self, category: Category) -> int:
        self.session.add(category)
        await self.session.flush()
        await self.session.refresh(category)
        return category.id

    async def update(self, category_id: int, data: dict) -> None:
        stmt = (
            update(Category)
            .where(Category.id == category_id)
            .values(**{k: v for k, v in data.items() if v is not None})
        )
        await self.session.execute(stmt)

    async def delete(self, category_id: int, *, user_id: int) -> None:
        stmt = (
            update(Category)
            .where(Category.id == category_id)
            .values(is_deleted=True, updated_by=user_id)
        )
        await self.session.execute(stmt)
