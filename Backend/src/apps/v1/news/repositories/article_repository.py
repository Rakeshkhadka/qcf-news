"""
SQLAlchemy implementation of the Article repository.
"""
from typing import Optional

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from src.apps.v1.news.models.news import Article, ArticleImage
from src.apps.v1.news.repositories.interfaces import IArticleRepository
from src.utils.filter_and_sort import apply_search

# What the single search box on the site and in the admin actually looks at.
# The body is included so a story is findable by a name that only appears in
# its text; markup is part of that column, so very short terms can match tags.
ARTICLE_SEARCH_COLUMNS = (Article.title, Article.summary, Article.content)


class ArticleRepository(IArticleRepository):
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_all(
        self,
        *,
        category_id: Optional[int] = None,
        is_published: Optional[bool] = None,
        search: Optional[str] = None,
        limit: int = 10,
        offset: int = 0,
    ) -> tuple[list[Article], int]:
        stmt = select(Article).options(selectinload(Article.images))

        if category_id is not None:
            stmt = stmt.where(Article.category_id == category_id)
        if is_published is not None:
            stmt = stmt.where(Article.is_published == is_published)
        stmt = apply_search(stmt, ARTICLE_SEARCH_COLUMNS, search)

        # Count query
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await self.session.execute(count_stmt)).scalar() or 0

        # Paginated results
        stmt = stmt.order_by(Article.created_at.desc()).limit(limit).offset(offset)
        result = await self.session.execute(stmt)

        return list(result.scalars().all()), total

    async def get_by_id(
        self, article_id: int, *, published_only: bool = False
    ) -> Optional[Article]:
        stmt = (
            select(Article)
            .options(selectinload(Article.images))
            .where(Article.id == article_id)
        )
        if published_only:
            stmt = stmt.where(Article.is_published.is_(True))
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_by_slug(
        self, slug: str, *, published_only: bool = False
    ) -> Optional[Article]:
        stmt = (
            select(Article)
            .options(selectinload(Article.images))
            .where(Article.slug == slug)
        )
        if published_only:
            stmt = stmt.where(Article.is_published.is_(True))
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def create(self, article: Article) -> int:
        self.session.add(article)
        await self.session.flush()
        await self.session.refresh(article)
        return article.id

    async def update(self, article_id: int, data: dict) -> None:
        clean = {k: v for k, v in data.items() if v is not None}
        if not clean:
            return
        stmt = update(Article).where(Article.id == article_id).values(**clean)
        await self.session.execute(stmt)

    async def delete(self, article_id: int, *, user_id: int) -> None:
        stmt = (
            update(Article)
            .where(Article.id == article_id)
            .values(is_deleted=True, updated_by=user_id)
        )
        await self.session.execute(stmt)

    async def replace_images(
        self, article_id: int, images: list[dict]
    ) -> list[ArticleImage]:
        """
        Swap an article's gallery for `images` (already ordered by the caller).

        Rows are hard-deleted rather than soft-deleted: a gallery entry has no
        life of its own once it is removed from the article. Deletes go through
        the ORM so an already-loaded `Article.images` collection stays coherent.
        """
        for existing in await self.get_images(article_id):
            await self.session.delete(existing)
        await self.session.flush()

        rows = [
            ArticleImage(
                article_id=article_id,
                image_url=img["image_url"],
                caption=img.get("caption"),
                alt_text=img.get("alt_text"),
                sort_order=idx,
            )
            for idx, img in enumerate(images)
        ]
        if rows:
            self.session.add_all(rows)
        await self.session.flush()
        return rows

    async def get_images(self, article_id: int) -> list[ArticleImage]:
        stmt = (
            select(ArticleImage)
            .where(ArticleImage.article_id == article_id)
            .order_by(ArticleImage.sort_order)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def bulk_update_publish_status(
        self, article_ids: list[int], is_published: bool, *, user_id: int
    ) -> int:
        if not article_ids:
            return 0
        stmt = (
            update(Article)
            .where(Article.id.in_(article_ids), Article.is_deleted == False)
            .values(is_published=is_published, updated_by=user_id)
        )
        result = await self.session.execute(stmt)
        return result.rowcount
