"""
SQLAlchemy implementation of the User repository interface.
"""
from typing import Optional

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from src.apps.v1.users.filters import USER_FILTER_MAP, USER_ORDERING_MAP
from src.apps.v1.users.models.role_and_perm import Role, UserPermissionOverride
from src.apps.v1.users.models.users import User
from src.apps.v1.users.repositories.interfaces import IUserRepository
from src.apps.v1.users.schemas.users import UserCreate, UserOutput, UserWithPassword
from src.utils.filter_and_sort import (
    OrderingFilterMap,
    apply_filter_map_stmt,
    apply_pagination,
    apply_search,
)


class UserRepository(IUserRepository):
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_email(self, email: str) -> Optional[UserOutput]:
        stmt = select(User).where(User.email == email)
        result = await self.session.execute(stmt)
        user = result.scalars().first()
        return UserOutput.model_validate(user) if user else None

    async def get_by_id(self, user_id: int) -> Optional[UserWithPassword]:
        stmt = select(User).where(User.id == user_id)
        result = await self.session.execute(stmt)
        user = result.scalars().first()
        return UserWithPassword.model_validate(user) if user else None

    async def create(self, user_data) -> int:
        if isinstance(user_data, User):
            new_user = user_data
        else:
            new_user = User(
                email=user_data.email,
                password=user_data.password,
            )
        self.session.add(new_user)
        await self.session.flush()
        await self.session.refresh(new_user)
        return new_user.id

    async def update_password(self, user_id: int, hashed_password: str) -> None:
        stmt = (
            update(User)
            .where(User.id == user_id)
            .values(password=hashed_password)
        )
        await self.session.execute(stmt)

    async def verify_email(self, email: str) -> None:
        stmt = (
            update(User)
            .where(User.email == email)
            .values(is_email_verified=True)
        )
        await self.session.execute(stmt)

    async def update_profile(
        self, user_id: int, first_name: str, last_name: str
    ) -> None:
        stmt = (
            update(User)
            .where(User.id == user_id)
            .values(first_name=first_name, last_name=last_name)
        )
        await self.session.execute(stmt)

    async def get_all(
        self, query_params: dict | None = None
    ) -> tuple[list[User], int]:
        """
        List users for the admin directory, with their roles eagerly loaded.

        Supports a single free-text ``search`` box matching email, first and
        last name at once — the admin UI has no other way to find a user,
        since nobody memorises numeric IDs.
        """
        query_params = query_params or {}
        stmt = select(User)

        stmt = apply_filter_map_stmt(stmt, User, USER_FILTER_MAP, query_params)
        stmt = apply_search(
            stmt,
            [User.email, User.first_name, User.last_name],
            query_params.get("search"),
        )

        ordering = OrderingFilterMap(
            ordering_fields_map=USER_ORDERING_MAP,
            default_ordering=["email"],
        )
        stmt = ordering.apply_ordering(stmt, User, query_params)

        count_subq = stmt.subquery()
        total = await self.session.scalar(
            select(func.count()).select_from(count_subq)
        )

        page = int(query_params.get("page", 1))
        page_size = int(query_params.get("page_size", 20))
        stmt = apply_pagination(stmt, page, page_size).options(
            selectinload(User.roles)
        )

        result = await self.session.execute(stmt)
        return list(result.scalars().unique().all()), total or 0

    async def get_with_permissions(self, user_id: int) -> Optional[User]:
        """
        Load a User with ALL RBAC/ABAC data eagerly loaded in a single query.

        This is the optimized approach — loads everything needed for
        `User.has_permission()` without N+1 queries.
        """
        stmt = (
            select(User)
            .options(
                selectinload(User.roles).selectinload(Role.permissions),
                selectinload(User.permission_overrides).selectinload(
                    UserPermissionOverride.permission
                ),
            )
            .where(User.id == user_id)
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()
