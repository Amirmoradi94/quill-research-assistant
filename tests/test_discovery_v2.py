"""Unit tests for discovery v2 pure logic (no network).

Run: pytest tests/test_discovery_v2.py
"""
from __future__ import annotations

import datetime

from app import scoring, embeddings, openalex


# ─── embeddings.cosine ──────────────────────────────────────────────
def test_cosine_identical():
    assert round(embeddings.cosine([1, 2, 3], [1, 2, 3]), 6) == 1.0


def test_cosine_orthogonal_and_empty():
    assert embeddings.cosine([1, 0], [0, 1]) == 0.0
    assert embeddings.cosine([], [1, 2]) == 0.0
    assert embeddings.cosine([1, 2], [1]) == 0.0  # mismatched length


# ─── career stage ───────────────────────────────────────────────────
def test_classify_career_stage():
    year = datetime.datetime.utcnow().year
    assert scoring.classify_career_stage(year - 3) == "early"
    assert scoring.classify_career_stage(year - 12) == "mid"
    assert scoring.classify_career_stage(year - 30) == "senior"
    assert scoring.classify_career_stage(None) is None


# ─── candidate scoring ──────────────────────────────────────────────
def _ctx(position="postdoc"):
    return scoring.UserContext(
        interests_text="reinforcement learning power grids",
        interest_tokens={"reinforcement", "learning", "power", "grids"},
        method_tokens={"reinforcement learning"},
        categories=set(), position_type=position, country="CA", embedding=[0.1, 0.2],
    )


def test_early_career_strong_match_beats_senior_weak():
    ctx = _ctx()
    strong, _b, reasons = scoring.score_candidate(ctx, {
        "semantic_score": 0.82, "topic_match_count": 5, "career_stage": "early",
        "works_count": 40, "h_index": 12, "last_pub_year": 2025, "has_contact": True,
    })
    weak, _b2, _r2 = scoring.score_candidate(ctx, {
        "semantic_score": 0.30, "topic_match_count": 1, "career_stage": "senior",
        "works_count": 600, "h_index": 90, "last_pub_year": 2024, "has_contact": False,
    })
    assert strong > weak
    assert any("early-career" in r for r in reasons)


def test_lexical_fallback_when_no_embedding():
    ctx = _ctx()
    score, breakdown, _r = scoring.score_candidate(ctx, {
        "semantic_score": None,
        "text": "deep reinforcement learning for power grids optimization",
        "topic_match_count": 3, "career_stage": "early", "works_count": 20, "h_index": 8,
    })
    assert 0 <= score <= 100
    assert breakdown["components"]["semantic_alignment"] > 0  # Jaccard picked up overlap


def test_weights_sum_to_one():
    assert round(sum(scoring.CANDIDATE_WEIGHTS.values()), 6) == 1.0


# ─── openalex parsing (no network) ──────────────────────────────────
def test_parse_work_extracts_authors_and_country():
    work = {
        "id": "https://openalex.org/W123",
        "title": "A paper",
        "publication_year": 2024,
        "authorships": [{
            "author": {"id": "https://openalex.org/A1", "display_name": "Jane Doe"},
            "institutions": [{"display_name": "McGill", "country_code": "CA", "ror": "r1", "id": "https://openalex.org/I1"}],
        }],
    }
    parsed = openalex._parse_work(work)
    assert parsed["id"] == "W123"
    assert parsed["year"] == 2024
    assert parsed["authors"][0]["id"] == "A1"
    assert parsed["authors"][0]["institutions"][0]["country_code"] == "ca"


def test_parse_author_derives_earliest_year_and_topics():
    author = {
        "id": "https://openalex.org/A9", "display_name": "Sam Lee",
        "orcid": "https://orcid.org/0000-0002-1", "works_count": 50, "cited_by_count": 900,
        "summary_stats": {"h_index": 20, "i10_index": 25},
        "counts_by_year": [{"year": 2019, "works_count": 3}, {"year": 2024, "works_count": 5}],
        "last_known_institutions": [{"display_name": "UBC", "country_code": "CA", "ror": "r9"}],
        "topics": [{"display_name": "Smart Grids"}, {"display_name": "RL"}],
    }
    p = openalex._parse_author(author)
    assert p["id"] == "A9"
    assert p["h_index"] == 20
    assert p["earliest_year"] == 2019
    assert p["last_known_institutions"][0]["country_code"] == "ca"
    assert "Smart Grids" in p["topics"]


def test_short_id():
    assert openalex._short_id("https://openalex.org/T10603") == "T10603"
    assert openalex._short_id("A5057284032") == "A5057284032"
    assert openalex._short_id(None) is None
