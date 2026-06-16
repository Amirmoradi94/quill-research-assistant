"""Isolated subprocess helper for the Quill runner.

The CLI is invoked via argv (NOT a shell), so user-supplied prompt strings
cannot inject shell commands. We only ever spawn binaries we explicitly
allow-list (`claude`, `codex`) or the path the user configured in Settings.

This module is intentionally tiny so the security boundary is easy to audit.
"""
from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator


@dataclass
class SpawnResult:
    """Sentinel yielded by `spawn_cli` after the process exits."""
    returncode: int
    stderr: str


# Bind the asyncio API once at module load — keeps the call site obvious and
# makes the security boundary easy to audit (single, named entry point).
_create_proc = asyncio.create_subprocess_exec  # NOTE: argv form, never shell.


def cli_child_env(extra_env: dict[str, str] | None = None) -> dict[str, str]:
    """Build a subprocess env that works from a macOS GUI-launched app.

    Tauri/Finder-launched apps often get a reduced PATH. Provider CLIs such as
    Codex may be small shims with a `/usr/bin/env node` shebang, so finding the
    CLI itself is not enough; the child process must also be able to find Node.
    """
    child_env = {**os.environ, **(extra_env or {})}

    home = Path.home()
    path_entries = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        str(home / ".local" / "bin"),
        str(home / ".npm-global" / "bin"),
        str(home / ".volta" / "bin"),
        str(home / ".codex" / "bin"),
        str(home / ".claude" / "local"),
        str(home / ".claude" / "bin"),
    ]

    existing_path = child_env.get("PATH") or ""
    path_entries.extend(p for p in existing_path.split(os.pathsep) if p)

    seen: set[str] = set()
    child_env["PATH"] = os.pathsep.join(
        p for p in path_entries
        if p and p not in seen and not seen.add(p)
    )

    # Strip RTK and other Claude Code hooks from the child process environment.
    # The PreToolUse hook rewrites shell commands (curl -> rtk curl) and filters
    # output for token savings, which breaks Quill's ability to parse API JSON.
    child_env.pop("CLAUDE_CODE_HOOKS", None)
    child_env["RTK_DISABLE"] = "1"
    child_env["NO_RTK"] = "1"
    return child_env


async def spawn_cli(
    argv: list[str],
    *,
    env: dict[str, str] | None = None,
    timeout_s: int = 300,
) -> AsyncIterator[str | SpawnResult]:
    """Spawn `argv` and yield each stdout line as a string.

    Arguments are passed as a list (no shell expansion). When the subprocess
    exits, a final `SpawnResult` is yielded carrying the return code and
    captured stderr.

    Raises `asyncio.TimeoutError` if total runtime exceeds `timeout_s`.
    """
    child_env = cli_child_env(env)

    proc = await _create_proc(
        *argv,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=child_env,
        limit=4 * 1024 * 1024,  # 4MB line buffer (default 64KB overflows on big tool-result lines)
    )
    assert proc.stdout is not None and proc.stderr is not None

    try:
        deadline = asyncio.get_running_loop().time() + timeout_s
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                proc.terminate()
                raise asyncio.TimeoutError(f"spawn_cli timed out after {timeout_s}s")
            try:
                line = await asyncio.wait_for(proc.stdout.readline(), timeout=remaining)
            except asyncio.TimeoutError:
                proc.terminate()
                raise asyncio.TimeoutError(f"spawn_cli timed out after {timeout_s}s")
            if not line:
                break
            yield line.decode("utf-8", errors="replace")

        rc = await proc.wait()
        stderr = (await proc.stderr.read()).decode("utf-8", errors="replace")
        yield SpawnResult(returncode=rc, stderr=stderr)
    finally:
        if proc.returncode is None:
            try:
                proc.terminate()
                await asyncio.wait_for(proc.wait(), timeout=2.0)
            except (ProcessLookupError, asyncio.TimeoutError):
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass


async def cancel(proc_pid: int) -> None:
    """Best-effort cancel: SIGTERM, then SIGKILL after 2 seconds."""
    import signal
    try:
        os.kill(proc_pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    await asyncio.sleep(2.0)
    try:
        os.kill(proc_pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
