"""Quill orchestrator — pure logic for the AI gateway.

Subprocess spawning is isolated in `ai.cli`. This module deals with:

  * Workflow / Provider enums + fallback chain
  * RunRequest + StreamEvent dataclasses
  * Provider selection (which CLI/key is available?)
  * Prompt rendering via Jinja2
  * Streaming the workflow (delegates the spawn to ai.cli.spawn_cli)

The caller (api/routes/ai.py in a later phase) is responsible for AIRun row
management — this module never touches the database.
"""
from __future__ import annotations

import json
import re
import shutil
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, AsyncIterator


# ───────────────────────────────────────────────────────────────────
# Enums
# ───────────────────────────────────────────────────────────────────
class Workflow(str, Enum):
    BOOTSTRAP_USER_PROFILE = "bootstrap_user_profile"
    RESEARCH_PROFESSOR     = "research_professor"
    EXTRACT_PROFILE        = "extract_profile"
    EXTRACT_USER_PROFILE_FULL = "extract_user_profile_full"
    DRAFT_EMAIL            = "draft_email"
    DRAFT_REPLY            = "draft_reply"
    PREPARE_INTERVIEW      = "prepare_interview"
    MOCK_INTERVIEW         = "mock_interview"
    FIND_GRANTS            = "find_grants"
    EDIT_CV                = "edit_cv"
    DRAFT_RESEARCH_STMT    = "draft_research_statement"
    DISCOVER_PROFESSORS    = "discover_professors"
    CHAT                   = "chat"


class Provider(str, Enum):
    CLAUDE_CLI    = "claude_cli"
    CODEX_CLI     = "codex_cli"
    ANTHROPIC_API = "anthropic_api"
    OPENAI_API    = "openai_api"


FALLBACK_CHAIN: tuple[Provider, ...] = (
    Provider.CLAUDE_CLI,
    Provider.CODEX_CLI,
    Provider.ANTHROPIC_API,
    Provider.OPENAI_API,
)


# ───────────────────────────────────────────────────────────────────
# Request + event types
# ───────────────────────────────────────────────────────────────────
@dataclass
class RunRequest:
    workflow: Workflow
    params: dict[str, Any]
    professor_id: int | None = None
    document_id: int | None = None
    grant_id: int | None = None
    cwd: str | None = None
    allowed_tools: list[str] | None = None
    max_turns: int = 30
    timeout_s: int = 300


@dataclass
class StreamEvent:
    """A single event yielded as the workflow runs.

    `kind` is one of:
        started     — subprocess launched
        text        — assistant produced a chunk of free-text output
        tool_call   — assistant invoked a tool (Read/Edit/Bash/WebFetch/...)
        tool_result — tool returned (success or error)
        parsed      — final structured JSON extracted from the assistant text
        done        — final event; carries cost/usage totals
        error       — fatal error
    """
    kind: str
    data: dict[str, Any] = field(default_factory=dict)
    at: float = field(default_factory=time.time)

    def to_sse(self) -> str:
        return f"event: {self.kind}\ndata: {json.dumps(self.data)}\n\n"


# ───────────────────────────────────────────────────────────────────
# Provider selection
# ───────────────────────────────────────────────────────────────────
def select_provider(
    preferred: Provider | None = None,
    *,
    claude_cli_path: str | None = None,
    codex_cli_path: str | None = None,
    anthropic_api_key: str | None = None,
    openai_api_key: str | None = None,
) -> Provider | None:
    """Return the first available provider, walking the fallback chain.

    Honors `preferred` first. Returns None if nothing is available.
    """
    chain: list[Provider] = []
    if preferred is not None:
        chain.append(preferred)
    for p in FALLBACK_CHAIN:
        if p not in chain:
            chain.append(p)

    for p in chain:
        if p == Provider.CLAUDE_CLI:
            if claude_cli_path or shutil.which("claude"):
                return p
        elif p == Provider.CODEX_CLI:
            if codex_cli_path or shutil.which("codex"):
                return p
        elif p == Provider.ANTHROPIC_API:
            if anthropic_api_key:
                return p
        elif p == Provider.OPENAI_API:
            if openai_api_key:
                return p
    return None


# ───────────────────────────────────────────────────────────────────
# Prompt rendering (Jinja2)
# ───────────────────────────────────────────────────────────────────
_PROMPT_DIR = Path(__file__).parent / "prompts"

# House style — auto-prepended to every rendered prompt so any text Quill
# generates obeys these rules regardless of which workflow is running.
HOUSE_STYLE = """\
# House style (must be obeyed in every response)

- Never use em-dashes (—). Use a comma, a period, or a semicolon instead.
- Never use en-dashes (–) in prose. (Number ranges like "150–250 words" are fine.)
- Always spell out IEEE journal names in full (e.g. "IEEE Transactions on
  Intelligent Transportation Systems", not "IEEE T-ITS").
- Be concise. Match the length the user asks for.
- No marketing language. No filler ("It's worth noting that…", "I hope this helps").

---

"""


def render_prompt(workflow: Workflow, **vars: Any) -> str:
    """Render a workflow's prompt template with the given variables.

    The HOUSE_STYLE preamble is prepended to every prompt — applies to all
    workflows so we don't have to remember to copy these rules into each
    template.
    """
    # Lazy-import jinja2 so import-time errors don't break the package.
    from jinja2 import Environment, FileSystemLoader, Undefined

    env = Environment(
        loader=FileSystemLoader(_PROMPT_DIR),
        undefined=Undefined,
        autoescape=False,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    template = env.get_template(f"{workflow.value}.md")
    return HOUSE_STYLE + template.render(**vars)


# ───────────────────────────────────────────────────────────────────
# Provider command builders
# ───────────────────────────────────────────────────────────────────
def claude_cli_argv(
    prompt: str,
    *,
    allowed_tools: list[str] | None,
    cwd: str | None,
    max_turns: int,
    cli_path: str | None,
) -> list[str]:
    argv = [cli_path or "claude", "--print", prompt, "--output-format", "stream-json", "--verbose"]
    if allowed_tools:
        argv += ["--allowed-tools", ",".join(allowed_tools)]
    if max_turns:
        argv += ["--max-turns", str(max_turns)]
    if cwd:
        argv += ["--add-dir", cwd]
    return argv


def codex_cli_argv(
    prompt: str,
    *,
    cwd: str | None,
    cli_path: str | None,
) -> list[str]:
    """Codex CLI shape — to be refined once we test against the real binary."""
    argv = [cli_path or "codex", "exec", "--json", prompt]
    if cwd:
        argv += ["--cwd", cwd]
    return argv


# ───────────────────────────────────────────────────────────────────
# Stream parsing (claude-cli stream-json shape)
# ───────────────────────────────────────────────────────────────────
def parse_claude_event(raw_line: str) -> StreamEvent | None:
    """Parse one line of claude --output-format stream-json into a StreamEvent.

    Claude emits JSON-per-line objects of these (simplified) shapes:
      {"type":"system","subtype":"init",...}
      {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
      {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read",
                                                  "input":{"file_path":"..."}}]}}
      {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":...}]}}
      {"type":"result","subtype":"success","total_cost_usd":...,"usage":{...}}
    """
    raw_line = raw_line.strip()
    if not raw_line:
        return None
    try:
        evt = json.loads(raw_line)
    except json.JSONDecodeError:
        return StreamEvent(kind="text", data={"text": raw_line})

    etype = evt.get("type")
    if etype == "assistant":
        contents = (evt.get("message") or {}).get("content") or []
        for c in contents:
            ctype = c.get("type")
            if ctype == "text":
                return StreamEvent(kind="text", data={"text": c.get("text", "")})
            if ctype == "tool_use":
                return StreamEvent(
                    kind="tool_call",
                    data={
                        "id": c.get("id"),
                        "name": c.get("name"),
                        "input": c.get("input"),
                    },
                )
        return None
    if etype == "user":
        contents = (evt.get("message") or {}).get("content") or []
        for c in contents:
            if c.get("type") == "tool_result":
                return StreamEvent(
                    kind="tool_result",
                    data={
                        "id": c.get("tool_use_id"),
                        "is_error": c.get("is_error", False),
                        "content": c.get("content"),
                    },
                )
        return None
    if etype == "result":
        return StreamEvent(
            kind="done",
            data={
                "ok": evt.get("subtype") == "success",
                "result": evt.get("result"),
                "cost_usd": evt.get("total_cost_usd"),
                "usage": evt.get("usage"),
                "duration_ms": evt.get("duration_ms"),
            },
        )
    return None


_JSON_BLOCK_RE = re.compile(r"\{[\s\S]*\}\s*$")


# House-style scrubber. Belt-and-suspenders: even when HOUSE_STYLE tells the
# model not to use em-dashes, sometimes a token slips through. We strip them
# from every text chunk before it reaches the client.
def scrub_house_style(text: str) -> str:
    if not text:
        return text
    # em-dash + zero-width space variants -> comma+space
    text = text.replace("—", ", ")  # —
    # en-dash inside spaced prose ("foo – bar") -> comma+space; bare ranges
    # like "150–250" get a hyphen.
    text = re.sub(r" – ", ", ", text)
    text = text.replace("–", "-")   # –
    # collapse any double commas/spaces the substitution might have produced
    text = re.sub(r",\s*,", ",", text)
    text = re.sub(r"  +", " ", text)
    return text


def extract_json_payload(full_text: str) -> dict[str, Any] | None:
    """Pull a trailing JSON object out of the assistant's free-text output."""
    if not full_text:
        return None
    # Strip trailing code-fence chars/whitespace (the model sometimes emits
    # 2 backticks instead of 3, defeating the \s*$ anchor below).
    cleaned = full_text.strip().rstrip("` \n\r\t")
    match = _JSON_BLOCK_RE.search(cleaned)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


# ───────────────────────────────────────────────────────────────────
# Public streaming API — delegates the spawn to ai.cli
# ───────────────────────────────────────────────────────────────────
async def stream(
    request: RunRequest,
    *,
    provider: Provider,
    cli_path: str | None = None,
    env: dict[str, str] | None = None,
) -> AsyncIterator[StreamEvent]:
    """Run a workflow and yield StreamEvents as the CLI produces output."""
    prompt = render_prompt(request.workflow, **request.params)

    if provider is Provider.CLAUDE_CLI:
        argv = claude_cli_argv(
            prompt,
            allowed_tools=request.allowed_tools,
            cwd=request.cwd,
            max_turns=request.max_turns,
            cli_path=cli_path,
        )
        parser = parse_claude_event
    elif provider is Provider.CODEX_CLI:
        argv = codex_cli_argv(prompt, cwd=request.cwd, cli_path=cli_path)
        parser = parse_claude_event  # codex stream shape TBD
    else:
        yield StreamEvent(
            kind="error",
            data={"message": f"Provider {provider.value} not implemented in Phase 0."},
        )
        return

    # Defer the actual subprocess spawn to ai.cli — keeps this module pure logic.
    from ai.cli import spawn_cli, SpawnResult

    yield StreamEvent(kind="started", data={"provider": provider.value})

    full_text_parts: list[str] = []
    async for line in spawn_cli(argv, env=env, timeout_s=request.timeout_s):
        if isinstance(line, SpawnResult):
            # Final sentinel from spawn_cli — exit code, stderr.
            if line.returncode != 0:
                yield StreamEvent(
                    kind="error",
                    data={
                        "message": f"Subprocess exited with code {line.returncode}",
                        "stderr": line.stderr[-2000:],
                    },
                )
            return

        evt = parser(line)
        if evt is None:
            continue
        if evt.kind == "text":
            evt.data["text"] = scrub_house_style(evt.data.get("text", ""))
            full_text_parts.append(evt.data["text"])
        yield evt
        if evt.kind == "done":
            payload = extract_json_payload("".join(full_text_parts))
            if payload is not None:
                yield StreamEvent(kind="parsed", data={"payload": payload})
