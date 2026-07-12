"""Pluggable web search for discovery contact-resolution.

Used only for the ranked shortlist (~30 candidates) to find each professor's
real faculty/profile page, which OpenAlex doesn't provide. Provider is selected
by WEBSEARCH_PROVIDER (default "tavily"); the key comes from the user's Settings
row (`websearch_api_key`) or a provider-specific env var.

Like the other network clients here, `search` never raises — it logs and returns
an empty list so a missing key or flaky provider degrades gracefully (the
candidate is still shown, just without a resolved homepage).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

log = logging.getLogger(__name__)

PROVIDER = os.environ.get("WEBSEARCH_PROVIDER", "tavily").lower()


def _resolve_key(settings=None) -> Optional[str]:
    key = getattr(settings, "websearch_api_key", None) if settings is not None else None
    if key:
        return key
    return (
        os.environ.get("WEBSEARCH_API_KEY")
        or os.environ.get("TAVILY_API_KEY")
        or os.environ.get("BRAVE_API_KEY")
        or None
    )


def has_search(settings=None) -> bool:
    return _resolve_key(settings) is not None


async def _tavily(client: httpx.AsyncClient, key: str, query: str, count: int) -> list[dict]:
    r = await client.post("https://api.tavily.com/search", json={
        "api_key": key,
        "query": query,
        "max_results": count,
        "search_depth": "basic",
    }, timeout=20)
    r.raise_for_status()
    data = r.json()
    return [
        {"title": it.get("title"), "url": it.get("url"), "snippet": it.get("content")}
        for it in (data.get("results") or [])
    ]


async def _brave(client: httpx.AsyncClient, key: str, query: str, count: int) -> list[dict]:
    r = await client.get(
        "https://api.search.brave.com/res/v1/web/search",
        headers={"X-Subscription-Token": key, "Accept": "application/json"},
        params={"q": query, "count": count},
        timeout=20,
    )
    r.raise_for_status()
    data = r.json()
    results = ((data.get("web") or {}).get("results")) or []
    return [
        {"title": it.get("title"), "url": it.get("url"), "snippet": it.get("description")}
        for it in results
    ]


async def search(query: str, count: int = 5, settings=None) -> list[dict]:
    """Return up to `count` web results as {title, url, snippet}. Empty on any
    failure or missing key."""
    query = (query or "").strip()
    if not query:
        return []
    key = _resolve_key(settings)
    if not key:
        return []
    try:
        async with httpx.AsyncClient() as client:
            if PROVIDER == "brave":
                return await _brave(client, key, query, count)
            return await _tavily(client, key, query, count)
    except Exception as exc:  # noqa: BLE001 - defensive: never crash a run
        log.warning("web search failed (%s): %s", PROVIDER, exc)
        return []
