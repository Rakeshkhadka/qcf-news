"""
News domain models: Category and Article.
"""
from sqlalchemy import (
    Boolean,
    Column,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from src.db.base import BaseModel, NamedBaseModel


class Category(NamedBaseModel):
    """News category (e.g. Politics, Sports, Tech)."""

    __tablename__ = "categories"

    slug = Column(String(255), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)


class Article(BaseModel):
    """A news article belonging to a category."""

    __tablename__ = "articles"

    title = Column(String(500), nullable=False, index=True)
    slug = Column(String(500), unique=True, nullable=False, index=True)
    summary = Column(Text, nullable=True)
    content = Column(Text, nullable=False)
    cover_image_url = Column(String(1000), nullable=True)
    is_published = Column(Boolean, default=False, nullable=False)
    is_featured = Column(Boolean, default=False, nullable=False)

    category_id = Column(
        Integer, ForeignKey("categories.id"), nullable=False, index=True
    )
    author_id = Column(Integer, nullable=False, index=True)

    images = relationship(
        "ArticleImage",
        back_populates="article",
        order_by="ArticleImage.sort_order",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ArticleImage(BaseModel):
    """
    One image in an article's gallery.

    The gallery drives the carousel on the article page; the image with the
    lowest `sort_order` doubles as the cover when `Article.cover_image_url`
    is not set explicitly.
    """

    __tablename__ = "article_images"

    article_id = Column(
        Integer,
        ForeignKey("articles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    image_url = Column(String(1000), nullable=False)
    caption = Column(String(500), nullable=True)
    alt_text = Column(String(500), nullable=True)
    sort_order = Column(Integer, default=0, nullable=False)

    article = relationship("Article", back_populates="images")
