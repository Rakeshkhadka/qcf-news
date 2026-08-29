"""
Alembic environment configuration.

Auto-discovers all models under `src/apps/v1/*/models` so that
`alembic revision --autogenerate` works without explicit imports.
"""
import importlib
import logging
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from src.config.settings import Settings
from src.db.base import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ── Auto-discover models ─────────────────────────────────────────────────────

_base_path = Path("src") / "apps" / "v1"

if _base_path.exists():
    for app_dir in _base_path.iterdir():
        if app_dir.is_dir() and app_dir.name != "__pycache__":
            models_pkg = f"src.apps.v1.{app_dir.name}.models"
            try:
                mod = importlib.import_module(models_pkg)
                # Force submodule loading
                if hasattr(mod, "__path__"):
                    for finder, name, _ in __import__("pkgutil").walk_packages(
                        mod.__path__, prefix=models_pkg + "."
                    ):
                        importlib.import_module(name)
            except Exception as exc:
                logging.warning("Could not import %s: %s", models_pkg, exc)

target_metadata = Base.metadata


# ── URL resolution ────────────────────────────────────────────────────────────


def _build_url_from_parts() -> str | None:
    """
    The same URL the application connects with, assembled the same way.

    Delegates to `Settings.sync_database_url` rather than interpolating the
    parts here: that builder escapes each component, so a generated password
    containing `/`, `@` or `+` survives.  Interpolating it by hand — as this
    function used to — turns `p/a+s=w@rd` into a URL whose host is `rd`, and
    the migration fails at deploy time with a DNS error that names no
    recognisable host.
    """
    parts = ("DB_USER", "DB_PASS", "DB_NAME")
    if not all(os.getenv(k) for k in parts):
        return None
    return Settings().sync_database_url


def resolve_db_url() -> str:
    url = config.get_main_option("sqlalchemy.url")
    if url:
        return url
    url = os.getenv("ALEMBIC_DATABASE_URL") or os.getenv("DATABASE_URL")
    if url:
        return url
    url = _build_url_from_parts()
    if url:
        return url
    raise RuntimeError(
        "DB URL not configured. Set sqlalchemy.url in alembic.ini, "
        "ALEMBIC_DATABASE_URL env var, or DB_* env vars."
    )


# ── Migration runners ────────────────────────────────────────────────────────


def run_migrations_offline() -> None:
    context.configure(
        url=resolve_db_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = resolve_db_url()
    section = config.get_section(config.config_ini_section) or {}
    section["sqlalchemy.url"] = url

    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
