"""
Global permission registry.

Aggregates all module-level permission definitions into a single list
consumed by the permission seeder script.
"""
from src.apps.v1.users.permissions import (
    ARTICLE_PERMISSIONS,
    CATEGORY_PERMISSIONS,
    NEWSLETTER_PERMISSIONS,
    ROLE_AND_PERMISSION_PERMISSIONS,
    USER_PERMISSIONS,
)

ALL_PERMISSIONS = (
    ARTICLE_PERMISSIONS
    + CATEGORY_PERMISSIONS
    + NEWSLETTER_PERMISSIONS
    + USER_PERMISSIONS
    + ROLE_AND_PERMISSION_PERMISSIONS
)
