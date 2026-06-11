#!/usr/bin/env python3
"""Retroactively clean Professor.hiring_notes for all existing rows.

Strips website nav/chrome (menu items, breadcrumbs, social media links)
that the heuristic scraper dumped into the field. Idempotent — safe to
re-run.

Usage (from dashboard/):
    POSTDOC_DB=data/postdoc.db python scripts/clean_hiring_notes.py
    POSTDOC_DB=data/postdoc.db python scripts/clean_hiring_notes.py --dry-run
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
DB_PATH = os.environ.get("POSTDOC_DB", str(Path(__file__).resolve().parent.parent / "data" / "postdoc.db"))

from app.text_cleaner import clean_scraped_text


def main(dry_run: bool) -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT id, name, hiring_notes FROM professors WHERE hiring_notes IS NOT NULL"
        ).fetchall()
        print(f"{len(rows)} professors have hiring_notes; cleaning...")
        changed = 0
        total_before = 0
        total_after = 0
        updates: list[tuple[str | None, int]] = []
        for r in rows:
            before = r["hiring_notes"] or ""
            after = clean_scraped_text(before)
            total_before += len(before)
            total_after += len(after)
            if after != before:
                changed += 1
                if dry_run:
                    print(f"  {r['id']:4d}  {r['name'][:32]:32s}  {len(before):5d} → {len(after):5d} chars")
                updates.append((after if after else None, r["id"]))
        if not dry_run and updates:
            conn.executemany("UPDATE professors SET hiring_notes = ? WHERE id = ?", updates)
            conn.commit()
        savings = total_before - total_after
        pct = (savings * 100 / total_before) if total_before else 0
        print()
        print(f"Total: {len(rows)} processed, {changed} changed")
        print(f"Bytes: {total_before:,} → {total_after:,}  (saved {savings:,}, {pct:.1f}%)")
        if dry_run:
            print("\n(dry-run — no changes committed)")
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Show changes without writing to DB")
    args = parser.parse_args()
    main(dry_run=args.dry_run)
