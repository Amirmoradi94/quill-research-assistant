#!/usr/bin/env python3
"""Mark existing drafts as backup (hidden from dashboard but kept in DB).

This one-time migration marks all current email_drafts as backup so they're
hidden from the Drafts, Batches, and ProfessorDetail views. New drafts created
via redraft_all_emails.py will be marked as active (is_backup=0).

Usage:
    python3 scripts/migrate_drafts_to_backup.py
"""
import os
import sqlite3
from pathlib import Path

DB_PATH = os.environ.get("POSTDOC_DB", str(Path(__file__).resolve().parent.parent / "data" / "postdoc.db"))


def main() -> None:
    conn = sqlite3.connect(DB_PATH)

    # Check if is_backup column exists
    cursor = conn.execute("PRAGMA table_info(email_drafts)")
    cols = {row[1] for row in cursor.fetchall()}

    if "is_backup" not in cols:
        print("Adding is_backup column to email_drafts table...")
        conn.execute("ALTER TABLE email_drafts ADD COLUMN is_backup BOOLEAN DEFAULT 0")
        conn.commit()

    # Mark only OLDER drafts as backup; keep the most recent per professor as active
    backed_up = conn.execute("""
        UPDATE email_drafts
        SET is_backup = 1
        WHERE id NOT IN (
            SELECT id FROM email_drafts ed1
            WHERE created_at = (
                SELECT MAX(created_at) FROM email_drafts ed2
                WHERE ed2.professor_id = ed1.professor_id
            )
        )
    """).rowcount
    kept_active = conn.execute(
        "SELECT COUNT(*) FROM email_drafts WHERE is_backup = 0"
    ).fetchone()[0]
    conn.commit()

    print(f"✓ Backed up {backed_up} older drafts")
    print(f"✓ Kept {kept_active} most-recent drafts active (one per professor)")
    print("✓ Old drafts hidden from dashboard but preserved in database")

    conn.close()


if __name__ == "__main__":
    main()
