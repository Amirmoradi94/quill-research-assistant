"""Gmail SMTP integration: encrypted app-password storage + per-draft send tracking.

Revision ID: 0005_gmail_smtp
Revises: 0004_user_profile_expand
Create Date: 2026-05-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0005_gmail_smtp"
down_revision: Union[str, None] = "0004_user_profile_expand"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("settings") as batch_op:
        batch_op.add_column(sa.Column("gmail_address", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("gmail_app_password_encrypted", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("gmail_send_name", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("gmail_last_verified_at", sa.DateTime(), nullable=True))

    with op.batch_alter_table("email_drafts") as batch_op:
        batch_op.add_column(sa.Column("sent_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("sent_message_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("send_error", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("email_drafts") as batch_op:
        batch_op.drop_column("send_error")
        batch_op.drop_column("sent_message_id")
        batch_op.drop_column("sent_at")
    with op.batch_alter_table("settings") as batch_op:
        batch_op.drop_column("gmail_last_verified_at")
        batch_op.drop_column("gmail_send_name")
        batch_op.drop_column("gmail_app_password_encrypted")
        batch_op.drop_column("gmail_address")
