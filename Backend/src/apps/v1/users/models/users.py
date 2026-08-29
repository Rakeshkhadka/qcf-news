"""
User domain model.

Extended with RBAC relationships and a `has_permission()` method
that evaluates both role-based grants and user-level overrides.
"""
from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.orm import relationship

from src.db.base import Base, TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    password = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    is_email_verified = Column(Boolean, default=False, nullable=False)
    is_superuser = Column(Boolean, default=False, nullable=False)
    last_login = Column(DateTime(timezone=True), nullable=True)

    # ── RBAC Relationships ────────────────────────────────────────────────
    user_roles = relationship(
        "UserRole",
        back_populates="user",
        cascade="all, delete-orphan",
        overlaps="roles",
    )
    roles = relationship(
        "Role",
        secondary="user_roles",
        back_populates="users",
        overlaps="user_roles,role",
    )
    permission_overrides = relationship(
        "UserPermissionOverride",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    def has_permission(self, code: str) -> bool:
        """
        Check if the user has a specific permission code.

        Resolution order (ABAC override takes precedence over RBAC):
          1. Superusers always have all permissions.
          2. Check user-level overrides — explicit grant/deny.
          3. Fall back to role-based permissions.

        Uses set-based lookups for O(1) average-case performance,
        an improvement over the mobileriz list-iteration approach.
        """
        if self.is_superuser:
            return True

        # Check ABAC overrides first (explicit grant/deny)
        override_map = {
            ov.permission.code: ov.is_allowed
            for ov in self.permission_overrides
            if ov.permission is not None
        }
        if code in override_map:
            return override_map[code]

        # Fall back to RBAC: collect all permission codes from all roles
        role_codes = {
            perm.code
            for role in self.roles
            for perm in role.permissions
        }
        return code in role_codes


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    jti = Column(String, unique=True, nullable=False, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    revoked = Column(Boolean, default=False, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
