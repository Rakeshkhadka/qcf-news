"""Cache behaviour for the public article-detail-by-slug endpoint."""
import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from src.apps.v1.news.services.article_service import (
    ARTICLE_SLUG_CACHE_PREFIX,
    ArticleService,
)


def _article(article_id: int = 1, slug: str = "big-story"):
    """A stand-in with every attribute `ArticleOutput` reads."""
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return SimpleNamespace(
        id=article_id,
        title="Big Story",
        slug=slug,
        summary="A summary",
        content="<p>Body</p>",
        cover_image_url=None,
        images=[],
        is_published=True,
        is_featured=False,
        category_id=1,
        author_id=1,
        created_at=now,
        updated_at=now,
        created_by=1,
        updated_by=1,
    )


class _FakeCache:
    """Mirrors CacheService, including its JSON round-trip."""

    def __init__(self):
        self.store: dict[str, str] = {}
        self.gets: list[str] = []

    async def get(self, key):
        self.gets.append(key)
        raw = self.store.get(key)
        return json.loads(raw) if raw else None

    async def set(self, key, value, ttl=300):
        self.store[key] = json.dumps(value, default=str)

    async def delete(self, key):
        self.store.pop(key, None)

    async def delete_pattern(self, pattern):
        prefix = pattern.rstrip("*")
        doomed = [k for k in self.store if k.startswith(prefix)]
        for key in doomed:
            del self.store[key]
        return len(doomed)

    async def scan_keys(self, pattern):
        prefix = pattern.rstrip("*")
        return [k for k in self.store if k.startswith(prefix)]


class _ArticleRepository:
    def __init__(self, article=None):
        self.article = article
        self.slug_lookups = 0

    async def get_by_slug(self, slug, **kwargs):
        self.slug_lookups += 1
        return self.article if self.article and self.article.slug == slug else None

    async def get_by_id(self, article_id, **kwargs):
        return self.article

    async def update(self, article_id, data):
        for key, value in data.items():
            setattr(self.article, key, value)

    async def delete(self, article_id, *, user_id):
        self.article = None

    async def replace_images(self, article_id, images):
        return []

    async def bulk_update_publish_status(self, article_ids, is_published, *, user_id):
        return len(article_ids)


class _UnitOfWork:
    def __init__(self, repository):
        self.article_repository = repository

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        return False


def _body(response):
    return json.loads(response.body)["data"]


class ArticleSlugCacheTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.article = _article()
        self.repository = _ArticleRepository(self.article)
        self.cache = _FakeCache()
        self.service = ArticleService(_UnitOfWork(self.repository), cache=self.cache)

    async def test_second_read_is_served_without_reloading_the_article(self):
        await self.service.get_article_by_slug("big-story")
        await self.service.get_article_by_slug("big-story")

        self.assertEqual(self.repository.slug_lookups, 1)

    async def test_drafts_are_neither_read_from_nor_written_to_cache(self):
        await self.service.get_article_by_slug("big-story", include_unpublished=True)

        self.assertEqual(self.cache.store, {})
        self.assertEqual(self.cache.gets, [])

    async def test_editorial_read_cannot_poison_the_public_entry(self):
        self.article.is_published = False
        await self.service.get_article_by_slug("big-story", include_unpublished=True)

        self.repository.article = None  # the draft is not publicly visible
        with self.assertRaises(Exception):
            await self.service.get_article_by_slug("big-story")

    async def test_missing_article_is_not_cached(self):
        with self.assertRaises(Exception):
            await self.service.get_article_by_slug("does-not-exist")

        self.assertEqual(self.cache.store, {})

    async def test_update_evicts_the_cached_payload(self):
        await self.service.get_article_by_slug("big-story")
        self.assertIn(f"{ARTICLE_SLUG_CACHE_PREFIX}big-story", self.cache.store)

        await self._update(title="Rewritten")

        self.assertEqual(self.cache.store, {})

    async def test_renaming_a_slug_evicts_the_old_key_too(self):
        await self.service.get_article_by_slug("big-story")

        await self._update(slug="bigger-story")

        self.assertNotIn(f"{ARTICLE_SLUG_CACHE_PREFIX}big-story", self.cache.store)

    async def test_delete_evicts_the_cached_payload(self):
        await self.service.get_article_by_slug("big-story")

        await self.service.delete_article(1, user_id=1)

        self.assertEqual(self.cache.store, {})

    async def test_bulk_publish_sweeps_detail_keys(self):
        await self.service.get_article_by_slug("big-story")

        await self.service.bulk_publish_articles(
            SimpleNamespace(article_ids=[1], is_published=False), user_id=1
        )

        self.assertEqual(self.cache.store, {})

    async def test_service_works_without_a_cache(self):
        service = ArticleService(_UnitOfWork(self.repository))

        response = await service.get_article_by_slug("big-story")

        self.assertEqual(_body(response)["slug"], "big-story")

    async def _update(self, **changes):
        payload = SimpleNamespace(
            images=None,
            model_dump=lambda **kwargs: dict(changes),
        )
        await self.service.update_article(1, payload, user_id=1)


if __name__ == "__main__":
    unittest.main()
