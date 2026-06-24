"""Discovery pipeline phase 1/2 tables.

Revision ID: 0012_discovery_phase2
Revises: 0011_ai_run_recovery
Create Date: 2026-06-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0012_discovery_phase2"
down_revision: Union[str, None] = "0011_ai_run_recovery"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "discovery_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("phase", sa.String(), nullable=False),
        sa.Column("position_type", sa.String(), nullable=True),
        sa.Column("target_countries", sa.JSON(), nullable=True),
        sa.Column("target_departments", sa.JSON(), nullable=True),
        sa.Column("filters", sa.JSON(), nullable=True),
        sa.Column("universities_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("universities_checked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("departments_found", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("directory_pages_found", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pages_crawled", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("candidates_extracted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("candidates_verified", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("candidates_rejected", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("professors_saved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_discovery_runs_created_at", "discovery_runs", ["created_at"])
    op.create_index("ix_discovery_runs_status", "discovery_runs", ["status"])

    op.create_table(
        "discovery_universities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("normalized_name", sa.String(), nullable=False),
        sa.Column("country", sa.String(), nullable=False),
        sa.Column("country_code", sa.String(), nullable=True),
        sa.Column("region", sa.String(), nullable=True),
        sa.Column("official_domain", sa.String(), nullable=True),
        sa.Column("official_url", sa.String(), nullable=True),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column("source_url", sa.String(), nullable=True),
        sa.Column("source_confidence", sa.Float(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("discovered_at", sa.DateTime(), nullable=True),
        sa.Column("checked_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["discovery_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "normalized_name", "country", name="uq_discovery_university_run_name_country"),
    )
    op.create_index("ix_discovery_universities_country", "discovery_universities", ["country"])
    op.create_index("ix_discovery_universities_country_code", "discovery_universities", ["country_code"])
    op.create_index("ix_discovery_universities_normalized_name", "discovery_universities", ["normalized_name"])
    op.create_index("ix_discovery_universities_official_domain", "discovery_universities", ["official_domain"])
    op.create_index("ix_discovery_universities_run_id", "discovery_universities", ["run_id"])
    op.create_index("ix_discovery_universities_status", "discovery_universities", ["status"])

    op.create_table(
        "discovery_departments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("university_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("normalized_name", sa.String(), nullable=False),
        sa.Column("school", sa.String(), nullable=True),
        sa.Column("url", sa.String(), nullable=True),
        sa.Column("domain", sa.String(), nullable=True),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column("relevance_keywords", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("discovered_at", sa.DateTime(), nullable=True),
        sa.Column("crawled_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["discovery_runs.id"]),
        sa.ForeignKeyConstraint(["university_id"], ["discovery_universities.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "university_id", "normalized_name", name="uq_discovery_department_run_university_name"),
    )
    op.create_index("ix_discovery_departments_domain", "discovery_departments", ["domain"])
    op.create_index("ix_discovery_departments_normalized_name", "discovery_departments", ["normalized_name"])
    op.create_index("ix_discovery_departments_run_id", "discovery_departments", ["run_id"])
    op.create_index("ix_discovery_departments_status", "discovery_departments", ["status"])
    op.create_index("ix_discovery_departments_university_id", "discovery_departments", ["university_id"])

    op.create_table(
        "discovery_pages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("university_id", sa.Integer(), nullable=True),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("normalized_url", sa.Text(), nullable=False),
        sa.Column("final_url", sa.Text(), nullable=True),
        sa.Column("page_type", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("depth", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fetcher", sa.String(), nullable=True),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("content_hash", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("discovered_from_url", sa.Text(), nullable=True),
        sa.Column("extracted_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(), nullable=True),
        sa.Column("last_crawled_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["department_id"], ["discovery_departments.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["discovery_runs.id"]),
        sa.ForeignKeyConstraint(["university_id"], ["discovery_universities.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "normalized_url", name="uq_discovery_page_run_url"),
    )
    op.create_index("ix_discovery_pages_content_hash", "discovery_pages", ["content_hash"])
    op.create_index("ix_discovery_pages_department_id", "discovery_pages", ["department_id"])
    op.create_index("ix_discovery_pages_page_type", "discovery_pages", ["page_type"])
    op.create_index("ix_discovery_pages_run_id", "discovery_pages", ["run_id"])
    op.create_index("ix_discovery_pages_status", "discovery_pages", ["status"])
    op.create_index("ix_discovery_pages_university_id", "discovery_pages", ["university_id"])

    op.create_table(
        "discovery_candidates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("university_id", sa.Integer(), nullable=True),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("source_page_id", sa.Integer(), nullable=True),
        sa.Column("professor_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("normalized_name", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("rank", sa.String(), nullable=True),
        sa.Column("university_name", sa.String(), nullable=True),
        sa.Column("country", sa.String(), nullable=True),
        sa.Column("dept_lab", sa.String(), nullable=True),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("profile_url", sa.Text(), nullable=True),
        sa.Column("lab_url", sa.Text(), nullable=True),
        sa.Column("scholar_url", sa.Text(), nullable=True),
        sa.Column("research_text", sa.Text(), nullable=True),
        sa.Column("evidence_summary", sa.Text(), nullable=True),
        sa.Column("raw_payload", sa.JSON(), nullable=True),
        sa.Column("extraction_confidence", sa.Float(), nullable=True),
        sa.Column("verification_status", sa.String(), nullable=False),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("match_score", sa.Integer(), nullable=True),
        sa.Column("matched_reasons", sa.JSON(), nullable=True),
        sa.Column("scored_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["department_id"], ["discovery_departments.id"]),
        sa.ForeignKeyConstraint(["professor_id"], ["professors.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["discovery_runs.id"]),
        sa.ForeignKeyConstraint(["source_page_id"], ["discovery_pages.id"]),
        sa.ForeignKeyConstraint(["university_id"], ["discovery_universities.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "normalized_name", "university_id", name="uq_discovery_candidate_run_name_university"),
    )
    op.create_index("ix_discovery_candidates_country", "discovery_candidates", ["country"])
    op.create_index("ix_discovery_candidates_department_id", "discovery_candidates", ["department_id"])
    op.create_index("ix_discovery_candidates_match_score", "discovery_candidates", ["match_score"])
    op.create_index("ix_discovery_candidates_normalized_name", "discovery_candidates", ["normalized_name"])
    op.create_index("ix_discovery_candidates_professor_id", "discovery_candidates", ["professor_id"])
    op.create_index("ix_discovery_candidates_rank", "discovery_candidates", ["rank"])
    op.create_index("ix_discovery_candidates_run_id", "discovery_candidates", ["run_id"])
    op.create_index("ix_discovery_candidates_source_page_id", "discovery_candidates", ["source_page_id"])
    op.create_index("ix_discovery_candidates_university_id", "discovery_candidates", ["university_id"])
    op.create_index("ix_discovery_candidates_verification_status", "discovery_candidates", ["verification_status"])

    op.create_table(
        "discovery_evidence",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("candidate_id", sa.Integer(), nullable=True),
        sa.Column("page_id", sa.Integer(), nullable=True),
        sa.Column("evidence_type", sa.String(), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("quote", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["candidate_id"], ["discovery_candidates.id"]),
        sa.ForeignKeyConstraint(["page_id"], ["discovery_pages.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_discovery_evidence_candidate_id", "discovery_evidence", ["candidate_id"])
    op.create_index("ix_discovery_evidence_evidence_type", "discovery_evidence", ["evidence_type"])
    op.create_index("ix_discovery_evidence_page_id", "discovery_evidence", ["page_id"])

    op.create_table(
        "discovery_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("level", sa.String(), nullable=False),
        sa.Column("stage", sa.String(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["discovery_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_discovery_logs_created_at", "discovery_logs", ["created_at"])
    op.create_index("ix_discovery_logs_level", "discovery_logs", ["level"])
    op.create_index("ix_discovery_logs_run_id", "discovery_logs", ["run_id"])
    op.create_index("ix_discovery_logs_stage", "discovery_logs", ["stage"])


def downgrade() -> None:
    op.drop_index("ix_discovery_logs_stage", table_name="discovery_logs")
    op.drop_index("ix_discovery_logs_run_id", table_name="discovery_logs")
    op.drop_index("ix_discovery_logs_level", table_name="discovery_logs")
    op.drop_index("ix_discovery_logs_created_at", table_name="discovery_logs")
    op.drop_table("discovery_logs")
    op.drop_index("ix_discovery_evidence_page_id", table_name="discovery_evidence")
    op.drop_index("ix_discovery_evidence_evidence_type", table_name="discovery_evidence")
    op.drop_index("ix_discovery_evidence_candidate_id", table_name="discovery_evidence")
    op.drop_table("discovery_evidence")
    op.drop_index("ix_discovery_candidates_verification_status", table_name="discovery_candidates")
    op.drop_index("ix_discovery_candidates_university_id", table_name="discovery_candidates")
    op.drop_index("ix_discovery_candidates_source_page_id", table_name="discovery_candidates")
    op.drop_index("ix_discovery_candidates_run_id", table_name="discovery_candidates")
    op.drop_index("ix_discovery_candidates_rank", table_name="discovery_candidates")
    op.drop_index("ix_discovery_candidates_professor_id", table_name="discovery_candidates")
    op.drop_index("ix_discovery_candidates_normalized_name", table_name="discovery_candidates")
    op.drop_index("ix_discovery_candidates_match_score", table_name="discovery_candidates")
    op.drop_index("ix_discovery_candidates_department_id", table_name="discovery_candidates")
    op.drop_index("ix_discovery_candidates_country", table_name="discovery_candidates")
    op.drop_table("discovery_candidates")
    op.drop_index("ix_discovery_pages_university_id", table_name="discovery_pages")
    op.drop_index("ix_discovery_pages_status", table_name="discovery_pages")
    op.drop_index("ix_discovery_pages_run_id", table_name="discovery_pages")
    op.drop_index("ix_discovery_pages_page_type", table_name="discovery_pages")
    op.drop_index("ix_discovery_pages_department_id", table_name="discovery_pages")
    op.drop_index("ix_discovery_pages_content_hash", table_name="discovery_pages")
    op.drop_table("discovery_pages")
    op.drop_index("ix_discovery_departments_university_id", table_name="discovery_departments")
    op.drop_index("ix_discovery_departments_status", table_name="discovery_departments")
    op.drop_index("ix_discovery_departments_run_id", table_name="discovery_departments")
    op.drop_index("ix_discovery_departments_normalized_name", table_name="discovery_departments")
    op.drop_index("ix_discovery_departments_domain", table_name="discovery_departments")
    op.drop_table("discovery_departments")
    op.drop_index("ix_discovery_universities_status", table_name="discovery_universities")
    op.drop_index("ix_discovery_universities_run_id", table_name="discovery_universities")
    op.drop_index("ix_discovery_universities_official_domain", table_name="discovery_universities")
    op.drop_index("ix_discovery_universities_normalized_name", table_name="discovery_universities")
    op.drop_index("ix_discovery_universities_country_code", table_name="discovery_universities")
    op.drop_index("ix_discovery_universities_country", table_name="discovery_universities")
    op.drop_table("discovery_universities")
    op.drop_index("ix_discovery_runs_status", table_name="discovery_runs")
    op.drop_index("ix_discovery_runs_created_at", table_name="discovery_runs")
    op.drop_table("discovery_runs")
