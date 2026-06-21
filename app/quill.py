"""Quill HTTP routes — POST /api/ai/run (SSE) + run history.

Architecture:
    The single endpoint POST /api/ai/run starts a workflow and STREAMS the
    response as Server-Sent Events. The very first event ('started') carries
    the AIRun id so the client can later look up the run for cost/usage.

    No separate "create run, then GET stream" handshake. This keeps state
    out of the picture (no per-run in-memory params dict) and matches how
    Cursor / OpenAI Stream / Vercel AI SDK expose chat completions.

    Cancellation: the client just closes the response; FastAPI cancels the
    underlying async generator, which terminates the subprocess via
    ai.cli.spawn_cli's `finally` block.
"""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import os
import platform
import re
import shlex
import subprocess
import time
from datetime import datetime, timedelta
from typing import Any, AsyncIterator, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .database import get_db
from . import models

# Make the parent dir importable so `ai` can be found alongside `app`.
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai.runner import (  # noqa: E402
    FALLBACK_CHAIN,
    Provider,
    RunRequest,
    StreamEvent,
    Workflow,
    render_prompt,
    resolve_cli_path,
    select_provider,
    stream as runner_stream,
)
from ai.cli import cli_child_env  # noqa: E402


router = APIRouter(prefix="/api/ai", tags=["ai"])

DASHBOARD_ROOT = Path(__file__).resolve().parent.parent
ALLOW_REMOTE_AI = os.environ.get("POSTDOC_ALLOW_REMOTE_AI", "").lower() in {"1", "true", "yes"}
TRUSTED_AI_ORIGINS = {
    o.strip()
    for o in os.environ.get(
        "POSTDOC_AI_TRUSTED_ORIGINS",
        "http://localhost:8000,http://127.0.0.1:8000,"
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://tauri.localhost,https://tauri.localhost,tauri://localhost,null",
    ).split(",")
    if o.strip()
}
SAFE_READ_TOOLS = ["Read", "Grep", "Glob"]
SAFE_WEB_TOOLS = ["WebFetch", "WebSearch"]
WORKFLOW_TOOL_POLICY: dict[Workflow, list[str]] = {
    Workflow.CHAT: SAFE_READ_TOOLS + SAFE_WEB_TOOLS,
    Workflow.RESEARCH_PROFESSOR: SAFE_WEB_TOOLS,
    Workflow.DISCOVER_PROFESSORS: SAFE_WEB_TOOLS,
    Workflow.FIND_GRANTS: SAFE_WEB_TOOLS,
}


# ───────────────────────────────────────────────────────────────────
# Schemas
# ───────────────────────────────────────────────────────────────────
class RunIn(BaseModel):
    workflow: str
    params: dict[str, Any] = {}
    preferred_provider: Optional[str] = None
    professor_id: Optional[int] = None
    document_id: Optional[int] = None
    grant_id: Optional[int] = None
    cwd: Optional[str] = None
    allowed_tools: Optional[list[str]] = None
    max_turns: int = 30
    timeout_s: int = 300


class RunOut(BaseModel):
    id: int
    workflow: str
    provider: str
    status: str
    cost_usd: Optional[float] = None
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    duration_ms: Optional[int] = None
    output: Optional[str] = None
    error_type: Optional[str] = None
    error_message: Optional[str] = None
    retry_of_run_id: Optional[int] = None
    professor_id: Optional[int] = None
    document_id: Optional[int] = None
    grant_id: Optional[int] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class RetryRunIn(BaseModel):
    use_fallback_provider: bool = False


class ProviderSetupIn(BaseModel):
    provider: str
    action: str


# ───────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────
def _settings(db: Session) -> models.Settings:
    s = db.get(models.Settings, 1)
    if not s:
        # Lazy create — should already exist via migration seed but be safe.
        s = models.Settings()
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _select_provider_for(settings: models.Settings, preferred: Optional[Provider] = None) -> Optional[Provider]:
    return select_provider(
        preferred=preferred or Provider(settings.ai_provider),
        claude_cli_path=settings.claude_cli_path,
        codex_cli_path=settings.codex_cli_path,
        anthropic_api_key=settings.anthropic_api_key,
        openai_api_key=settings.openai_api_key,
    )


def _provider_available(settings: models.Settings, provider: Provider) -> bool:
    return select_provider(
        preferred=provider,
        claude_cli_path=settings.claude_cli_path,
        codex_cli_path=settings.codex_cli_path,
        anthropic_api_key=settings.anthropic_api_key,
        openai_api_key=settings.openai_api_key,
    ) == provider


def _select_fallback_provider(settings: models.Settings, failed_provider: str) -> Optional[Provider]:
    for provider in FALLBACK_CHAIN:
        if provider.value == failed_provider:
            continue
        if _provider_available(settings, provider):
            return provider
    return None


def _run_probe(argv: list[str], timeout_s: int = 8) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            argv,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            env=cli_child_env(),
        )
        return {
            "ok": proc.returncode == 0,
            "returncode": proc.returncode,
            "stdout": (proc.stdout or "").strip(),
            "stderr": (proc.stderr or "").strip(),
        }
    except FileNotFoundError:
        return {"ok": False, "returncode": 127, "stdout": "", "stderr": "Command not found."}
    except subprocess.TimeoutExpired:
        return {"ok": False, "returncode": 124, "stdout": "", "stderr": "Command timed out."}


def _provider_setup_status(provider: str, configured_path: str | None = None) -> dict[str, Any]:
    if provider not in {"claude_cli", "codex_cli"}:
        raise HTTPException(400, "Unsupported provider.")

    command = "claude" if provider == "claude_cli" else "codex"
    label = "Claude Code" if provider == "claude_cli" else "Codex"
    path = resolve_cli_path(command, configured_path)
    status: dict[str, Any] = {
        "provider": provider,
        "label": label,
        "installed": bool(path),
        "path": path,
        "version": None,
        "authenticated": None,
        "account": None,
        "auth_method": None,
        "message": "Not installed.",
        "can_install": platform.system() == "Darwin",
        "can_login": bool(path) and platform.system() == "Darwin",
        "install_url": "https://claude.ai/install.sh" if provider == "claude_cli" else "https://chatgpt.com/codex/install.sh",
    }
    if not path:
        return status

    version = _run_probe([path, "--version"])
    if version["ok"]:
        status["version"] = version["stdout"].splitlines()[0] if version["stdout"] else None

    if provider == "claude_cli":
        auth = _run_probe([path, "auth", "status"])
        if auth["ok"]:
            try:
                payload = json.loads(auth["stdout"] or "{}")
            except json.JSONDecodeError:
                payload = {}
            logged_in = bool(payload.get("loggedIn"))
            status.update({
                "authenticated": logged_in,
                "account": payload.get("email"),
                "auth_method": payload.get("subscriptionType") or payload.get("authMethod"),
                "message": "Signed in." if logged_in else "Installed, but not signed in.",
            })
        else:
            status.update({
                "authenticated": False,
                "message": auth["stderr"] or auth["stdout"] or "Installed, but not signed in.",
            })
    else:
        auth = _run_probe([path, "login", "status"])
        text = "\n".join(x for x in (auth["stdout"], auth["stderr"]) if x).strip()
        logged_in = auth["ok"] and "logged in" in text.lower()
        status.update({
            "authenticated": logged_in,
            "auth_method": text.replace("Logged in using ", "") if logged_in else None,
            "message": text or ("Signed in." if logged_in else "Installed, but not signed in."),
        })

    return status


def _osascript_string(value: str) -> str:
    return json.dumps(value)


def _open_setup_command_in_terminal(command: str) -> None:
    if platform.system() != "Darwin":
        raise HTTPException(400, "Guided install/login is currently supported on macOS only.")

    script = (
        'tell application "Terminal"\n'
        f"  do script {_osascript_string(command)}\n"
        "  activate\n"
        "end tell\n"
    )
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "macOS did not allow Quill to open Terminal.").strip()
        raise HTTPException(500, f"Could not open Terminal: {detail}")


def _setup_terminal_command(provider: str, action: str) -> str:
    if provider == "claude_cli" and action == "install":
        body = "curl -fsSL https://claude.ai/install.sh | bash"
        title = "Claude Code install"
    elif provider == "claude_cli" and action == "login":
        body = "claude auth login --claudeai"
        title = "Claude Code login"
    elif provider == "codex_cli" and action == "install":
        body = "curl -fsSL https://chatgpt.com/codex/install.sh | sh"
        title = "Codex install"
    elif provider == "codex_cli" and action == "login":
        body = "codex login"
        title = "Codex login"
    else:
        raise HTTPException(400, "Unsupported provider setup action.")

    path_prefix = (
        'export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:'
        '$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.volta/bin:'
        '$HOME/.codex/bin:$HOME/.claude/local:$HOME/.claude/bin:$PATH"'
    )
    return (
        f"echo {shlex.quote(title)}; "
        "echo; "
        f"{path_prefix}; "
        f"{body}; "
        "status=$?; echo; "
        'if [ "$status" -eq 0 ]; then echo "Finished. Return to Quill and click Recheck."; '
        'else echo "The command did not finish successfully. Return to Quill for manual steps."; fi; '
        "echo; "
        "read -n 1 -s -r -p 'Press any key to close this window...'; "
        "exit $status"
    )


def _classify_ai_error(text: str | None) -> str:
    lower = (text or "").lower()
    if any(s in lower for s in (
        "rate limit",
        "rate_limit",
        "rate_limit_exceeded",
        "too many requests",
        "429",
    )):
        return "rate_limit"
    if any(s in lower for s in (
        "quota",
        "usage limit",
        "usage limit reached",
        "daily limit",
        "weekly limit",
        "limit resets",
        "credit balance",
        "billing",
        "insufficient_quota",
        "exceeded your current quota",
    )):
        return "quota_limit"
    if any(s in lower for s in ("timed out", "timeout", "deadline")):
        return "timeout"
    if any(s in lower for s in ("max turns", "maximum turns", "context length", "token limit", "input is too long")):
        return "run_limit"
    if any(s in lower for s in ("not found", "no such file", "permission denied", "provider", "not implemented")):
        return "provider_unavailable"
    if any(s in lower for s in ("json", "parse", "decode")):
        return "parse_error"
    return "unknown"


PROVIDER_LIMIT_ERROR_TYPES = {"rate_limit", "quota_limit"}


def _provider_label(provider: Provider | str) -> str:
    value = provider.value if isinstance(provider, Provider) else provider
    return {
        "claude_cli": "Claude",
        "codex_cli": "Codex",
        "anthropic_api": "Anthropic API",
        "openai_api": "OpenAI API",
    }.get(value, value.replace("_", " "))


def _workflow_label(workflow: Workflow | str) -> str:
    value = workflow.value if isinstance(workflow, Workflow) else workflow
    return value.replace("_", " ")


def _event_error_text(data: dict[str, Any]) -> str:
    return "\n".join(
        str(data.get(key) or "")
        for key in ("message", "error", "stderr", "raw_error")
        if data.get(key)
    )


def _runtime_api_base() -> str:
    port = os.environ.get("PORT", "8000")
    return os.environ.get("POSTDOC_API_BASE", f"http://127.0.0.1:{port}").rstrip("/")


def _provider_limit_user_message(provider: Provider, workflow: Workflow) -> str:
    return (
        f"{_provider_label(provider)} reported a usage limit while Quill was running "
        f"{_workflow_label(workflow)}. Quill saved this task in the Recovery Queue. "
        "When the provider limit resets, open AI Runs and rerun it, or use Fallback "
        "to retry with another available provider."
    )


def _is_provider_limit_error(error_type: str | None) -> bool:
    return bool(error_type in PROVIDER_LIMIT_ERROR_TYPES)


def _run_input_payload(req: RunIn) -> dict[str, Any]:
    return {
        "workflow": req.workflow,
        "params": req.params,
        "preferred_provider": req.preferred_provider,
        "professor_id": req.professor_id,
        "document_id": req.document_id,
        "grant_id": req.grant_id,
        "cwd": req.cwd,
        "allowed_tools": req.allowed_tools,
        "max_turns": req.max_turns,
        "timeout_s": req.timeout_s,
    }


def _rehydrate_run_input(payload: dict[str, Any]) -> RunIn:
    return RunIn(**{
        "workflow": payload.get("workflow"),
        "params": payload.get("params") or {},
        "professor_id": payload.get("professor_id"),
        "document_id": payload.get("document_id"),
        "grant_id": payload.get("grant_id"),
        "cwd": payload.get("cwd"),
        "allowed_tools": payload.get("allowed_tools"),
        "max_turns": payload.get("max_turns") or 30,
        "timeout_s": payload.get("timeout_s") or 300,
    })


def _cleanup_stale_runs(db: Session, older_than_minutes: int = 15) -> int:
    cutoff = datetime.utcnow() - timedelta(minutes=older_than_minutes)
    runs = (
        db.query(models.AIRun)
        .filter(models.AIRun.status.in_(("queued", "running")))
        .filter(models.AIRun.created_at < cutoff)
        .all()
    )
    for run in runs:
        run.status = "failed"
        run.completed_at = datetime.utcnow()
        run.error_type = "interrupted"
        run.error_message = "Run was left queued/running after the server or client stopped."
        run.output = run.output or "[error] interrupted stale AI run"
    if runs:
        db.commit()
    return len(runs)


def _enforce_daily_cost_cap(db: Session, settings: models.Settings) -> None:
    cap = settings.daily_cost_cap_usd
    if cap is None or cap <= 0:
        return
    start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    runs = (
        db.query(models.AIRun)
        .filter(models.AIRun.created_at >= start)
        .filter(models.AIRun.cost_usd.isnot(None))
        .all()
    )
    spent = sum(r.cost_usd or 0 for r in runs)
    if spent >= cap:
        raise HTTPException(
            429,
            f"Daily AI cost cap reached (${spent:.4f} of ${cap:.2f}). Raise the cap in Settings or retry tomorrow.",
        )


def _is_loopback(host: str | None) -> bool:
    if not host:
        return False
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _verify_ai_request(request: Request) -> None:
    """Keep local CLI-backed AI runs local unless explicitly opened by env."""
    origin = request.headers.get("origin")
    if origin:
        parsed = urlparse(origin)
        origin_host = parsed.hostname
        if origin not in TRUSTED_AI_ORIGINS and not _is_loopback(origin_host):
            raise HTTPException(403, "AI runs are restricted to trusted local origins.")

    if ALLOW_REMOTE_AI:
        return

    client_host = request.client.host if request.client else None
    if not _is_loopback(client_host):
        raise HTTPException(
            403,
            "AI runs are restricted to loopback clients. Set POSTDOC_ALLOW_REMOTE_AI=1 "
            "only for a trusted, authenticated deployment.",
        )


def _allowed_tools_for(workflow: Workflow) -> list[str]:
    return list(WORKFLOW_TOOL_POLICY.get(workflow, SAFE_WEB_TOOLS))


def _resolve_user_context(db: Session) -> dict[str, Any]:
    """Build the {user, professor, document, grant} dict that prompts expect."""
    user = db.get(models.User, 1)
    if user is not None:
        user_ctx = _shim(user)
        user_ctx["education"] = [_shim(row) for row in user.education]
        user_ctx["publications"] = [_shim(row) for row in user.publications]
        user_ctx["experience"] = [_shim(row) for row in user.experience]
        user_ctx["awards"] = [_shim(row) for row in user.awards]
        user_ctx["references"] = [_shim(row) for row in user.references]
    else:
        user_ctx = _shim(None, default={})
    return {
        "user": user_ctx,
    }


def _shim(obj, default=None):
    """Wrap a SQLAlchemy row so Jinja can do `user.name`. Falls back to defaults."""
    if obj is None:
        return _DotDict(default or {})
    return _DotDict({c.name: getattr(obj, c.name) for c in obj.__table__.columns})


class _DotDict(dict):
    def __getattr__(self, k):  # type: ignore[override]
        return self.get(k)


_DISCOVERY_PAPER_STOPWORDS = {
    "about", "after", "again", "against", "also", "and", "are", "based", "been",
    "between", "both", "can", "data", "for", "from", "has", "have", "into", "its",
    "model", "models", "new", "not", "our", "paper", "papers", "research", "study",
    "studies", "system", "systems", "that", "the", "their", "these", "this", "those",
    "through", "using", "was", "were", "with", "work", "works",
}


def _jsonish_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple, set)):
        return " ".join(_jsonish_text(v) for v in value)
    if isinstance(value, dict):
        return " ".join(f"{k} {_jsonish_text(v)}" for k, v in value.items())
    return str(value)


def _discovery_tokens(text: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z][a-z0-9+\-.]{2,}", (text or "").lower())
        if token not in _DISCOVERY_PAPER_STOPWORDS
    }


def _discovery_profile_publication_tokens(db: Session) -> set[str]:
    user = db.query(models.User).first()
    parts: list[str] = []
    if user:
        parts.extend([
            user.headline or "",
            user.research_interests or "",
            _jsonish_text(user.research_categories),
            _jsonish_text(user.methods),
            _jsonish_text(user.application_domains),
            _jsonish_text(user.tools_frameworks),
            _jsonish_text(user.datasets_used),
            _jsonish_text(user.datasets_created),
        ])
        publications = (
            db.query(models.UserPublication)
            .filter(models.UserPublication.user_id == user.id)
            .order_by(models.UserPublication.is_signature.desc(), models.UserPublication.year.desc())
            .limit(12)
            .all()
        )
        for pub in publications:
            parts.extend([
                pub.title or "",
                pub.abstract or "",
                pub.one_line_takeaway or "",
                pub.venue_short or "",
                pub.venue_full_name or "",
                pub.type or "",
            ])

    return _discovery_tokens("\n".join(parts))


def _professor_paper_tokens(prof: models.Professor) -> set[str]:
    text = "\n".join([
        prof.name or "",
        prof.dept_lab or "",
        prof.research_angle or "",
        prof.research_interests or "",
        prof.last_research_summary or "",
        prof.research_category or "",
    ])
    return _discovery_tokens(text)


def _score_discovery_paper(
    paper: dict[str, Any],
    query_tokens: set[str],
    professor_tokens: set[str],
) -> tuple[int, list[str], int]:
    text = " ".join([
        str(paper.get("title") or ""),
        str(paper.get("venue") or ""),
        str(paper.get("abstract") or ""),
    ])
    paper_tokens = _discovery_tokens(text)
    query_overlap = sorted(query_tokens & paper_tokens)
    professor_overlap = sorted(professor_tokens & paper_tokens)
    current_year = datetime.utcnow().year
    year = paper.get("year")
    try:
        age = max(0, current_year - int(year)) if year else 8
    except Exception:
        age = 8
    recency_bonus = max(0, 20 - (age * 3))
    lexical_score = min(80, len(query_overlap) * 5 + len(professor_overlap) * 10)
    if not query_tokens:
        lexical_score = min(80, 35 + len(professor_overlap) * 10)
    score = max(0, min(100, lexical_score + recency_bonus))
    matched = sorted(set(query_overlap + professor_overlap))
    return int(score), matched[:6], len(professor_overlap)


def _discovery_paper_summary(paper: dict[str, Any], matched_terms: list[str]) -> str:
    title = str(paper.get("title") or "").strip()
    if not title:
        return ""
    year = paper.get("year")
    year_text = f" ({year})" if year else ""
    if matched_terms:
        return f"{title}{year_text} overlaps with your profile/publications on {', '.join(matched_terms[:4])}."
    return f"{title}{year_text} is one of this professor's recent publications; run Research for a deeper fit summary."


async def _save_discovery_professor_papers(db: Session, prof: models.Professor, query_tokens: set[str]) -> None:
    from .semantic_scholar import fetch_professor_papers

    try:
        papers = await fetch_professor_papers(prof.name, prof.university, limit=25)
    except Exception:
        papers = []
    if not papers:
        return

    professor_tokens = _professor_paper_tokens(prof)
    seen_titles: set[str] = set()
    scored: list[tuple[int, int, dict[str, Any], list[str], int]] = []
    for paper in papers:
        if not paper.get("title"):
            continue
        title_key = str(paper["title"]).strip().lower()
        if title_key in seen_titles:
            continue
        seen_titles.add(title_key)
        score, matched, professor_overlap_count = _score_discovery_paper(paper, query_tokens, professor_tokens)
        year = paper.get("year") or 0
        scored.append((score, int(year) if isinstance(year, int) else 0, paper, matched, professor_overlap_count))

    if not scored:
        return

    ranked = sorted(scored, key=lambda row: (row[0], row[1]), reverse=True)
    verified = [row for row in ranked if row[4] >= 2]
    selected = [row for row in verified if row[0] >= 45][:5]
    for row in ranked:
        if len(selected) >= min(5, len(ranked)):
            break
        if row in selected or row[4] < 2:
            continue
        if not selected or len(selected) < 3:
            selected.append(row)

    for score, _year, paper, matched, _professor_overlap_count in selected:
        db.add(models.ProfessorPaper(
            professor_id=prof.id,
            title=paper["title"],
            venue=paper.get("venue"),
            year=paper.get("year"),
            abstract=paper.get("abstract"),
            url=paper.get("url"),
            pdf_url=paper.get("pdf_url"),
            s2_id=paper.get("s2_id"),
            relevance_score=score,
            relevance_summary=_discovery_paper_summary(paper, matched),
        ))


_HIRING_LINE_RE = re.compile(
    r"\b(postdoc|post-doctor|phd|doctoral|master|msc|graduate|student|hiring|"
    r"opening|position|opportunit|join|recruit|apply|prospective|funded|funding|"
    r"vacancy|fellowship)\b",
    re.IGNORECASE,
)
_CONTACT_LINE_RE = re.compile(r"\b(email|contact|apply|send|cv|transcript|statement)\b", re.IGNORECASE)


def _scraped_page_text(page: Any) -> str:
    if not page:
        return ""
    return str(getattr(page, "markdown", None) or getattr(page, "text", None) or "")


def _scraped_evidence_text(scraped: dict[str, Any]) -> str:
    from .text_cleaner import clean_scraped_text

    pages = [scraped.get("scraped_main"), *(scraped.get("scraped_subpages") or [])]
    chunks: list[str] = []
    for page in pages:
        raw = _scraped_page_text(page)
        cleaned = clean_scraped_text(raw)
        if cleaned:
            url = getattr(page, "final_url", None) or getattr(page, "url", None) or ""
            chunks.append(f"{url}\n{cleaned}" if url else cleaned)
    return "\n\n".join(chunks)


def _name_evidence_score(name: str, evidence_text: str) -> int:
    tokens = [t for t in re.findall(r"[a-z]{2,}", (name or "").lower()) if t not in {"dr", "prof", "professor"}]
    evidence = (evidence_text or "").lower()
    if not tokens or not evidence:
        return 0
    score = 0
    if all(t in evidence for t in tokens):
        score += 2
    if tokens[-1] in evidence:
        score += 1
    return score


def _research_evidence_score(candidate: dict[str, Any], query_tokens: set[str], evidence_text: str) -> int:
    candidate_text = " ".join(str(candidate.get(k) or "") for k in (
        "research_angle",
        "research_summary",
        "research_category",
        "dept_lab",
    ))
    candidate_tokens = _discovery_tokens(candidate_text)
    evidence_tokens = _discovery_tokens(evidence_text)
    if not evidence_tokens:
        return 0
    score = 0
    if candidate_tokens & evidence_tokens:
        score += min(4, len(candidate_tokens & evidence_tokens))
    if query_tokens & evidence_tokens:
        score += min(4, len(query_tokens & evidence_tokens))
    return score


def _best_lines(evidence_text: str, pattern: re.Pattern[str], limit: int = 5) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in evidence_text.splitlines():
        line = " ".join(raw.split())
        if len(line) < 35 or len(line) > 320:
            continue
        if not pattern.search(line):
            continue
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(line)
        if len(out) >= limit:
            break
    return out


def _summary_lines(evidence_text: str, query_tokens: set[str], limit: int = 5) -> list[str]:
    scored: list[tuple[int, str]] = []
    for raw in evidence_text.splitlines():
        line = " ".join(raw.split())
        if len(line) < 60 or len(line) > 340:
            continue
        tokens = _discovery_tokens(line)
        score = len(tokens & query_tokens)
        if score:
            scored.append((score, line))
    scored.sort(key=lambda item: item[0], reverse=True)
    lines: list[str] = []
    seen: set[str] = set()
    for _score, line in scored:
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        lines.append(line)
        if len(lines) >= limit:
            break
    return lines


async def _verify_discovery_candidate(candidate: dict[str, Any], query_tokens: set[str]) -> dict[str, Any] | None:
    """Scrape profile/lab pages after discovery and return enriched candidate data.

    Returns:
      - enriched dict when backend evidence exists or the local scraper is unavailable.
      - None when URLs are present but the pages do not contain usable identity/research evidence.
    """
    profile_url = str(candidate.get("profile_url") or "").strip()
    lab_url = str(candidate.get("lab_url") or "").strip()
    if not profile_url and not lab_url:
        return None

    from .scraper_client import prescrape_professor, scrape

    if profile_url:
        scraped = await prescrape_professor(profile_url, lab_url or None)
    else:
        lab_page = await scrape(lab_url)
        scraped = {"scraped_main": lab_page, "scraped_subpages": []}

    main = scraped.get("scraped_main")
    subpages = scraped.get("scraped_subpages") or []
    pages = [p for p in [main, *subpages] if p and getattr(p, "ok", False)]
    if not pages:
        return {**candidate, "profile_scraped_at": None}

    evidence_text = _scraped_evidence_text(scraped)
    if len(evidence_text) < 250:
        return None

    name_score = _name_evidence_score(str(candidate.get("name") or ""), evidence_text)
    research_score = _research_evidence_score(candidate, query_tokens, evidence_text)
    if name_score == 0 and research_score < 2:
        return None

    enriched = dict(candidate)
    enriched["profile_scraped_at"] = datetime.utcnow()
    if not enriched.get("research_summary"):
        summary_lines = _summary_lines(evidence_text, query_tokens, limit=3)
        if summary_lines:
            enriched["research_summary"] = " ".join(summary_lines)[:1200]
    else:
        summary_lines = _summary_lines(evidence_text, query_tokens, limit=2)
        if summary_lines:
            enriched["research_summary"] = f"{enriched['research_summary']}\n\nVerified page evidence: " + " ".join(summary_lines)[:900]

    if not enriched.get("hiring_notes"):
        hiring_lines = _best_lines(evidence_text, _HIRING_LINE_RE, limit=5)
        if hiring_lines:
            enriched["hiring_notes"] = "\n".join(f"- {line}" for line in hiring_lines)
    if not enriched.get("contact_instructions"):
        contact_lines = _best_lines(evidence_text, _CONTACT_LINE_RE, limit=2)
        if contact_lines:
            enriched["contact_instructions"] = " ".join(contact_lines)
    if not enriched.get("lab_url"):
        for page in subpages:
            page_url = getattr(page, "final_url", None) or getattr(page, "url", None) or ""
            if re.search(r"(lab|group|research)", page_url, re.IGNORECASE):
                enriched["lab_url"] = page_url
                break
    return enriched


# ───────────────────────────────────────────────────────────────────
# Post-run result application
# ───────────────────────────────────────────────────────────────────
async def _apply_workflow_result(db: Session, request: RunRequest, full_text: str) -> None:
    """Parse JSON from AI output and write relevant fields to the DB."""
    from ai.runner import extract_json_payload, Workflow  # local to avoid circular import

    payload = extract_json_payload(full_text)
    if not payload:
        return

    if request.workflow == Workflow.RESEARCH_PROFESSOR and request.professor_id:
        prof = db.get(models.Professor, request.professor_id)
        if not prof:
            return
        now = datetime.utcnow()

        if payload.get("email"):
            prof.email = payload["email"]
        if payload.get("lab_url"):
            prof.lab_url = payload["lab_url"]
        if payload.get("scholar_url"):
            prof.scholar_url = payload["scholar_url"]
        if payload.get("summary"):
            prof.last_research_summary = payload["summary"]
            prof.research_summary_at = now
        if payload.get("prospective_url"):
            prof.prospective_url = payload["prospective_url"]
        if payload.get("hiring_signals") is not None:
            prof.hiring_signals = payload["hiring_signals"]
        if payload.get("hiring_notes"):
            prof.hiring_notes = payload["hiring_notes"]
        if payload.get("contact_instructions"):
            prof.contact_instructions = payload["contact_instructions"]

        prof.profile_scraped_at = now
        prof.auto_filled_at = now

        # Save relevant papers returned by the AI.
        raw_papers = payload.get("papers") or []
        if raw_papers:
            # Delete stale papers before replacing.
            db.query(models.ProfessorPaper).filter_by(professor_id=request.professor_id).delete()
            for p in raw_papers:
                if not p.get("title"):
                    continue
                db.add(models.ProfessorPaper(
                    professor_id=request.professor_id,
                    title=p["title"],
                    venue=p.get("venue"),
                    year=p.get("year"),
                    abstract=p.get("abstract"),
                    url=p.get("url"),
                    pdf_url=p.get("pdf_url"),
                    s2_id=p.get("s2_id"),
                    relevance_score=p.get("relevance_score"),
                    relevance_summary=p.get("relevance_summary"),
                ))

        db.commit()

    elif request.workflow == Workflow.DRAFT_EMAIL and request.professor_id:
        prof = db.get(models.Professor, request.professor_id)
        if not prof:
            return
        subject = payload.get("subject", "")
        body = payload.get("body", "")
        if subject or body:
            # Mark any existing active drafts for this professor as backup so
            # the UI shows only the freshly-redrafted one. The old version is
            # preserved in the database with is_backup=True.
            db.query(models.EmailDraft).filter(
                models.EmailDraft.professor_id == request.professor_id,
                models.EmailDraft.is_backup == False,  # noqa: E712
                models.EmailDraft.sent_at.is_(None),
            ).update({"is_backup": True})

            draft = models.EmailDraft(
                professor_id=request.professor_id,
                subject=subject,
                body=body,
                ai_generated=True,
            )
            db.add(draft)
            db.commit()

    elif request.workflow == Workflow.EXTRACT_PROFILE:
        user = db.query(models.User).first()
        if not user:
            return
        field_map = {
            "full_name": "name",
            "current_role": "current_role",
            "affiliation": "affiliation",
            "country": "country",
            "research_interests": "research_interests",
            "research_categories": "research_categories",
            "phd_year": "phd_year",
            "phd_institution": "phd_institution",
            "orcid": "orcid",
            "scholar_url": "scholar_url",
            "github": "github",
            "website": "website",
        }
        for json_key, col in field_map.items():
            val = payload.get(json_key)
            if val is not None:
                setattr(user, col, val)
        db.commit()

    elif request.workflow == Workflow.EXTRACT_USER_PROFILE_FULL:
        _apply_user_profile_extraction(db, payload)

    elif request.workflow == Workflow.DISCOVER_PROFESSORS:
        professors = payload.get("professors", [])
        allowed_countries = _normalize_country_filter(request.params.get("target_countries"))
        query_tokens = _discovery_profile_publication_tokens(db)
        for p in professors:
            if not p.get("name") or not p.get("university"):
                continue
            if allowed_countries and not _country_matches_filter(p.get("country"), allowed_countries):
                continue
            verified = await _verify_discovery_candidate(p, query_tokens)
            if verified is None:
                continue
            p = verified
            existing = (
                db.query(models.Professor.id)
                .filter(func.lower(models.Professor.name) == str(p["name"]).strip().lower())
                .filter(func.lower(models.Professor.university) == str(p["university"]).strip().lower())
                .first()
            )
            if existing:
                continue
            position_type = p.get("position_type") or request.params.get("position_type") or None
            hiring_signal = p.get("hiring_signals")
            prof = models.Professor(
                name=str(p["name"]).strip(),
                university=str(p["university"]).strip(),
                dept_lab=p.get("dept_lab") or "",
                email=p.get("email") or "",
                profile_url=p.get("profile_url"),
                lab_url=p.get("lab_url"),
                scholar_url=p.get("scholar_url"),
                research_angle=p.get("research_angle"),
                research_interests=p.get("research_summary") or "",
                last_research_summary=p.get("research_summary"),
                research_category=p.get("research_category", ""),
                match_score=p.get("match_score"),
                position_type=position_type,
                is_suggested=True,
                status="drafting",
                source="discovery",
                hiring_signals={position_type: hiring_signal} if hiring_signal is not None else None,
                hiring_notes=p.get("hiring_notes"),
                prospective_url=p.get("prospective_url"),
                contact_instructions=p.get("contact_instructions"),
                profile_scraped_at=p.get("profile_scraped_at"),
            )
            db.add(prof)
            db.flush()
            await _save_discovery_professor_papers(db, prof, query_tokens)
        db.commit()


def _normalize_country_filter(value: Any) -> set[str]:
    if not value:
        return set()
    items = value if isinstance(value, list) else str(value).replace(";", ",").split(",")
    return {
        normalized
        for item in items
        if (normalized := _normalize_country_name(str(item)))
    }


def _country_matches_filter(country: Any, allowed: set[str]) -> bool:
    if not allowed:
        return True
    normalized = _normalize_country_name(str(country or ""))
    return bool(normalized and normalized in allowed)


def _normalize_country_name(value: str) -> str:
    compact = value.strip().lower()
    compact = compact.replace(".", "")
    aliases = {
        "ca": "canada",
        "can": "canada",
        "canada": "canada",
        "us": "united states",
        "usa": "united states",
        "u s": "united states",
        "u s a": "united states",
        "united states": "united states",
        "united states of america": "united states",
        "america": "united states",
        "uk": "united kingdom",
        "u k": "united kingdom",
        "united kingdom": "united kingdom",
        "great britain": "united kingdom",
    }
    return aliases.get(compact, compact)


# ───────────────────────────────────────────────────────────────────
# extract_user_profile_full helpers
# ───────────────────────────────────────────────────────────────────
# Map of repeatable-section name in the JSON payload → (Model, list of
# allowed column names). Anything outside the allowed set is silently
# dropped so the AI can't insert columns we don't have.
_USER_PROFILE_CHILD_SECTIONS = {
    "education":    (models.UserEducation,   {
        "degree_level","field","institution","department","start_date","end_date",
        "is_current","gpa","gpa_scale","honors","advisor_name","advisor_title",
        "co_advisor_name","thesis_title","thesis_abstract","key_courses",
    }),
    "publications": (models.UserPublication, {
        "title","authors","venue_full_name","venue_short","year","type","status",
        "doi","url","pdf_url","citation_count","your_role","abstract",
        "one_line_takeaway","is_signature",
    }),
    "experience":   (models.UserExperience,  {
        "title","employer","lab_or_group","supervisor","location","start_date",
        "end_date","is_current","bullets","tech_used",
    }),
    "awards":       (models.UserAward,       {
        "name","granting_body","amount","currency","year","type","notes",
    }),
    "references":   (models.UserReference,   {
        "name","title","institution","email","relationship_type","years_known","notes",
    }),
}

# Scalar fields on User that the AI is allowed to set. Whitelist-based to
# avoid AI overwriting `id`, `created_at`, FK ids, or provenance metadata.
_USER_PROFILE_SCALAR_FIELDS = {
    "name","preferred_name","pronouns","headshot_url",
    "email","email_secondary","phone","city","country","nationality","languages",
    "orcid","scholar_url","github","linkedin","website","twitter",
    "current_role","affiliation",
    "headline","research_interests","research_categories",
    "methods","application_domains","tools_frameworks",
    "datasets_used","datasets_created",
    "programming_languages","certifications","reviewing_venues","teaching_summary",
}


def _parse_iso_date(v):
    """AI may return 'YYYY-MM-DD' or null. Convert to date or return None."""
    if not v:
        return None
    from datetime import date as _date
    if isinstance(v, _date):
        return v
    try:
        return datetime.fromisoformat(str(v)[:10]).date()
    except Exception:
        return None


def _apply_user_profile_extraction(db: Session, payload: dict[str, Any]) -> None:
    """Upsert AI-extracted profile data into users + child tables.

    Honours user.field_provenance[field].verified_by_user: any scalar field
    flagged verified is left untouched. Child tables are replaced wholesale
    (the AI receives existing_profile and is told to preserve verified items).
    """
    user = db.get(models.User, 1)
    if not user:
        user = models.User(id=1, name="")
        db.add(user)
        db.flush()

    existing_prov = dict(user.field_provenance or {})
    new_prov_from_ai = dict(payload.get("field_provenance") or {})

    user_block = payload.get("user") or {}
    for field, value in user_block.items():
        if field not in _USER_PROFILE_SCALAR_FIELDS:
            continue
        if existing_prov.get(field, {}).get("verified_by_user"):
            continue
        if value is None or value == "":
            continue
        setattr(user, field, value)

    # Merge provenance: new entries overwrite non-verified ones; verified
    # entries are always preserved.
    merged_prov = {}
    for k, v in existing_prov.items():
        if v.get("verified_by_user"):
            merged_prov[k] = v
    for k, v in new_prov_from_ai.items():
        if k not in merged_prov:
            merged_prov[k] = {**(v if isinstance(v, dict) else {}), "extracted_at": datetime.utcnow().isoformat()}
    user.field_provenance = merged_prov
    user.cv_last_extracted_at = datetime.utcnow()

    # Replace child collections.
    for section, (Model, allowed_cols) in _USER_PROFILE_CHILD_SECTIONS.items():
        items = payload.get(section) or []
        if not isinstance(items, list):
            continue
        db.query(Model).filter_by(user_id=user.id).delete()
        for idx, raw in enumerate(items):
            if not isinstance(raw, dict):
                continue
            kwargs = {k: v for k, v in raw.items() if k in allowed_cols}
            # Coerce date strings
            for date_col in ("start_date", "end_date"):
                if date_col in kwargs:
                    kwargs[date_col] = _parse_iso_date(kwargs[date_col])
            # Required-NOT-NULL guards
            if Model is models.UserEducation and not kwargs.get("degree_level"):
                continue
            if Model is models.UserPublication and not kwargs.get("title"):
                continue
            if Model is models.UserExperience and not kwargs.get("title"):
                continue
            if Model is models.UserAward and not kwargs.get("name"):
                continue
            if Model is models.UserReference and not kwargs.get("name"):
                continue
            kwargs["user_id"] = user.id
            kwargs["order_idx"] = idx
            db.add(Model(**kwargs))

    db.commit()


def _build_user_extraction_context(db: Session, request: RunRequest) -> None:
    """Resolve CV / transcripts / personal page texts and inject into request.params.

    Reads users.cv_doc_id, users.transcript_doc_ids, users.website, and the
    current users row (as existing_profile, minus id / timestamps).
    """
    user = db.get(models.User, 1)
    if not user:
        request.params.setdefault("cv_text", "")
        return

    # CV — mandatory but we don't raise here; the prompt will surface the gap.
    cv_text = ""
    if user.cv_doc_id:
        cv_doc = db.get(models.Document, user.cv_doc_id)
        if cv_doc and cv_doc.text:
            cv_text = cv_doc.text
    request.params["cv_text"] = cv_text

    # Transcripts — list of {degree_hint, text}.
    transcript_texts: list[dict[str, str]] = []
    transcript_ids = user.transcript_doc_ids or []
    for tid in transcript_ids:
        doc = db.get(models.Document, tid)
        if doc and doc.text:
            # Try to infer degree level from title — best-effort.
            title = (doc.title or "").lower()
            hint = ""
            for level in ("phd", "ph.d", "doctoral", "msc", "m.sc", "master", "bsc", "b.sc", "bachelor"):
                if level in title:
                    hint = level.upper().replace(".", "")
                    break
            transcript_texts.append({"degree_hint": hint, "text": doc.text})
    request.params["transcript_texts"] = transcript_texts

    # Personal page — already-scraped text stored on user.website is just a
    # URL, so we keep it empty for now. Wire a real scraper later.
    request.params["personal_page_text"] = ""

    # Existing profile (so the AI preserves verified fields).
    snapshot = {c.name: getattr(user, c.name) for c in user.__table__.columns}
    for k in ("id", "created_at", "updated_at", "cv_last_extracted_at"):
        snapshot.pop(k, None)
    # Make sure JSON-serialisable
    from datetime import date as _date
    for k, v in list(snapshot.items()):
        if isinstance(v, (datetime, _date)):
            snapshot[k] = v.isoformat()
    request.params["existing_profile"] = snapshot


# ───────────────────────────────────────────────────────────────────
# Streaming
# ───────────────────────────────────────────────────────────────────
async def _run_and_stream(run_id: int, request: RunRequest, provider: Provider, cli_path: Optional[str]) -> AsyncIterator[bytes]:
    """The actual SSE generator. Updates the AIRun row inline."""
    # We open our own DB session in this generator because the request-scoped
    # session from FastAPI may close before the stream ends.
    from .database import SessionLocal
    db = SessionLocal()
    started_wallclock = time.monotonic()
    full_text_parts: list[str] = []
    last_event: dict[str, Any] = {}

    try:
        # Mark running.
        run = db.get(models.AIRun, run_id)
        if run:
            run.status = "running"
            run.started_at = datetime.utcnow()
            db.commit()

        # Initial sentinel so the client knows the run id immediately.
        head = StreamEvent(kind="run_id", data={"id": run_id, "provider": provider.value, "workflow": request.workflow.value})
        yield head.to_sse().encode()

        # Pre-scrape professor pages before the AI run so the prompt has real content.
        if request.workflow == Workflow.RESEARCH_PROFESSOR and request.professor_id:
            from .scraper_client import prescrape_professor
            from .semantic_scholar import fetch_professor_papers
            # Always set defaults so the Jinja template never hits StrictUndefined.
            request.params.setdefault("scraped_main", None)
            request.params.setdefault("scraped_subpages", [])

            prof_ctx = request.params.get("professor")
            prof_name = (
                getattr(prof_ctx, "name", None)
                or (prof_ctx.get("name") if isinstance(prof_ctx, dict) else None)
                or ""
            )
            prof_uni = (
                getattr(prof_ctx, "university", None)
                or (prof_ctx.get("university") if isinstance(prof_ctx, dict) else None)
            )
            profile_url = (
                getattr(prof_ctx, "profile_url", None)
                or (prof_ctx.get("profile_url") if isinstance(prof_ctx, dict) else None)
            )
            lab_url = (
                getattr(prof_ctx, "lab_url", None)
                or (prof_ctx.get("lab_url") if isinstance(prof_ctx, dict) else None)
            )

            # Fetch papers from Semantic Scholar in parallel with scraping.
            s2_task = asyncio.create_task(fetch_professor_papers(prof_name, prof_uni))

            if profile_url:
                scrape_evt = StreamEvent(kind="text", data={"text": f"\n[Scraper] Fetching {profile_url} ...\n"})
                yield scrape_evt.to_sse().encode()
                scraped = await prescrape_professor(profile_url, lab_url)
                request.params.update(scraped)
                sub_count = len(scraped.get("scraped_subpages") or [])
                done_evt = StreamEvent(kind="text", data={"text": f"[Scraper] Done - main page + {sub_count} evidence page(s) scraped.\n\n"})
                yield done_evt.to_sse().encode()

            s2_papers = await s2_task
            request.params["s2_papers"] = s2_papers
            if s2_papers:
                s2_evt = StreamEvent(kind="text", data={"text": f"[Semantic Scholar] {len(s2_papers)} papers found for {prof_name}.\n\n"})
                yield s2_evt.to_sse().encode()

        # For extract_user_profile_full: build context from CV + transcripts + personal page.
        if request.workflow == Workflow.EXTRACT_USER_PROFILE_FULL:
            _build_user_extraction_context(db, request)

        # For draft_email: inject saved papers as context.
        if request.workflow == Workflow.DRAFT_EMAIL and request.professor_id:
            papers = (
                db.query(models.ProfessorPaper)
                .filter_by(professor_id=request.professor_id)
                .order_by(models.ProfessorPaper.relevance_score.desc(), models.ProfessorPaper.year.desc())
                .limit(5)
                .all()
            )
            if papers:
                request.params["relevant_papers"] = [
                    {
                        "title": p.title,
                        "venue": p.venue,
                        "year": p.year,
                        "relevance_summary": p.relevance_summary,
                        "url": p.url,
                    }
                    for p in papers
                ]

        got_done = False
        try:
            async for evt in runner_stream(request, provider=provider, cli_path=cli_path):
                if evt.kind == "text":
                    full_text_parts.append(evt.data.get("text", ""))
                if evt.kind == "error":
                    raw_error = _event_error_text(evt.data)
                    error_type = _classify_ai_error(raw_error)
                    if _is_provider_limit_error(error_type):
                        evt.data = {
                            "message": _provider_limit_user_message(provider, request.workflow),
                            "error_type": error_type,
                            "retryable": True,
                            "deferred": True,
                            "raw_error": raw_error,
                        }
                if evt.kind in ("done", "error", "parsed"):
                    last_event = evt.data
                if evt.kind == "done":
                    got_done = True
                yield evt.to_sse().encode()
        except asyncio.CancelledError:
            # Client disconnected mid-stream. If the AI already finished
            # (got_done == True), fall through and finalize normally so the
            # generated draft is not lost. Otherwise mark the run cancelled.
            if not got_done:
                run = db.get(models.AIRun, run_id)
                if run and run.status == "running":
                    run.status = "cancelled"
                    run.completed_at = datetime.utcnow()
                    run.error_type = "cancelled"
                    run.error_message = "Client disconnected before the run completed."
                    db.commit()
                raise

        # Finalize the AIRun row with cost / usage / output.
        full_text = "".join(full_text_parts)
        run = db.get(models.AIRun, run_id)
        if run:
            raw_failure_text = (
                last_event.get("raw_error")
                or last_event.get("message")
                or last_event.get("error")
                or last_event.get("stderr")
                or (None if got_done else "AI run ended before a completion event was received.")
            )
            error_type = _classify_ai_error(str(raw_failure_text or ""))
            failure_text = (
                last_event.get("message")
                or last_event.get("error")
                or last_event.get("stderr")
                or (None if got_done else "AI run ended before a completion event was received.")
            )
            failed = last_event.get("ok") is False or "error" in last_event or not got_done
            run.status = "deferred" if failed and _is_provider_limit_error(error_type) else ("failed" if failed else "done")
            run.completed_at = datetime.utcnow()
            run.duration_ms = int((time.monotonic() - started_wallclock) * 1000)
            run.cost_usd = last_event.get("cost_usd")
            usage = last_event.get("usage") or {}
            run.tokens_in = usage.get("input_tokens")
            run.tokens_out = usage.get("output_tokens")
            run.output = full_text or last_event.get("result")
            if run.status in {"failed", "deferred"}:
                run.error_type = error_type
                run.error_message = (
                    _provider_limit_user_message(provider, request.workflow)
                    if run.status == "deferred"
                    else str(failure_text or "AI run failed.")
                )
            db.commit()

        # Write workflow-specific results back to the DB.
        if run and run.status == "done":
            await _apply_workflow_result(db, request, full_text or last_event.get("result") or "")
    except Exception as exc:
        # Any unhandled exception (template render error, subprocess crash, etc.)
        # must flip the row to "failed" so it never stays stuck at "running".
        try:
            run = db.get(models.AIRun, run_id)
            if run and run.status == "running":
                error_type = _classify_ai_error(str(exc))
                run.status = "failed"
                run.completed_at = datetime.utcnow()
                run.duration_ms = int((time.monotonic() - started_wallclock) * 1000)
                if _is_provider_limit_error(error_type):
                    run.status = "deferred"
                    run.error_message = _provider_limit_user_message(provider, request.workflow)
                else:
                    run.error_message = str(exc)
                run.error_type = error_type
                run.output = f"[error] {exc}"
                db.commit()
            if _is_provider_limit_error(_classify_ai_error(str(exc))):
                err_evt = StreamEvent(
                    kind="error",
                    data={
                        "message": _provider_limit_user_message(provider, request.workflow),
                        "error_type": _classify_ai_error(str(exc)),
                        "retryable": True,
                        "deferred": True,
                    },
                )
            else:
                err_evt = StreamEvent(kind="error", data={"error": str(exc)})
            yield err_evt.to_sse().encode()
        except Exception:
            pass
    finally:
        db.close()


# ───────────────────────────────────────────────────────────────────
# Routes
# ───────────────────────────────────────────────────────────────────
def _prepare_ai_run(
    db: Session,
    req: RunIn,
    *,
    provider_override: Optional[Provider] = None,
    retry_of_run_id: Optional[int] = None,
) -> tuple[models.AIRun, RunRequest, Provider, Optional[str]]:
    try:
        workflow = Workflow(req.workflow)
    except ValueError:
        raise HTTPException(400, f"Unknown workflow: {req.workflow}")

    # Forgive a common Quill-shape mistake: if professor_id / document_id /
    # grant_id were nested under `params` instead of being passed at the top
    # level, lift them up. Without this, the Jinja `professor` var is never
    # injected and the workflow dies with `'professor' is undefined`.
    for key in ("professor_id", "document_id", "grant_id"):
        if getattr(req, key) is None and key in req.params:
            try:
                setattr(req, key, int(req.params.pop(key)))
            except (TypeError, ValueError):
                req.params.pop(key, None)

    _required_target = {
        Workflow.RESEARCH_PROFESSOR: ("professor_id", req.professor_id),
        Workflow.DRAFT_EMAIL:        ("professor_id", req.professor_id),
        Workflow.EXTRACT_USER_PROFILE_FULL: ("document_id", req.document_id),
    }.get(workflow)
    if _required_target is not None:
        field, value = _required_target
        if value is None:
            raise HTTPException(
                400,
                f"Workflow '{workflow.value}' requires top-level '{field}'. "
                f"Pass it as a top-level field on the request body, not inside `params`.",
            )

    settings = _settings(db)
    _enforce_daily_cost_cap(db, settings)
    preferred_provider = None
    if req.preferred_provider:
        try:
            preferred_provider = Provider(req.preferred_provider)
        except ValueError:
            raise HTTPException(400, f"Unknown provider: {req.preferred_provider}")
        if not _provider_available(settings, preferred_provider):
            raise HTTPException(503, f"Provider '{preferred_provider.value}' is not available.")

    provider = provider_override or preferred_provider or _select_provider_for(settings)
    if provider is None:
        raise HTTPException(503, "No AI provider available. Install Claude or Codex CLI, or configure an API key in Settings.")

    cli_path = (
        resolve_cli_path("claude", settings.claude_cli_path) if provider == Provider.CLAUDE_CLI else
        resolve_cli_path("codex", settings.codex_cli_path) if provider == Provider.CODEX_CLI else
        None
    )

    # Hydrate the user/professor/document/grant Jinja vars if the prompt expects them.
    base_ctx = _resolve_user_context(db)
    base_ctx["api_base"] = _runtime_api_base()
    if req.professor_id is not None:
        prof = db.get(models.Professor, req.professor_id)
        if prof is not None:
            base_ctx["professor"] = _shim(prof)
    if req.document_id is not None:
        doc = db.get(models.Document, req.document_id)
        if doc is not None:
            base_ctx["document"] = _shim(doc)
    if req.grant_id is not None:
        grant = db.get(models.Grant, req.grant_id)
        if grant is not None:
            base_ctx["grant"] = _shim(grant)
    params = {**base_ctx, **req.params}

    max_turns = max(1, min(req.max_turns, 30))
    timeout_cap = 900 if workflow in {Workflow.DISCOVER_PROFESSORS, Workflow.EXTRACT_USER_PROFILE_FULL} else 300
    timeout_s = max(10, min(req.timeout_s, timeout_cap))
    run_request = RunRequest(
        workflow=workflow,
        params=params,
        professor_id=req.professor_id,
        document_id=req.document_id,
        grant_id=req.grant_id,
        cwd=str(DASHBOARD_ROOT),
        allowed_tools=_allowed_tools_for(workflow),
        max_turns=max_turns,
        timeout_s=timeout_s,
    )

    prompt_text = None
    prompt_hash = None
    try:
        prompt_text = render_prompt(workflow, **params)
        prompt_hash = hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()
    except Exception:
        # The streaming path will surface the concrete render error.
        pass

    ai_run = models.AIRun(
        workflow=workflow.value,
        provider=provider.value,
        status="queued",
        professor_id=req.professor_id,
        document_id=req.document_id,
        grant_id=req.grant_id,
        request_json=_run_input_payload(req),
        prompt_text=prompt_text,
        prompt_hash=prompt_hash,
        retry_of_run_id=retry_of_run_id,
    )
    db.add(ai_run)
    db.commit()
    db.refresh(ai_run)
    return ai_run, run_request, provider, cli_path


async def _drain_run(run_id: int, request: RunRequest, provider: Provider, cli_path: Optional[str]) -> None:
    async for _ in _run_and_stream(run_id, request, provider, cli_path):
        pass


@router.post("/run")
def run_workflow(req: RunIn, request: Request, db: Session = Depends(get_db)):
    """Start a workflow and stream its events as SSE.

    The first event is `run_id` — the client should capture it.
    """
    _verify_ai_request(request)
    ai_run, run_request, provider, cli_path = _prepare_ai_run(db, req)

    return StreamingResponse(
        _run_and_stream(ai_run.id, run_request, provider, cli_path),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering if proxied
            "Connection": "keep-alive",
        },
    )


@router.post("/run/background", response_model=RunOut, status_code=202)
def start_background_workflow(
    req: RunIn,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
):
    """Start a workflow and keep draining it after the HTTP response closes."""
    _verify_ai_request(request)
    ai_run, run_request, provider, cli_path = _prepare_ai_run(db, req)
    background_tasks.add_task(_drain_run, ai_run.id, run_request, provider, cli_path)
    return ai_run


@router.get("/runs/{run_id}", response_model=RunOut)
def get_run(run_id: int, db: Session = Depends(get_db)):
    _cleanup_stale_runs(db)
    run = db.get(models.AIRun, run_id)
    if not run:
        raise HTTPException(404, "AI run not found")
    return run


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: int, db: Session = Depends(get_db)):
    """Mark a stuck running/queued run as cancelled."""
    run = db.get(models.AIRun, run_id)
    if not run:
        raise HTTPException(404, "AI run not found")
    if run.status not in ("running", "queued"):
        raise HTTPException(400, f"Run is already {run.status}")
    run.status = "cancelled"
    run.completed_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "run_id": run_id, "status": "cancelled"}


@router.post("/runs/{run_id}/retry", response_model=RunOut, status_code=202)
def retry_run(
    run_id: int,
    payload: RetryRunIn,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
):
    """Create and start a replacement run from the saved request metadata."""
    _verify_ai_request(request)
    _cleanup_stale_runs(db)
    old = db.get(models.AIRun, run_id)
    if not old:
        raise HTTPException(404, "AI run not found")
    if old.status in ("queued", "running"):
        raise HTTPException(400, f"Run is still {old.status}; cancel it before retrying.")
    if not old.request_json:
        raise HTTPException(409, "This run was created before retry metadata existed.")

    settings = _settings(db)
    provider_override = None
    if payload.use_fallback_provider:
        provider_override = _select_fallback_provider(settings, old.provider)
        if provider_override is None:
            raise HTTPException(503, "No fallback AI provider is available.")
    else:
        try:
            provider_override = Provider(old.provider)
        except ValueError:
            provider_override = None
        if provider_override is not None and not _provider_available(settings, provider_override):
            raise HTTPException(503, f"Original provider '{old.provider}' is not available.")

    req = _rehydrate_run_input(old.request_json)
    new_run, run_request, provider, cli_path = _prepare_ai_run(
        db,
        req,
        provider_override=provider_override,
        retry_of_run_id=old.id,
    )
    if old.status == "deferred" or _is_provider_limit_error(old.error_type):
        old.status = "retried"
        old.error_message = (
            f"{old.error_message or 'Task was restarted.'}\n\n"
            f"Restarted as AI run #{new_run.id}."
        )
        db.commit()
    background_tasks.add_task(_drain_run, new_run.id, run_request, provider, cli_path)
    return new_run


@router.post("/recover-stale-runs")
def recover_stale_runs(db: Session = Depends(get_db)):
    return {"updated": _cleanup_stale_runs(db, older_than_minutes=15)}


@router.get("/runs", response_model=list[RunOut])
def list_runs(limit: int = 50, db: Session = Depends(get_db)):
    _cleanup_stale_runs(db)
    return (
        db.query(models.AIRun)
        .order_by(models.AIRun.id.desc())
        .limit(min(limit, 200))
        .all()
    )


@router.get("/providers")
def providers_status(db: Session = Depends(get_db)):
    """Tells the UI which providers are available right now."""
    s = _settings(db)
    claude_path = resolve_cli_path("claude", s.claude_cli_path)
    codex_path = resolve_cli_path("codex", s.codex_cli_path)
    return {
        "selected_default": s.ai_provider,
        "claude_cli": {
            "available": bool(claude_path),
            "path": claude_path,
        },
        "codex_cli": {
            "available": bool(codex_path),
            "path": codex_path,
        },
        "anthropic_api": {"configured": bool(s.anthropic_api_key)},
        "openai_api": {"configured": bool(s.openai_api_key)},
        "active": (_select_provider_for(s).value if _select_provider_for(s) else None),
        "daily_cost_cap_usd": s.daily_cost_cap_usd,
    }


@router.get("/provider-setup")
def provider_setup_status(db: Session = Depends(get_db)):
    """Detailed local CLI setup status for the Settings connector wizard."""
    s = _settings(db)
    return {
        "platform": platform.system(),
        "providers": {
            "claude_cli": _provider_setup_status("claude_cli", s.claude_cli_path),
            "codex_cli": _provider_setup_status("codex_cli", s.codex_cli_path),
        },
    }


@router.post("/provider-setup")
def provider_setup_action(payload: ProviderSetupIn, request: Request, db: Session = Depends(get_db)):
    """Open an allowlisted provider install/login command in Terminal.

    This endpoint intentionally does not accept arbitrary shell text. The UI
    can only choose a known provider and one of the known setup actions.
    """
    _verify_ai_request(request)
    if payload.provider not in {"claude_cli", "codex_cli"}:
        raise HTTPException(400, "Unsupported provider.")
    if payload.action not in {"install", "login"}:
        raise HTTPException(400, "Unsupported setup action.")

    s = _settings(db)
    before = _provider_setup_status(
        payload.provider,
        s.claude_cli_path if payload.provider == "claude_cli" else s.codex_cli_path,
    )
    if payload.action == "login" and not before["installed"]:
        raise HTTPException(400, f"{before['label']} must be installed before login.")

    command = _setup_terminal_command(payload.provider, payload.action)
    _open_setup_command_in_terminal(command)
    return {
        "ok": True,
        "provider": payload.provider,
        "action": payload.action,
        "message": f"Opened {before['label']} {payload.action} in Terminal.",
    }


# Workflow registry (for the UI to know what's wireable):
@router.get("/workflows")
def list_workflows():
    return [{"id": w.value, "label": w.value.replace("_", " ").title()} for w in Workflow]
