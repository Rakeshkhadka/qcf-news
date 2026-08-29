"""
SQLAlchemy implementation of the RefreshSession repository.
"""
from typing import Optional

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from src.apps.v1.users.models.users import RefreshSession
from src.apps.v1.users.repositories.interfaces import IRefreshSessionRepository


class RefreshSessionRepository(IRefreshSessionRepository):
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_session(self, refresh_session: RefreshSession) -> None:
        self.session.add(refresh_session)
        await self.session.flush()

    async def get_active_session(self, jti: str) -> Optional[RefreshSession]:
        stmt = select(RefreshSession).where(
            RefreshSession.jti == jti,
            RefreshSession.revoked.is_(False),
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def revoke_user_sessions(self, user_id: int) -> None:
        stmt = (
            update(RefreshSession)
            .where(
                RefreshSession.user_id == user_id,
                RefreshSession.revoked.is_(False),
            )
            .values(revoked=True)
        )
        await self.session.execute(stmt)
