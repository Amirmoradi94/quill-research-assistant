"""AI-powered cleaner for scraped professor pages.

Takes raw page-dump text and asks the user's selected AI provider to keep
only hiring-relevant content (hiring statements, research areas, contact /
application instructions) and drop all site nav, marketing, and chrome.

Dispatches on Settings.ai_provider:
  - claude_cli     -> `claude --print <prompt>`
  - codex_cli      -> `codex exec <prompt>`
  - anthropic_api  -> Messages API (claude-haiku-4-5)
  - openai_api     -> Chat Completions (gpt-4o-mini)

Returns the cleaned text on success, or None on any failure -- callers
should fall back to the heuristic `text_cleaner.clean_scraped_text`.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
from typing import Optional

import httpx

from . import models


SYSTEM_PROMPT = (
    "You clean scraped academic faculty pages. Given raw page text, extract only "
    "professor-specific content and structure it BY POSITION TYPE so the reader "
    "can see openings relevant to them. Drop site navigation, menus, breadcrumbs, "
    "marketing blurbs about the university, cookie notices, and any text unrelated "
    "to this professor.\n\n"
    "Return a JSON object with exactly these keys:\n"
    "  - \"postdoc\": text about postdoc openings, requirements, application steps "
    "(or empty string if none).\n"
    "  - \"phd\": text about PhD / doctoral student openings, requirements, "
    "application steps (or empty string if none).\n"
    "  - \"master\": text about Master's / MSc / MEng student openings, "
    "requirements, application steps (or empty string if none).\n"
    "  - \"general\": research areas, lab name, position title, affiliations, "
    "supervised programs, contact info, generic application instructions that "
    "apply to all positions (or empty string).\n\n"
    "Rules:\n"
    "- A statement like \"not currently accepting PhD students\" goes into the "
    "phd field (so the reader sees the negative signal).\n"
    "- Generic \"interested students should email me\" goes into general.\n"
    "- Use empty string \"\" for any key with no content. Never omit keys.\n"
    "- Output ONLY the JSON object, no commentary, no markdown fences, no extra text.\n"
    "- If the page has no professor-specific content at all, output exactly: "
    "{\"postdoc\":\"\",\"phd\":\"\",\"master\":\"\",\"general\":\"\"}"
)


SECTION_KEYS = ("postdoc", "phd", "master", "general")


def _empty_intel() -> dict[str, str]:
    return {k: "" for k in SECTION_KEYS}


def _user_prompt(raw: str, prof_name: str) -> str:
    return (
        f"Professor: {prof_name}\n\n"
        f"Raw scraped page text:\n---\n{raw}\n---\n\n"
        "Return only the JSON object."
    )


_JSON_RE = re.compile(r"\{[\s\S]*\}")


def _parse_intel(text: str) -> Optional[dict[str, str]]:
    """Parse the model's JSON output into a dict of {section: text}."""
    if not text:
        return None
    match = _JSON_RE.search(text)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    out = _empty_intel()
    for k in SECTION_KEYS:
        v = data.get(k, "")
        if isinstance(v, str):
            out[k] = v.strip()
    return out


MAX_INPUT_CHARS = 20000


def _truncate(raw: str) -> str:
    if len(raw) <= MAX_INPUT_CHARS:
        return raw
    half = MAX_INPUT_CHARS // 2
    return f"{raw[:half]}\n\n[...truncated...]\n\n{raw[-half:]}"


async def _run_subprocess(argv: list[str]) -> Optional[str]:
    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=120)
    except asyncio.TimeoutError:
        proc.kill()
        return None
    if proc.returncode != 0:
        return None
    return stdout.decode("utf-8", errors="replace").strip() or None


async def _clean_via_claude_cli(prompt: str, cli_path: str | None) -> Optional[str]:
    binary = cli_path or shutil.which("claude")
    if not binary:
        return None
    return await _run_subprocess([binary, "--print", prompt])


async def _clean_via_codex_cli(prompt: str, cli_path: str | None) -> Optional[str]:
    binary = cli_path or shutil.which("codex")
    if not binary:
        return None
    return await _run_subprocess([binary, "exec", prompt])


async def _clean_via_anthropic_api(prompt: str, api_key: str) -> Optional[str]:
    body = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 2000,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post("https://api.anthropic.com/v1/messages", json=body, headers=headers)
    if r.status_code != 200:
        return None
    parts = (r.json().get("content") or [])
    text = "".join(p.get("text", "") for p in parts if p.get("type") == "text").strip()
    return text or None


async def _clean_via_openai_api(prompt: str, api_key: str) -> Optional[str]:
    body = {
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 2000,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post("https://api.openai.com/v1/chat/completions", json=body, headers=headers)
    if r.status_code != 200:
        return None
    choices = r.json().get("choices") or []
    if not choices:
        return None
    return (choices[0].get("message") or {}).get("content", "").strip() or None


async def clean_hiring_text(
    raw: str,
    prof_name: str,
    settings: models.Settings,
) -> Optional[dict[str, str]]:
    """Clean raw scraped page text into structured sections by position type.

    Returns:
      - dict {postdoc, phd, master, general}  on success (any/all may be empty)
      - None                                  if the call failed / no provider configured
                                              (caller should fall back to the heuristic)
    """
    if not raw or not raw.strip():
        return _empty_intel()

    prompt = _user_prompt(_truncate(raw), prof_name)
    provider = (settings.ai_provider or "").strip()

    if provider == "claude_cli":
        combined = f"{SYSTEM_PROMPT}\n\n{prompt}"
        result = await _clean_via_claude_cli(combined, settings.claude_cli_path)
    elif provider == "codex_cli":
        combined = f"{SYSTEM_PROMPT}\n\n{prompt}"
        result = await _clean_via_codex_cli(combined, settings.codex_cli_path)
    elif provider == "anthropic_api":
        result = await _clean_via_anthropic_api(prompt, settings.anthropic_api_key) if settings.anthropic_api_key else None
    elif provider == "openai_api":
        result = await _clean_via_openai_api(prompt, settings.openai_api_key) if settings.openai_api_key else None
    else:
        return None

    if result is None:
        return None  # provider failed → heuristic fallback
    return _parse_intel(result) or _empty_intel()
