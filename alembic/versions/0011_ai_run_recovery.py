"""AI run recovery metadata.

Revision ID: 0011_ai_run_recovery
Revises: 0010_interview_prep
Create Date: 2026-06-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0011_ai_run_recovery"
down_revision: Union[str, None] = "0010_interview_prep"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("ai_runs") as batch_op:
        batch_op.add_column(sa.Column("request_json", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("error_type", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("error_message", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("retry_of_run_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_ai_runs_retry_of_run_id_ai_runs", "ai_runs", ["retry_of_run_id"], ["id"])

    op.create_index("ix_ai_runs_error_type", "ai_runs", ["error_type"])
    op.create_index("ix_ai_runs_retry_of_run_id", "ai_runs", ["retry_of_run_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_runs_retry_of_run_id", table_name="ai_runs")
    op.drop_index("ix_ai_runs_error_type", table_name="ai_runs")
    with op.batch_alter_table("ai_runs") as batch_op:
        batch_op.drop_constraint("fk_ai_runs_retry_of_run_id_ai_runs", type_="foreignkey")
        batch_op.drop_column("retry_of_run_id")
        batch_op.drop_column("error_message")
        batch_op.drop_column("error_type")
        batch_op.drop_column("request_json")
