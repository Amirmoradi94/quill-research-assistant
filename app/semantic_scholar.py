"""Semantic Scholar API client for fetching professor papers.

Free public API — no key required for low-volume use.
Rate limit: ~100 req/5min unauthenticated. We stay well under that.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)

S2_BASE = "https://api.semanticscholar.org/graph/v1"
_PAPER_FIELDS = "title,year,venue,abstract,openAccessPdf,externalIds,url"
_AUTHOR_FIELDS = "name,affiliations,paperCount"


async def _get(client: httpx.AsyncClient, url: str, params: dict, retries: int = 5) -> dict | None:
    for attempt in range(retries):
        try:
            r = await client.get(url, params=params, timeout=15)
            if r.status_code == 429:
                wait = 2 ** (attempt + 1)
                log.warning("S2 rate-limited, retrying in %ds...", wait)
                await asyncio.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except httpx.HTTPStatusError:
            raise
        except Exception as exc:
            log.warning("S2 request failed: %s — %s", url, exc)
            return None
    log.warning("S2 request gave up after %d retries: %s", retries, url)
    return None


async def fetch_professor_papers(
    name: str,
    university: str | None = None,
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Return up to `limit` recent papers for the named author.

    Strategy:
      1. Search S2 author by name only (affiliation in query string breaks the API).
      2. Pick best-matching candidate by name similarity + highest paper count.
      3. Fetch their papers sorted by year desc.
      4. Return structured dicts with title, year, venue, abstract, url, pdf_url.
    """
    if not name:
        return []

    async with httpx.AsyncClient() as client:
        data = await _get(client, f"{S2_BASE}/author/search", {
            "query": name,
            "fields": _AUTHOR_FIELDS,
            "limit": 8,
        })
        if not data or not data.get("data"):
            log.info("S2: no author found for '%s'", name)
            return []

        candidates = data["data"]
        author_id = _best_author(candidates, name, university)
        if not author_id:
            log.info("S2: could not match author from candidates: %s", [c.get("name") for c in candidates])
            return []

        papers_data = await _get(client, f"{S2_BASE}/author/{author_id}/papers", {
            "fields": _PAPER_FIELDS,
            "limit": limit,
            "sort": "year:desc",
        })
        if not papers_data or not papers_data.get("data"):
            return []

        results = []
        for p in papers_data["data"]:
            if not p.get("title"):
                continue
            oap = p.get("openAccessPdf") or {}
            ext = p.get("externalIds") or {}
            arxiv_id = ext.get("ArXiv")
            results.append({
                "title": p["title"],
                "year": p.get("year"),
                "venue": p.get("venue") or "",
                "abstract": p.get("abstract") or "",
                "url": p.get("url") or (f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else None),
                "pdf_url": oap.get("url"),
                "s2_id": p.get("paperId"),
            })
        return results


def _affiliation_tokens(university: str | None) -> set[str]:
    """Pull short, distinctive tokens out of a university string.

    e.g. "HEC Montréal" → {"hec", "montreal"}
         "Polytechnique Montréal" → {"polytechnique", "montreal"}
         "École de technologie supérieure (ÉTS)" → {"ets", "ecole", "technologie", "superieure"}
    Strips diacritics so accented and unaccented affiliation spellings match.
    """
    if not university:
        return set()
    import re, unicodedata
    norm = unicodedata.normalize("NFKD", university).encode("ascii", "ignore").decode("ascii").lower()
    tokens = re.findall(r"[a-z]{2,}", norm)
    stop = {"de", "of", "the", "and", "et", "du", "la", "le", "en", "at", "for", "university", "universite", "college"}
    return {t for t in tokens if t not in stop}


def _best_author(candidates: list[dict], name: str, university: str | None = None) -> str | None:
    """Pick the S2 author ID that best matches the given name (and affiliation, if provided).

    Scoring, in priority order:
      1. Name token overlap (required — candidates with 0 overlap are skipped).
      2. Exact full-name match bonus.
      3. Affiliation token overlap with the university (BIG bonus per token —
         a single matching affiliation token outweighs a 1000-paper homonym).
      4. Paper count, as a final tie-breaker.

    Without (3), common names like "Jorge Mendoza" route to the homonym with
    the most papers (often a prolific clinical author) instead of the target.
    """
    name_parts = set(name.lower().split())
    aff_tokens = _affiliation_tokens(university)

    # Pre-pass: check if ANY candidate has affiliation data. S2 commonly returns
    # affiliations=[] for everyone, which makes the affiliation signal useless
    # and forces us to fall back to paper count.
    any_aff_data = any(c.get("affiliations") for c in candidates)

    # Compute the candidate surname (last token of the input name) for the
    # no-affiliation fallback: a candidate must at least share the surname to
    # be a plausible homonym/variant.
    surname = (name.lower().split() or [""])[-1]

    scored: list[tuple[int, int, str]] = []  # (composite_score, paper_count, author_id)
    for c in candidates:
        author_id = c.get("authorId")
        if not author_id:
            continue
        cname_parts = set((c.get("name") or "").lower().split())
        overlap = len(name_parts & cname_parts)
        if overlap == 0:
            continue
        paper_count = c.get("paperCount") or 0
        exact_bonus = 100 if name_parts == cname_parts else 0

        # Affiliation match: union the candidate's affiliation strings into one
        # token set and count overlap with the user-supplied university tokens.
        aff_match = 0
        if aff_tokens and any_aff_data:
            cand_aff_tokens: set[str] = set()
            for aff in (c.get("affiliations") or []):
                cand_aff_tokens |= _affiliation_tokens(aff)
            aff_match = len(aff_tokens & cand_aff_tokens)

        score = overlap * 10 + exact_bonus + aff_match * 1000
        scored.append((score, paper_count, author_id))

    if not scored:
        return None

    # When S2 returned no affiliation data at all, the matcher can't see the
    # difference between a prolific homonym and the intended lower-paper-count author.
    # and "Foutse Khomh" (7-paper stub of the same person). The exact-name
    # bonus pushes the stub to win. Detect this case and fall back to
    # paper-count among candidates that share the surname AND aren't tiny
    # stubs (≥10 papers). This fixes the duplicate-author-ID problem without
    # opening the door wide enough to let unrelated homonyms in (those usually
    # don't share a 5×-or-more paper-count gap with the real target).
    if not any_aff_data:
        eligible = [
            (papers, aid) for (sc, papers, aid), c in zip(scored, candidates)
            if surname in set((c.get("name") or "").lower().split())
            and papers >= 10
        ]
        if eligible:
            eligible.sort(reverse=True)
            top_papers, top_id = eligible[0]
            # Use the prolific candidate only if it's clearly the dominant
            # variant — at least 3× the second candidate's paper count, or
            # the only one above the threshold.
            second_papers = eligible[1][0] if len(eligible) > 1 else 0
            if top_papers >= max(30, second_papers * 3):
                return top_id

    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return scored[0][2]
