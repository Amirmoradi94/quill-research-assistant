"""Quill subprocess runner — orchestrates AI calls across providers.

Phase 0 stub. Real implementation in Phase 1 — see plan.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Workflow(str, Enum):
    BOOTSTRAP_USER_PROFILE = "bootstrap_user_profile"
    RESEARCH_PROFESSOR     = "research_professor"
    EXTRACT_PROFILE        = "extract_profile"
    DRAFT_EMAIL            = "draft_email"
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


@dataclass
class RunRequest:
    workflow: Workflow
    params: dict
    professor_id: int | None = None
    document_id: int | None = None
    grant_id: int | None = None


def run(_request: RunRequest):
    """Execute a workflow. Phase 0 stub — returns NotImplementedError."""
    raise NotImplementedError("Quill runner — implemented in Phase 1.")
