"""Scrapling microservice — thin FastAPI wrapper around Scrapling fetchers.

Strategy:
  - mode="auto"  → try AsyncFetcher (fast, stateless); if content is thin
                   (< MIN_TEXT_LEN chars), retry with DynamicFetcher (Playwright).
  - mode="fast"  → AsyncFetcher only, no fallback.
  - mode="js"    → DynamicFetcher always (full Chromium render).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Literal
from urllib.parse import urljoin, urlparse

import html2text
from fastapi import FastAPI
from pydantic import BaseModel
from scrapling.fetchers import AsyncFetcher, DynamicFetcher

log = logging.getLogger("scraper")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Scrapling service", version="1.0.0")

MIN_TEXT_LEN = 400  # chars below which we retry with Playwright

# Chromium is memory-hungry; cap concurrent Playwright sessions to avoid OOM /
# connection drops when the batch endpoint handles many JS-heavy pages at once.
_PLAYWRIGHT_SEM = asyncio.Semaphore(2)


# ── schemas ──────────────────────────────────────────────────────────

class ScrapeRequest(BaseModel):
    url: str
    mode: Literal["auto", "fast", "js"] = "auto"


class LinkItem(BaseModel):
    href: str
    text: str


class ScrapeResponse(BaseModel):
    url: str
    final_url: str | None = None
    text: str = ""
    markdown: str = ""
    links: list[LinkItem] = []
    status_code: int | None = None
    fetcher_used: str = ""
    error: str | None = None


class BatchRequest(BaseModel):
    urls: list[str]
    mode: Literal["auto", "fast", "js"] = "auto"


# ── helpers ──────────────────────────────────────────────────────────

_h2t = html2text.HTML2Text()
_h2t.ignore_links = False
_h2t.ignore_images = True
_h2t.body_width = 0  # no line wrapping


def _page_to_response(url: str, page, fetcher_used: str) -> ScrapeResponse:
    try:
        raw_html = page.html_content or ""
    except Exception:
        raw_html = ""

    text = ""
    try:
        text = page.get_all_text(ignore_tags=("script", "style", "noscript")) or ""
    except Exception:
        pass

    markdown = _h2t.handle(raw_html) if raw_html else text

    links: list[LinkItem] = []
    try:
        base = url
        for a in page.css("a[href]"):
            href = (a.attrib.get("href") or "").strip()
            if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
                continue
            abs_href = urljoin(base, href)
            link_text = (a.text or "").strip()
            links.append(LinkItem(href=abs_href, text=link_text))
    except Exception:
        pass

    status = None
    try:
        status = int(page.status)
    except Exception:
        pass

    final_url = url
    try:
        final_url = str(page.url)
    except Exception:
        pass

    return ScrapeResponse(
        url=url,
        final_url=final_url,
        text=text,
        markdown=markdown,
        links=links,
        status_code=status,
        fetcher_used=fetcher_used,
    )


async def _fetch_dynamic(url: str) -> tuple[object, str]:
    """Run DynamicFetcher (sync Playwright) in a thread pool.

    The semaphore caps concurrent Chromium instances to prevent OOM and the
    connection-drop errors observed under high concurrency.
    """
    async with _PLAYWRIGHT_SEM:
        page = await asyncio.to_thread(
            DynamicFetcher.fetch,
            url,
            disable_resources=True,  # skip images/fonts — much faster
            headless=True,
        )
    return page, "dynamic"


async def _fetch_async(url: str) -> tuple[object, str]:
    page = await AsyncFetcher.get(url, stealthy_headers=True)
    return page, "async"


async def _scrape_one(url: str, mode: str) -> ScrapeResponse:
    try:
        if mode == "js":
            page, fetcher = await _fetch_dynamic(url)
        elif mode == "fast":
            page, fetcher = await _fetch_async(url)
        else:  # auto
            page, fetcher = await _fetch_async(url)
            # Retry with Playwright if content is suspiciously thin
            text_preview = ""
            try:
                text_preview = page.get_all_text(ignore_tags=("script", "style", "noscript")) or ""
            except Exception:
                pass
            if len(text_preview.strip()) < MIN_TEXT_LEN:
                log.info("Content thin (%d chars) for %s — retrying with Playwright", len(text_preview), url)
                page, fetcher = await _fetch_dynamic(url)

        return _page_to_response(url, page, fetcher)

    except Exception as exc:
        log.warning("Scrape failed for %s: %s", url, exc)
        return ScrapeResponse(url=url, error=str(exc), fetcher_used="failed")


# ── routes ───────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True}


@app.post("/scrape", response_model=ScrapeResponse)
async def scrape(req: ScrapeRequest) -> ScrapeResponse:
    return await _scrape_one(req.url, req.mode)


@app.post("/scrape/batch", response_model=list[ScrapeResponse])
async def scrape_batch(req: BatchRequest) -> list[ScrapeResponse]:
    tasks = [_scrape_one(url, req.mode) for url in req.urls]
    return list(await asyncio.gather(*tasks))
