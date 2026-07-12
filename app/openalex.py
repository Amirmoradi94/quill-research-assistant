"""OpenAlex API client for retrieval-first discovery.

OpenAlex is a free, open scholarly graph (the successor to Microsoft Academic
Graph). No API key is required; passing a contact email joins the faster,
more-reliable "polite pool" (set OPENALEX_MAILTO).

Design mirrors `scraper_client` / `semantic_scholar`: every public coroutine is
defensive — it logs and returns an empty result instead of raising, so a flaky
upstream never crashes a discovery run. A process-wide rate limiter keeps us
under OpenAlex's ~10 req/s guidance.

Public API:
  topics_for_text(title, abstract)      -> list[{"id","display_name","score"}]
  works_for_topics(topic_ids, ...)      -> list[work dict]  (authorships parsed)
  authors_by_ids(author_ids)            -> dict[author_id -> author dict]
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Iterable

import httpx

log = logging.getLogger(__name__)

OPENALEX_BASE = "https://api.openalex.org"
MAILTO = os.environ.get("OPENALEX_MAILTO", "quill@devnook.xyz")

# OpenAlex asks for <=10 req/s. Keep a conservative floor between requests.
_MIN_INTERVAL_S = 0.15
_rate_lock = asyncio.Lock()
_last_request_at = 0.0

_MAX_PER_PAGE = 200
# OR-batch size for /authors — keep the filter URL comfortably short.
_AUTHOR_BATCH = 25


async def _throttle() -> None:
    global _last_request_at
    async with _rate_lock:
        now = time.monotonic()
        wait = _MIN_INTERVAL_S - (now - _last_request_at)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_request_at = time.monotonic()


def _short_id(value: str | None) -> str | None:
    """'https://openalex.org/A123' or 'A123' -> 'A123'. Topics -> 'T123'."""
    if not value:
        return None
    return str(value).rstrip("/").split("/")[-1]


async def _get(
    client: httpx.AsyncClient,
    path: str,
    params: dict[str, Any],
    retries: int = 4,
) -> dict | None:
    """GET a single OpenAlex endpoint; returns parsed JSON or None (never raises)."""
    params = {**params, "mailto": MAILTO}
    url = f"{OPENALEX_BASE}{path}"
    for attempt in range(retries):
        await _throttle()
        try:
            r = await client.get(url, params=params, timeout=30)
            if r.status_code == 429:
                wait = 2 ** (attempt + 1)
                log.warning("OpenAlex rate-limited, retrying in %ds", wait)
                await asyncio.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except Exception as exc:  # noqa: BLE001 - defensive: never crash a run
            log.warning("OpenAlex request failed (%s): %s", path, exc)
            if attempt + 1 >= retries:
                return None
            await asyncio.sleep(1 + attempt)
    return None


# ───────────────────────────────────────────────────────────────────
# Topic tagging — ground the user in OpenAlex's taxonomy
# ───────────────────────────────────────────────────────────────────
async def topics_for_text(title: str, abstract: str = "") -> list[dict[str, Any]]:
    """Tag free text with OpenAlex topics via the /text/topics endpoint.

    Returns up to a handful of {"id": "T10603", "display_name", "score"} dicts,
    highest-score first. Empty on any failure.
    """
    title = (title or "").strip()
    abstract = (abstract or "").strip()
    if not title and not abstract:
        return []
    # Keep inputs short: the endpoint is GET-based (URL-length limited) and
    # topic tagging is most accurate on focused text, not a whole-CV dump.
    params: dict[str, Any] = {}
    if title:
        params["title"] = title[:400]
    if abstract:
        params["abstract"] = abstract[:800]
    async with httpx.AsyncClient() as client:
        data = await _get(client, "/text/topics", params)
    if not data:
        return []
    out: list[dict[str, Any]] = []
    for t in data.get("topics") or []:
        sid = _short_id(t.get("id"))
        if not sid:
            continue
        out.append({
            "id": sid,
            "display_name": t.get("display_name"),
            "score": t.get("score"),
        })
    return out


async def topics_from_publications(titles: list[str], per_title: int = 1) -> list[dict[str, Any]]:
    """Derive topics from the user's OWN papers by looking them up in OpenAlex
    and reading their pre-assigned topics.

    More robust than /text/topics (higher rate limit, grounded in real published
    work). Aggregates topics across matched papers, summing scores, and returns
    them ranked. Empty if nothing matches.
    """
    titles = [t.strip() for t in titles if t and t.strip()][:6]
    if not titles:
        return []
    agg: dict[str, dict[str, Any]] = {}
    async with httpx.AsyncClient() as client:
        for title in titles:
            page = await _get(client, "/works", {
                "search": title[:300],
                "per-page": per_title,
                "select": "id,title,topics",
            })
            if not page:
                continue
            for w in page.get("results") or []:
                for t in w.get("topics") or []:
                    sid = _short_id(t.get("id"))
                    if not sid:
                        continue
                    entry = agg.setdefault(sid, {"id": sid, "display_name": t.get("display_name"), "score": 0.0})
                    entry["score"] += float(t.get("score") or 0)
    return sorted(agg.values(), key=lambda x: x["score"], reverse=True)


# ───────────────────────────────────────────────────────────────────
# Works retrieval — recent papers in the user's topics + target countries
# ───────────────────────────────────────────────────────────────────
def _parse_work(work: dict[str, Any]) -> dict[str, Any]:
    authors: list[dict[str, Any]] = []
    for a in work.get("authorships") or []:
        au = a.get("author") or {}
        insts = []
        for inst in a.get("institutions") or []:
            insts.append({
                "name": inst.get("display_name"),
                "country_code": (inst.get("country_code") or "").lower() or None,
                "ror": inst.get("ror"),
                "id": _short_id(inst.get("id")),
            })
        authors.append({
            "id": _short_id(au.get("id")),
            "name": au.get("display_name"),
            "institutions": insts,
        })
    return {
        "id": _short_id(work.get("id")),
        "title": work.get("title") or work.get("display_name"),
        "year": work.get("publication_year"),
        "authors": authors,
    }


async def works_for_topics(
    topic_ids: Iterable[str],
    country_codes: Iterable[str] | None = None,
    from_date: str | None = None,
    max_works: int = 400,
) -> list[dict[str, Any]]:
    """Retrieve recent works whose topics overlap the user's, optionally scoped
    to author institutions in the target countries.

    Args:
      topic_ids:      OpenAlex short topic ids, e.g. ["T10603", "T10604"].
      country_codes:  ISO-2 codes (lowercased), matched against author institutions.
      from_date:      "YYYY-MM-DD" lower bound on publication date.
      max_works:      hard cap across all pages.

    Returns parsed work dicts (see `_parse_work`). Empty on failure.
    """
    topic_ids = [t for t in (_short_id(t) for t in topic_ids) if t]
    if not topic_ids:
        return []

    filters = [f"topics.id:{'|'.join(topic_ids)}", "is_paratext:false"]
    if from_date:
        filters.append(f"from_publication_date:{from_date}")
    codes = [c.lower() for c in (country_codes or []) if c]
    if codes:
        filters.append(f"authorships.institutions.country_code:{'|'.join(codes)}")

    params = {
        "filter": ",".join(filters),
        "per-page": min(_MAX_PER_PAGE, max_works),
        "select": "id,title,publication_year,authorships",
        "sort": "cited_by_count:desc",
    }

    results: list[dict[str, Any]] = []
    cursor = "*"
    async with httpx.AsyncClient() as client:
        while cursor and len(results) < max_works:
            page = await _get(client, "/works", {**params, "cursor": cursor})
            if not page:
                break
            for w in page.get("results") or []:
                results.append(_parse_work(w))
                if len(results) >= max_works:
                    break
            cursor = (page.get("meta") or {}).get("next_cursor")
    return results


# ───────────────────────────────────────────────────────────────────
# Author enrichment — h-index, ORCID, career stage, topics
# ───────────────────────────────────────────────────────────────────
def _parse_author(author: dict[str, Any]) -> dict[str, Any]:
    ss = author.get("summary_stats") or {}
    counts = author.get("counts_by_year") or []
    years = [c.get("year") for c in counts if c.get("year")]
    insts = author.get("last_known_institutions") or []
    return {
        "id": _short_id(author.get("id")),
        "name": author.get("display_name"),
        "orcid": author.get("orcid"),
        "works_count": author.get("works_count"),
        "cited_by_count": author.get("cited_by_count"),
        "h_index": ss.get("h_index"),
        "i10_index": ss.get("i10_index"),
        # counts_by_year only spans recent years; it is a floor on activity, not
        # a true first-publication year. Good enough as a career-stage proxy.
        "earliest_year": min(years) if years else None,
        "last_known_institutions": [
            {
                "name": i.get("display_name"),
                "country_code": (i.get("country_code") or "").lower() or None,
                "ror": i.get("ror"),
            }
            for i in insts
        ],
        "topics": [t.get("display_name") for t in (author.get("topics") or [])[:8] if t.get("display_name")],
    }


async def authors_by_ids(author_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    """Batch-fetch author enrichment. Returns {short_id -> parsed author dict}."""
    ids = [i for i in ({_short_id(a) for a in author_ids}) if i]
    if not ids:
        return {}
    select = (
        "id,display_name,orcid,works_count,cited_by_count,"
        "summary_stats,counts_by_year,last_known_institutions,topics"
    )
    out: dict[str, dict[str, Any]] = {}
    async with httpx.AsyncClient() as client:
        for start in range(0, len(ids), _AUTHOR_BATCH):
            batch = ids[start:start + _AUTHOR_BATCH]
            page = await _get(client, "/authors", {
                "filter": f"openalex_id:{'|'.join(batch)}",
                "per-page": _AUTHOR_BATCH,
                "select": select,
            })
            if not page:
                continue
            for a in page.get("results") or []:
                parsed = _parse_author(a)
                if parsed["id"]:
                    out[parsed["id"]] = parsed
    return out
