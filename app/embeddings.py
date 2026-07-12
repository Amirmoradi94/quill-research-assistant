"""Text embeddings for semantic professor matching.

Uses OpenAI `text-embedding-3-small` (cheap, ~$0.02 / 1M tokens). The key is
resolved from the user's Settings row (`openai_api_key`) or the OPENAI_API_KEY
env var. When no key is available `embed_texts` returns None, so callers fall
back to lexical (Jaccard) matching and discovery still works — just less
precisely.

Every successful embed records a small AIRun row so the spend counts against
the user's lifetime credit cap (see `quill._lifetime_ai_spend`).
"""
from __future__ import annotations

import logging
import math
import os
from datetime import datetime
from typing import Optional, Sequence

import httpx

log = logging.getLogger(__name__)

OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings"
EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")
# text-embedding-3-small list price, USD per token.
_COST_PER_TOKEN = 0.02 / 1_000_000
# OpenAI accepts up to 2048 inputs per request; stay well under.
_BATCH = 256


def _resolve_key(settings=None) -> Optional[str]:
    key = getattr(settings, "openai_api_key", None) if settings is not None else None
    return key or os.environ.get("OPENAI_API_KEY") or None


def has_embeddings(settings=None) -> bool:
    return _resolve_key(settings) is not None


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity in [-1, 1]; 0.0 for empty/degenerate vectors."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def _record_cost(db, user_id: Optional[int], tokens: int) -> None:
    if db is None or user_id is None:
        return
    try:
        from . import models
        cost = round(tokens * _COST_PER_TOKEN, 8)
        db.add(models.AIRun(
            user_id=user_id,
            workflow="discovery_embedding",
            provider="openai_api",
            status="done",
            tokens_in=tokens,
            cost_usd=cost,
            created_at=datetime.utcnow(),
            completed_at=datetime.utcnow(),
        ))
        db.commit()
    except Exception as exc:  # noqa: BLE001 - cost accounting must never break a run
        log.warning("failed to record embedding cost: %s", exc)


async def embed_texts(
    texts: Sequence[str],
    settings=None,
    db=None,
    user_id: Optional[int] = None,
) -> Optional[list[list[float]]]:
    """Embed a list of texts. Returns one vector per input, or None if no key /
    on failure (caller should fall back to lexical matching).

    Empty/blank inputs are embedded as zero-length placeholders preserved by
    position so the returned list aligns 1:1 with `texts`.
    """
    key = _resolve_key(settings)
    if not key:
        return None
    cleaned = [(t or "").strip().replace("\n", " ")[:8000] for t in texts]
    # Map non-empty inputs to their positions so blanks don't waste tokens.
    idx_nonempty = [i for i, t in enumerate(cleaned) if t]
    if not idx_nonempty:
        return [[] for _ in texts]

    vectors: dict[int, list[float]] = {}
    total_tokens = 0
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            for start in range(0, len(idx_nonempty), _BATCH):
                batch_idx = idx_nonempty[start:start + _BATCH]
                inputs = [cleaned[i] for i in batch_idx]
                r = await client.post(OPENAI_EMBED_URL, headers=headers, json={
                    "model": EMBED_MODEL,
                    "input": inputs,
                })
                r.raise_for_status()
                payload = r.json()
                for item in payload.get("data") or []:
                    pos = batch_idx[item["index"]]
                    vectors[pos] = item["embedding"]
                total_tokens += (payload.get("usage") or {}).get("total_tokens", 0)
    except Exception as exc:  # noqa: BLE001 - defensive: degrade to lexical
        log.warning("embedding request failed: %s", exc)
        return None

    _record_cost(db, user_id, total_tokens)
    return [vectors.get(i, []) for i in range(len(texts))]
