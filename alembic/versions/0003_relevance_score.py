"""Add relevance_score + relevance_breakdown to professors

Replaces the coarse T1/T2/T3 tier with a calculated 0-100 relevance score
plus a JSON breakdown that explains the contribution of each component.

Revision ID: 0003_relevance_score
Revises: 0002_hiring_intelligence
Create Date: 2026-05-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0003_relevance_score"
down_revision: Union[str, None] = "0002_hiring_intelligence"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("professors") as batch_op:
        batch_op.add_column(sa.Column("relevance_score", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("relevance_breakdown", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("relevance_scored_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("professors") as batch_op:
        batch_op.drop_column("relevance_scored_at")
        batch_op.drop_column("relevance_breakdown")
        batch_op.drop_column("relevance_score")
