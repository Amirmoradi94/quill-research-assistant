"""Inbound email replies — Gmail IMAP-fetched messages threaded to sent drafts.

Revision ID: 0007_email_replies
Revises: 0006_draft_attachments
Create Date: 2026-05-14
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0007_email_replies"
down_revision: Union[str, None] = "0006_draft_attachments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "email_replies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("draft_id", sa.Integer(), sa.ForeignKey("email_drafts.id"), nullable=False, index=True),
        sa.Column("professor_id", sa.Integer(), sa.ForeignKey("professors.id"), nullable=False, index=True),
        sa.Column("received_at", sa.DateTime(), nullable=False, index=True),
        sa.Column("from_email", sa.String(), nullable=True),
        sa.Column("from_name", sa.String(), nullable=True),
        sa.Column("subject", sa.String(), nullable=True),
        sa.Column("snippet", sa.Text(), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("message_id", sa.String(), unique=True, nullable=True, index=True),
        sa.Column("in_reply_to", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("email_replies")
