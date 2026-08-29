"""
SQLAlchemy declarative base and reusable model mixins.

All domain models should inherit from `Base` (or one of the abstract models)
so that Alembic auto-generate can discover them.
"""
import re
from datetime import datetime, timezone

import inflect
from sqlalchemy import Boolean, Column, DateTime, Integer, String, text
from sqlalchemy.ext.declarative import as_declarative, declared_attr
from sqlalchemy.orm import Mapped, mapped_column

_inflector = inflect.engine()


def _camel_to_snake_plural(name: str) -> str:
    """Convert CamelCase class name to snake_case plural table name."""
    snake = re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
    return _inflector.plural(snake)


@as_declarative()
class Base:
    """Declarative base with auto-generated table names."""

    id: int
    __name__: str

    @declared_attr
    def __tablename__(cls) -> str:
        return _camel_to_snake_plural(cls.__name__)


def utc_now() -> datetime:
    """Return timezone-aware UTC now."""
    return datetime.now(timezone.utc)


# ── Mixins ────────────────────────────────────────────────────────────────────


class TimestampMixin:
    """Adds created_at / updated_at / created_by / updated_by columns."""

    created_at = Column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
    created_by = Column(Integer, nullable=True)
    updated_by = Column(Integer, nullable=True)


class SoftDeleteMixin:
    """
    Adds an `is_deleted` boolean for soft-delete support.
    The global ORM event in `src/shared/audit.py` filters these out
    from normal queries automatically.
    """

    is_deleted: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )


class NameMixin:
    """Adds a unique `name` column."""

    name = Column(String(255), nullable=False, unique=True)


# ── Abstract Base Models ──────────────────────────────────────────────────────


class BaseModel(Base, TimestampMixin, SoftDeleteMixin):
    """Abstract base with timestamps + soft-delete (no name column)."""

    __abstract__ = True
    id = Column(Integer, primary_key=True, index=True)


class NamedBaseModel(BaseModel, NameMixin):
    """Abstract base with timestamps + soft-delete + unique name."""

    __abstract__ = True
