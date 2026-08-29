"""
Pydantic schemas for the News domain.
"""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from src.utils.html_sanitizer import sanitize_html, strip_html


# ── Category Schemas ─────────────────────────────────────────────────────────


class CategoryCreate(BaseModel):
    name: str = Field(..., max_length=255)
    slug: str = Field(..., max_length=255)
    description: Optional[str] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    slug: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    is_active: Optional[bool] = None


class CategoryOutput(BaseModel):
    id: int
    name: str
    slug: str
    description: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    updated_by: Optional[int] = None

    model_config = {"from_attributes": True}


# ── Article Image Schemas ────────────────────────────────────────────────────


class ArticleImageInput(BaseModel):
    """One gallery image as sent by the client, already uploaded to /media."""

    image_url: str = Field(..., max_length=1000)
    caption: Optional[str] = Field(None, max_length=500)
    alt_text: Optional[str] = Field(None, max_length=500)
    sort_order: int = 0


class ArticleImageOutput(BaseModel):
    id: int
    image_url: str
    caption: Optional[str] = None
    alt_text: Optional[str] = None
    sort_order: int

    model_config = {"from_attributes": True}


class UploadedImageOutput(BaseModel):
    """Result of a single file in a multi-file upload."""

    url: str
    path: str
    filename: str
    size: int
    content_type: str
    width: int = 0
    height: int = 0
    variants: dict[str, dict[str, str]] = Field(default_factory=dict)


# ── Article Schemas ──────────────────────────────────────────────────────────


def _clean_content(value: str) -> str:
    """
    Reduce authored article HTML to the allowlist.

    The admin editor sanitises on the way out and the public site sanitises on
    the way in, but this is the only check every client has to pass, so it is
    the one that decides what the database holds.
    """
    cleaned = sanitize_html(value)
    if not strip_html(cleaned) and "<img" not in cleaned:
        raise ValueError("Content cannot be empty")
    return cleaned


class ArticleCreate(BaseModel):
    title: str = Field(..., max_length=500)
    slug: str = Field(..., max_length=500)
    summary: Optional[str] = None
    content: str
    cover_image_url: Optional[str] = None
    images: List[ArticleImageInput] = Field(default_factory=list)
    is_published: bool = False
    is_featured: bool = False
    category_id: int

    @field_validator("content")
    @classmethod
    def sanitize_content(cls, value: str) -> str:
        return _clean_content(value)


class ArticleUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=500)
    slug: Optional[str] = Field(None, max_length=500)
    summary: Optional[str] = None
    content: Optional[str] = None
    cover_image_url: Optional[str] = None
    # `None` leaves the gallery untouched; `[]` clears it.
    images: Optional[List[ArticleImageInput]] = None
    is_published: Optional[bool] = None
    is_featured: Optional[bool] = None
    category_id: Optional[int] = None

    @field_validator("content")
    @classmethod
    def sanitize_content(cls, value: Optional[str]) -> Optional[str]:
        return None if value is None else _clean_content(value)


class BulkPublishRequest(BaseModel):
    """Payload for bulk publish / unpublish."""

    article_ids: List[int] = Field(..., min_length=1, max_length=100)
    is_published: bool


class ArticleOutput(BaseModel):
    id: int
    title: str
    slug: str
    summary: Optional[str] = None
    content: str
    cover_image_url: Optional[str] = None
    images: List[ArticleImageOutput] = Field(default_factory=list)
    is_published: bool
    is_featured: bool
    category_id: int
    author_id: int
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    updated_by: Optional[int] = None

    model_config = {"from_attributes": True}


class ArticleListOutput(BaseModel):
    """Lightweight schema for list views (excludes full content)."""

    id: int
    title: str
    slug: str
    summary: Optional[str] = None
    cover_image_url: Optional[str] = None
    images: List[ArticleImageOutput] = Field(default_factory=list)
    is_published: bool
    is_featured: bool
    category_id: int
    author_id: int
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    updated_by: Optional[int] = None

    model_config = {"from_attributes": True}
