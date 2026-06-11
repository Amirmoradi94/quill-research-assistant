"""Add hiring intelligence + position_type fields to professors

Adds scraped-profile fields that capture hiring signals, contact instructions,
and the target position type (postdoc / phd / master) for each professor row.

Revision ID: 0002_hiring_intelligence
Revises: 0001_v1_redesign
Create Date: 2026-05-09
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0002_hiring_intelligence"
down_revision: Union[str, None] = "0001_v1_redesign"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("professors") as batch_op:
        batch_op.add_column(sa.Column("position_type", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("prospective_url", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("hiring_signals", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("hiring_notes", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("contact_instructions", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("profile_scraped_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("professors") as batch_op:
        batch_op.drop_column("profile_scraped_at")
        batch_op.drop_column("contact_instructions")
        batch_op.drop_column("hiring_notes")
        batch_op.drop_column("hiring_signals")
        batch_op.drop_column("prospective_url")
        batch_op.drop_column("position_type")
