"""Strip website navigation / chrome from scraped page text.

Used by batch_scrape.py when populating Professor.hiring_notes, and by
scripts/clean_hiring_notes.py to retroactively clean existing rows.

Heuristics target the most common page-chrome patterns we've seen in
the wild on faculty / "openings" pages:
  - Single short words that are navigation labels (Home, Contact, About).
  - Common phrases ("Skip to content", "Submit Search", "Main Menu").
  - Bare social media platform names.
  - Breadcrumb-y short fragments with no verb.

We do NOT try to be perfect. The goal is to get from "page dump" to
"the actual sentences", and let the user / Quill clean up the rest.
"""
from __future__ import annotations

import re


# Exact-match lines (after strip + lower) we always drop
_NAV_EXACT = {
    "home", "contact", "about", "menu", "main menu", "search", "search:",
    "search for:", "submit search", "submit", "apply", "apply now",
    "login", "log in", "sign in", "sign up", "register",
    "faculty", "students", "staff", "alumni", "research", "events",
    "news", "publications", "people", "teaching", "courses",
    "linkedin", "instagram", "facebook", "tiktok", "youtube", "twitter",
    "x", "x social media", "x (twitter)", "github", "mastodon", "bluesky",
    "follow us", "follow us:", "social media",
    "skip to content", "skip to main content", "skip to navigation",
    "back to top", "back", "next", "previous",
    "career opportunities", "frequently asked questions", "health and safety",
    "our department", "staff directory", "teaching labs",
    "undergraduate students", "graduate students", "current students",
    "prospective students",
    "u of t home", "u of t engineering", "ece internal", "quercus",
    "main content", "go to main content",
}

# Substring patterns that mark a line as nav/chrome (regex, case-insensitive)
_NAV_PATTERNS = [
    r"^©\s*\d{4}",
    r"^copyright\s",
    r"^all rights reserved",
    r"^terms\s+(of|&)",
    r"^privacy\s+(policy|notice)",
    r"^cookie\s+(policy|notice|consent)",
    r"^accessibility",
    r"^follow\s+(us|me)\s+(on|at)",
    r"^subscribe\s+to",
    r"^sign up for",
    r"^view all",
    r"^see all",
    r"^read more$",
    r"^learn more$",
    r"^show more$",
    r"^load more$",
]
_NAV_PATTERNS_C = [re.compile(p, re.IGNORECASE) for p in _NAV_PATTERNS]

# Minimum line length to consider keeping a "fragment" (no verb). Lines with
# a verb-y construction (contains a period, contains common verbs) can be
# shorter than this.
MIN_LINE_CHARS = 25

# Words that suggest a line is a real sentence even if short
_SENTENCE_HINTS = re.compile(
    r"\b(is|are|was|were|will|would|should|must|please|hire|hiring|recruit|"
    r"seek|seeking|apply|email|contact|accept|accepting|join|welcome|"
    r"interested|looking|open|available|prefer|prefers|prefer\s+a|"
    r"do\s+not|don't|won't|will\s+not|cannot|can't|no\s+response|"
    r"phd|postdoc|master|graduate|doctoral|student)\b",
    re.IGNORECASE,
)


def _is_nav_line(line: str) -> bool:
    """Return True if this line is page chrome, not real content."""
    stripped = line.strip()
    if not stripped:
        return True
    low = stripped.lower().rstrip(":.")
    if low in _NAV_EXACT:
        return True
    for pat in _NAV_PATTERNS_C:
        if pat.search(stripped):
            return True
    # Very short line with no sentence-hint and no period → probably nav
    if len(stripped) < MIN_LINE_CHARS:
        if not _SENTENCE_HINTS.search(stripped) and "." not in stripped:
            return True
    return False


def clean_scraped_text(text: str | None) -> str:
    """Strip navigation chrome from page-dump text.

    Returns a cleaned string with consecutive blank lines collapsed.
    Returns "" if text is None/empty.
    """
    if not text:
        return ""
    out_lines: list[str] = []
    prev_blank = False
    for raw in text.splitlines():
        if _is_nav_line(raw):
            # Collapse the dropped line into at most one blank for paragraph breaks
            if not prev_blank and out_lines:
                out_lines.append("")
                prev_blank = True
            continue
        out_lines.append(raw.rstrip())
        prev_blank = False
    # Trim leading/trailing blanks
    while out_lines and not out_lines[0].strip():
        out_lines.pop(0)
    while out_lines and not out_lines[-1].strip():
        out_lines.pop()
    return "\n".join(out_lines)
