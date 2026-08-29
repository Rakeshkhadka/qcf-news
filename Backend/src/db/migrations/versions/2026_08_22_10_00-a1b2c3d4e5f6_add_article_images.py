"""add_article_images

Revision ID: a1b2c3d4e5f6
Revises: 16ef2be42148
Create Date: 2026-08-22 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '16ef2be42148'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'article_images',
        sa.Column('article_id', sa.Integer(), nullable=False),
        sa.Column('image_url', sa.String(length=1000), nullable=False),
        sa.Column('caption', sa.String(length=500), nullable=True),
        sa.Column('alt_text', sa.String(length=500), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            'is_deleted',
            sa.Boolean(),
            server_default=sa.text('false'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['article_id'], ['articles.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_article_images_article_id'),
        'article_images',
        ['article_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_article_images_id'), 'article_images', ['id'], unique=False
    )

    # Seed the gallery from covers that already exist, so articles created
    # before this feature still render a (single-slide) carousel.
    op.execute(
        """
        INSERT INTO article_images (
            article_id, image_url, sort_order,
            created_at, updated_at, is_deleted
        )
        SELECT id, cover_image_url, 0, NOW(), NOW(), false
        FROM articles
        WHERE cover_image_url IS NOT NULL AND cover_image_url <> ''
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_article_images_id'), table_name='article_images')
    op.drop_index(
        op.f('ix_article_images_article_id'), table_name='article_images'
    )
    op.drop_table('article_images')
