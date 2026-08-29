"""
Pydantic schemas for Role & Permission management.
"""
from pydantic import BaseModel, Field


class CreateRoleInput(BaseModel):
    """Payload for creating a role with permissions."""

    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    permission_ids: list[int] = []


class UpdateRoleInput(BaseModel):
    """Payload for updating an existing role."""

    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    permission_ids: list[int] = []


class AssignUsersToRoleInput(BaseModel):
    """Payload for assigning users to a role."""

    user_ids: list[int] = Field(..., min_length=1)


class RemoveUsersFromRoleInput(BaseModel):
    """Payload for removing users from a role."""

    user_ids: list[int] = Field(..., min_length=1)


class OverrideUserPermissionInput(BaseModel):
    """Payload for setting a user-level permission override."""

    user_id: int
    permission_id: int
    is_allowed: bool


class PermissionOutput(BaseModel):
    """Response schema for a single permission."""

    id: int
    name: str
    code: str
    module: str

    model_config = {"from_attributes": True}


class RoleOutput(BaseModel):
    """Response schema for a role with its permissions."""

    id: int
    name: str
    description: str | None = None
    permissions: list[PermissionOutput] = []

    model_config = {"from_attributes": True}


class UserOverrideOutput(BaseModel):
    """Response schema for a user-level permission override."""

    permission_id: int
    permission_code: str
    permission_name: str
    is_allowed: bool
