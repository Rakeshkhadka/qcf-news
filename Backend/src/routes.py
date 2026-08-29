"""
Centralized route registration.

All versioned API routes are included here, keeping `main.py` clean.
"""
from fastapi import FastAPI


def setup_routes(app: FastAPI) -> None:
    from src.apps.v1.news.routes.articles import router as articles_router
    from src.apps.v1.news.routes.categories import router as categories_router
    from src.apps.v1.news.routes.uploads import router as uploads_router
    from src.apps.v1.newsletter.routes.subscriptions import (
        router as newsletter_router,
    )
    from src.apps.v1.users.routes.roles import router as roles_router
    from src.apps.v1.users.routes.users import router as users_router

    app.include_router(users_router, prefix="/api/v1/users", tags=["Users"])
    app.include_router(
        roles_router, prefix="/api/v1/roles", tags=["Roles & Permissions"]
    )
    app.include_router(
        categories_router, prefix="/api/v1/categories", tags=["Categories"]
    )
    app.include_router(
        articles_router, prefix="/api/v1/articles", tags=["Articles"]
    )
    app.include_router(uploads_router, prefix="/api/v1/uploads", tags=["Uploads"])
    app.include_router(
        newsletter_router, prefix="/api/v1/newsletter", tags=["Newsletter"]
    )
