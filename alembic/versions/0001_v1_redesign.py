"""v1 redesign — multi-user schema, AI runs, grants, documents, applications

Adds all entities introduced by the 2026-05-04 dashboard redesign plan:
  * users (singleton), settings (singleton)
  * documents, publications
  * ai_runs (every Quill workflow leaves a row here)
  * recommenders, applications, application_recommenders
  * email_replies
  * fellowships → grants (renamed + new columns)
  * professors + email_drafts extended with redesign fields

Seeds the singleton user/settings rows so existing installs upgrade cleanly.

Revision ID: 0001_v1_redesign
Revises: e49f5f7e9d9d
Create Date: 2026-05-05
"""
from datetime import datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0001_v1_redesign"
down_revision: Union[str, None] = "e49f5f7e9d9d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ───────────────────────────────────────────────────────────────────
# Upgrade
# ───────────────────────────────────────────────────────────────────
def upgrade() -> None:
    # ───── users (singleton) ────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False, server_default=""),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("current_role", sa.String(), nullable=True),
        sa.Column("affiliation", sa.String(), nullable=True),
        sa.Column("country", sa.String(), nullable=True),
        sa.Column("research_interests", sa.Text(), nullable=True),
        sa.Column("research_categories", sa.JSON(), nullable=True),
        sa.Column("orcid", sa.String(), nullable=True),
        sa.Column("scholar_url", sa.String(), nullable=True),
        sa.Column("github", sa.String(), nullable=True),
        sa.Column("website", sa.String(), nullable=True),
        sa.Column("twitter", sa.String(), nullable=True),
        sa.Column("phd_year", sa.Integer(), nullable=True),
        sa.Column("phd_institution", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )

    # ───── settings (singleton) ─────────────────────────────────────
    op.create_table(
        "settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ai_provider", sa.String(), nullable=False, server_default="claude_cli"),
        sa.Column("claude_cli_path", sa.String(), nullable=True),
        sa.Column("codex_cli_path", sa.String(), nullable=True),
        sa.Column("anthropic_api_key", sa.String(), nullable=True),
        sa.Column("openai_api_key", sa.String(), nullable=True),
        sa.Column("default_provider_per_workflow", sa.JSON(), nullable=True),
        sa.Column("email_tone_rules", sa.Text(), nullable=True),
        sa.Column("daily_cost_cap_usd", sa.Float(), nullable=False, server_default="5.0"),
        sa.Column("ui_density", sa.String(), nullable=False, server_default="comfortable"),
    )

    # ───── documents ────────────────────────────────────────────────
    op.create_table(
        "documents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(), nullable=False, index=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("file_path", sa.String(), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("extracted_json", sa.JSON(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )

    # ───── publications ─────────────────────────────────────────────
    op.create_table(
        "publications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("venue", sa.String(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("authors", sa.JSON(), nullable=True),
        sa.Column("my_author_order", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="published"),
        sa.Column("doi", sa.String(), nullable=True),
        sa.Column("url", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )

    # ───── ai_runs ──────────────────────────────────────────────────
    op.create_table(
        "ai_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workflow", sa.String(), nullable=False, index=True),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="queued", index=True),
        sa.Column("prompt_hash", sa.String(), nullable=True),
        sa.Column("prompt_text", sa.Text(), nullable=True),
        sa.Column("output", sa.Text(), nullable=True),
        sa.Column("tokens_in", sa.Integer(), nullable=True),
        sa.Column("tokens_out", sa.Integer(), nullable=True),
        sa.Column("cost_usd", sa.Float(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("professor_id", sa.Integer(), sa.ForeignKey("professors.id"), nullable=True, index=True),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("documents.id"), nullable=True, index=True),
        sa.Column("grant_id", sa.Integer(), nullable=True, index=True),  # FK added below after rename
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )

    # ───── recommenders ─────────────────────────────────────────────
    op.create_table(
        "recommenders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("relationship", sa.String(), nullable=True),
        sa.Column("affiliation", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )

    # ───── applications ─────────────────────────────────────────────
    op.create_table(
        "applications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("professor_id", sa.Integer(), sa.ForeignKey("professors.id"), nullable=True, index=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="planning", index=True),
        sa.Column("portal_url", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
    )

    # ───── application_recommenders (join) ──────────────────────────
    op.create_table(
        "application_recommenders",
        sa.Column("application_id", sa.Integer(), sa.ForeignKey("applications.id"), primary_key=True),
        sa.Column("recommender_id", sa.Integer(), sa.ForeignKey("recommenders.id"), primary_key=True),
        sa.Column("letter_status", sa.String(), nullable=False, server_default="asked"),
        sa.Column("letter_due_date", sa.Date(), nullable=True),
        sa.Column("last_nudge_sent_at", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )

    # ───── email_replies ────────────────────────────────────────────
    op.create_table(
        "email_replies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("draft_id", sa.Integer(), sa.ForeignKey("email_drafts.id"), nullable=False, index=True),
        sa.Column("thread_url", sa.String(), nullable=True),
        sa.Column("received_at", sa.DateTime(), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("classified_sentiment", sa.String(), nullable=True),
        sa.Column("resulting_status_change", sa.String(), nullable=True),
    )

    # ───── fellowships → grants (rename + extend) ───────────────────
    # Note: FK from ai_runs.grant_id → grants.id is enforced at the SQLAlchemy
    # model layer, not via a DB-level constraint (SQLite ALTER TABLE limits).
    op.rename_table("fellowships", "grants")
    op.add_column("grants", sa.Column("source", sa.String(), nullable=False, server_default="manual"))
    op.add_column("grants", sa.Column("match_score", sa.Integer(), nullable=True))
    op.add_column("grants", sa.Column("matched_reasons", sa.JSON(), nullable=True))
    op.add_column("grants", sa.Column("region", sa.String(), nullable=True))
    op.add_column("grants", sa.Column("discipline_tags", sa.JSON(), nullable=True))

    # ───── extend professors ────────────────────────────────────────
    op.add_column("professors", sa.Column("scholar_url", sa.String(), nullable=True))
    op.add_column("professors", sa.Column("twitter", sa.String(), nullable=True))
    op.add_column("professors", sa.Column("lab_url", sa.String(), nullable=True))
    op.add_column("professors", sa.Column("last_research_summary", sa.Text(), nullable=True))
    op.add_column("professors", sa.Column("research_summary_at", sa.DateTime(), nullable=True))
    op.add_column("professors", sa.Column("auto_filled_at", sa.DateTime(), nullable=True))
    op.add_column("professors", sa.Column("source", sa.String(), nullable=False, server_default="manual"))
    op.add_column("professors", sa.Column("is_suggested", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("professors", sa.Column("dismissed_at", sa.DateTime(), nullable=True))
    op.add_column("professors", sa.Column("match_score", sa.Integer(), nullable=True))

    # ───── extend email_drafts ──────────────────────────────────────
    # FK from email_drafts.ai_run_id → ai_runs.id also lives in models, not DDL.
    op.add_column("email_drafts", sa.Column("ai_generated", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("email_drafts", sa.Column("ai_run_id", sa.Integer(), nullable=True))
    op.add_column("email_drafts", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("email_drafts", sa.Column("sent_via", sa.String(), nullable=True))

    # ───── seed: singleton user + settings ──────────────────────────
    now = datetime.utcnow().isoformat(sep=" ", timespec="seconds")
    op.execute(
        f"INSERT INTO users (id, name, email, current_role, affiliation, country, "
        f"created_at, updated_at) VALUES (1, '', NULL, NULL, NULL, NULL, '{now}', '{now}')"
    )
    op.execute(
        "INSERT INTO settings (id, ai_provider, daily_cost_cap_usd, ui_density) "
        "VALUES (1, 'claude_cli', 5.0, 'comfortable')"
    )


# ───────────────────────────────────────────────────────────────────
# Downgrade
# ───────────────────────────────────────────────────────────────────
def downgrade() -> None:
    # Note: dropping columns on SQLite still requires batch mode (table recreate).
    # Use only when truly needed; in practice we'd usually re-init the DB.
    with op.batch_alter_table("email_drafts") as batch:
        batch.drop_column("sent_via")
        batch.drop_column("version")
        batch.drop_column("ai_run_id")
        batch.drop_column("ai_generated")

    with op.batch_alter_table("professors") as batch:
        batch.drop_column("match_score")
        batch.drop_column("dismissed_at")
        batch.drop_column("is_suggested")
        batch.drop_column("source")
        batch.drop_column("auto_filled_at")
        batch.drop_column("research_summary_at")
        batch.drop_column("last_research_summary")
        batch.drop_column("lab_url")
        batch.drop_column("twitter")
        batch.drop_column("scholar_url")

    with op.batch_alter_table("grants") as batch:
        batch.drop_column("discipline_tags")
        batch.drop_column("region")
        batch.drop_column("matched_reasons")
        batch.drop_column("match_score")
        batch.drop_column("source")
    op.rename_table("grants", "fellowships")

    op.drop_table("email_replies")
    op.drop_table("application_recommenders")
    op.drop_table("applications")
    op.drop_table("recommenders")
    op.drop_table("ai_runs")
    op.drop_table("publications")
    op.drop_table("documents")
    op.drop_table("settings")
    op.drop_table("users")
