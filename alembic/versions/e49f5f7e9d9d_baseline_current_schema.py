"""baseline — current schema (4 tables: professors, email_drafts, fellowships, activities)

This migration is a marker for the schema as it existed before the v1 redesign.
The live DB was created via Base.metadata.create_all(). To bring an existing
install under Alembic control:

    alembic stamp e49f5f7e9d9d

That marks the DB as already at baseline without running any DDL. New installs
will go through `alembic upgrade head` from scratch (which runs this migration
as a no-op, then v1_redesign).

Revision ID: e49f5f7e9d9d
Revises:
Create Date: 2026-05-05
"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = "e49f5f7e9d9d"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # No-op: this revision is the marker for the pre-redesign schema.
    # The actual tables are defined in app/models.py and were created by
    # Base.metadata.create_all() at first run.
    pass


def downgrade() -> None:
    # Nothing to undo.
    pass
