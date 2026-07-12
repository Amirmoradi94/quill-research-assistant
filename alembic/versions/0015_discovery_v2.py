"""Discovery v2 (retrieval-first) — query-profile cache + candidate enrichment.

Adds:
  * users: cached OpenAlex topics / research summary / embedding for discovery.
  * discovery_candidates: OpenAlex/Semantic-Scholar enrichment signals.
  * settings: web-search provider key for contact resolution.

All columns are nullable with sane server defaults, so this applies cleanly to
existing rows.

Revision ID: 0015_discovery_v2
Revises: 0014_credit_cap
Create Date: 2026-07-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0015_discovery_v2"
down_revision: Union[str, None] = "0014_credit_cap"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("discovery_topic_ids", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("discovery_summary", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("discovery_embedding", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("discovery_profile_built_at", sa.DateTime(), nullable=True))

    with op.batch_alter_table("settings") as batch_op:
        batch_op.add_column(sa.Column("websearch_api_key", sa.String(), nullable=True))

    with op.batch_alter_table("discovery_candidates") as batch_op:
        batch_op.add_column(sa.Column("openalex_author_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("orcid", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("s2_author_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("works_count", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("cited_by_count", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("h_index", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("first_pub_year", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("career_stage", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("topic_match_count", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("semantic_score", sa.Float(), nullable=True))
        batch_op.create_index("ix_discovery_candidates_openalex_author_id", ["openalex_author_id"])


def downgrade() -> None:
    with op.batch_alter_table("discovery_candidates") as batch_op:
        batch_op.drop_index("ix_discovery_candidates_openalex_author_id")
        batch_op.drop_column("semantic_score")
        batch_op.drop_column("topic_match_count")
        batch_op.drop_column("career_stage")
        batch_op.drop_column("first_pub_year")
        batch_op.drop_column("h_index")
        batch_op.drop_column("cited_by_count")
        batch_op.drop_column("works_count")
        batch_op.drop_column("s2_author_id")
        batch_op.drop_column("orcid")
        batch_op.drop_column("openalex_author_id")

    with op.batch_alter_table("settings") as batch_op:
        batch_op.drop_column("websearch_api_key")

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("discovery_profile_built_at")
        batch_op.drop_column("discovery_embedding")
        batch_op.drop_column("discovery_summary")
        batch_op.drop_column("discovery_topic_ids")
