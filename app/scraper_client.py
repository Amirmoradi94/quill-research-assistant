"""HTTP client for the Scrapling sidecar service.

Provides two public coroutines:
  scrape(url, mode) -> ScrapeResult | None
  scrape_batch(urls, mode) -> list[ScrapeResult | None]

Returns None (never raises) when the service is unreachable — callers fall back
to Claude's built-in WebFetch in that case.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import urljoin, urlparse

import httpx

log = logging.getLogger("scraper_client")

SCRAPER_URL = os.environ.get("SCRAPER_URL", "http://localhost:8001")
_TIMEOUT = httpx.Timeout(90.0)  # Playwright renders can be slow

# Keywords that suggest a sub-page is a hiring/prospective-students page
_HIRING_KEYWORDS = frozenset({
    "prospective", "join", "opening", "position", "opportunit",
    "apply", "phd", "postdoc", "graduate", "student", "hiring",
    "recruit", "master", "vacancy", "fellowship", "opportunity",
    "future", "work-with", "work_with", "how-to-apply",
})


@dataclass
class ScrapeResult:
    url: str
    final_url: str | None
    text: str
    markdown: str
    links: list[dict]
    fetcher_used: str
    error: str | None = None

    @property
    def ok(self) -> bool:
        return bool(self.text or self.markdown) and not self.error


def _filter_hiring_links(
    profile_url: str,
    links: list[dict],
    lab_url: str | None = None,
) -> list[str]:
    """Return absolute URLs from `links` that look like hiring/openings sub-pages.

    Filtering rules:
    1. Must be on the same domain as `profile_url` OR `lab_url`.
    2. Must contain a hiring keyword in the URL path OR the link anchor text.
    3. Must not be exactly equal to `profile_url` (avoid re-scraping main page).
    4. For the professor's primary domain: if the link is NOT a sub-path of their
       profile URL, it still passes IF a keyword is present (e.g. /~prof/students/).
       Links to unrelated paths on the same university server are filtered out unless
       a keyword is present.
    """
    parsed_profile = urlparse(profile_url)
    profile_domain = parsed_profile.netloc
    profile_path = parsed_profile.path.rstrip("/")

    allowed_domains: set[str] = {profile_domain}
    if lab_url:
        lab_domain = urlparse(lab_url).netloc
        if lab_domain:
            allowed_domains.add(lab_domain)

    seen: set[str] = set()
    result: list[str] = []

    for link in links:
        href = (link.get("href") or "").strip()
        if not href:
            continue

        parsed = urlparse(href)
        if parsed.netloc not in allowed_domains:
            continue

        # Skip the main profile page itself
        if href.rstrip("/") == profile_url.rstrip("/"):
            continue

        url_lower = href.lower()
        text_lower = (link.get("text") or "").lower()
        has_keyword = any(kw in url_lower or kw in text_lower for kw in _HIRING_KEYWORDS)

        if not has_keyword:
            continue

        if href not in seen:
            seen.add(href)
            result.append(href)

    return result


async def scrape(url: str, mode: Literal["auto", "fast", "js"] = "auto") -> ScrapeResult | None:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{SCRAPER_URL}/scrape", json={"url": url, "mode": mode})
            resp.raise_for_status()
            d = resp.json()
            return ScrapeResult(
                url=d["url"],
                final_url=d.get("final_url"),
                text=d.get("text", ""),
                markdown=d.get("markdown", ""),
                links=d.get("links", []),
                fetcher_used=d.get("fetcher_used", ""),
                error=d.get("error"),
            )
    except Exception as exc:
        log.warning("Scraper unavailable (%s: %s) — will rely on WebFetch",
                    type(exc).__name__, exc or "(no message)")
        return None


async def scrape_batch(
    urls: list[str],
    mode: Literal["auto", "fast", "js"] = "auto",
) -> list[ScrapeResult | None]:
    if not urls:
        return []
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{SCRAPER_URL}/scrape/batch",
                json={"urls": urls, "mode": mode},
            )
            resp.raise_for_status()
            return [
                ScrapeResult(
                    url=d["url"],
                    final_url=d.get("final_url"),
                    text=d.get("text", ""),
                    markdown=d.get("markdown", ""),
                    links=d.get("links", []),
                    fetcher_used=d.get("fetcher_used", ""),
                    error=d.get("error"),
                )
                for d in resp.json()
            ]
    except Exception as exc:
        log.warning("Scraper batch unavailable (%s: %s) — will rely on WebFetch",
                    type(exc).__name__, exc or "(no message)")
        return [None] * len(urls)


async def prescrape_professor(
    profile_url: str,
    lab_url: str | None = None,
) -> dict:
    """Scrape a professor's profile and any hiring sub-pages.

    Returns a dict ready to merge into prompt params:
      scraped_main       - ScrapeResult of the main profile page (or None)
      scraped_subpages   - list[ScrapeResult] of hiring/openings sub-pages
    """
    if not profile_url:
        return {"scraped_main": None, "scraped_subpages": []}

    main = await scrape(profile_url)
    if not main or not main.ok:
        return {"scraped_main": main, "scraped_subpages": []}

    hiring_urls = _filter_hiring_links(profile_url, main.links, lab_url)
    subpages: list[ScrapeResult | None] = []
    if hiring_urls:
        subpages = await scrape_batch(hiring_urls[:5])  # cap at 5 sub-pages

    return {
        "scraped_main": main,
        "scraped_subpages": [s for s in subpages if s and s.ok],
    }
