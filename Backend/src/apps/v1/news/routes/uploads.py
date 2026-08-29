"""
Media upload routes.

Images are uploaded here first and the returned URLs are then attached to an
article (as its cover and/or its carousel gallery). Keeping upload separate
from article writes means the admin UI can show previews before the article
itself is saved, and the same endpoint serves create and edit alike.
"""
from typing import List

from dependency_injector.wiring import Provide, inject
from fastapi import APIRouter, Depends, File, UploadFile

from src.apps.v1.news.schemas.news import UploadedImageOutput
from src.apps.v1.users.permissions import PermissionCode
from src.config.settings import settings
from src.container import Container
from src.dependencies import require_any
from src.utils.exceptions import InvalidDataException
from src.utils.response import ResponseSuccess
from src.utils.storage import LocalImageStorage

router = APIRouter()


@router.post("/images")
@inject
async def upload_images(
    files: List[UploadFile] = File(..., description="One or more image files"),
    _=Depends(
        require_any(
            PermissionCode.CREATE_ARTICLE,
            PermissionCode.UPDATE_ARTICLE,
        )
    ),
    storage: LocalImageStorage = Depends(Provide[Container.image_storage]),
):
    """Upload one or many images and return their public URLs, in order."""
    if not files:
        raise InvalidDataException(detail="No files were uploaded")
    if len(files) > settings.MAX_IMAGES_PER_UPLOAD:
        raise InvalidDataException(
            detail=(
                f"Too many files: {len(files)} "
                f"(maximum {settings.MAX_IMAGES_PER_UPLOAD} per request)"
            )
        )

    uploaded = []
    try:
        for upload in files:
            # Validation raises before anything is written, so a bad file in
            # the batch aborts the whole request — see the cleanup below.
            saved = storage.save(upload.file, upload.filename)
            uploaded.append(UploadedImageOutput(**saved).model_dump())
    except Exception:
        # Don't leave half a batch orphaned on disk.
        for item in uploaded:
            storage.delete(item["path"])
        raise
    finally:
        for upload in files:
            await upload.close()

    return ResponseSuccess(
        message=f"{len(uploaded)} image(s) uploaded", data=uploaded
    ).to_response()


@router.delete("/images")
@inject
async def delete_image(
    path: str,
    _=Depends(
        require_any(
            PermissionCode.CREATE_ARTICLE,
            PermissionCode.UPDATE_ARTICLE,
        )
    ),
    storage: LocalImageStorage = Depends(Provide[Container.image_storage]),
):
    """Remove an uploaded file by its storage `path` (e.g. `2026/08/foo.jpg`)."""
    removed = storage.delete(path)
    return ResponseSuccess(
        message="Image deleted" if removed else "Image not found",
        data={"path": path, "deleted": removed},
    ).to_response()
