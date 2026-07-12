"""Per-user lifetime AI credit cap + admin exemption flag.

Revision ID: 0014_credit_cap
Revises: 0013_multi_user
Create Date: 2026-07-04
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0014_credit_cap"
down_revision: Union[str, None] = "0013_multi_user"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column("is_admin", sa.Boolean(), nullable=False, server_default="0")
        )
        batch_op.add_column(
            sa.Column("credit_cap_usd", sa.Float(), nullable=True, server_default="10.0")
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("credit_cap_usd")
        batch_op.drop_column("is_admin")
