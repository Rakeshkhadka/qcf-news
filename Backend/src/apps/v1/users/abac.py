"""
ABAC (Attribute-Based Access Control) policy engine.

Provides a lightweight, extensible way to define attribute-based conditions
that run *after* the RBAC check. This is an upgrade over the mobileriz
reference which had ABAC models commented out and unused.

Usage in routes:
    from src.apps.v1.users.abac import abac_check, is_owner

    @router.put("/{article_id}")
    async def update_article(
        article_id: int,
        current_user=Depends(require_permission(PermissionCode.UPDATE_ARTICLE)),
        service=Depends(...),
    ):
        article = await service.get_article_raw(article_id)
        abac_check(current_user, article, [is_owner])
        ...

Design notes:
  • Each policy is a simple callable: (user, resource) → bool
  • Policies compose via `abac_check` (all must pass) or `abac_check_any`
  • Superusers bypass all ABAC checks automatically
"""
from typing import Any, Callable

from src.utils.exceptions import ForbiddenException

# Type alias for an ABAC policy function
AbacPolicy = Callable[[Any, Any], bool]


def abac_check(
    user: Any,
    resource: Any,
    policies: list[AbacPolicy],
    *,
    message: str = "Access denied by attribute policy",
) -> None:
    """
    Evaluate ALL policies. Raises ForbiddenException if any fails.

    Superusers bypass all checks.
    """
    if getattr(user, "is_superuser", False):
        return

    for policy in policies:
        if not policy(user, resource):
            raise ForbiddenException(detail=message)


def abac_check_any(
    user: Any,
    resource: Any,
    policies: list[AbacPolicy],
    *,
    message: str = "Access denied by attribute policy",
) -> None:
    """
    Evaluate policies. Passes if ANY policy returns True.

    Superusers bypass all checks.
    """
    if getattr(user, "is_superuser", False):
        return

    if not any(policy(user, resource) for policy in policies):
        raise ForbiddenException(detail=message)


# ── Built-in Policies ────────────────────────────────────────────────────────


def is_owner(user: Any, resource: Any) -> bool:
    """Check if the user is the owner/author of the resource."""
    author_id = getattr(resource, "author_id", None) or getattr(
        resource, "created_by", None
    )
    return author_id is not None and author_id == getattr(user, "id", None)


def is_active_user(user: Any, _resource: Any) -> bool:
    """Check if the user account is active."""
    return getattr(user, "is_active", False)


def is_email_verified(user: Any, _resource: Any) -> bool:
    """Check if the user's email is verified."""
    return getattr(user, "is_email_verified", False)


def is_published_resource(_user: Any, resource: Any) -> bool:
    """Check if the resource is in a published state."""
    return getattr(resource, "is_published", False)


def make_field_equals_policy(field: str, expected: Any) -> AbacPolicy:
    """
    Factory: creates a policy that checks resource.field == expected.

    Usage:
        is_draft = make_field_equals_policy("status", "draft")
    """
    def _policy(_user: Any, resource: Any) -> bool:
        return getattr(resource, field, None) == expected

    _policy.__name__ = f"field_{field}_equals_{expected}"
    return _policy
