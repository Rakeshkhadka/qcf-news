"""
Article service — business logic for news articles.
"""
from typing import Optional

from fastapi import status

from src.apps.v1.news.models.news import Article
from src.apps.v1.news.schemas.news import (
    ArticleCreate,
    ArticleImageInput,
    ArticleListOutput,
    ArticleOutput,
    ArticleUpdate,
    BulkPublishRequest,
)
from src.apps.v1.news.unit_of_work.interfaces import INewsUnitOfWork
from src.utils.cache.service import CacheService
from src.utils.exceptions import AlreadyExistsException, NotFoundException
from src.utils.response import ResponseSuccess

# Story pages are the hot read on a news site and their body changes rarely, so
# the rendered detail payload is cached by slug. The TTL is deliberately short:
# it caps how long a story can be stale if an invalidation is ever missed.
ARTICLE_SLUG_CACHE_PREFIX = "article:slug:"
ARTICLE_DETAIL_TTL = 300  # seconds


def _slug_cache_key(slug: str) -> str:
    return f"{ARTICLE_SLUG_CACHE_PREFIX}{slug}"


class ArticleService:
    def __init__(self, uow: INewsUnitOfWork, cache: Optional[CacheService] = None):
        self.uow = uow
        # Optional so the service stays constructible without Redis (tests, and
        # any caller that wants the uncached path).
        self.cache = cache

    async def _invalidate_slugs(self, *slugs: Optional[str]) -> None:
        """
        Drop cached detail payloads. Always call this *after* the unit of work
        has committed: busting the key while the write is still uncommitted
        lets a concurrent reader repopulate it from the pre-write row.
        """
        if self.cache is None:
            return
        for slug in {s for s in slugs if s}:
            await self.cache.delete(_slug_cache_key(slug))

    @staticmethod
    def _normalize_images(images: list[ArticleImageInput]) -> list[dict]:
        """
        Drop blank URLs, de-duplicate, and order by the client-supplied
        `sort_order` so the carousel renders in the intended sequence.
        """
        ordered = sorted(
            (img for img in images if img.image_url and img.image_url.strip()),
            key=lambda img: img.sort_order,
        )
        seen: set[str] = set()
        result: list[dict] = []
        for img in ordered:
            url = img.image_url.strip()
            if url in seen:
                continue
            seen.add(url)
            result.append(
                {
                    "image_url": url,
                    "caption": img.caption,
                    "alt_text": img.alt_text,
                }
            )
        return result

    @staticmethod
    def _resolve_cover(
        cover_image_url: Optional[str], images: list[dict]
    ) -> Optional[str]:
        """Fall back to the first gallery image when no cover was given."""
        if cover_image_url and cover_image_url.strip():
            return cover_image_url.strip()
        return images[0]["image_url"] if images else None

    async def list_articles(
        self,
        *,
        category_id: Optional[int] = None,
        is_published: Optional[bool] = None,
        search: Optional[str] = None,
        limit: int = 10,
        offset: int = 0,
        include_unpublished: bool = False,
    ):
        # An anonymous request cannot override this with
        # ``?is_published=false``.  Editorial callers retain the ability to
        # list drafts or all stories.
        visible_published = is_published if include_unpublished else True
        async with self.uow as uow:
            articles, total = await uow.article_repository.get_all(
                category_id=category_id,
                is_published=visible_published,
                search=search,
                limit=limit,
                offset=offset,
            )
            data = [
                ArticleListOutput.model_validate(a).model_dump(mode="json")
                for a in articles
            ]

        return ResponseSuccess(
            message="Articles", data=data, total_count=total
        ).to_response()

    async def get_article(
        self,
        article_id: int,
        *,
        include_unpublished: bool = False,
    ):
        async with self.uow as uow:
            article = await uow.article_repository.get_by_id(
                article_id,
                published_only=not include_unpublished,
            )
            if not article:
                raise NotFoundException(detail="Article not found")
            data = ArticleOutput.model_validate(article).model_dump(mode="json")

        return ResponseSuccess(message="Article detail", data=data).to_response()

    async def get_article_by_slug(self, slug: str, *, include_unpublished: bool = False):
        # Drafts are never cached. A single key per slug would otherwise let an
        # editorial read populate the entry that anonymous readers are served,
        # publishing the story early.
        use_cache = self.cache is not None and not include_unpublished

        if use_cache:
            cached = await self.cache.get(_slug_cache_key(slug))
            if cached is not None:
                return ResponseSuccess(
                    message="Article detail", data=dict(cached)
                ).to_response()

        async with self.uow as uow:
            article = await uow.article_repository.get_by_slug(
                slug,
                published_only=not include_unpublished,
            )
            if not article:
                # Misses are not cached: a story published a moment from now
                # would otherwise keep 404ing for the rest of the TTL.
                raise NotFoundException(detail="Article not found")
            data = ArticleOutput.model_validate(article).model_dump(mode="json")

        if use_cache:
            await self.cache.set(
                _slug_cache_key(slug), data, ttl=ARTICLE_DETAIL_TTL
            )

        return ResponseSuccess(message="Article detail", data=data).to_response()

    async def create_article(self, payload: ArticleCreate, author_id: int):
        async with self.uow as uow:
            existing = await uow.article_repository.get_by_slug(payload.slug)
            if existing:
                raise AlreadyExistsException(detail="Article slug already exists")

            images = self._normalize_images(payload.images)
            article = Article(
                title=payload.title,
                slug=payload.slug,
                summary=payload.summary,
                content=payload.content,
                cover_image_url=self._resolve_cover(payload.cover_image_url, images),
                is_published=payload.is_published,
                is_featured=payload.is_featured,
                category_id=payload.category_id,
                author_id=author_id,
                created_by=author_id,
                updated_by=author_id,
            )
            article_id = await uow.article_repository.create(article)
            if images:
                await uow.article_repository.replace_images(article_id, images)

        return ResponseSuccess(
            message="Article created",
            data={"id": article_id},
            status_code=status.HTTP_201_CREATED,
        ).to_response()

    async def update_article(self, article_id: int, payload: ArticleUpdate, *, user_id: int):
        async with self.uow as uow:
            article = await uow.article_repository.get_by_id(article_id)
            if not article:
                raise NotFoundException(detail="Article not found")
            old_slug = article.slug

            data = payload.model_dump(exclude_unset=True)
            # `images` lives in its own table — pull it out of the column update.
            data.pop("images", None)
            data["updated_by"] = user_id

            if payload.images is not None:
                images = self._normalize_images(payload.images)
                await uow.article_repository.replace_images(article_id, images)

                # Keep the cover pointing at a real image: leave an explicitly
                # supplied cover alone, keep the existing one if it survived the
                # replacement, otherwise adopt the first gallery entry.
                if not (data.get("cover_image_url") or "").strip():
                    kept = (
                        article.cover_image_url
                        if _still_present(article.cover_image_url, images)
                        else None
                    )
                    cover = self._resolve_cover(kept, images)
                    if cover is None:
                        # `update()` ignores None values, so clear it on the
                        # loaded instance and let the UoW flush the change.
                        article.cover_image_url = None
                        data.pop("cover_image_url", None)
                    else:
                        data["cover_image_url"] = cover

            await uow.article_repository.update(article_id, data)

        # A rename leaves the old key serving a story that no longer answers to
        # that slug, so both the old and the new one are evicted.
        await self._invalidate_slugs(old_slug, data.get("slug"))

        return ResponseSuccess(
            message="Article updated", data={"id": article_id}
        ).to_response()

    async def delete_article(self, article_id: int, *, user_id: int):
        async with self.uow as uow:
            article = await uow.article_repository.get_by_id(article_id)
            if not article:
                raise NotFoundException(detail="Article not found")
            deleted_slug = article.slug
            await uow.article_repository.delete(article_id, user_id=user_id)

        await self._invalidate_slugs(deleted_slug)

        return ResponseSuccess(
            message="Article deleted", data={"id": article_id}
        ).to_response()

    async def bulk_publish_articles(self, payload: BulkPublishRequest, *, user_id: int):
        async with self.uow as uow:
            count = await uow.article_repository.bulk_update_publish_status(
                payload.article_ids,
                payload.is_published,
                user_id=user_id,
            )

        # The repository reports a row count, not the slugs it touched, and
        # unpublishing has to evict the story it just hid. Bulk publishing is a
        # rare editorial action, so sweeping the (small) detail keyspace is
        # cheaper than the query it would take to resolve those slugs.
        if self.cache is not None and count:
            await self.cache.delete_pattern(f"{ARTICLE_SLUG_CACHE_PREFIX}*")

        action = "published" if payload.is_published else "unpublished"
        return ResponseSuccess(
            message=f"{count} article(s) {action}",
            data={"updated_count": count},
        ).to_response()


def _still_present(cover_url: Optional[str], images: list[dict]) -> bool:
    """True when the current cover survived the gallery replacement."""
    if not cover_url:
        return False
    return any(img["image_url"] == cover_url for img in images)
