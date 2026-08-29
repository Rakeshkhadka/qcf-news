"""
FastAPI application factory.

Wires the DI container, registers middleware, exception handlers,
and mounts all routes.
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

import src.shared.audit  # noqa: F401 — registers ORM event listeners

from src.apps.v1.news.routes import categories as categories_mod
from src.apps.v1.news.routes import articles as articles_mod
from src.apps.v1.news.routes import uploads as uploads_mod
from src.apps.v1.newsletter.routes import subscriptions as newsletter_mod
from src.apps.v1.users.routes import users as users_mod
from src.apps.v1.users.routes import roles as roles_mod
from src.config.settings import settings
from src.container import Container
from src.db.session import db_lifespan
from src.routes import setup_routes
from src.utils.error_handler import ErrorHandlerMiddleware
from src.utils.rate_limit import RateLimitMiddleware

logger = logging.getLogger(__name__)

# ── DI Container ──────────────────────────────────────────────────────────────

container = Container()
container.wire(
    modules=[
        users_mod,
        roles_mod,
        categories_mod,
        articles_mod,
        uploads_mod,
        newsletter_mod,
        # Wire the dependencies module so @inject works for get_current_user
        "src.dependencies",
    ]
)

# ── FastAPI App ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Own the lifetime of the shared connections: the database engine and the
    Redis pool are opened once per process and closed on shutdown.

    A Redis that is down must not take the site down with it — the cache is a
    read accelerator, and `CacheService` already degrades every operation to a
    miss. So a failed connect is logged and the app boots without a cache.
    """
    redis_client = container.redis_client()
    async with db_lifespan(app):
        try:
            await redis_client.connect()
        except Exception:
            logger.warning(
                "Redis unavailable at startup; serving without cache",
                exc_info=True,
            )
        try:
            yield
        finally:
            await redis_client.disconnect()


# Interactive docs are a deployment decision, not a constant: they publish a
# complete, machine-readable map of every route and payload. `ENABLE_API_DOCS`
# is True in the development env file and False in production, where the paths
# return 404 even for a caller who reaches the API directly. The host nginx
# config leaves them unproxied as well, so there are two independent answers.
_docs_enabled = settings.ENABLE_API_DOCS

app = FastAPI(
    title="QCF News API",
    version="1.0.0",
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
    lifespan=lifespan,
)

app.container = container

# ── Middleware ────────────────────────────────────────────────────────────────

# Order matters. Starlette runs the LAST-registered middleware outermost, so
# CORS is registered after the error handler: otherwise error responses are
# produced outside the CORS layer, arrive without an Access-Control-Allow-Origin
# header, and the browser reports every backend error as an opaque
# "Failed to fetch" instead of the message the API actually sent.
app.middleware("http")(ErrorHandlerMiddleware())

# Registered after the error handler so it runs *outside* it: a throttled
# request is rejected before any handler, DB session, or Redis lookup runs.
# Still inside CORS, so the 429 carries the CORS headers the browser needs.
app.middleware("http")(RateLimitMiddleware(container.redis_client()))

# Cross-origin policy comes from configuration, per environment.
#
# The default is an empty list, and that is not an oversight: the host nginx
# serves the site and the API from one origin, so the browser never makes a
# cross-origin request and CORS has nothing to permit. Origins are named only
# when a client genuinely lives elsewhere — a separate dev server, a staging
# front end.
#
# `allow_credentials` follows the origin list rather than being asserted
# independently, because "*" plus credentials is a combination browsers refuse
# outright. See `Settings.cors_allow_credentials`.
_cors_origins = settings.cors_allow_origins

if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=settings.cors_allow_credentials,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Revalidation-Secret"],
        max_age=600,
    )
    if not settings.cors_allow_credentials:
        logger.warning(
            "CORS_ALLOW_ORIGINS contains '*'; credentialed cross-origin "
            "requests are disabled. Name the exact origins to allow them."
        )
else:
    logger.info("CORS disabled: no CORS_ALLOW_ORIGINS configured (same-origin only)")

# ── Media ─────────────────────────────────────────────────────────────────────

# Uploaded images live on disk under MEDIA_ROOT and are served from MEDIA_URL.
_media_root = Path(settings.MEDIA_ROOT)
_media_root.mkdir(parents=True, exist_ok=True)
app.mount(
    settings.MEDIA_URL,
    StaticFiles(directory=str(_media_root)),
    name="media",
)

# ── Routes ────────────────────────────────────────────────────────────────────

setup_routes(app)


# ── Health Check ──────────────────────────────────────────────────────────────


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "ok"}
