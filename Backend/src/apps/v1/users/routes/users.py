"""
User API routes.

Uses dependency-injector wiring to resolve the UserService
from the DI container automatically.
"""
from dependency_injector.wiring import Provide, inject
from fastapi import APIRouter, Body, Depends, Request
from fastapi.security import OAuth2PasswordRequestForm

from src.apps.v1.users.permissions import PermissionCode
from src.apps.v1.users.schemas.users import (
    ChangePassword,
    UserCreate,
    UserLogin,
    UserUpdate,
)
from src.apps.v1.users.services.user_service import UserService
from src.container import Container
from src.dependencies import get_current_user, require_permission

router = APIRouter()


@router.post("/register")
@inject
async def register(
    user_data: UserCreate,
    service: UserService = Depends(Provide[Container.user_service]),
):
    return await service.register(user_data)


@router.post("/login")
@inject
async def login(
    credentials: UserLogin,
    service: UserService = Depends(Provide[Container.user_service]),
):
    return await service.login(credentials)


@router.post("/token")
@inject
async def oauth_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    service: UserService = Depends(Provide[Container.user_service]),
):
    """OAuth2-compatible login used by Swagger UI's Authorize dialog."""
    tokens = await service.authenticate(
        UserLogin(email=form_data.username, password=form_data.password)
    )
    return {
        "access_token": tokens["access_token"],
        "token_type": "bearer",
        "refresh_token": tokens["refresh_token"],
        "user_id": tokens["user_id"],
    }


@router.post("/refresh-token")
@inject
async def refresh_token(
    refresh_token: str = Body(..., embed=True),
    service: UserService = Depends(Provide[Container.user_service]),
):
    return await service.refresh_token(refresh_token)


@router.post("/logout")
@inject
async def logout(
    current_user=Depends(get_current_user),
    service: UserService = Depends(Provide[Container.user_service]),
):
    return await service.logout(current_user.id)


@router.get("/")
@inject
async def list_users(
    request: Request,
    _=Depends(require_permission(PermissionCode.READ_USERS)),
    service: UserService = Depends(Provide[Container.user_service]),
):
    """
    Searchable user directory for the admin UI.

    Query params: `search` (email / first / last name), `page`, `page_size`,
    `ordering`.
    """
    return await service.list_users(dict(request.query_params))


@router.get("/me")
@inject
async def me(
    current_user=Depends(get_current_user),
    service: UserService = Depends(Provide[Container.user_service]),
):
    return await service.get_me(current_user.id)


@router.put("/profile")
@inject
async def update_profile(
    data: UserUpdate,
    current_user=Depends(get_current_user),
    service: UserService = Depends(Provide[Container.user_service]),
):
    return await service.update_profile(current_user.id, data)


@router.post("/change-password")
@inject
async def change_password(
    data: ChangePassword,
    current_user=Depends(get_current_user),
    service: UserService = Depends(Provide[Container.user_service]),
):
    return await service.change_password(current_user.id, data)
