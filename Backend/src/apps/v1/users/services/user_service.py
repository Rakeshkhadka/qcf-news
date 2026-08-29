"""
User service — orchestrates business logic via UoW.

The service layer is the only place where business rules live.
Routes call services, services use UoW for transactional consistency.
"""
from fastapi import status

from src.apps.v1.users.models.users import RefreshSession, User
from src.apps.v1.users.schemas.users import (
    ChangePassword,
    UserCreate,
    UserLogin,
    UserUpdate,
)
from src.apps.v1.users.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    hash_password,
    verify_password,
)
from src.apps.v1.users.unit_of_work.interfaces import IUserUnitOfWork
from src.utils.exceptions import (
    AlreadyExistsException,
    ForbiddenException,
    InvalidDataException,
    NotFoundException,
    UnauthorizedException,
)
from src.utils.response import ResponseFailure, ResponseSuccess


class UserService:
    def __init__(self, uow_factory: IUserUnitOfWork):
        self.uow_factory = uow_factory

    async def _issue_tokens(self, uow, user_id: int) -> dict:
        """Revoke old refresh sessions and issue new token pair."""
        await uow.refresh_session_repository.revoke_user_sessions(user_id)

        refresh_data = create_refresh_token(user_id)
        await uow.refresh_session_repository.create_session(
            RefreshSession(
                user_id=user_id,
                jti=refresh_data["jti"],
                expires_at=refresh_data["expires_at"],
            )
        )
        await uow.commit()

        access_token = create_access_token(user_id)

        return {
            "access_token": access_token,
            "refresh_token": refresh_data["refresh_token"],
            "user_id": user_id,
        }

    async def register(self, user_data: UserCreate):
        async with self.uow_factory as uow:
            existing = await uow.user_repository.get_by_email(user_data.email)
            if existing:
                raise AlreadyExistsException(detail="User already exists")

            hashed = hash_password(user_data.password)
            new_user = User(email=user_data.email, password=hashed)
            user_id = await uow.user_repository.create(new_user)

        return ResponseSuccess(
            message="User registered successfully",
            data={"user_id": user_id},
            status_code=status.HTTP_201_CREATED,
        ).to_response()

    async def authenticate(self, credentials: UserLogin) -> dict:
        """Validate credentials and return a freshly issued token pair."""
        async with self.uow_factory as uow:
            user = await uow.user_repository.get_by_email(credentials.email)
            if not user:
                raise NotFoundException(detail="User not found")

            user_with_pw = await uow.user_repository.get_by_id(user.id)
            if not verify_password(credentials.password, user_with_pw.password):
                raise InvalidDataException(detail="Incorrect email or password")

            # Checked after the password so a wrong guess cannot be used to
            # probe which accounts exist and are disabled.
            if not user_with_pw.is_active:
                raise ForbiddenException(detail="User account is inactive")

            return await self._issue_tokens(uow, user.id)

    async def login(self, credentials: UserLogin):
        tokens = await self.authenticate(credentials)

        return ResponseSuccess(
            message="Login successful",
            data=tokens,
        ).to_response()

    async def refresh_token(self, refresh_token_str: str):
        payload = decode_refresh_token(refresh_token_str)
        if not payload:
            raise UnauthorizedException(detail="Invalid refresh token")

        async with self.uow_factory as uow:
            active = await uow.refresh_session_repository.get_active_session(
                payload["jti"]
            )
            if not active:
                raise UnauthorizedException(detail="Refresh token revoked or expired")

            # A refresh token outlives deactivation, so the account is
            # re-checked here; a disabled one loses its sessions outright
            # rather than being turned away once per hour.
            user = await uow.user_repository.get_by_id(payload["user_id"])
            if not user or not user.is_active:
                await uow.refresh_session_repository.revoke_user_sessions(
                    payload["user_id"]
                )
                await uow.commit()
                raise UnauthorizedException(detail="User account is inactive")

            tokens = await self._issue_tokens(uow, payload["user_id"])

        return ResponseSuccess(
            message="Token refreshed",
            data=tokens,
        ).to_response()

    async def logout(self, user_id: int):
        async with self.uow_factory as uow:
            await uow.refresh_session_repository.revoke_user_sessions(user_id)

        return ResponseSuccess(message="Logged out", data={}).to_response()

    async def change_password(self, user_id: int, data: ChangePassword):
        async with self.uow_factory as uow:
            user = await uow.user_repository.get_by_id(user_id)
            if not user:
                raise NotFoundException(detail="User not found")
            if not verify_password(data.old_password, user.password):
                raise InvalidDataException(detail="Incorrect old password")

            new_hash = hash_password(data.new_password)
            await uow.user_repository.update_password(user_id, new_hash)

        return ResponseSuccess(
            message="Password changed successfully",
            data={"user_id": user_id},
        ).to_response()

    async def update_profile(self, user_id: int, data: UserUpdate):
        async with self.uow_factory as uow:
            await uow.user_repository.update_profile(
                user_id, data.first_name, data.last_name
            )

        return ResponseSuccess(
            message="Profile updated",
            data={"user_id": user_id},
        ).to_response()

    async def list_users(self, query_params: dict | None = None):
        """
        Directory listing for the admin UI: every user with their roles, so an
        administrator can pick people by name or email instead of by ID.
        """
        async with self.uow_factory as uow:
            users, total = await uow.user_repository.get_all(query_params or {})
            data = [
                {
                    "id": u.id,
                    "email": u.email,
                    "first_name": u.first_name,
                    "last_name": u.last_name,
                    "is_active": u.is_active,
                    "is_email_verified": u.is_email_verified,
                    "is_superuser": u.is_superuser,
                    "roles": [
                        {"id": r.id, "name": r.name} for r in u.roles
                    ],
                }
                for u in users
            ]

        return ResponseSuccess(
            message="Users fetched successfully",
            data=data,
            total_count=total,
        ).to_response()

    async def get_me(self, user_id: int):
        async with self.uow_factory as uow:
            user = await uow.user_repository.get_by_id(user_id)
            if not user:
                raise NotFoundException(detail="User not found")

        return ResponseSuccess(
            message="User details",
            data={
                "id": user.id,
                "email": user.email,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "is_email_verified": user.is_email_verified,
                "is_superuser": user.is_superuser,
            },
        ).to_response()
