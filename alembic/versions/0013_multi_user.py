"""Multi-user conversion: real account identity on `users`, plus a `user_id`
FK on every table that was previously an implicit global singleton.

Data backfill: any pre-existing rows (there was ever only one implicit
"user") get assigned to the first `users` row by id. If POSTDOC_MIGRATION_OWNER_EMAIL
is set, that first user also gets `account_email` + a freshly generated
temporary password (bcrypt-hashed, printed once to migration stdout for
out-of-band handoff — never stored anywhere else). If the env var is unset,
`account_email`/`password_hash` are left NULL for that row; an operator can
set them later (e.g. via a follow-up UPDATE) before that account can log in
through the web UI. `account_email`/`password_hash` are intentionally left
nullable at the DB level (enforced at signup time by the application) since
we cannot guarantee every legacy row has real credentials at migration time.

Revision ID: 0013_multi_user
Revises: 0012_discovery_phase2
Create Date: 2026-07-03
"""
import os
import secrets
from typing import Sequence, Union

import bcrypt
import sqlalchemy as sa
from alembic import op


revision: str = "0013_multi_user"
down_revision: Union[str, None] = "0012_discovery_phase2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Tables that get a plain `user_id` FK, backfilled then made NOT NULL.
USER_SCOPED_TABLES = [
    "settings",
    "professors",
    "discovery_runs",
    "email_drafts",
    "email_replies",
    "interview_prep",
    "mock_interview",
    "grants",
    "activities",
    "documents",
    "publications",
    "ai_runs",
    "recommenders",
    "applications",
    "calendar_events",
]


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("account_email", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("password_hash", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1")
        )
    op.create_index("ix_users_account_email", "users", ["account_email"], unique=True)

    for table in USER_SCOPED_TABLES:
        with op.batch_alter_table(table) as batch_op:
            batch_op.add_column(sa.Column("user_id", sa.Integer(), nullable=True))
        # `settings.user_id` is unique (one settings row per user) — matches
        # the model's `Column(..., index=True, unique=True)` declaration.
        op.create_index(
            f"ix_{table}_user_id", table, ["user_id"], unique=(table == "settings")
        )

    op.create_index(
        "ix_professors_user_id_status", "professors", ["user_id", "status"]
    )
    op.create_index(
        "ix_activities_user_id_created_at", "activities", ["user_id", "created_at"]
    )
    op.create_index(
        "ix_ai_runs_user_id_created_at", "ai_runs", ["user_id", "created_at"]
    )

    # ── Data backfill ──
    conn = op.get_bind()
    first_user_id = conn.execute(
        sa.text("SELECT id FROM users ORDER BY id LIMIT 1")
    ).scalar()

    if first_user_id is not None:
        for table in USER_SCOPED_TABLES:
            conn.execute(
                sa.text(f"UPDATE {table} SET user_id = :uid WHERE user_id IS NULL"),
                {"uid": first_user_id},
            )

        owner_email = (os.environ.get("POSTDOC_MIGRATION_OWNER_EMAIL") or "").strip().lower()
        if owner_email:
            temp_password = secrets.token_urlsafe(12)
            password_hash = bcrypt.hashpw(
                temp_password.encode("utf-8"), bcrypt.gensalt(12)
            ).decode("utf-8")
            conn.execute(
                sa.text(
                    "UPDATE users SET account_email = :email, password_hash = :hash, "
                    "is_active = 1 WHERE id = :uid"
                ),
                {"email": owner_email, "hash": password_hash, "uid": first_user_id},
            )
            print(
                f"\n[0013_multi_user] Assigned account_email={owner_email!r} to "
                f"users.id={first_user_id}.\n"
                f"[0013_multi_user] TEMPORARY PASSWORD (copy now — this is the only "
                f"time it is printed): {temp_password}\n"
            )

        # Every pre-existing row now has a concrete user_id — safe to enforce.
        for table in USER_SCOPED_TABLES:
            with op.batch_alter_table(table) as batch_op:
                batch_op.alter_column("user_id", nullable=False)
    else:
        # Fresh install with no existing users row — tables are empty, so the
        # NOT NULL constraint is safe to apply immediately.
        for table in USER_SCOPED_TABLES:
            with op.batch_alter_table(table) as batch_op:
                batch_op.alter_column("user_id", nullable=False)


def downgrade() -> None:
    for table in USER_SCOPED_TABLES:
        with op.batch_alter_table(table) as batch_op:
            batch_op.alter_column("user_id", nullable=True)

    op.drop_index("ix_ai_runs_user_id_created_at", table_name="ai_runs")
    op.drop_index("ix_activities_user_id_created_at", table_name="activities")
    op.drop_index("ix_professors_user_id_status", table_name="professors")

    for table in reversed(USER_SCOPED_TABLES):
        op.drop_index(f"ix_{table}_user_id", table_name=table)
        with op.batch_alter_table(table) as batch_op:
            batch_op.drop_column("user_id")

    op.drop_index("ix_users_account_email", table_name="users")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("is_active")
        batch_op.drop_column("password_hash")
        batch_op.drop_column("account_email")
