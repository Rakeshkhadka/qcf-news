"""
FastAPI dependencies for authentication and authorization.

Provides:
  • get_current_user         — JWT auth, eagerly loads RBAC data
  • get_optional_current_user — same, but ``None`` when no token is sent
  • require_superuser        — superuser gate
  • require_permission(code) — single permission check (RBAC + ABAC overrides)
  • require_any(*codes)      — pass if user has ANY of the listed permissions
  • require_all(*codes)      — pass only if user has ALL listed permissions
"""
from dependency_injector.wiring import Provide, inject
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from src.apps.v1.users.models.users import User
from src.apps.v1.users.security import decode_access_token
from src.apps.v1.users.unit_of_work.interfaces import IUserUnitOfWork
from src.container import Container

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/users/token")
# Read endpoints need to work without a token, while still allowing authorised
# newsroom users to see drafts.  Unlike the required scheme above, this one
# returns ``None`` when the header is absent.  A supplied but invalid token is
# still rejected rather than silently treated as anonymous.
optional_oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/v1/users/token",
    auto_error=False,
)


async def _user_from_token(token: str, user_uow: IUserUnitOfWork) -> User:
    """
    Decode the JWT access token and resolve the current user
    **with all RBAC/ABAC data eagerly loaded**.

    This is the key upgrade over mobileriz: permissions are loaded
    once during auth, not lazily queried per-check.

    Raises 401 for any token that does not resolve to a live user.
    """
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    async with user_uow as uow:
        user = await uow.user_repository.get_with_permissions(user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    # Deactivation must revoke access immediately. Access tokens outlive the
    # click that disables an account, so the flag is re-read here on every
    # request rather than trusted from the token's claims.
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


@inject
async def get_current_user(
    token: str = Depends(oauth2_scheme),
    user_uow: IUserUnitOfWork = Depends(Provide[Container.user_uow]),
) -> User:
    """Resolve the bearer token of an authenticated-only endpoint."""
    return await _user_from_token(token, user_uow)


@inject
async def get_optional_current_user(
    token: str | None = Depends(optional_oauth2_scheme),
    user_uow: IUserUnitOfWork = Depends(Provide[Container.user_uow]),
) -> User | None:
    """Resolve a valid bearer token when present, otherwise return ``None``."""
    if token is None:
        return None
    return await _user_from_token(token, user_uow)


async def require_superuser(
    current_user=Depends(get_current_user),
):
    """Raises 403 if current user is not a superuser."""
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superuser privileges required",
        )
    return current_user


def require_permission(code: str):
    """
    FastAPI dependency factory: checks a single permission code.

    Usage:
        @router.post("/")
        async def create_article(
            current_user=Depends(require_permission(PermissionCode.CREATE_ARTICLE)),
        ):
            ...
    """

    async def _check(user: User = Depends(get_current_user)):
        if not user.has_permission(code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission '{code}' required",
            )
        return user

    return _check


def require_any(*codes: str):
    """
    FastAPI dependency factory: passes if the user has ANY of the listed permissions.

    Usage:
        Depends(require_any(PermissionCode.UPDATE_ARTICLE, PermissionCode.PUBLISH_ARTICLE))
    """

    async def _check(user: User = Depends(get_current_user)):
        if not any(user.has_permission(c) for c in codes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"One of permissions {list(codes)} required",
            )
        return user

    return _check


def require_all(*codes: str):
    """
    FastAPI dependency factory: passes only if the user has ALL listed permissions.

    Usage:
        Depends(require_all(PermissionCode.READ_ARTICLE, PermissionCode.PUBLISH_ARTICLE))
    """

    async def _check(user: User = Depends(get_current_user)):
        missing = [c for c in codes if not user.has_permission(c)]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permissions: {missing}",
            )
        return user

    return _check
