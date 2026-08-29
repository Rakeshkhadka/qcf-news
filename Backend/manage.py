"""
CLI management commands (similar to Django's manage.py).

Usage:
    python manage.py startapp <app_name>   — scaffold a new app module
    python manage.py createsuperuser       — create admin user
"""
import asyncio
from pathlib import Path

import click
from sqlalchemy import select

from src.apps.v1.users.models.users import User
from src.apps.v1.users.security import hash_password
from src.db.session import SessionLocal

PROJECT_BASE = Path(__file__).parent.resolve()

BASIC_FILE_TEMPLATE = '# {file_name}.py\n'


@click.group()
def cli():
    """QCF News backend management CLI."""
    pass


@cli.command()
@click.argument("app_name")
def startapp(app_name):
    """Create a new FastAPI module structure with __init__.py in all folders."""
    base_path = PROJECT_BASE / "src" / "apps" / "v1" / app_name

    dirs = [
        "models",
        "schemas",
        "routes",
        "repositories",
        "services",
        "unit_of_work",
        "utils",
    ]

    for rel in dirs:
        folder = base_path / rel
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "__init__.py").touch(exist_ok=True)

    # App-level init
    (base_path / "__init__.py").touch(exist_ok=True)

    # Scaffold common files
    for fname in ("exception.py", "constants.py"):
        path = base_path / fname
        if not path.exists():
            path.write_text(BASIC_FILE_TEMPLATE.format(file_name=fname.split(".")[0]))

    click.echo(f"✓ Created app '{app_name}' at {base_path}")


@cli.command(name="createsuperuser")
@click.option("--email", prompt="Email", help="Superuser email")
@click.option("--first-name", prompt="First name")
@click.option("--last-name", prompt="Last name")
@click.password_option("--password", confirmation_prompt=True)
def createsuperuser(email, first_name, last_name, password):
    """Create a new superuser."""
    asyncio.run(_create_superuser(email, first_name, last_name, password))


async def _create_superuser(email, first_name, last_name, password):
    async with SessionLocal() as session:
        stmt = select(User).where(User.email == email)
        result = await session.execute(stmt)
        if result.scalars().first():
            click.echo(f"✗ User with email '{email}' already exists.")
            return

        user = User(
            email=email,
            first_name=first_name,
            last_name=last_name,
            password=hash_password(password),
            is_superuser=True,
            is_active=True,
            is_email_verified=True,
        )
        session.add(user)
        await session.commit()
        click.echo(f"✓ Superuser '{email}' created successfully.")


if __name__ == "__main__":
    cli()
