"""
Service layer for Role & Permission management.

Orchestrates all RBAC/ABAC business logic through the Unit of Work.
"""
from fastapi import status

from src.apps.v1.users.models.role_and_perm import (
    Role,
    UserPermissionOverride,
)
from src.apps.v1.users.schemas.role_and_permission import (
    AssignUsersToRoleInput,
    CreateRoleInput,
    OverrideUserPermissionInput,
    RemoveUsersFromRoleInput,
    UpdateRoleInput,
)
from src.apps.v1.users.unit_of_work.permission_interfaces import (
    IRolePermissionUnitOfWork,
)
from src.utils.exceptions import (
    AlreadyExistsException,
    DomainException,
    ErrorCode,
    NotFoundException,
)
from src.utils.response import ResponseSuccess


class RoleAndPermissionService:
    def __init__(self, uow: IRolePermissionUnitOfWork):
        self.uow = uow

    # ── Role CRUD ─────────────────────────────────────────────────────────

    async def create_role(self, data: CreateRoleInput):
        async with self.uow as uow:
            existing = await uow.roles.get_by_name(data.name)
            if existing:
                raise AlreadyExistsException(detail="Role with this name already exists")

            # Validate and collect permissions
            permissions = []
            for pid in data.permission_ids:
                perm = await uow.permissions.get_by_id(pid)
                if not perm:
                    raise NotFoundException(detail=f"Permission ID {pid} not found")
                permissions.append(perm)

            new_role = Role(
                name=data.name,
                description=data.description,
                permissions=permissions,
            )
            await uow.roles.add(new_role)
            await uow._session.flush()

            return ResponseSuccess(
                message="Role created successfully",
                data={"id": new_role.id, "name": new_role.name},
                status_code=status.HTTP_201_CREATED,
            ).to_response()

    async def update_role(self, role_id: int, data: UpdateRoleInput):
        async with self.uow as uow:
            role = await uow.roles.get_by_id(role_id)
            if not role:
                raise NotFoundException(detail=f"Role ID {role_id} not found")

            # Check name uniqueness if changed
            if role.name != data.name:
                existing = await uow.roles.get_by_name(data.name)
                if existing:
                    raise AlreadyExistsException(
                        detail="Another role with this name already exists"
                    )

            role.name = data.name
            role.description = data.description

            # Replace permissions
            new_permissions = []
            for pid in data.permission_ids:
                perm = await uow.permissions.get_by_id(pid)
                if not perm:
                    raise NotFoundException(detail=f"Permission ID {pid} not found")
                new_permissions.append(perm)

            role.permissions.clear()
            role.permissions.extend(new_permissions)

            return ResponseSuccess(
                message="Role updated successfully",
                data={"id": role.id, "name": role.name},
            ).to_response()

    async def delete_role(self, role_id: int):
        async with self.uow as uow:
            role = await uow.roles.get_by_id(role_id)
            if not role:
                raise NotFoundException(detail=f"Role ID {role_id} not found")

            await uow.roles.delete_role(role_id)

            return ResponseSuccess(
                message="Role deleted successfully",
                data={"id": role_id},
            ).to_response()

    async def list_roles(self, query_params: dict):
        async with self.uow as uow:
            roles, total = await uow.roles.list_roles(query_params)
            data = [
                {
                    "id": r.id,
                    "name": r.name,
                    "description": r.description,
                    "permissions": [
                        {
                            "id": p.id,
                            "name": p.name,
                            "code": p.code,
                            "module": p.module,
                        }
                        for p in r.permissions
                    ],
                }
                for r in roles
            ]
            return ResponseSuccess(
                message="Roles fetched successfully",
                data=data,
                total_count=total,
            ).to_response()

    async def get_role_permissions(self, role_id: int):
        async with self.uow as uow:
            role = await uow.roles.get_with_permissions(role_id)
            if not role:
                raise NotFoundException(detail=f"Role ID {role_id} not found")

            data = {
                "id": role.id,
                "name": role.name,
                "description": role.description,
                "permissions": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "code": p.code,
                        "module": p.module,
                    }
                    for p in role.permissions
                ],
            }
            return ResponseSuccess(
                message="Role permissions fetched",
                data=data,
            ).to_response()

    # ── User ↔ Role Assignment ────────────────────────────────────────────

    async def assign_users_to_role(self, role_id: int, data: AssignUsersToRoleInput):
        async with self.uow as uow:
            role = await uow.roles.get_by_id(role_id)
            if not role:
                raise NotFoundException(detail=f"Role ID {role_id} not found")

            for uid in data.user_ids:
                await uow.roles.add_user_to_role(uid, role_id)
            await uow.commit()

            return ResponseSuccess(
                message="Users assigned to role successfully",
                data={"role_id": role_id, "user_ids": data.user_ids},
            ).to_response()

    async def remove_users_from_role(
        self, role_id: int, data: RemoveUsersFromRoleInput
    ):
        async with self.uow as uow:
            role = await uow.roles.get_by_id(role_id)
            if not role:
                raise NotFoundException(detail=f"Role ID {role_id} not found")

            for uid in data.user_ids:
                await uow.roles.remove_user_from_role(uid, role_id)
            await uow.commit()

            return ResponseSuccess(
                message="Users removed from role successfully",
                data={"role_id": role_id, "user_ids": data.user_ids},
            ).to_response()

    async def list_users_by_role(self, role_id: int, query_params: dict):
        async with self.uow as uow:
            users, total = await uow.roles.get_users_by_role(role_id, query_params)
            data = [
                {
                    "id": u.id,
                    "first_name": u.first_name,
                    "last_name": u.last_name,
                    "email": u.email,
                    "is_active": u.is_active,
                    "is_email_verified": u.is_email_verified,
                    "is_superuser": u.is_superuser,
                    "roles": [{"id": r.id, "name": r.name} for r in u.roles],
                }
                for u in users
            ]
            return ResponseSuccess(
                message="Users fetched successfully",
                data=data,
                total_count=total,
            ).to_response()

    # ── Permissions listing ───────────────────────────────────────────────

    async def list_permissions(self, query_params: dict):
        async with self.uow as uow:
            permissions, total = await uow.permissions.get_all(query_params)
            data = [
                {
                    "id": p.id,
                    "name": p.name,
                    "code": p.code,
                    "module": p.module,
                }
                for p in permissions
            ]
            return ResponseSuccess(
                message="Permissions fetched successfully",
                data=data,
                total_count=total,
            ).to_response()

    # ── User-Level Permission Overrides (ABAC) ────────────────────────────

    async def set_user_permission_override(self, data: OverrideUserPermissionInput):
        async with self.uow as uow:
            perm = await uow.permissions.get_by_id(data.permission_id)
            if not perm:
                raise NotFoundException(
                    detail=f"Permission ID {data.permission_id} not found"
                )

            override = UserPermissionOverride(
                user_id=data.user_id,
                permission_id=data.permission_id,
                is_allowed=data.is_allowed,
            )
            await uow.permissions.set_override(override)
            await uow.commit()

            return ResponseSuccess(
                message="User permission override set successfully",
                data={
                    "user_id": data.user_id,
                    "permission_id": data.permission_id,
                    "is_allowed": data.is_allowed,
                },
            ).to_response()

    async def get_user_permission_overrides(self, user_id: int):
        async with self.uow as uow:
            overrides = await uow.permissions.get_overrides_for_user(user_id)
            data = [
                {
                    "permission_id": o.permission.id,
                    "permission_code": o.permission.code,
                    "permission_name": o.permission.name,
                    "is_allowed": o.is_allowed,
                }
                for o in overrides
            ]
            return ResponseSuccess(
                message="User permission overrides fetched",
                data=data,
            ).to_response()

    async def delete_user_permission_override(self, user_id: int, permission_id: int):
        async with self.uow as uow:
            await uow.permissions.delete_override(user_id, permission_id)
            await uow.commit()

            return ResponseSuccess(
                message="User permission override deleted",
                data={"user_id": user_id, "permission_id": permission_id},
            ).to_response()
