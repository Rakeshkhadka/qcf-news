"""
Article API routes.

Anonymous reads expose published stories only. Editorial users with
``ART.READ`` may also retrieve drafts; write endpoints require their own
specific permissions.
"""
from typing import Optional

from dependency_injector.wiring import Provide, inject
from fastapi import APIRouter, Depends, Query

from src.apps.v1.news.schemas.news import ArticleCreate, ArticleUpdate, BulkPublishRequest
from src.apps.v1.news.services.article_service import ArticleService
from src.apps.v1.users.permissions import PermissionCode
from src.container import Container
from src.dependencies import get_optional_current_user, require_permission

router = APIRouter()


def _can_read_unpublished(current_user) -> bool:
    """
    Drafts are visible only to an authenticated editorial reader — knowing a
    draft's id or slug is not itself an authorisation to read it.
    """
    return bool(
        current_user
        and current_user.has_permission(PermissionCode.READ_ARTICLE)
    )


async def can_read_unpublished(
    current_user=Depends(get_optional_current_user),
) -> bool:
    return _can_read_unpublished(current_user)


@router.get("/")
@inject
async def list_articles(
    category_id: Optional[int] = Query(None),
    is_published: Optional[bool] = Query(None),
    search: Optional[str] = Query(
        None,
        max_length=200,
        description="Free-text match on title, summary and body.",
    ),
    limit: int = Query(10, ge=1, le=20),
    offset: int = Query(0, ge=0),
    include_unpublished: bool = Depends(can_read_unpublished),
    service: ArticleService = Depends(Provide[Container.article_service]),
):
    return await service.list_articles(
        category_id=category_id,
        is_published=is_published,
        search=search,
        limit=limit,
        offset=offset,
        include_unpublished=include_unpublished,
    )


@router.post("/bulk-publish")
@inject
async def bulk_publish_articles(
    payload: BulkPublishRequest,
    current_user=Depends(require_permission(PermissionCode.PUBLISH_ARTICLE)),
    service: ArticleService = Depends(Provide[Container.article_service]),
):
    return await service.bulk_publish_articles(payload, user_id=current_user.id)


@router.get("/by-slug/{slug}")
@inject
async def get_article_by_slug(
    slug: str,
    include_unpublished: bool = Depends(can_read_unpublished),
    service: ArticleService = Depends(Provide[Container.article_service]),
):
    return await service.get_article_by_slug(
        slug,
        include_unpublished=include_unpublished,
    )


@router.get("/{article_id}")
@inject
async def get_article(
    article_id: int,
    include_unpublished: bool = Depends(can_read_unpublished),
    service: ArticleService = Depends(Provide[Container.article_service]),
):
    return await service.get_article(
        article_id,
        include_unpublished=include_unpublished,
    )


@router.post("/")
@inject
async def create_article(
    payload: ArticleCreate,
    current_user=Depends(require_permission(PermissionCode.CREATE_ARTICLE)),
    service: ArticleService = Depends(Provide[Container.article_service]),
):
    return await service.create_article(payload, author_id=current_user.id)


@router.put("/{article_id}")
@inject
async def update_article(
    article_id: int,
    payload: ArticleUpdate,
    current_user=Depends(require_permission(PermissionCode.UPDATE_ARTICLE)),
    service: ArticleService = Depends(Provide[Container.article_service]),
):
    return await service.update_article(article_id, payload, user_id=current_user.id)


@router.delete("/{article_id}")
@inject
async def delete_article(
    article_id: int,
    current_user=Depends(require_permission(PermissionCode.DELETE_ARTICLE)),
    service: ArticleService = Depends(Provide[Container.article_service]),
):
    return await service.delete_article(article_id, user_id=current_user.id)
