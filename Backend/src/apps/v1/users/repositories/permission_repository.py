"""
SQLAlchemy implementations of the Permission and Role repository interfaces.
"""
from typing import Optional

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.apps.v1.users.filters import (
    PERMISSION_FILTER_MAP,
    PERMISSION_ORDERING_MAP,
    ROLE_FILTER_MAP,
    ROLE_ORDERING_MAP,
    USER_FILTER_MAP,
    USER_ORDERING_MAP,
)
from src.apps.v1.users.models.role_and_perm import (
    Permission,
    Role,
    UserPermissionOverride,
    UserRole,
)
from src.apps.v1.users.models.users import User
from src.apps.v1.users.repositories.permission_interfaces import (
    IPermissionRepository,
    IRoleRepository,
)
from src.utils.filter_and_sort import (
    OrderingFilterMap,
    apply_filter_map_stmt,
    apply_pagination,
)


class PermissionRepository(IPermissionRepository):
    def __init__(self, session: AsyncSession):
        self.session = session

    async def add(self, permission: Permission) -> None:
        self.session.add(permission)

    async def get_by_id(self, permission_id: int) -> Optional[Permission]:
        stmt = select(Permission).where(Permission.id == permission_id)
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_by_code(self, code: str) -> Optional[Permission]:
        stmt = select(Permission).where(Permission.code == code)
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_all(
        self, query_params: dict | None = None
    ) -> tuple[list[Permission], int]:
        query_params = query_params or {}
        stmt = select(Permission)

        stmt = apply_filter_map_stmt(
            stmt, Permission, PERMISSION_FILTER_MAP, query_params
        )
        ordering = OrderingFilterMap(ordering_fields_map=PERMISSION_ORDERING_MAP)
        stmt = ordering.apply_ordering(stmt, Permission, query_params)

        count_subq = stmt.subquery()
        total = await self.session.scalar(
            select(func.count()).select_from(count_subq)
        )

        page = int(query_params.get("page", 1))
        page_size = int(query_params.get("page_size", 50))
        stmt = apply_pagination(stmt, page, page_size)

        result = await self.session.execute(stmt)
        return result.scalars().all(), total or 0

    async def upsert_by_code(
        self, code: str, name: str, module: str
    ) -> Permission:
        existing = await self.get_by_code(code)
        if existing:
            existing.name = name
            existing.module = module
            return existing
        perm = Permission(name=name, code=code, module=module)
        self.session.add(perm)
        return perm

    # ── User Permission Overrides ─────────────────────────────────────────

    async def set_override(self, override: UserPermissionOverride) -> None:
        stmt = select(UserPermissionOverride).where(
            UserPermissionOverride.user_id == override.user_id,
            UserPermissionOverride.permission_id == override.permission_id,
        )
        result = await self.session.execute(stmt)
        existing = result.scalars().first()

        if existing:
            existing.is_allowed = override.is_allowed
        else:
            self.session.add(override)

    async def get_overrides_for_user(
        self, user_id: int
    ) -> list[UserPermissionOverride]:
        stmt = (
            select(UserPermissionOverride)
            .options(selectinload(UserPermissionOverride.permission))
            .where(UserPermissionOverride.user_id == user_id)
        )
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def delete_override(self, user_id: int, permission_id: int) -> None:
        stmt = (
            delete(UserPermissionOverride)
            .where(
                UserPermissionOverride.user_id == user_id,
                UserPermissionOverride.permission_id == permission_id,
            )
        )
        await self.session.execute(stmt)


class RoleRepository(IRoleRepository):
    def __init__(self, session: AsyncSession):
        self.session = session

    async def add(self, role: Role) -> None:
        self.session.add(role)

    async def get_by_id(self, role_id: int) -> Optional[Role]:
        stmt = (
            select(Role)
            .options(selectinload(Role.permissions))
            .where(Role.id == role_id)
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_by_name(self, name: str) -> Optional[Role]:
        stmt = select(Role).where(Role.name == name)
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_with_permissions(self, role_id: int) -> Optional[Role]:
        stmt = (
            select(Role)
            .options(selectinload(Role.permissions))
            .where(Role.id == role_id)
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def list_roles(
        self, query_params: dict | None = None
    ) -> tuple[list[Role], int]:
        query_params = query_params or {}
        stmt = select(Role)

        stmt = apply_filter_map_stmt(stmt, Role, ROLE_FILTER_MAP, query_params)
        ordering = OrderingFilterMap(ordering_fields_map=ROLE_ORDERING_MAP)
        stmt = ordering.apply_ordering(stmt, Role, query_params)

        count_subq = stmt.subquery()
        total = await self.session.scalar(
            select(func.count()).select_from(count_subq)
        )

        page = int(query_params.get("page", 1))
        page_size = int(query_params.get("page_size", 20))
        # Permissions are eager-loaded so callers can report what each role
        # grants without an extra round-trip per role.
        stmt = apply_pagination(stmt, page, page_size).options(
            selectinload(Role.permissions)
        )

        result = await self.session.execute(stmt)
        return list(result.scalars().unique().all()), total or 0

    async def add_user_to_role(self, user_id: int, role_id: int) -> None:
        stmt = select(UserRole).where(
            UserRole.user_id == user_id,
            UserRole.role_id == role_id,
        )
        result = await self.session.execute(stmt)
        if not result.scalars().first():
            self.session.add(UserRole(user_id=user_id, role_id=role_id))

    async def remove_user_from_role(self, user_id: int, role_id: int) -> None:
        stmt = delete(UserRole).where(
            UserRole.user_id == user_id,
            UserRole.role_id == role_id,
        )
        await self.session.execute(stmt)

    async def get_users_by_role(
        self, role_id: int, query_params: dict | None = None
    ) -> tuple[list, int]:
        query_params = query_params or {}
        stmt = select(User).join(UserRole).where(UserRole.role_id == role_id)

        stmt = apply_filter_map_stmt(stmt, User, USER_FILTER_MAP, query_params)
        ordering = OrderingFilterMap(
            ordering_param="ordering",
            ordering_fields_map=USER_ORDERING_MAP,
        )
        stmt = ordering.apply_ordering(stmt, User, query_params)

        count_subq = stmt.subquery()
        total = await self.session.scalar(
            select(func.count()).select_from(count_subq)
        )

        page = int(query_params.get("page", 1))
        page_size = int(query_params.get("page_size", 20))
        # Roles are eager-loaded so the admin UI can show every role a user
        # holds, not just the one being listed.
        stmt = apply_pagination(stmt, page, page_size).options(
            selectinload(User.roles)
        )

        result = await self.session.execute(stmt)
        return list(result.scalars().unique().all()), total or 0

    async def delete_role(self, role_id: int) -> None:
        role = await self.get_by_id(role_id)
        if role:
            await self.session.delete(role)
