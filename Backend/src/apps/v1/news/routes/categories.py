"""
Category API routes.

Read endpoints are public; write endpoints require specific permissions.
"""
from typing import Optional

from dependency_injector.wiring import Provide, inject
from fastapi import APIRouter, Depends, Query

from src.apps.v1.news.schemas.news import CategoryCreate, CategoryUpdate
from src.apps.v1.news.services.category_service import CategoryService
from src.apps.v1.users.permissions import PermissionCode
from src.container import Container
from src.dependencies import require_permission

router = APIRouter()


@router.get("/")
@inject
async def list_categories(
    search: Optional[str] = Query(
        None,
        max_length=200,
        description="Free-text match on name, slug and description.",
    ),
    limit: int = Query(10, ge=1, le=20),
    offset: int = Query(0, ge=0),
    service: CategoryService = Depends(Provide[Container.category_service]),
):
    return await service.list_categories(search=search, limit=limit, offset=offset)


@router.get("/{category_id}")
@inject
async def get_category(
    category_id: int,
    service: CategoryService = Depends(Provide[Container.category_service]),
):
    return await service.get_category(category_id)


@router.post("/")
@inject
async def create_category(
    payload: CategoryCreate,
    current_user=Depends(require_permission(PermissionCode.CREATE_CATEGORY)),
    service: CategoryService = Depends(Provide[Container.category_service]),
):
    return await service.create_category(payload, user_id=current_user.id)


@router.put("/{category_id}")
@inject
async def update_category(
    category_id: int,
    payload: CategoryUpdate,
    current_user=Depends(require_permission(PermissionCode.UPDATE_CATEGORY)),
    service: CategoryService = Depends(Provide[Container.category_service]),
):
    return await service.update_category(category_id, payload, user_id=current_user.id)


@router.delete("/{category_id}")
@inject
async def delete_category(
    category_id: int,
    current_user=Depends(require_permission(PermissionCode.DELETE_CATEGORY)),
    service: CategoryService = Depends(Provide[Container.category_service]),
):
    return await service.delete_category(category_id, user_id=current_user.id)

