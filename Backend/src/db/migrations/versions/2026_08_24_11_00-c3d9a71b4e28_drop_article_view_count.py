"""drop_article_view_count

Revision ID: c3d9a71b4e28
Revises: 7f2f4a1fe17e
Create Date: 2026-08-24 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d9a71b4e28'
down_revision: Union[str, None] = '7f2f4a1fe17e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop the article view counter."""
    op.drop_column('articles', 'view_count')


def downgrade() -> None:
    """Restore the column. The counts themselves are not recoverable."""
    # The server default backfills existing rows so the NOT NULL holds; it is
    # then dropped, since the ORM supplied the default on insert.
    op.add_column(
        'articles',
        sa.Column(
            'view_count',
            sa.Integer(),
            nullable=False,
            server_default='0',
        ),
    )
    op.alter_column('articles', 'view_count', server_default=None)
