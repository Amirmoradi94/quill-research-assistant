"""Interview prep: interview_prep + mock_interview tables, meeting detection on email_replies.

Revision ID: 0010_interview_prep
Revises: 0009_reply_management
Create Date: 2026-05-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0010_interview_prep"
down_revision: Union[str, None] = "0009_reply_management"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("email_replies") as batch_op:
        batch_op.add_column(sa.Column("meeting_request", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("meeting_intent_at", sa.DateTime(), nullable=True))

    op.create_table(
        "interview_prep",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("professor_id", sa.Integer(), nullable=False),
        sa.Column("reply_id", sa.Integer(), nullable=True),
        sa.Column("position_type", sa.String(), nullable=True),
        sa.Column("meeting_format", sa.String(), nullable=False, server_default="formal_interview"),
        sa.Column("meeting_at", sa.DateTime(), nullable=True),
        sa.Column("meeting_notes", sa.Text(), nullable=True),
        sa.Column("briefing", sa.Text(), nullable=True),
        sa.Column("fit_analysis", sa.Text(), nullable=True),
        sa.Column("talking_points", sa.JSON(), nullable=True),
        sa.Column("likely_questions", sa.JSON(), nullable=True),
        sa.Column("questions_to_ask", sa.JSON(), nullable=True),
        sa.Column("logistics", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("ai_run_id", sa.Integer(), nullable=True),
        sa.Column("generated_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["professor_id"], ["professors.id"]),
        sa.ForeignKeyConstraint(["reply_id"], ["email_replies.id"]),
        sa.ForeignKeyConstraint(["ai_run_id"], ["ai_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_interview_prep_professor_id", "interview_prep", ["professor_id"])

    op.create_table(
        "mock_interview",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("prep_id", sa.Integer(), nullable=False),
        sa.Column("transcript", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["prep_id"], ["interview_prep.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mock_interview_prep_id", "mock_interview", ["prep_id"])


def downgrade() -> None:
    op.drop_index("ix_mock_interview_prep_id", table_name="mock_interview")
    op.drop_table("mock_interview")
    op.drop_index("ix_interview_prep_professor_id", table_name="interview_prep")
    op.drop_table("interview_prep")
    with op.batch_alter_table("email_replies") as batch_op:
        batch_op.drop_column("meeting_intent_at")
        batch_op.drop_column("meeting_request")
