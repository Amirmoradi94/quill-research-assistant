#!/usr/bin/env python3
"""Re-score every ProfessorPaper.relevance_score against the current user.

The paper relevance_score is computed at fetch time against the user's
research interests. If the user profile changes (e.g., a test persona
got swapped back to the real user), every paper's score becomes stale.

This script recomputes ProfessorPaper.relevance_score in-place using the
same _relevance_score() function from fetch_papers.py, without re-hitting
Semantic Scholar.

Usage (from dashboard/):
    POSTDOC_DB=data/postdoc.db python scripts/rescore_papers.py
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("POSTDOC_DB", str(Path(__file__).resolve().parent.parent / "data" / "postdoc.db"))

from app.database import SessionLocal
from app import models


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z]{4,}", text.lower()))


def _relevance_score(title: str | None, abstract: str | None, user_tokens: set[str]) -> int:
    haystack = " ".join(filter(None, [title, abstract]))
    paper_tokens = _tokens(haystack)
    if not paper_tokens or not user_tokens:
        return 0
    overlap = len(paper_tokens & user_tokens)
    return min(100, int(overlap / max(len(user_tokens) * 0.15, 1) * 100))


def main() -> None:
    db = SessionLocal()
    try:
        user = db.get(models.User, 1)
        if not user:
            print("ERROR: no user row")
            return
        cats = user.research_categories or []
        user_tokens = _tokens(
            f"{user.research_interests or ''} {' '.join(cats if isinstance(cats, list) else [])}"
        )
        if not user_tokens:
            print("ERROR: user has no research_interests")
            return
        print(f"User: {user.name}")
        print(f"Tokens ({len(user_tokens)}): {sorted(user_tokens)[:20]}{'...' if len(user_tokens)>20 else ''}")
        print()

        papers = db.query(models.ProfessorPaper).all()
        print(f"Re-scoring {len(papers)} papers...")
        bands_before = {"0": 0, "1-49": 0, "50+": 0}
        bands_after = {"0": 0, "1-49": 0, "50+": 0}
        for p in papers:
            before = p.relevance_score or 0
            after = _relevance_score(p.title, p.abstract, user_tokens)
            p.relevance_score = after
            for s, b in [(before, bands_before), (after, bands_after)]:
                if s == 0: b["0"] += 1
                elif s < 50: b["1-49"] += 1
                else: b["50+"] += 1
        db.commit()
        print(f"  before: {bands_before}")
        print(f"  after:  {bands_after}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
