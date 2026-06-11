"""Background reply-poller settings columns.

Revision ID: 0008_reply_poller
Revises: 0007_email_replies
Create Date: 2026-05-14
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0008_reply_poller"
down_revision: Union[str, None] = "0007_email_replies"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("settings") as batch_op:
        batch_op.add_column(sa.Column("reply_check_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("reply_check_interval_hours", sa.Integer(), nullable=False, server_default="4"))
        batch_op.add_column(sa.Column("reply_check_last_run_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("reply_check_last_status", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("reply_check_last_error", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("settings") as batch_op:
        batch_op.drop_column("reply_check_last_error")
        batch_op.drop_column("reply_check_last_status")
        batch_op.drop_column("reply_check_last_run_at")
        batch_op.drop_column("reply_check_interval_hours")
        batch_op.drop_column("reply_check_enabled")
