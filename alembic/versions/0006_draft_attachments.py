"""Per-draft attachment overrides — list of document IDs.

NULL means "use the user's default CV"; an empty list means "no attachments";
a populated list means "use exactly these documents".

Revision ID: 0006_draft_attachments
Revises: 0005_gmail_smtp
Create Date: 2026-05-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0006_draft_attachments"
down_revision: Union[str, None] = "0005_gmail_smtp"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("email_drafts") as batch_op:
        batch_op.add_column(sa.Column("attachment_doc_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("email_drafts") as batch_op:
        batch_op.drop_column("attachment_doc_ids")
