"""Expand user profile: rich identity, application target, research profile,
and repeatable tables for education / publications / experience / awards / references.

Revision ID: 0004_user_profile_expand
Revises: 0003_relevance_score
Create Date: 2026-05-12
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0004_user_profile_expand"
down_revision: Union[str, None] = "0003_relevance_score"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


USER_NEW_COLUMNS = [
    # Identity
    ("preferred_name", sa.String()),
    ("pronouns", sa.String()),
    ("headshot_url", sa.String()),
    # Contact
    ("email_secondary", sa.String()),
    ("phone", sa.String()),
    ("city", sa.String()),
    ("nationality", sa.String()),
    ("languages", sa.JSON()),
    # Online
    ("linkedin", sa.String()),
    # Application target
    ("target_position_type", sa.String()),
    ("target_start_date", sa.Date()),
    ("earliest_available_date", sa.Date()),
    ("target_countries", sa.JSON()),
    ("target_universities_preferred", sa.JSON()),
    ("excluded_institutions", sa.JSON()),
    ("funding_status", sa.String()),
    ("work_authorization", sa.JSON()),
    ("commitment_length", sa.String()),
    # Research profile
    ("headline", sa.String()),
    ("methods", sa.JSON()),
    ("application_domains", sa.JSON()),
    ("tools_frameworks", sa.JSON()),
    ("datasets_used", sa.JSON()),
    ("datasets_created", sa.JSON()),
    # Skills
    ("programming_languages", sa.JSON()),
    ("certifications", sa.JSON()),
    ("reviewing_venues", sa.JSON()),
    ("teaching_summary", sa.Text()),
    # Linked documents
    ("cv_doc_id", sa.Integer()),
    ("research_statement_doc_id", sa.Integer()),
    ("transcript_doc_ids", sa.JSON()),
    ("sample_paper_doc_ids", sa.JSON()),
    # Provenance
    ("field_provenance", sa.JSON()),
    ("cv_last_extracted_at", sa.DateTime()),
]


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        for name, type_ in USER_NEW_COLUMNS:
            batch_op.add_column(sa.Column(name, type_, nullable=True))

    op.create_table(
        "user_education",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("degree_level", sa.String(), nullable=False),
        sa.Column("field", sa.String()),
        sa.Column("institution", sa.String()),
        sa.Column("department", sa.String()),
        sa.Column("start_date", sa.Date()),
        sa.Column("end_date", sa.Date()),
        sa.Column("is_current", sa.Boolean(), default=False),
        sa.Column("gpa", sa.Float()),
        sa.Column("gpa_scale", sa.Float()),
        sa.Column("honors", sa.String()),
        sa.Column("advisor_name", sa.String()),
        sa.Column("advisor_title", sa.String()),
        sa.Column("co_advisor_name", sa.String()),
        sa.Column("thesis_title", sa.String()),
        sa.Column("thesis_abstract", sa.Text()),
        sa.Column("key_courses", sa.JSON()),
        sa.Column("transcript_doc_id", sa.Integer(), sa.ForeignKey("documents.id")),
        sa.Column("order_idx", sa.Integer(), default=0),
    )

    op.create_table(
        "user_publications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("authors", sa.Text()),
        sa.Column("venue_full_name", sa.String()),
        sa.Column("venue_short", sa.String()),
        sa.Column("year", sa.Integer(), index=True),
        sa.Column("type", sa.String()),
        sa.Column("status", sa.String(), default="published"),
        sa.Column("doi", sa.String()),
        sa.Column("url", sa.String()),
        sa.Column("pdf_url", sa.String()),
        sa.Column("citation_count", sa.Integer()),
        sa.Column("your_role", sa.String()),
        sa.Column("abstract", sa.Text()),
        sa.Column("one_line_takeaway", sa.Text()),
        sa.Column("is_signature", sa.Boolean(), default=False, index=True),
        sa.Column("order_idx", sa.Integer(), default=0),
    )

    op.create_table(
        "user_experience",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("employer", sa.String()),
        sa.Column("lab_or_group", sa.String()),
        sa.Column("supervisor", sa.String()),
        sa.Column("location", sa.String()),
        sa.Column("start_date", sa.Date()),
        sa.Column("end_date", sa.Date()),
        sa.Column("is_current", sa.Boolean(), default=False),
        sa.Column("bullets", sa.JSON()),
        sa.Column("tech_used", sa.JSON()),
        sa.Column("order_idx", sa.Integer(), default=0),
    )

    op.create_table(
        "user_awards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("granting_body", sa.String()),
        sa.Column("amount", sa.Float()),
        sa.Column("currency", sa.String(), default="USD"),
        sa.Column("year", sa.Integer(), index=True),
        sa.Column("type", sa.String()),
        sa.Column("notes", sa.Text()),
        sa.Column("order_idx", sa.Integer(), default=0),
    )

    op.create_table(
        "user_references",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("title", sa.String()),
        sa.Column("institution", sa.String()),
        sa.Column("email", sa.String()),
        sa.Column("relationship_type", sa.String()),
        sa.Column("years_known", sa.Integer()),
        sa.Column("notes", sa.Text()),
        sa.Column("order_idx", sa.Integer(), default=0),
    )


def downgrade() -> None:
    for tbl in ("user_references", "user_awards", "user_experience",
                "user_publications", "user_education"):
        op.drop_table(tbl)
    with op.batch_alter_table("users") as batch_op:
        for name, _ in USER_NEW_COLUMNS:
            batch_op.drop_column(name)
