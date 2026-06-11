"""
Relevance scoring service for professor matching.

Computes a 0-100 relevance score between the user and each professor based on:
  - ResearchAlignment   (35%)  semantic similarity of research interests
  - PublicationRecency  (20%)  how active the professor is in recent years
  - MethodOverlap       (15%)  shared techniques (RL, optimization, ML, etc.)
  - HiringSignal        (10%)  open positions for user's target position type
  - CitationProxy       (10%)  research output volume (paper count)
  - PositionFit         (05%)  binary: does prof hire user's position type?
  - CategoryMatch       (05%)  research_category overlap with user categories

All components are normalized to [0,1] before weighting. The final score is
multiplied by 100 and rounded to the nearest int.

A breakdown dict is stored alongside the score so the UI can show *why* a
professor matched.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import math
import re
from typing import Optional

from sqlalchemy.orm import Session

from . import models


# ─────────────────────────────────────────────────────────────────────
# Weights (must sum to 1.0)
# ─────────────────────────────────────────────────────────────────────
WEIGHTS = {
    "research_alignment": 0.40,   # AI per-paper relevance_score (primary) or fallback Jaccard
    "publication_recency": 0.15,
    "method_overlap": 0.12,
    "venue_prestige":   0.08,
    "hiring_signal":    0.10,
    "citation_proxy":   0.05,
    "position_fit":     0.05,
    "category_match":   0.05,
}
assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-6, "weights must sum to 1.0"


# Venue prestige tiers (case-insensitive substring match)
VENUE_TIERS = {
    # A+ : flagship ML/CV/AI + top sci journals
    1.00: [
        "neurips", "nips", "icml", "iclr", "cvpr", "iccv", "jmlr",
        "tpami", "ieee transactions on pattern analysis", "nature", "science",
        "siggraph",
    ],
    # A  : strong AI/ML/robotics/NLP/vision
    0.80: [
        "eccv", "aaai", "ijcai", "acl", "emnlp", "naacl", "iros", "icra",
        "kdd", "sigir", "uai", "colt", "rss",
        "ieee transactions on", "acm transactions on",
    ],
    # B  : reputable specialised venues
    0.60: [
        "wacv", "bmvc", "interspeech", "icassp", "iccp", "miccai",
        "ral", "tac", "tase", "isit", "cdc", "acc",
        "applied energy", "ieee access", "energies",
    ],
}
# Default for unknown venues
DEFAULT_VENUE_SCORE = 0.30


# Common ML / research method tokens we look for in both user and professor texts.
# Used for MethodOverlap. Order doesn't matter; matching is set-based.
METHOD_VOCAB = {
    "reinforcement learning", "rl", "deep learning", "neural network",
    "transformer", "llm", "large language model", "computer vision", "cv",
    "natural language processing", "nlp", "graph neural network", "gnn",
    "convolutional", "cnn", "recurrent", "rnn", "lstm", "attention",
    "optimization", "stochastic", "convex", "nonconvex", "bayesian",
    "gaussian process", "diffusion", "generative", "gan", "vae",
    "robotics", "autonomous", "self-supervised", "unsupervised",
    "supervised", "semi-supervised", "transfer learning", "meta-learning",
    "federated", "privacy", "differential privacy", "adversarial",
    "stochastic optimization", "dynamic programming", "control",
    "model predictive control", "mpc", "operations research",
    "scheduling", "dispatch", "energy", "grid", "renewable",
    "structural", "geotechnical", "hydroelectric", "reservoir",
    "time series", "forecasting", "regression", "classification",
    "clustering", "embedding", "representation learning",
    "policy gradient", "q-learning", "actor-critic", "multi-agent",
    "imitation learning", "online learning", "active learning",
}

# Stop-words filtered out before tokenizing free-text similarity
STOPWORDS = {
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "of", "in", "on", "at", "to", "for", "with", "by", "from", "as",
    "and", "or", "but", "not", "if", "then", "else", "so", "than",
    "this", "that", "these", "those", "it", "its", "his", "her", "our",
    "we", "you", "they", "i", "me", "my", "their", "them",
    "research", "work", "use", "using", "based", "via", "new",
    "paper", "papers", "study", "studies", "approach", "method", "methods",
    "model", "models", "system", "systems", "data",
}


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
def _tokenize(text: str) -> set[str]:
    """Lowercase, strip punctuation, drop stop-words, return token set."""
    if not text:
        return set()
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s\-]", " ", text)
    tokens = {t for t in text.split() if len(t) > 2 and t not in STOPWORDS}
    return tokens


def _extract_methods(text: str) -> set[str]:
    """Find METHOD_VOCAB terms appearing in text (multi-word friendly)."""
    if not text:
        return set()
    lower = text.lower()
    return {m for m in METHOD_VOCAB if m in lower}


def _jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _safe_clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


# ─────────────────────────────────────────────────────────────────────
# User context (build once, reuse across all professors)
# ─────────────────────────────────────────────────────────────────────
@dataclass
class UserContext:
    interests_text: str
    interest_tokens: set[str]
    method_tokens: set[str]
    categories: set[str]
    position_type: str  # "phd" | "postdoc" | "master" | ""
    country: Optional[str]

    @classmethod
    def from_db(cls, db: Session) -> "UserContext":
        user = db.query(models.User).first()
        # Best CV/document fallback: also pull the latest CV document text
        cv_doc = (
            db.query(models.Document)
            .filter(models.Document.kind == "cv")
            .order_by(models.Document.updated_at.desc())
            .first()
        )
        interests = (user.research_interests if user else "") or ""
        cv_text = (cv_doc.text if cv_doc and cv_doc.text else "") or ""
        combined = f"{interests}\n{cv_text}"

        cats = []
        if user and user.research_categories:
            cats = user.research_categories if isinstance(user.research_categories, list) else []

        # Position type heuristic from user's current_role
        role = (user.current_role if user else "") or ""
        role_lower = role.lower()
        position = ""
        if "postdoc" in role_lower or "post-doc" in role_lower or "phd graduate" in role_lower:
            position = "postdoc"
        elif "phd" in role_lower or "doctoral" in role_lower:
            position = "phd"
        elif "master" in role_lower or "msc" in role_lower:
            position = "master"

        return cls(
            interests_text=combined,
            interest_tokens=_tokenize(combined),
            method_tokens=_extract_methods(combined),
            categories={c.lower() for c in cats if c},
            position_type=position,
            country=(user.country if user else None) or None,
        )


# ─────────────────────────────────────────────────────────────────────
# Component scorers (each returns float in [0,1])
# ─────────────────────────────────────────────────────────────────────
def _research_alignment(ctx: UserContext, prof: models.Professor, papers: list[models.ProfessorPaper]) -> float:
    """Primary signal: research alignment between user and professor.

    Uses Quill's AI-scored per-paper `relevance_score` when available (most
    reliable signal: a semantic judgment of "how relevant is this paper to
    the user"). Recency-weights papers so old papers count less.

    Falls back to token-Jaccard on bio + paper text when no AI scores exist.
    Blends the two when only some papers are scored.
    """
    current_year = datetime.utcnow().year
    ai_scored = [p for p in papers if p.relevance_score is not None]
    ai_value = None
    if ai_scored:
        # Use up to 10 most recent AI-scored papers, weighted by recency
        ai_scored = sorted(ai_scored, key=lambda p: p.year or 0, reverse=True)[:10]
        num = 0.0
        den = 0.0
        for p in ai_scored:
            age = max(0, current_year - (p.year or current_year))
            w = math.exp(-0.3 * age)
            num += w * (p.relevance_score / 100.0)
            den += w
        ai_value = num / den if den > 0 else 0.0

    # Jaccard fallback / supplement
    parts = [prof.research_angle or "", prof.research_interests or "",
             prof.last_research_summary or ""]
    for p in papers[:5]:
        parts.append(p.title or "")
        parts.append(p.abstract or "")
    prof_tokens = _tokenize(" ".join(parts))
    j = _jaccard(ctx.interest_tokens, prof_tokens)
    jaccard_value = _safe_clamp(j * 4.0)  # rescale: Jaccard tends to be small

    if ai_value is not None:
        # 80% AI signal, 20% lexical (catches keyword overlap the AI may miss)
        return _safe_clamp(0.8 * ai_value + 0.2 * jaccard_value)
    return jaccard_value


def _publication_recency(papers: list[models.ProfessorPaper]) -> float:
    """Exp-decayed recency score over up to 10 most recent papers."""
    if not papers:
        return 0.0
    current_year = datetime.utcnow().year
    weights = []
    for p in papers[:10]:
        if p.year is None:
            continue
        age = max(0, current_year - p.year)
        weights.append(math.exp(-0.5 * age))
    if not weights:
        return 0.0
    return _safe_clamp(sum(weights) / len(weights))


def _method_overlap(ctx: UserContext, prof: models.Professor, papers: list[models.ProfessorPaper]) -> float:
    """Jaccard over METHOD_VOCAB tokens."""
    parts = [prof.research_angle or "", prof.research_interests or "",
             prof.last_research_summary or ""]
    for p in papers[:10]:
        parts.append(p.title or "")
        parts.append(p.abstract or "")
    prof_methods = _extract_methods(" ".join(parts))
    return _jaccard(ctx.method_tokens, prof_methods)


def _hiring_signal(ctx: UserContext, prof: models.Professor) -> float:
    """Use hiring_signals JSON: {"postdoc": true, "phd": null, "master": false}."""
    signals = prof.hiring_signals or {}
    if not signals:
        # If we have hiring_notes but no signals, give a small benefit
        if prof.hiring_notes:
            return 0.4
        return 0.3  # unknown ≠ closed
    if ctx.position_type and ctx.position_type in signals:
        v = signals[ctx.position_type]
        if v is True:
            return 1.0
        if v is False:
            return 0.0
        return 0.5  # null/unknown
    # Average across known signals as fallback
    knowns = [1.0 if v is True else 0.0 for v in signals.values() if isinstance(v, bool)]
    return sum(knowns) / len(knowns) if knowns else 0.5


def _venue_prestige(papers: list[models.ProfessorPaper]) -> float:
    """Average prestige score across the professor's most-recent papers.

    Looks at up to 10 recent papers, maps each venue string to a tier score,
    and returns the mean. Unknown venues contribute DEFAULT_VENUE_SCORE so
    professors with papers (but unrecognised venues) still beat those with none.
    """
    if not papers:
        return 0.0
    sample = papers[:10]
    scores = []
    for p in sample:
        v = (p.venue or "").lower().strip()
        if not v:
            scores.append(DEFAULT_VENUE_SCORE)
            continue
        matched = DEFAULT_VENUE_SCORE
        # Iterate highest tier first so "ieee transactions on pattern analysis"
        # (A+) beats the generic "ieee transactions on" (A) match.
        for tier_score in sorted(VENUE_TIERS.keys(), reverse=True):
            if any(token in v for token in VENUE_TIERS[tier_score]):
                matched = tier_score
                break
        scores.append(matched)
    return sum(scores) / len(scores)


def _citation_proxy(papers: list[models.ProfessorPaper]) -> float:
    """Until we ingest h-index, use paper count (log-scaled) as a proxy."""
    n = len(papers)
    if n == 0:
        return 0.0
    # log10(1+n) / log10(31)  →  saturates at 30 papers
    return _safe_clamp(math.log10(1 + n) / math.log10(31))


def _position_fit(ctx: UserContext, prof: models.Professor) -> float:
    """Binary boost when professor's position_type matches user's target."""
    if not ctx.position_type or not prof.position_type:
        return 0.5  # neutral
    return 1.0 if prof.position_type.lower() == ctx.position_type.lower() else 0.0


def _category_match(ctx: UserContext, prof: models.Professor) -> float:
    if not prof.research_category:
        return 0.3
    cat = prof.research_category.lower()
    if not ctx.categories:
        return 0.5
    return 1.0 if cat in ctx.categories else 0.2


# ─────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────
def score_professor(
    db: Session,
    prof: models.Professor,
    ctx: Optional[UserContext] = None,
) -> tuple[int, dict]:
    """Compute relevance score for a single professor.

    Returns (score_int_0_100, breakdown_dict).
    The breakdown contains the raw [0,1] component values, the weighted
    contribution (0-100 points each), and the user position type so the UI
    can render an explanation.
    """
    if ctx is None:
        ctx = UserContext.from_db(db)
    papers = (
        db.query(models.ProfessorPaper)
        .filter_by(professor_id=prof.id)
        .order_by(models.ProfessorPaper.year.desc())
        .all()
    )
    components = {
        "research_alignment": _research_alignment(ctx, prof, papers),
        "publication_recency": _publication_recency(papers),
        "method_overlap": _method_overlap(ctx, prof, papers),
        "venue_prestige": _venue_prestige(papers),
        "hiring_signal": _hiring_signal(ctx, prof),
        "citation_proxy": _citation_proxy(papers),
        "position_fit": _position_fit(ctx, prof),
        "category_match": _category_match(ctx, prof),
    }
    contributions = {k: round(WEIGHTS[k] * v * 100, 1) for k, v in components.items()}
    total = sum(contributions.values())
    score = int(round(total))
    score = max(0, min(100, score))

    breakdown = {
        "components": {k: round(v, 3) for k, v in components.items()},
        "weights": WEIGHTS,
        "contributions": contributions,
        "total": score,
        "user_position_type": ctx.position_type,
        "paper_count": len(papers),
    }
    return score, breakdown


def score_all_professors(db: Session) -> int:
    """Recompute scores for every professor. Returns count updated."""
    ctx = UserContext.from_db(db)
    profs = db.query(models.Professor).all()
    now = datetime.utcnow()
    for p in profs:
        s, br = score_professor(db, p, ctx)
        p.relevance_score = s
        p.relevance_breakdown = br
        p.relevance_scored_at = now
    db.commit()
    return len(profs)
