"""Regression tests for public-versus-editorial article visibility."""
import unittest

from src.apps.v1.news.routes.articles import _can_read_unpublished
from src.apps.v1.news.services.article_service import ArticleService
from src.utils.exceptions import NotFoundException


class _ArticleRepository:
    def __init__(self):
        self.list_args: dict | None = None
        self.by_id_args: dict | None = None
        self.by_slug_args: dict | None = None

    async def get_all(self, **kwargs):
        self.list_args = kwargs
        return [], 0

    async def get_by_id(self, article_id, **kwargs):
        self.by_id_args = {"article_id": article_id, **kwargs}
        return None

    async def get_by_slug(self, slug, **kwargs):
        self.by_slug_args = {"slug": slug, **kwargs}
        return None


class _UnitOfWork:
    def __init__(self, repository):
        self.article_repository = repository

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        return False


class _User:
    def __init__(self, can_read_articles: bool):
        self.can_read_articles = can_read_articles

    def has_permission(self, _permission):
        return self.can_read_articles


class ArticleVisibilityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.repository = _ArticleRepository()
        self.service = ArticleService(_UnitOfWork(self.repository))

    def test_only_editorial_readers_can_see_drafts(self):
        self.assertFalse(_can_read_unpublished(None))
        self.assertFalse(_can_read_unpublished(_User(False)))
        self.assertTrue(_can_read_unpublished(_User(True)))

    async def test_anonymous_list_always_uses_published_filter(self):
        await self.service.list_articles(is_published=False)

        self.assertIs(self.repository.list_args["is_published"], True)

    async def test_editorial_list_can_request_drafts(self):
        await self.service.list_articles(
            is_published=False,
            include_unpublished=True,
        )

        self.assertIs(self.repository.list_args["is_published"], False)

    async def test_anonymous_detail_lookups_use_published_filter(self):
        with self.assertRaises(NotFoundException):
            await self.service.get_article_by_slug("private-draft")
        with self.assertRaises(NotFoundException):
            await self.service.get_article(42)

        self.assertTrue(self.repository.by_slug_args["published_only"])
        self.assertTrue(self.repository.by_id_args["published_only"])

    async def test_editorial_detail_lookups_include_drafts(self):
        with self.assertRaises(NotFoundException):
            await self.service.get_article_by_slug(
                "private-draft",
                include_unpublished=True,
            )
        with self.assertRaises(NotFoundException):
            await self.service.get_article(42, include_unpublished=True)

        self.assertFalse(self.repository.by_slug_args["published_only"])
        self.assertFalse(self.repository.by_id_args["published_only"])
