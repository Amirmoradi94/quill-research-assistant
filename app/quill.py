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
import json
import os
import time
from datetime import datetime
from typing import Any, AsyncIterator, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .database import get_db
from . import models

# Make the parent dir importable so `ai` can be found alongside `app`.
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai.runner import (  # noqa: E402
    Provider,
    RunRequest,
    StreamEvent,
    Workflow,
    select_provider,
    stream as runner_stream,
)


router = APIRouter(prefix="/api/ai", tags=["ai"])


# ───────────────────────────────────────────────────────────────────
# Schemas
# ───────────────────────────────────────────────────────────────────
class RunIn(BaseModel):
    workflow: str
    params: dict[str, Any] = {}
    professor_id: Optional[int] = None
    document_id: Optional[int] = None
    grant_id: Optional[int] = None
    cwd: Optional[str] = None
    allowed_tools: Optional[list[str]] = None
    max_turns: int = 8
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
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


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


def _resolve_user_context(db: Session) -> dict[str, Any]:
    """Build the {user, professor, document, grant} dict that prompts expect."""
    user = db.get(models.User, 1)
    return {
        "user": _shim(user, default={"name": "the user", "current_role": "researcher", "affiliation": "—", "research_interests": "—"}),
    }


def _shim(obj, default=None):
    """Wrap a SQLAlchemy row so Jinja can do `user.name`. Falls back to defaults."""
    if obj is None:
        return _DotDict(default or {})
    return _DotDict({c.name: getattr(obj, c.name) for c in obj.__table__.columns})


class _DotDict(dict):
    def __getattr__(self, k):  # type: ignore[override]
        return self.get(k)


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

        async for evt in runner_stream(request, provider=provider, cli_path=cli_path):
            if evt.kind == "text":
                full_text_parts.append(evt.data.get("text", ""))
            if evt.kind in ("done", "error", "parsed"):
                last_event = evt.data
            yield evt.to_sse().encode()

        # Finalize the AIRun row with cost / usage / output.
        run = db.get(models.AIRun, run_id)
        if run:
            run.status = "failed" if last_event.get("ok") is False or "error" in last_event else "done"
            run.completed_at = datetime.utcnow()
            run.duration_ms = int((time.monotonic() - started_wallclock) * 1000)
            run.cost_usd = last_event.get("cost_usd")
            usage = last_event.get("usage") or {}
            run.tokens_in = usage.get("input_tokens")
            run.tokens_out = usage.get("output_tokens")
            run.output = "".join(full_text_parts) or last_event.get("result")
            db.commit()
    except asyncio.CancelledError:
        run = db.get(models.AIRun, run_id)
        if run and run.status == "running":
            run.status = "cancelled"
            run.completed_at = datetime.utcnow()
            db.commit()
        raise
    finally:
        db.close()


# ───────────────────────────────────────────────────────────────────
# Routes
# ───────────────────────────────────────────────────────────────────
@router.post("/run")
def run_workflow(req: RunIn, db: Session = Depends(get_db)):
    """Start a workflow and stream its events as SSE.

    The first event is `run_id` — the client should capture it.
    """
    try:
        workflow = Workflow(req.workflow)
    except ValueError:
        raise HTTPException(400, f"Unknown workflow: {req.workflow}")

    settings = _settings(db)
    provider = _select_provider_for(settings)
    if provider is None:
        raise HTTPException(503, "No AI provider available. Install Claude or Codex CLI, or configure an API key in Settings.")

    cli_path = (
        settings.claude_cli_path if provider == Provider.CLAUDE_CLI else
        settings.codex_cli_path  if provider == Provider.CODEX_CLI  else
        None
    )

    # Hydrate the user/professor/document/grant Jinja vars if the prompt expects them.
    base_ctx = _resolve_user_context(db)
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

    # Persist the AIRun row up-front so we have an id to put in the first event.
    ai_run = models.AIRun(
        workflow=workflow.value,
        provider=provider.value,
        status="queued",
        professor_id=req.professor_id,
        document_id=req.document_id,
        grant_id=req.grant_id,
    )
    db.add(ai_run)
    db.commit()
    db.refresh(ai_run)

    run_request = RunRequest(
        workflow=workflow,
        params=params,
        professor_id=req.professor_id,
        document_id=req.document_id,
        grant_id=req.grant_id,
        cwd=req.cwd,
        allowed_tools=req.allowed_tools,
        max_turns=req.max_turns,
        timeout_s=req.timeout_s,
    )

    return StreamingResponse(
        _run_and_stream(ai_run.id, run_request, provider, cli_path),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering if proxied
            "Connection": "keep-alive",
        },
    )


@router.get("/runs/{run_id}", response_model=RunOut)
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(models.AIRun, run_id)
    if not run:
        raise HTTPException(404, "AI run not found")
    return run


@router.get("/runs", response_model=list[RunOut])
def list_runs(limit: int = 50, db: Session = Depends(get_db)):
    return (
        db.query(models.AIRun)
        .order_by(models.AIRun.id.desc())
        .limit(min(limit, 200))
        .all()
    )


@router.get("/providers")
def providers_status(db: Session = Depends(get_db)):
    """Tells the UI which providers are available right now."""
    import shutil
    s = _settings(db)
    return {
        "selected_default": s.ai_provider,
        "claude_cli": {
            "available": bool(shutil.which("claude") or s.claude_cli_path),
            "path": s.claude_cli_path or shutil.which("claude"),
        },
        "codex_cli": {
            "available": bool(shutil.which("codex") or s.codex_cli_path),
            "path": s.codex_cli_path or shutil.which("codex"),
        },
        "anthropic_api": {"configured": bool(s.anthropic_api_key)},
        "openai_api": {"configured": bool(s.openai_api_key)},
        "active": (_select_provider_for(s).value if _select_provider_for(s) else None),
        "daily_cost_cap_usd": s.daily_cost_cap_usd,
    }


# Workflow registry (for the UI to know what's wireable):
@router.get("/workflows")
def list_workflows():
    return [{"id": w.value, "label": w.value.replace("_", " ").title()} for w in Workflow]
