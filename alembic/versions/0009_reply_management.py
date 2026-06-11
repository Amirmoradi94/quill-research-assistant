"""Reply management: read/dismiss flags + outbound response tracking on email_replies.

Revision ID: 0009_reply_management
Revises: 0008_reply_poller
Create Date: 2026-05-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0009_reply_management"
down_revision: Union[str, None] = "0008_reply_poller"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("email_replies") as batch_op:
        batch_op.add_column(sa.Column("read_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("dismissed_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("response_draft", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("response_subject", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("response_sent_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("response_message_id", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("email_replies") as batch_op:
        batch_op.drop_column("response_message_id")
        batch_op.drop_column("response_sent_at")
        batch_op.drop_column("response_subject")
        batch_op.drop_column("response_draft")
        batch_op.drop_column("dismissed_at")
        batch_op.drop_column("read_at")
