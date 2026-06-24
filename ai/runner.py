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
import os
import re
import shlex
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable

import httpx


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
    OPENROUTER_API = "openrouter_api"


FALLBACK_CHAIN: tuple[Provider, ...] = (
    Provider.OPENROUTER_API,
    Provider.CLAUDE_CLI,
    Provider.CODEX_CLI,
    Provider.ANTHROPIC_API,
    Provider.OPENAI_API,
)

DEFAULT_OPENROUTER_MODEL = os.environ.get("OPENROUTER_MODEL", "z-ai/glm-5.2")

CLAUDE_NONINTERACTIVE_PERMISSION_ARGS = ["--permission-mode", "bypassPermissions"]

ToolExecutor = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]


def resolve_cli_path(command: str, configured_path: str | None = None) -> str | None:
    """Find a provider CLI even when the desktop app has a minimal PATH."""
    if configured_path:
        return configured_path

    path = shutil.which(command)
    if path:
        return path

    home = Path.home()
    if command == "codex":
        search_dirs = (
            home / ".local" / "bin",
            home / ".codex" / "bin",
            Path("/opt/homebrew/bin"),
            Path("/usr/local/bin"),
            home / ".npm-global" / "bin",
            home / ".volta" / "bin",
        )
    else:
        search_dirs = (
            Path("/opt/homebrew/bin"),
            Path("/usr/local/bin"),
            home / ".local" / "bin",
            home / ".npm-global" / "bin",
            home / ".volta" / "bin",
            home / ".codex" / "bin",
            home / ".claude" / "local",
            home / ".claude" / "bin",
        )

    for directory in search_dirs:
        candidate = directory / command
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)

    try:
        found = subprocess.run(
            ["/bin/zsh", "-lc", f"command -v {shlex.quote(command)}"],
            capture_output=True,
            text=True,
            timeout=3,
        )
    except Exception:
        return None
    return found.stdout.strip().splitlines()[0] if found.returncode == 0 and found.stdout.strip() else None


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
    openrouter_tools: list[dict[str, Any]] | None = None
    openrouter_tool_aliases: dict[str, str] | None = None
    tool_executor: ToolExecutor | None = None
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
    openrouter_api_key: str | None = None,
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
            if resolve_cli_path("claude", claude_cli_path):
                return p
        elif p == Provider.CODEX_CLI:
            if resolve_cli_path("codex", codex_cli_path):
                return p
        elif p == Provider.ANTHROPIC_API:
            if anthropic_api_key:
                return p
        elif p == Provider.OPENAI_API:
            if openai_api_key:
                return p
        elif p == Provider.OPENROUTER_API:
            if openrouter_api_key or os.environ.get("OPENROUTER_API_KEY"):
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
    argv = [
        resolve_cli_path("claude", cli_path) or "claude",
        *CLAUDE_NONINTERACTIVE_PERMISSION_ARGS,
        "--print",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
    ]
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
    """Codex CLI JSONL streaming command."""
    argv = [
        resolve_cli_path("codex", cli_path) or "codex",
        "exec",
        "--json",
        "--sandbox",
        "danger-full-access",
        "--skip-git-repo-check",
    ]
    if cwd:
        argv += ["-C", cwd]
    argv.append(prompt)
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


def parse_codex_event(raw_line: str) -> StreamEvent | None:
    """Parse one line of `codex exec --json` JSONL output."""
    raw_line = raw_line.strip()
    if not raw_line:
        return None
    try:
        evt = json.loads(raw_line)
    except json.JSONDecodeError:
        return StreamEvent(kind="text", data={"text": raw_line})

    etype = evt.get("type")
    item = evt.get("item") or {}
    if etype == "item.completed":
        item_type = item.get("type")
        if item_type == "agent_message":
            return StreamEvent(kind="text", data={"text": item.get("text", "")})
        if item_type in {"tool_call", "function_call"}:
            return StreamEvent(
                kind="tool_call",
                data={
                    "id": item.get("id") or item.get("call_id"),
                    "name": item.get("name") or item.get("tool_name") or item_type,
                    "input": item.get("input") or item.get("arguments"),
                },
            )
        if item_type in {"tool_call_output", "function_call_output"}:
            return StreamEvent(
                kind="tool_result",
                data={
                    "id": item.get("id") or item.get("call_id"),
                    "is_error": bool(item.get("is_error")),
                    "content": item.get("output") or item.get("content"),
                },
            )
        return None
    if etype == "turn.completed":
        return StreamEvent(
            kind="done",
            data={
                "ok": True,
                "usage": evt.get("usage"),
            },
        )
    if etype == "error":
        return StreamEvent(kind="error", data={"message": evt.get("message") or str(evt)})
    return None


def _normalise_openrouter_usage(usage: dict[str, Any] | None) -> dict[str, Any]:
    usage = usage or {}
    return {
        "input_tokens": usage.get("input_tokens", usage.get("prompt_tokens")),
        "output_tokens": usage.get("output_tokens", usage.get("completion_tokens")),
        "raw": usage,
    }


def _openrouter_headers(api_key: str, env: dict[str, str] | None = None) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": (env or {}).get("OPENROUTER_HTTP_REFERER", "http://localhost:8000"),
        "X-OpenRouter-Title": (env or {}).get("OPENROUTER_TITLE", "Quill AI"),
    }


async def _post_openrouter_chat(
    client: httpx.AsyncClient,
    *,
    body: dict[str, Any],
    headers: dict[str, str],
) -> dict[str, Any] | StreamEvent:
    response = await client.post(
        "https://openrouter.ai/api/v1/chat/completions",
        json=body,
        headers=headers,
    )
    if response.status_code >= 400:
        detail = response.text
        return StreamEvent(
            kind="error",
            data={
                "message": f"OpenRouter request failed with HTTP {response.status_code}.",
                "raw_error": detail[-2000:],
            },
        )
    return response.json()


async def stream_openrouter_agent(prompt: str, request: RunRequest, env: dict[str, str] | None = None) -> AsyncIterator[StreamEvent]:
    api_key = (env or {}).get("OPENROUTER_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        yield StreamEvent(kind="error", data={"message": "OpenRouter API key is not configured."})
        return

    model = (env or {}).get("OPENROUTER_MODEL") or DEFAULT_OPENROUTER_MODEL
    tools = request.openrouter_tools or []
    if not tools or request.tool_executor is None:
        async for evt in stream_openrouter_text(prompt, request, env=env):
            yield evt
        return

    headers = _openrouter_headers(api_key, env)
    messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
    full_text_parts: list[str] = []
    total_usage = {"input_tokens": 0, "output_tokens": 0}

    yield StreamEvent(kind="started", data={"provider": Provider.OPENROUTER_API.value, "model": model, "tools": True})

    try:
        async with httpx.AsyncClient(timeout=request.timeout_s) as client:
            for _turn in range(max(1, min(request.max_turns, 30))):
                body = {
                    "model": model,
                    "messages": messages,
                    "tools": tools,
                    "tool_choice": "auto",
                    "parallel_tool_calls": False,
                    "stream": False,
                }
                payload = await _post_openrouter_chat(client, body=body, headers=headers)
                if isinstance(payload, StreamEvent):
                    yield payload
                    return

                usage = _normalise_openrouter_usage(payload.get("usage"))
                for key in ("input_tokens", "output_tokens"):
                    if isinstance(usage.get(key), int):
                        total_usage[key] += usage[key]

                choice = (payload.get("choices") or [{}])[0]
                message = choice.get("message") or {}
                tool_calls = message.get("tool_calls") or []
                content = message.get("content") or ""

                if not tool_calls:
                    if content:
                        content = scrub_house_style(content)
                        full_text_parts.append(content)
                        yield StreamEvent(kind="text", data={"text": content})
                    yield StreamEvent(
                        kind="done",
                        data={
                            "ok": True,
                            "result": "".join(full_text_parts),
                            "usage": total_usage,
                        },
                    )
                    payload = extract_json_payload("".join(full_text_parts))
                    if payload is not None:
                        yield StreamEvent(kind="parsed", data={"payload": payload})
                    return

                assistant_message = {
                    "role": "assistant",
                    "content": content if content else None,
                    "tool_calls": tool_calls,
                }
                messages.append(assistant_message)

                for tool_call in tool_calls:
                    function = tool_call.get("function") or {}
                    tool_name = function.get("name") or ""
                    raw_args = function.get("arguments") or "{}"
                    try:
                        args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                    except json.JSONDecodeError:
                        args = {"_invalid_arguments": raw_args}
                    if not isinstance(args, dict):
                        args = {"value": args}

                    display_name = (request.openrouter_tool_aliases or {}).get(tool_name, tool_name)
                    yield StreamEvent(
                        kind="tool_call",
                        data={
                            "id": tool_call.get("id"),
                            "name": display_name,
                            "input": args,
                        },
                    )

                    try:
                        result = await request.tool_executor(tool_name, args)
                        is_error = not result.get("ok", True)
                    except Exception as exc:
                        result = {"ok": False, "error": str(exc)}
                        is_error = True

                    yield StreamEvent(
                        kind="tool_result",
                        data={
                            "id": tool_call.get("id"),
                            "is_error": is_error,
                            "content": result,
                        },
                    )
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.get("id"),
                        "name": tool_name,
                        "content": json.dumps(result, default=str),
                    })

        yield StreamEvent(kind="error", data={"message": "OpenRouter tool loop reached the maximum number of turns."})
    except httpx.TimeoutException:
        yield StreamEvent(kind="error", data={"message": "OpenRouter request timed out."})
    except httpx.HTTPError as exc:
        yield StreamEvent(kind="error", data={"message": f"OpenRouter request failed: {exc}"})


async def stream_openrouter_text(prompt: str, request: RunRequest, env: dict[str, str] | None = None) -> AsyncIterator[StreamEvent]:
    api_key = (env or {}).get("OPENROUTER_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        yield StreamEvent(kind="error", data={"message": "OpenRouter API key is not configured."})
        return

    model = (env or {}).get("OPENROUTER_MODEL") or DEFAULT_OPENROUTER_MODEL
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
    }
    headers = _openrouter_headers(api_key, env)

    yield StreamEvent(kind="started", data={"provider": Provider.OPENROUTER_API.value, "model": model})

    full_text_parts: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=request.timeout_s) as client:
            async with client.stream(
                "POST",
                "https://openrouter.ai/api/v1/chat/completions",
                json=body,
                headers=headers,
            ) as response:
                if response.status_code >= 400:
                    detail = await response.aread()
                    yield StreamEvent(
                        kind="error",
                        data={
                            "message": f"OpenRouter request failed with HTTP {response.status_code}.",
                            "raw_error": detail.decode("utf-8", errors="replace")[-2000:],
                        },
                    )
                    return

                async for raw_line in response.aiter_lines():
                    line = raw_line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        payload = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choice = (payload.get("choices") or [{}])[0]
                    delta = choice.get("delta") or {}
                    chunk = delta.get("content") or ""
                    if chunk:
                        chunk = scrub_house_style(chunk)
                        full_text_parts.append(chunk)
                        yield StreamEvent(kind="text", data={"text": chunk})

        usage = {"input_tokens": None, "output_tokens": None}
        yield StreamEvent(
            kind="done",
            data={
                "ok": True,
                "result": "".join(full_text_parts),
                "usage": usage,
            },
        )
        payload = extract_json_payload("".join(full_text_parts))
        if payload is not None:
            yield StreamEvent(kind="parsed", data={"payload": payload})
    except httpx.TimeoutException:
        yield StreamEvent(kind="error", data={"message": "OpenRouter request timed out."})
    except httpx.HTTPError as exc:
        yield StreamEvent(kind="error", data={"message": f"OpenRouter request failed: {exc}"})


async def stream_openrouter(prompt: str, request: RunRequest, env: dict[str, str] | None = None) -> AsyncIterator[StreamEvent]:
    if request.openrouter_tools and request.tool_executor is not None:
        async for evt in stream_openrouter_agent(prompt, request, env=env):
            yield evt
        return
    async for evt in stream_openrouter_text(prompt, request, env=env):
        yield evt


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
        parser = parse_codex_event
    elif provider is Provider.OPENROUTER_API:
        async for evt in stream_openrouter(prompt, request, env=env):
            yield evt
        return
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
                        "raw_error": line.stderr[-2000:],
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
