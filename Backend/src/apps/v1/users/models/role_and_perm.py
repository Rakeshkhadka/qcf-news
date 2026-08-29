"""
RBAC + ABAC domain models.

Implements the full permission hierarchy:
  User ─►  UserRole  ─►  Role  ─►  RolePermission  ─►  Permission
  User ─►  UserPermissionOverride  ─►  Permission  (ABAC-style per-user overrides)

Key improvements over the mobileriz reference:
  • Longer permission codes (20 chars) for hierarchical naming like "ART.CRT"
  • Composite unique constraints prevent duplicate assignments
  • TimestampMixin on Role for auditability
  • Module column indexed for grouped permission queries
"""
from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from src.db.base import Base, TimestampMixin


class Role(Base, TimestampMixin):
    """A named role scoped globally (news platform has no multi-tenancy)."""

    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(String(500), nullable=True)

    # ── Relationships ─────────────────────────────────────────────────────
    role_permissions = relationship(
        "RolePermission",
        back_populates="role",
        cascade="all, delete-orphan",
        overlaps="permissions",
    )
    permissions = relationship(
        "Permission",
        secondary="role_permissions",
        back_populates="roles",
        overlaps="role_permissions",
    )
    user_roles = relationship(
        "UserRole",
        back_populates="role",
        cascade="all, delete-orphan",
        overlaps="users",
    )
    users = relationship(
        "User",
        secondary="user_roles",
        back_populates="roles",
        overlaps="user_roles,user",
    )


class Permission(Base):
    """
    A single, code-identified permission.

    `code`   — short hierarchical token, e.g. "ART.CRT" (module.action)
    `module` — grouping key for UI display, e.g. "articles"
    """

    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    code = Column(String(20), unique=True, nullable=False, index=True)
    module = Column(String(100), nullable=False, index=True)

    # ── Relationships ─────────────────────────────────────────────────────
    role_permissions = relationship("RolePermission", back_populates="permission")
    roles = relationship(
        "Role",
        secondary="role_permissions",
        back_populates="permissions",
        overlaps="role_permissions",
    )
    overrides = relationship("UserPermissionOverride", back_populates="permission")


class RolePermission(Base):
    """Join table: which permissions belong to which role."""

    __tablename__ = "role_permissions"

    role_id = Column(
        Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id = Column(
        Integer, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True
    )

    role = relationship(
        "Role",
        back_populates="role_permissions",
        overlaps="permissions,roles",
    )
    permission = relationship(
        "Permission",
        back_populates="role_permissions",
        overlaps="permissions,roles",
    )


class UserRole(Base):
    """Join table: which users belong to which role."""

    __tablename__ = "user_roles"

    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role_id = Column(
        Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )

    user = relationship("User", back_populates="user_roles", overlaps="roles,users")
    role = relationship("Role", back_populates="user_roles", overlaps="users,roles")


class UserPermissionOverride(Base):
    """
    ABAC-style per-user permission override.

    If `is_allowed=True`  → grants the permission even if no role has it.
    If `is_allowed=False` → revokes the permission even if a role grants it.

    Overrides always take precedence over role-based grants.
    """

    __tablename__ = "user_permission_overrides"

    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id = Column(
        Integer, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True
    )
    is_allowed = Column(Boolean, default=True, nullable=False)

    user = relationship("User", back_populates="permission_overrides")
    permission = relationship("Permission", back_populates="overrides")
