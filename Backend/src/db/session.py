"""
Async SQLAlchemy engine, session factory, and FastAPI dependency.

Key design decisions:
  - Custom AsyncSession subclass that converts `delete()` to soft-delete
    for models using SoftDeleteMixin.
  - Separate engine factory for test isolation (NullPool when TESTING=1).
  - A context-manager-based `db_lifespan` for proper pool cleanup.
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from sqlalchemy import NullPool
from sqlalchemy.ext.asyncio import (
    AsyncSession as _AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import sessionmaker

from src.config.settings import settings
from src.db.base import SoftDeleteMixin


class AsyncSession(_AsyncSession):
    """
    Custom session that transparently converts `session.delete(obj)`
    into a soft-delete when the model uses SoftDeleteMixin.
    """

    async def delete(self, instance):
        if isinstance(instance, SoftDeleteMixin):
            instance.is_deleted = True
            self.add(instance)
        else:
            await super().delete(instance)


# Pool sizing is env-tunable because it multiplies in a way that is easy to
# miss: every gunicorn worker imports this module AND runs db_lifespan, so a
# worker holds TWO pools, and the host sees
#     workers x 2 x (DB_POOL_SIZE + DB_MAX_OVERFLOW)
# connections at full stretch.  At the previous hard-coded 10 + 20 that is 120
# connections for 2 workers — past PostgreSQL's default max_connections of 100,
# and roughly 5-10 MB of server memory each.  Keep the product under the
# database's max_connections with room to spare.
DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "10"))
DB_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "20"))


def _make_engine(
    *,
    pool_size: int = DB_POOL_SIZE,
    max_overflow: int = DB_MAX_OVERFLOW,
):
    """Build an async engine with sensible pool defaults."""
    if os.getenv("TESTING") == "1":
        return create_async_engine(
            settings.async_database_url,
            poolclass=NullPool,
            pool_pre_ping=True,
        )
    return create_async_engine(
        settings.async_database_url,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_pre_ping=True,
        pool_recycle=1800,
    )


engine = _make_engine()

# Used by the DI container — each call returns a *new* session instance.
SessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


@asynccontextmanager
async def db_lifespan(app: FastAPI):
    """
    Manage engine lifetime alongside the ASGI application.
    Attach the sessionmaker to `app.state` for middleware / deps.
    """
    eng = _make_engine()
    app.state.engine = eng
    app.state.async_sessionmaker = async_sessionmaker(
        eng, class_=AsyncSession, expire_on_commit=False
    )
    try:
        yield
    finally:
        await eng.dispose()


async def get_session(request: Request):
    """FastAPI dependency that yields a session from the lifespan engine."""
    maker = request.app.state.async_sessionmaker
    async with maker() as session:
        yield session
