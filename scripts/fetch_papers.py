#!/usr/bin/env python3
"""Batch-fetch Semantic Scholar papers for all professors who have none.

Usage (from the dashboard/ directory):
    POSTDOC_DB=data/postdoc.db python scripts/fetch_papers.py
    POSTDOC_DB=data/postdoc.db python scripts/fetch_papers.py --all   # re-fetch even if papers exist

Concurrency is capped so we stay within S2's rate limit (~100 req/5 min
unauthenticated). Each professor needs 2 API calls; we run 4 professors in
parallel → 8 concurrent calls max, well under the cap.

Architecture:
  Phase 1 — all S2 fetches run concurrently (asyncio + semaphore), no DB.
  Phase 2 — results written to DB sequentially with a single session.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("POSTDOC_DB", str(Path(__file__).resolve().parent.parent / "data" / "postdoc.db"))

from app.database import SessionLocal
from app import models
from app.semantic_scholar import fetch_professor_papers


CONCURRENCY = 1
S2_DELAY_S  = 3.0


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z]{4,}", text.lower()))


def _relevance_score(paper: dict, user_tokens: set[str]) -> int:
    haystack = " ".join(filter(None, [paper.get("title"), paper.get("abstract")]))
    paper_tokens = _tokens(haystack)
    if not paper_tokens or not user_tokens:
        return 0
    overlap = len(paper_tokens & user_tokens)
    return min(100, int(overlap / max(len(user_tokens) * 0.15, 1) * 100))


# ─── Phase 1: fetch papers for one professor ─────────────────────────────────

async def fetch_one(
    prof_id: int,
    prof_name: str,
    prof_uni: str,
    sem: asyncio.Semaphore,
) -> tuple[int, list[dict]]:
    """Return (prof_id, papers). Empty list on failure."""
    try:
        async with sem:
            papers = await fetch_professor_papers(prof_name, prof_uni, limit=30)
            await asyncio.sleep(S2_DELAY_S)
        if papers:
            print(f"  s2    {prof_name[:42]:42s} → {len(papers)} papers")
        else:
            print(f"  none  {prof_name[:42]:42s} — no results on S2")
        return prof_id, papers
    except Exception as exc:
        print(f"  ERROR {prof_name[:42]:42s} — {exc}")
        return prof_id, []


# ─── Phase 2: write results to DB ────────────────────────────────────────────

def save_papers(
    db,
    prof_id: int,
    papers: list[dict],
    user_tokens: set[str],
    refetch: bool,
) -> int:
    if not refetch:
        existing = db.query(models.ProfessorPaper).filter_by(professor_id=prof_id).count()
        if existing > 0:
            return 0   # skip

    if not papers:
        return 0

    scored = sorted(
        papers,
        key=lambda p: (_relevance_score(p, user_tokens), p.get("year") or 0),
        reverse=True,
    )

    db.query(models.ProfessorPaper).filter_by(professor_id=prof_id).delete()
    saved = 0
    for p in scored[:20]:
        db.add(models.ProfessorPaper(
            professor_id=prof_id,
            title=p["title"],
            venue=p.get("venue") or None,
            year=p.get("year"),
            abstract=p.get("abstract") or None,
            url=p.get("url"),
            pdf_url=p.get("pdf_url"),
            s2_id=p.get("s2_id"),
            relevance_score=_relevance_score(p, user_tokens),
            relevance_summary=None,
            fetched_at=datetime.utcnow(),
        ))
        saved += 1
    return saved


# ─── main ────────────────────────────────────────────────────────────────────

async def main(refetch: bool) -> None:
    # Read professors and user profile from DB upfront.
    db = SessionLocal()
    try:
        user = db.get(models.User, 1)
        user_tokens = _tokens(f"{user.research_interests or ''} {' '.join(user.research_categories or [])}")
        professors = [(p.id, p.name, p.university or "") for p in db.query(models.Professor).order_by(models.Professor.id).all()]
    finally:
        db.close()

    if not user_tokens:
        print("WARNING: user has no research_interests — relevance scores will all be 0")
    print(f"Enriching {len(professors)} professors  (refetch={'yes' if refetch else 'skip existing'})")
    print(f"User tokens (sample): {sorted(user_tokens)[:12]}")
    print()

    # Phase 1: fetch all papers concurrently.
    sem = asyncio.Semaphore(CONCURRENCY)
    results: list[tuple[int, list[dict]]] = await asyncio.gather(*[
        fetch_one(pid, name, uni, sem)
        for pid, name, uni in professors
    ])

    # Phase 2: write to DB sequentially with one session.
    print()
    print("Writing to database...")
    db = SessionLocal()
    total_saved = 0
    total_skipped = 0
    try:
        for (prof_id, papers) in results:
            n = save_papers(db, prof_id, papers, user_tokens, refetch)
            if n > 0:
                total_saved += n
            else:
                total_skipped += 1
        db.commit()
    finally:
        db.close()

    print()
    print(f"Done. {total_saved} papers saved across professors ({total_skipped} skipped / no papers).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", dest="refetch", action="store_true",
                        help="Re-fetch even if professor already has papers")
    args = parser.parse_args()
    asyncio.run(main(refetch=args.refetch))
