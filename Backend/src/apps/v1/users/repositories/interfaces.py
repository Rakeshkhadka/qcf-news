"""
Abstract repository interface for the User aggregate.

All repository implementations must satisfy this contract,
enabling easy swapping for tests (in-memory) or different ORMs.
"""
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from src.apps.v1.users.models.users import RefreshSession, User
from src.apps.v1.users.schemas.users import UserCreate, UserOutput, UserWithPassword


class IUserRepository(ABC):
    """Read/write contract for the User aggregate root."""

    @abstractmethod
    async def get_by_email(self, email: str) -> Optional[UserOutput]:
        ...

    @abstractmethod
    async def get_by_id(self, user_id: int) -> Optional[UserWithPassword]:
        ...

    @abstractmethod
    async def create(self, user_data: UserCreate) -> int:
        ...

    @abstractmethod
    async def update_password(self, user_id: int, hashed_password: str) -> None:
        ...

    @abstractmethod
    async def verify_email(self, email: str) -> None:
        ...

    @abstractmethod
    async def update_profile(
        self, user_id: int, first_name: str, last_name: str
    ) -> None:
        ...

    @abstractmethod
    async def get_all(
        self, query_params: Optional[dict] = None
    ) -> tuple[list[User], int]:
        """List users with filtering, free-text search, ordering and paging."""
        ...

    @abstractmethod
    async def get_with_permissions(self, user_id: int) -> Optional[User]:
        """Load a User with all roles, permissions, and overrides eagerly."""
        ...


class IRefreshSessionRepository(ABC):
    """Contract for refresh-token session management."""

    @abstractmethod
    async def create_session(self, session: RefreshSession) -> None:
        ...

    @abstractmethod
    async def get_active_session(self, jti: str) -> Optional[RefreshSession]:
        ...

    @abstractmethod
    async def revoke_user_sessions(self, user_id: int) -> None:
        ...
