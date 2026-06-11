"""Batch-scrape all professor profile pages.

Runs prescrape_professor() for every professor that has a profile_url but
has not been scraped yet (profile_scraped_at IS NULL).

Extracts hiring signals via simple heuristics (no AI cost).
Saves: prospective_url, hiring_signals, hiring_notes, contact_instructions,
       profile_scraped_at.

Usage (inside container):
    python3 /app/scripts/batch_scrape.py [--all] [--tier T1]
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, "/app")
os.environ.setdefault("POSTDOC_DB", "/app/data/postdoc.db")
os.environ.setdefault("SCRAPER_URL", "http://scraper:8001")

from app.database import SessionLocal
from app import models
from app.scraper_client import prescrape_professor
from app.text_cleaner import clean_scraped_text
from app.ai_cleaner import clean_hiring_text

BATCH_SIZE = 5  # concurrent scrape tasks


# ── heuristic hiring-signal detection ────────────────────────────────

_HIRE_VERBS = r"(recruit|hire|hiring|seek|seeking|looking for|lookout for|welcom|accept|accepting|tak(?:ing)?\s+on|join)"
_AVAIL = r"(available|open(?:ing)?s?|opportunit|position|spot|slot|fellowship|vacanc)"

_POS = {
    "postdoc": [
        rf"{_HIRE_VERBS}.{{0,80}}postdoc",
        rf"postdoc.{{0,80}}{_HIRE_VERBS}",
        rf"postdoc.{{0,80}}{_AVAIL}",
        rf"{_AVAIL}.{{0,80}}postdoc",
        r"postdoctoral\s+(fellow|researcher|position|opportunit)",
        r"we\s+are\s+hiring",
        r"join\s+our\s+(lab|group|team|research)",
    ],
    "phd": [
        rf"{_HIRE_VERBS}.{{0,80}}(?:ph\.?d|doctoral|graduate)\s+student",
        rf"(?:ph\.?d|doctoral|graduate)\s+student.{{0,80}}{_HIRE_VERBS}",
        rf"(?:ph\.?d|doctoral|graduate)\s+student.{{0,80}}{_AVAIL}",
        rf"{_AVAIL}.{{0,80}}(?:ph\.?d|doctoral|graduate)\s+student",
        r"plan\s+to\s+recruit.{0,80}(?:ph\.?d|student|graduate)",
        r"(?:exceptional|motivated|outstanding|talented).{0,40}(?:ph\.?d|graduate|doctoral)\s+student",
        r"we\s+are\s+hiring",
        r"join\s+our\s+(lab|group|team|research)",
    ],
    "master": [
        rf"{_HIRE_VERBS}.{{0,80}}(?:master|m\.?sc|msc|m\.?eng)\s+student",
        rf"(?:master|m\.?sc|msc|m\.?eng)\s+student.{{0,80}}{_HIRE_VERBS}",
        rf"(?:master|m\.?sc|msc|m\.?eng)\s+student.{{0,80}}{_AVAIL}",
        rf"{_AVAIL}.{{0,80}}(?:master|m\.?sc|msc|m\.?eng)\s+student",
        r"plan\s+to\s+recruit.{0,80}(?:master|m\.?sc|student)",
        r"we\s+are\s+hiring",
        r"join\s+our\s+(lab|group|team|research)",
    ],
}

_NEG = {
    "postdoc": [
        r"not\s+(currently\s+)?(?:accepting|recruiting|looking for|taking|hiring)\s+(?:new\s+)?postdoc",
        r"no\s+(?:current\s+)?(?:postdoc\s+)?(?:opening|position)s",
        r"postdoc.{0,60}not\s+(?:available|open)",
    ],
    "phd": [
        r"not\s+(currently\s+)?(?:accepting|recruiting|looking for|taking|hiring)\s+(?:new\s+)?(?:phd|ph\.d|graduate|doctoral)\s+student",
        r"not\s+taking\s+(?:on\s+)?new\s+students",
        r"not\s+accepting\s+(?:new\s+)?students",
        r"fully\s+(?:staffed|booked|committed)",
        r"no\s+(?:phd|graduate)\s+(?:opening|position)s",
    ],
    "master": [
        r"not\s+(currently\s+)?(?:accepting|recruiting|looking for|taking|hiring)\s+(?:new\s+)?(?:master|msc)\s+student",
        r"no\s+(?:master|msc)\s+(?:opening|position)s",
    ],
}


def detect_signal(text: str, position_type: str, from_subpage: bool = False) -> bool | None:
    t = text.lower()
    # Negatives always take priority
    for pat in _NEG.get(position_type, []):
        if re.search(pat, t):
            return False
    for pat in _POS.get(position_type, []):
        if re.search(pat, t):
            return True
    # If this text came from a dedicated hiring/openings sub-page and explicitly
    # mentions the position type at all, lean positive.
    if from_subpage:
        pos_keywords = {"postdoc": r"postdoc", "phd": r"ph\.?d|doctoral|graduate\s+student", "master": r"master\s+student|m\.?sc\s+student"}
        kw = pos_keywords.get(position_type, "")
        if kw and re.search(kw, t):
            return True
    return None


def extract_signals(main_text: str, sub_texts: list[str]) -> dict:
    result = {}
    for pos in ("postdoc", "phd", "master"):
        # Check sub-pages first (more authoritative), then main page
        sig = None
        for st in sub_texts:
            sig = detect_signal(st, pos, from_subpage=True)
            if sig is not None:
                break
        if sig is None:
            sig = detect_signal(main_text, pos, from_subpage=False)
        result[pos] = sig
    return result


# ── contact instruction extraction ───────────────────────────────────

_CONTACT_PATTERNS = [
    r"(please|make sure to|ensure you|be sure to)[^.]{0,200}(subject|email|contact|apply|write|mention|include)[^.]{0,200}\.",
    r"(mention|include|put|write)[^.]{0,100}(subject line|email|application)[^.]{0,200}\.",
    r"(before\s+(emailing|contacting|writing|reaching out))[^.]{0,300}\.",
    r"(do not|don't)\s+send[^.]{0,200}\.",
    r"(i\s+(will not|won't|do not|don't)\s+respond)[^.]{0,200}\.",
    r"(fill out|complete|submit)\s+(this\s+)?(form|application)[^.]{0,200}\.",
]


def extract_contact_instructions(sub_texts: list[str], main_text: str) -> str | None:
    combined = "\n\n".join(sub_texts) or main_text
    matches = []
    for pat in _CONTACT_PATTERNS:
        for m in re.finditer(pat, combined, re.IGNORECASE | re.DOTALL):
            snippet = m.group(0).strip()
            if len(snippet) > 20:
                matches.append(snippet)
    if not matches:
        return None
    # Deduplicate and join
    seen: set[str] = set()
    result = []
    for m in matches:
        key = m[:60]
        if key not in seen:
            seen.add(key)
            result.append(m)
    return " | ".join(result[:5]) or None


# ── main batch loop ───────────────────────────────────────────────────

async def scrape_one(prof: models.Professor, db, settings: models.Settings) -> str:
    name = prof.name
    url = prof.profile_url
    try:
        result = await prescrape_professor(url, prof.lab_url)
        main = result.get("scraped_main")
        subs = result.get("scraped_subpages") or []

        if not main or not main.ok:
            return f"  SKIP  {name} — scrape returned no content"

        main_text = main.text or ""
        sub_texts = [s.text for s in subs if s and s.ok and s.text]

        hiring_signals = extract_signals(main_text, sub_texts)
        contact_instructions = extract_contact_instructions(sub_texts, main_text)

        # Only overwrite stored fields when we actually got fresh data —
        # preserves previously scraped sub-page content if this run's batch call failed.
        # Try the AI cleaner first (uses Settings.ai_provider); fall back to the
        # heuristic stripper if the AI call fails or no provider is configured.
        texts_for_cleaning = ([main_text] if main_text else []) + sub_texts
        if texts_for_cleaning:
            merged: dict[str, list[str]] = {"postdoc": [], "phd": [], "master": [], "general": []}
            heuristic_fallback: list[str] = []
            for t in texts_for_cleaning:
                ai_out = await clean_hiring_text(t, name, settings)
                if ai_out is None:
                    # AI failed entirely → fall back to heuristic for this page.
                    cleaned = clean_scraped_text(t)
                    if cleaned.strip():
                        heuristic_fallback.append(cleaned)
                else:
                    for k, v in ai_out.items():
                        if v.strip():
                            merged[k].append(v.strip())

            intel = {k: "\n\n".join(parts).strip() for k, parts in merged.items()}
            has_intel = any(v for v in intel.values())

            if has_intel:
                prof.hiring_intel = intel
                # Backward-compatible flat view: concatenate non-empty sections,
                # labeled, into hiring_notes.
                flat_parts = []
                for k in ("postdoc", "phd", "master", "general"):
                    if intel[k]:
                        flat_parts.append(f"[{k.upper()}]\n{intel[k]}")
                prof.hiring_notes = "\n\n".join(flat_parts)[:8000] if flat_parts else None
            elif heuristic_fallback:
                prof.hiring_intel = None
                prof.hiring_notes = "\n\n---\n\n".join(heuristic_fallback)[:8000]
            else:
                prof.hiring_intel = None
                prof.hiring_notes = None
        if subs:
            prof.prospective_url = subs[0].final_url or subs[0].url

        # Always update signals (re-derived from whatever text we have now).
        prof.hiring_signals = hiring_signals

        # Only overwrite contact_instructions if we found something new.
        if contact_instructions:
            prof.contact_instructions = contact_instructions

        prof.profile_scraped_at = datetime.utcnow()
        db.add(prof)
        db.commit()

        sig_str = " | ".join(f"{k}={v}" for k, v in hiring_signals.items())
        sub_str = f"+ {len(subs)} sub-page(s)" if subs else ""
        return f"  OK    {name} [{prof.tier}] {sub_str} | {sig_str}"

    except Exception as exc:
        return f"  ERROR {name} — {exc}"


async def run(tier_filter: str | None = None, force: bool = False):
    db = SessionLocal()
    settings = db.get(models.Settings, 1) or models.Settings()
    query = db.query(models.Professor)
    if not force:
        query = query.filter(models.Professor.profile_scraped_at.is_(None))
    if tier_filter:
        query = query.filter(models.Professor.tier == tier_filter)
    profs = query.filter(
        models.Professor.profile_url.isnot(None),
        models.Professor.profile_url != "",
    ).all()

    total = len(profs)
    print(f"\nBatch scrape: {total} professors to process (batch_size={BATCH_SIZE}, ai_provider={settings.ai_provider})\n")

    done = 0
    for i in range(0, total, BATCH_SIZE):
        batch = profs[i : i + BATCH_SIZE]
        tasks = [scrape_one(p, db, settings) for p in batch]
        results = await asyncio.gather(*tasks)
        for r in results:
            print(r)
        done += len(batch)
        print(f"  [{done}/{total}]")

    db.close()
    print(f"\nDone. {total} professors processed.")


if __name__ == "__main__":
    tier = None
    force = False
    for arg in sys.argv[1:]:
        if arg == "--all":
            force = True
        elif arg.startswith("--tier="):
            tier = arg.split("=", 1)[1]
        elif arg in ("T1", "T2", "T3"):
            tier = arg

    asyncio.run(run(tier_filter=tier, force=force))
