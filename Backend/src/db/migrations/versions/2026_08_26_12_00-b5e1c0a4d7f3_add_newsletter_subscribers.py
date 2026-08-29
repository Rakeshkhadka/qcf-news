"""add_newsletter_subscribers

Revision ID: b5e1c0a4d7f3
Revises: c3d9a71b4e28
Create Date: 2026-08-26 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b5e1c0a4d7f3'
down_revision: Union[str, None] = 'c3d9a71b4e28'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    The newsletter mailing list.

    No `is_deleted` column, unlike every other table here: an address hidden
    behind a soft-delete flag would still hold the unique index, so the person
    could never sign up again while the ORM's global filter kept the row
    invisible to the code trying to find it.  Leaving is a `status` change and
    an erasure request is a real DELETE — see the model for the full note.

    There is likewise no unsubscribe-token column.  That token is an HMAC over
    the row id, recomputed on demand, so an unsubscribe link keeps working for
    as long as the email holding it exists.
    """
    op.create_table(
        'newsletter_subscribers',
        sa.Column('id', sa.Integer(), nullable=False),
        # 320 = the RFC 3696 ceiling: 64-octet local part, "@", 255-octet domain.
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column(
            'status',
            sa.String(length=20),
            server_default='pending',
            nullable=False,
        ),
        sa.Column('confirm_token_hash', sa.String(length=64), nullable=True),
        sa.Column(
            'confirm_token_expires_at', sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column('confirm_sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('unsubscribed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('source', sa.String(length=50), nullable=True),
        # 45 characters is the longest textual IPv6 form.
        sa.Column('consent_ip', sa.String(length=45), nullable=True),
        sa.Column('consent_user_agent', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_newsletter_subscribers_id'),
        'newsletter_subscribers',
        ['id'],
        unique=False,
    )
    # Unique: one row per address, so a second signup updates the existing
    # consent record instead of creating a duplicate subscription.
    op.create_index(
        op.f('ix_newsletter_subscribers_email'),
        'newsletter_subscribers',
        ['email'],
        unique=True,
    )
    op.create_index(
        op.f('ix_newsletter_subscribers_status'),
        'newsletter_subscribers',
        ['status'],
        unique=False,
    )
    # Unique so a token lookup is one indexed equality test that can never
    # match two rows.  Postgres treats NULLs as distinct in a unique index, so
    # this stays correct for the confirmed and unsubscribed rows, which carry
    # no token at all.
    op.create_index(
        op.f('ix_newsletter_subscribers_confirm_token_hash'),
        'newsletter_subscribers',
        ['confirm_token_hash'],
        unique=True,
    )


def downgrade() -> None:
    """Drop the list. The subscriptions themselves are not recoverable."""
    op.drop_index(
        op.f('ix_newsletter_subscribers_confirm_token_hash'),
        table_name='newsletter_subscribers',
    )
    op.drop_index(
        op.f('ix_newsletter_subscribers_status'),
        table_name='newsletter_subscribers',
    )
    op.drop_index(
        op.f('ix_newsletter_subscribers_email'),
        table_name='newsletter_subscribers',
    )
    op.drop_index(
        op.f('ix_newsletter_subscribers_id'),
        table_name='newsletter_subscribers',
    )
    op.drop_table('newsletter_subscribers')
