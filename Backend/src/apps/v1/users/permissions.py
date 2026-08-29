"""
Permission code registry.

Every permission in the system is declared here as a `PermissionCode` enum
and grouped into `PermissionDef` lists by module.

Codes use a hierarchical scheme:  MODULE_PREFIX.ACTION
  e.g. "ART.CRT" = Articles → Create

This file is the single source of truth for the permission seeder.
"""
from dataclasses import dataclass
from enum import Enum


class PermissionCode(str, Enum):
    """All permission codes used across the application."""

    # ── Articles ──────────────────────────────────────────────────────────
    CREATE_ARTICLE = "ART.CRT"
    READ_ARTICLE = "ART.READ"
    UPDATE_ARTICLE = "ART.UPD"
    DELETE_ARTICLE = "ART.DEL"
    PUBLISH_ARTICLE = "ART.PUB"

    # ── Categories ────────────────────────────────────────────────────────
    CREATE_CATEGORY = "CAT.CRT"
    READ_CATEGORY = "CAT.READ"
    UPDATE_CATEGORY = "CAT.UPD"
    DELETE_CATEGORY = "CAT.DEL"

    # ── Newsletter ────────────────────────────────────────────────────────
    READ_SUBSCRIBERS = "SUB.READ"
    DELETE_SUBSCRIBER = "SUB.DEL"

    # ── Users ─────────────────────────────────────────────────────────────
    READ_USERS = "USR.READ"
    UPDATE_USERS = "USR.UPD"
    DELETE_USERS = "USR.DEL"

    # ── Roles & Permissions ───────────────────────────────────────────────
    CREATE_ROLE = "ROLE.CRT"
    READ_ROLE = "ROLE.READ"
    UPDATE_ROLE = "ROLE.UPD"
    DELETE_ROLE = "ROLE.DEL"
    ASSIGN_USER_TO_ROLE = "ROLE.ASG"
    READ_ROLE_PERMISSIONS = "ROLE.RDP"
    READ_PERMISSIONS = "PERM.READ"

    # ── User-Level Permission Overrides (ABAC) ────────────────────────────
    OVERRIDE_USER_PERMISSION = "UPO.CRT"
    READ_USER_OVERRIDES = "UPO.READ"
    DELETE_USER_OVERRIDE = "UPO.DEL"


# ── Module names ──────────────────────────────────────────────────────────────

M_ARTICLES = "articles"
M_CATEGORIES = "categories"
M_NEWSLETTER = "newsletter"
M_USERS = "users"
M_ROLES = "roles_and_permissions"


# ── Permission definitions ────────────────────────────────────────────────────


@dataclass(frozen=True)
class PermissionDef:
    """Immutable descriptor used by the seed script to upsert permissions."""

    name: str
    code: PermissionCode
    module: str


ARTICLE_PERMISSIONS = [
    PermissionDef("Create Article", PermissionCode.CREATE_ARTICLE, M_ARTICLES),
    PermissionDef("Read Article", PermissionCode.READ_ARTICLE, M_ARTICLES),
    PermissionDef("Update Article", PermissionCode.UPDATE_ARTICLE, M_ARTICLES),
    PermissionDef("Delete Article", PermissionCode.DELETE_ARTICLE, M_ARTICLES),
    PermissionDef("Publish Article", PermissionCode.PUBLISH_ARTICLE, M_ARTICLES),
]

CATEGORY_PERMISSIONS = [
    PermissionDef("Create Category", PermissionCode.CREATE_CATEGORY, M_CATEGORIES),
    PermissionDef("Read Category", PermissionCode.READ_CATEGORY, M_CATEGORIES),
    PermissionDef("Update Category", PermissionCode.UPDATE_CATEGORY, M_CATEGORIES),
    PermissionDef("Delete Category", PermissionCode.DELETE_CATEGORY, M_CATEGORIES),
]

NEWSLETTER_PERMISSIONS = [
    PermissionDef(
        "Read Newsletter Subscribers", PermissionCode.READ_SUBSCRIBERS, M_NEWSLETTER
    ),
    # Deleting a subscriber erases the consent record outright, which is why it
    # is a permission of its own rather than part of the read grant.
    PermissionDef(
        "Delete Newsletter Subscriber", PermissionCode.DELETE_SUBSCRIBER, M_NEWSLETTER
    ),
]

USER_PERMISSIONS = [
    PermissionDef("Read Users", PermissionCode.READ_USERS, M_USERS),
    PermissionDef("Update Users", PermissionCode.UPDATE_USERS, M_USERS),
    PermissionDef("Delete Users", PermissionCode.DELETE_USERS, M_USERS),
]

ROLE_AND_PERMISSION_PERMISSIONS = [
    PermissionDef("Create Role", PermissionCode.CREATE_ROLE, M_ROLES),
    PermissionDef("Read Roles", PermissionCode.READ_ROLE, M_ROLES),
    PermissionDef("Update Role", PermissionCode.UPDATE_ROLE, M_ROLES),
    PermissionDef("Delete Role", PermissionCode.DELETE_ROLE, M_ROLES),
    PermissionDef("Assign User to Role", PermissionCode.ASSIGN_USER_TO_ROLE, M_ROLES),
    PermissionDef(
        "Read Role Permissions", PermissionCode.READ_ROLE_PERMISSIONS, M_ROLES
    ),
    PermissionDef("Read All Permissions", PermissionCode.READ_PERMISSIONS, M_ROLES),
    PermissionDef(
        "Override User Permission", PermissionCode.OVERRIDE_USER_PERMISSION, M_ROLES
    ),
    PermissionDef("Read User Overrides", PermissionCode.READ_USER_OVERRIDES, M_ROLES),
    PermissionDef(
        "Delete User Override", PermissionCode.DELETE_USER_OVERRIDE, M_ROLES
    ),
]
