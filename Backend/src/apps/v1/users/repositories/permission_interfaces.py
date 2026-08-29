"""
Abstract repository interfaces for Permission and Role aggregates.

Clean interfaces without the mobileriz 'seen' tracking set — that
pattern was unnecessary overhead for async SQLAlchemy.
"""
from abc import ABC, abstractmethod
from typing import Optional

from src.apps.v1.users.models.role_and_perm import (
    Permission,
    Role,
    UserPermissionOverride,
)


class IPermissionRepository(ABC):
    """Read/write contract for Permission entities."""

    @abstractmethod
    async def add(self, permission: Permission) -> None:
        ...

    @abstractmethod
    async def get_by_id(self, permission_id: int) -> Optional[Permission]:
        ...

    @abstractmethod
    async def get_by_code(self, code: str) -> Optional[Permission]:
        ...

    @abstractmethod
    async def get_all(
        self, query_params: dict | None = None
    ) -> tuple[list[Permission], int]:
        ...

    @abstractmethod
    async def upsert_by_code(
        self, code: str, name: str, module: str
    ) -> Permission:
        ...

    # ── User Permission Overrides ─────────────────────────────────────────

    @abstractmethod
    async def set_override(self, override: UserPermissionOverride) -> None:
        ...

    @abstractmethod
    async def get_overrides_for_user(
        self, user_id: int
    ) -> list[UserPermissionOverride]:
        ...

    @abstractmethod
    async def delete_override(self, user_id: int, permission_id: int) -> None:
        ...


class IRoleRepository(ABC):
    """Read/write contract for Role entities."""

    @abstractmethod
    async def add(self, role: Role) -> None:
        ...

    @abstractmethod
    async def get_by_id(self, role_id: int) -> Optional[Role]:
        ...

    @abstractmethod
    async def get_by_name(self, name: str) -> Optional[Role]:
        ...

    @abstractmethod
    async def get_with_permissions(self, role_id: int) -> Optional[Role]:
        ...

    @abstractmethod
    async def list_roles(
        self, query_params: dict | None = None
    ) -> tuple[list[Role], int]:
        ...

    @abstractmethod
    async def add_user_to_role(self, user_id: int, role_id: int) -> None:
        ...

    @abstractmethod
    async def remove_user_from_role(self, user_id: int, role_id: int) -> None:
        ...

    @abstractmethod
    async def get_users_by_role(
        self, role_id: int, query_params: dict | None = None
    ) -> tuple[list, int]:
        ...

    @abstractmethod
    async def delete_role(self, role_id: int) -> None:
        ...
