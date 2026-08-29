"""
Dependency Injector container.

This is the single source of truth for all service wiring.
Each UoW gets the session_factory, each service gets its UoW.
"""
from dependency_injector import containers, providers

from src.apps.v1.newsletter.services.subscription_service import (
    SubscriptionService,
)
from src.apps.v1.newsletter.unit_of_work.newsletter_uow import (
    NewsletterSqlAlchemyUnitOfWork,
)
from src.apps.v1.news.services.article_service import ArticleService
from src.apps.v1.news.services.category_service import CategoryService
from src.apps.v1.news.unit_of_work.news_uow import NewsSqlAlchemyUnitOfWork
from src.apps.v1.users.services.permission_service import RoleAndPermissionService
from src.apps.v1.users.services.user_service import UserService
from src.apps.v1.users.unit_of_work.permission_uow import RolePermissionSqlAlchemyUoW
from src.apps.v1.users.unit_of_work.user_uow import UserSqlAlchemyUnitOfWork
from src.db.session import SessionLocal
from src.shared.context import UserContext
from src.utils.cache.client import RedisClient
from src.utils.cache.service import CacheService
from src.utils.mailer import build_mailer
from src.utils.storage import LocalImageStorage


class Container(containers.DeclarativeContainer):
    wiring_config = containers.WiringConfiguration()

    # ── Infrastructure ────────────────────────────────────────────────────

    session_factory = providers.Object(SessionLocal)
    user_context = providers.Singleton(UserContext)
    redis_client = providers.Singleton(RedisClient)
    cache_service = providers.Factory(CacheService, redis_client=redis_client)
    image_storage = providers.Singleton(LocalImageStorage)
    # Resolved lazily: `build_mailer` raises when nothing can send, and a
    # deployment with the newsletter switched off must still boot.
    mailer = providers.Singleton(build_mailer)

    # ── Users ─────────────────────────────────────────────────────────────

    user_uow = providers.Factory(
        UserSqlAlchemyUnitOfWork,
        session_factory=session_factory,
    )
    user_service = providers.Factory(
        UserService,
        uow_factory=user_uow,
    )

    # ── Roles & Permissions (RBAC/ABAC) ───────────────────────────────────

    permission_uow = providers.Factory(
        RolePermissionSqlAlchemyUoW,
        session_factory=session_factory,
    )
    permission_service = providers.Factory(
        RoleAndPermissionService,
        uow=permission_uow,
    )

    # ── News ──────────────────────────────────────────────────────────────

    news_uow = providers.Factory(
        NewsSqlAlchemyUnitOfWork,
        session_factory=session_factory,
    )
    category_service = providers.Factory(
        CategoryService,
        uow=news_uow,
    )
    article_service = providers.Factory(
        ArticleService,
        uow=news_uow,
        cache=cache_service,
    )

    # ── Newsletter ────────────────────────────────────────────────────────

    newsletter_uow = providers.Factory(
        NewsletterSqlAlchemyUnitOfWork,
        session_factory=session_factory,
    )
    subscription_service = providers.Factory(
        SubscriptionService,
        uow=newsletter_uow,
        mailer=mailer,
    )
