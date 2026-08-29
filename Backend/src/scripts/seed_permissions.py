"""
Permission seeder script.

Reads the global ALL_PERMISSIONS registry and upserts each entry
into the `permissions` table. Safe to run repeatedly — existing
entries are updated, new ones are created.

Usage:
    python -m src.scripts.seed_permissions
"""
import asyncio
import sys
from pathlib import Path

# Ensure the project root is on sys.path
project_root = str(Path(__file__).resolve().parents[2])
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.db.session import SessionLocal
from src.permissions import ALL_PERMISSIONS


async def seed_permissions() -> None:
    """Upsert all declared permissions into the database."""
    from src.apps.v1.users.repositories.permission_repository import (
        PermissionRepository,
    )

    session = SessionLocal()
    repo = PermissionRepository(session)

    try:
        created = 0
        updated = 0

        for pdef in ALL_PERMISSIONS:
            existing = await repo.get_by_code(pdef.code.value)
            if existing:
                if existing.name != pdef.name or existing.module != pdef.module:
                    existing.name = pdef.name
                    existing.module = pdef.module
                    updated += 1
            else:
                from src.apps.v1.users.models.role_and_perm import Permission

                perm = Permission(
                    name=pdef.name,
                    code=pdef.code.value,
                    module=pdef.module,
                )
                session.add(perm)
                created += 1

        await session.commit()
        print(f"✅ Seeded permissions: {created} created, {updated} updated")
        print(f"   Total registered: {len(ALL_PERMISSIONS)}")

    except Exception as e:
        await session.rollback()
        print(f"❌ Seeding failed: {e}")
        raise
    finally:
        await session.close()


if __name__ == "__main__":
    asyncio.run(seed_permissions())
