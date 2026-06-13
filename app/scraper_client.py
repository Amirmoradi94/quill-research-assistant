"""HTTP client for the Scrapling sidecar service.

Provides two public coroutines:
  scrape(url, mode) -> ScrapeResult | None
  scrape_batch(urls, mode) -> list[ScrapeResult | None]

Returns None (never raises) when the service is unreachable — callers fall back
to Claude's built-in WebFetch in that case.
"""
from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Literal
from urllib.parse import urljoin, urlparse

import httpx

log = logging.getLogger("scraper_client")

SCRAPER_URL = os.environ.get("SCRAPER_URL", "http://localhost:8001")
_TIMEOUT = httpx.Timeout(90.0)  # Playwright renders can be slow

# Keywords that suggest a sub-page is a hiring/prospective-students page.
_HIRING_KEYWORDS = frozenset({
    "prospective", "join", "opening", "position", "opportunit",
    "apply", "phd", "postdoc", "graduate", "student", "hiring",
    "recruit", "master", "vacancy", "fellowship", "opportunity",
    "future", "work-with", "work_with", "how-to-apply",
})

# Keywords that suggest a sub-page has useful research evidence.
_RESEARCH_KEYWORDS = frozenset({
    "research", "lab", "group", "publication", "paper", "project",
    "people", "team", "student", "member", "contact", "profile",
    "supervision", "graduate", "prospective", "join", "opening",
    "position", "hiring", "opportunit", "postdoc", "phd", "master",
})

_SKIP_LINK_KEYWORDS = frozenset({
    "login", "privacy", "accessibility", "calendar", "event", "news",
    "media", "alumni", "donate", "map", "parking", "library",
    "directory", "admission", "tuition", "program", "course",
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


class _SimplePageParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.parts: list[str] = []
        self.links: list[dict] = []
        self._skip_depth = 0
        self._current_href: str | None = None
        self._current_link_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        attrs_dict = {k.lower(): v for k, v in attrs if v}
        if tag == "a" and attrs_dict.get("href"):
            self._current_href = urljoin(self.base_url, attrs_dict["href"])
            self._current_link_text = []
        if tag in {"p", "div", "section", "article", "header", "footer", "li", "br", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "svg"} and self._skip_depth:
            self._skip_depth -= 1
            return
        if self._skip_depth:
            return
        if tag == "a" and self._current_href:
            text = " ".join("".join(self._current_link_text).split())
            self.links.append({"href": self._current_href, "text": text})
            self._current_href = None
            self._current_link_text = []
        if tag in {"p", "div", "section", "article", "li", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if self._current_href:
            self._current_link_text.append(data)
        self.parts.append(data)

    def text(self) -> str:
        lines = [" ".join(line.split()) for line in "".join(self.parts).splitlines()]
        return "\n".join(line for line in lines if line)


async def _direct_scrape(url: str) -> ScrapeResult | None:
    """Best-effort static HTML fallback for desktop when Scrapling is absent."""
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0),
            follow_redirects=True,
            headers={"User-Agent": "QuillAI/0.1 academic-discovery"},
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "text/html" not in content_type and "application/xhtml" not in content_type:
            return None
        parser = _SimplePageParser(str(resp.url))
        parser.feed(resp.text)
        text = parser.text()
        return ScrapeResult(
            url=url,
            final_url=str(resp.url),
            text=text,
            markdown=text,
            links=parser.links,
            fetcher_used="httpx",
        )
    except Exception as exc:
        log.warning("Direct scrape failed (%s: %s): %s", type(exc).__name__, exc or "(no message)", url)
        return None


def _filter_evidence_links(
    profile_url: str,
    links: list[dict],
    lab_url: str | None = None,
) -> list[str]:
    """Return same-domain URLs likely to help deep professor research.

    Filtering rules:
    1. Must be on the same domain as `profile_url` OR `lab_url`.
    2. Must contain a research or hiring keyword in the URL path or anchor text.
    3. Must not be exactly equal to `profile_url` (avoid re-scraping main page).
    4. Hiring-looking URLs are ranked first, then lab/research/publication pages.
    """
    parsed_profile = urlparse(profile_url)
    profile_domain = parsed_profile.netloc

    allowed_domains: set[str] = {profile_domain}
    if lab_url:
        lab_domain = urlparse(lab_url).netloc
        if lab_domain:
            allowed_domains.add(lab_domain)

    seen: set[str] = set()
    scored: list[tuple[int, str]] = []

    for link in links:
        href = (link.get("href") or "").strip()
        if not href:
            continue
        href = urljoin(profile_url, href)

        parsed = urlparse(href)
        if parsed.netloc not in allowed_domains:
            continue

        # Skip the main profile page itself
        if href.rstrip("/") == profile_url.rstrip("/"):
            continue

        url_lower = href.lower()
        text_lower = (link.get("text") or "").lower()
        combined = f"{url_lower} {text_lower}"
        if any(kw in combined for kw in _SKIP_LINK_KEYWORDS):
            continue

        is_hiring = any(kw in combined for kw in _HIRING_KEYWORDS)
        is_research = any(kw in combined for kw in _RESEARCH_KEYWORDS)

        if not is_hiring and not is_research:
            continue

        if href not in seen:
            seen.add(href)
            score = 100 if is_hiring else 0
            if any(kw in combined for kw in ("lab", "group", "research", "publication", "paper", "project")):
                score += 40
            if any(kw in combined for kw in ("people", "team", "student", "member", "contact")):
                score += 20
            scored.append((score, href))

    scored.sort(key=lambda item: item[0], reverse=True)
    return [href for _, href in scored]


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
        log.warning("Scraper unavailable (%s: %s) — falling back to direct HTTP fetch",
                    type(exc).__name__, exc or "(no message)")
        return await _direct_scrape(url)


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
        log.warning("Scraper batch unavailable (%s: %s) — falling back to direct HTTP fetches",
                    type(exc).__name__, exc or "(no message)")
        return await asyncio.gather(*(_direct_scrape(url) for url in urls))


async def prescrape_professor(
    profile_url: str,
    lab_url: str | None = None,
) -> dict:
    """Scrape a professor's profile and high-value evidence sub-pages.

    Returns a dict ready to merge into prompt params:
      scraped_main       - ScrapeResult of the main profile page (or None)
      scraped_subpages   - list[ScrapeResult] of lab/research/hiring sub-pages
    """
    if not profile_url:
        return {"scraped_main": None, "scraped_subpages": []}

    main = await scrape(profile_url)
    if not main or not main.ok:
        return {"scraped_main": main, "scraped_subpages": []}

    evidence_urls = _filter_evidence_links(profile_url, main.links, lab_url)
    if lab_url and lab_url.rstrip("/") != profile_url.rstrip("/"):
        lab_abs = urljoin(profile_url, lab_url)
        evidence_urls = [lab_abs] + [u for u in evidence_urls if u.rstrip("/") != lab_abs.rstrip("/")]
    subpages: list[ScrapeResult | None] = []
    if evidence_urls:
        subpages = await scrape_batch(evidence_urls[:8])  # cap to keep prompts bounded

    return {
        "scraped_main": main,
        "scraped_subpages": [s for s in subpages if s and s.ok],
    }
