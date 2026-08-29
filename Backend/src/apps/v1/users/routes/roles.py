"""
Role & Permission management API routes.

All endpoints are protected by their own permission codes,
enforced via the `require_permission` dependency.
"""
from dependency_injector.wiring import Provide, inject
from fastapi import APIRouter, Body, Depends, Path, Request

from src.apps.v1.users.permissions import PermissionCode
from src.apps.v1.users.schemas.role_and_permission import (
    AssignUsersToRoleInput,
    CreateRoleInput,
    OverrideUserPermissionInput,
    RemoveUsersFromRoleInput,
    UpdateRoleInput,
)
from src.apps.v1.users.services.permission_service import RoleAndPermissionService
from src.container import Container
from src.dependencies import require_permission

router = APIRouter()


# ── Role CRUD ─────────────────────────────────────────────────────────────────


@router.post("/")
@inject
async def create_role(
    data: CreateRoleInput,
    _=Depends(require_permission(PermissionCode.CREATE_ROLE)),
    service: RoleAndPermissionService = Depends(
        Provide[Container.permission_service]
    ),
):
    return await service.create_role(data)


@router.get("/")
@inject
async def list_roles(
    request: Request,
    _=Depends(require_permission(PermissionCode.READ_ROLE)),
    service: RoleAndPermissionService = Depends(
        Provide[Container.permission_service]
    ),
):
    return await service.list_roles(dict(request.query_params))


@router.get("/{role_id}")
@inject
async def get_role_permissions(
    role_id: int = Path(...),
    _=Depends(require_permission(PermissionCode.READ_ROLE_PERMISSIONS)),
    service: RoleAndPermissionService = Depends(
        Provide[Container.permission_service]
    ),
):
    return await service.get_role_permissions(role_id)


@router.put("/{role_id}")
@inject
async def update_role(
    data: UpdateRoleInput,
    role_id: int = Path(...),
    _=Depends(require_permission(PermissionCode.UPDATE_ROLE)),
    service: RoleAndPermissionService = Depends(
        Provide[Container.permission_service]
    ),
):
    return await service.update_role(role_id, data)


@router.delete("/{role_id}")
@inject
async def delete_role(
    role_id: int = Path(...),
    _=Depends(require_permission(PermissionCode.DELETE_ROLE)),
    service: RoleAndPermissionService = Depends(
        Provide[Container.permission_service]
    ),
):
    return await service.delete_role(role_id)


# ── User ↔ Role Assignment ───────────────────────────────────────────────────


@router.post("/{role_id}/assign-users")
@inject
async def assign_users_to_role(
    data: AssignUsersToRoleInput,
    role_id: int = Path(...),
    _=Depends(require_permission(PermissionCode.ASSIGN_USER_TO_ROLE)),
    service: RoleAndPermissionService = Depends(
        Provide[Container.permission_service]
    ),
):
    return await service.assign_users_to_role(role_id, data)


@router.post("/{role_id}/remove-users")
@inject
async def remove_users_from_role(
    data: RemoveUsersFromRoleInput,
    role_id: int = Path(...),
    _=Depends(require_permission(PermissionCode.ASSIGN_USER_TO_ROLE)),
    service: RoleAndPermissionService = Depends(
        Provide[Container.permission_service]
    ),
):
    return await service.remove_users_from_role(role_id, data)


@router.get("/{role_id}/users")
@inject
async def list_users_by_role(
    request: Request,
    role_id: int = Path(...),
    _=Depends(require_permission(PermissionCode.READ_ROLE)),
    service: RoleAndPermissionService = Depends(
        Provide[Container.permission_service]
    ),
):
    return await service.list_users_by_role(role_id, dict(request.query_params))


# ── Permissions Listing ───────────────────────────────────────────────────────


@router.get("/permissions/all")
@inject
async def list_permissions(
    request: Request,
    _=Depends(require_permission(PermissionCode.READ_PERMISSIONS)),
    service: RoleAndPermissionService = Depends(
        Provide[Container.permission_service]
    ),
):
    return await service.list_permissions(dict(request.query_params))


# ── User-Level Permission Overrides (ABAC) ────────────────────────────────────


@router.post("/user-overrides")
@inject
async def set_user_override(
    data: OverrideUserPermissionInput,
    _=Depends(require_permission(PermissionCode.OVERRIDE_USER_PERMISSION)),
    service: RoleAndPermissionService = Depends(
        Provide[Container.permission_service]
    ),
):
    return await service.set_user_permission_override(data)


@router.get("/user-overrides/{user_id}")
@inject
async def get_user_overrides(
    user_id: int = Path(...),
    _=Depends(require_permission(PermissionCode.READ_USER_OVERRIDES)),
    service: RoleAndPermissionService = Depends(
        Provide[Container.permission_service]
    ),
):
    return await service.get_user_permission_overrides(user_id)


@router.delete("/user-overrides/{user_id}/permission/{permission_id}")
@inject
async def delete_user_override(
    user_id: int = Path(...),
    permission_id: int = Path(...),
    _=Depends(require_permission(PermissionCode.DELETE_USER_OVERRIDE)),
    service: RoleAndPermissionService = Depends(
        Provide[Container.permission_service]
    ),
):
    return await service.delete_user_permission_override(user_id, permission_id)
