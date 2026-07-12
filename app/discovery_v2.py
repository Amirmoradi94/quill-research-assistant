"""Retrieval-first professor discovery (discovery v2).

Replaces the v1 enumerate-guess-crawl pipeline with a scholarly-graph retrieval
approach:

  A. build_query_profile — derive the user's OpenAlex topics + a research
     summary + an embedding (cached on the user row).
  B. retrieve_candidates — query OpenAlex for recent works in those topics,
     scoped to the target countries, and roll authorships up to candidate authors.
  C. enrich_and_rank — enrich authors (h-index, ORCID, career stage), compute a
     semantic match score, then an optional one-shot LLM re-rank of the top ~30.
  D. resolve_contacts — for the shortlist, find a real faculty page via ORCID +
     web search + a single scrape, and pull an email.

`run_discovery_pipeline(run_id)` is the sync entrypoint used by the FastAPI
background task; it drives A→D inside one asyncio loop, logging progress into
`discovery_logs` and updating `discovery_runs.phase`/counters as it goes.

Every network hop is defensive (see app.openalex / app.embeddings / app.websearch
/ app.scraper_client): a missing key or flaky upstream degrades the result but
never crashes the run.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func

from . import models, openalex, embeddings, websearch, scraper_client, scoring
from .database import SessionLocal
from .discovery import normalize_name, country_name, _add_log, _count_candidates

log = logging.getLogger(__name__)

# Tuning knobs.
RECENT_YEARS = 4
MAX_WORKS = 400
MAX_CANDIDATES = 150      # authors enriched + scored
SHORTLIST_SIZE = 30       # candidates that get LLM rerank + contact resolution
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)


# ───────────────────────────────────────────────────────────────────
# Small run-state helpers
# ───────────────────────────────────────────────────────────────────
def _set_phase(db, run: models.DiscoveryRun, phase: str, summary: str | None = None) -> None:
    run.phase = phase
    if summary:
        run.summary = summary
    run.updated_at = datetime.utcnow()
    db.commit()


def _fail(db, run: models.DiscoveryRun, message: str) -> None:
    run.status = "failed"
    run.error_message = message
    run.summary = message
    run.completed_at = datetime.utcnow()
    run.updated_at = datetime.utcnow()
    db.commit()
    _add_log(db, run.id, "error", run.phase or "discovery", message)


# ───────────────────────────────────────────────────────────────────
# Phase A — query profile
# ───────────────────────────────────────────────────────────────────
def _profile_source_text(db, user: models.User) -> tuple[str, str, str]:
    """Return (interests, topic_abstract, rich_context).

    - interests:      the user's research-interests / headline (topic-tag title).
    - topic_abstract: a few recent publication *titles* — focused text for topic
      tagging (a whole-CV dump dilutes OpenAlex topic classification).
    - rich_context:   interests + pub titles/abstracts + CV text, for the LLM
      research-summary step (which handles long input fine).
    """
    interests = (user.research_interests or user.headline or "").strip()
    pubs = (
        db.query(models.UserPublication)
        .filter(models.UserPublication.user_id == user.id)
        .order_by(models.UserPublication.year.desc().nullslast())
        .limit(8)
        .all()
    )
    pub_titles = [p.title for p in pubs if p.title]
    topic_abstract = " · ".join(pub_titles[:4])[:800]

    rich_parts: list[str] = []
    if interests:
        rich_parts.append(interests)
    for p in pubs:
        if p.title:
            rich_parts.append(p.title)
        if p.abstract:
            rich_parts.append(p.abstract[:600])
    if user.cv_doc_id:
        cv = db.get(models.Document, user.cv_doc_id)
        if cv and cv.text:
            rich_parts.append(cv.text[:2000])
    if not interests and pub_titles:
        interests = pub_titles[0][:300]
    return interests, topic_abstract, "\n".join(rich_parts)[:6000]


async def build_query_profile(db, user: models.User) -> Optional[dict[str, Any]]:
    """Resolve + cache the user's discovery topics, summary, and embedding."""
    # Reuse a fresh cache (built < 30 days ago) to avoid re-deriving every run.
    fresh = (
        user.discovery_profile_built_at
        and user.discovery_profile_built_at > datetime.utcnow() - timedelta(days=30)
        and user.discovery_topic_ids
    )
    interests, topic_abstract, rich = _profile_source_text(db, user)
    if not interests and not topic_abstract and not rich:
        return None

    if fresh:
        topic_ids = list(user.discovery_topic_ids or [])
        summary = user.discovery_summary or interests
        embedding = user.discovery_embedding if isinstance(user.discovery_embedding, list) else None
        return {"topic_ids": topic_ids, "summary": summary, "embedding": embedding}

    # Prefer topics derived from the user's OWN publications (grounded in real
    # published work, uses the higher-rate-limit /works endpoint). Fall back to
    # the /text/topics ML endpoint for users with only free-text interests.
    pub_titles = [t.strip() for t in (topic_abstract.split(" · ") if topic_abstract else []) if t.strip()]
    topics = await openalex.topics_from_publications(pub_titles) if pub_titles else []
    if not topics:
        topics = await openalex.topics_for_text(interests or topic_abstract, topic_abstract)
    topic_ids = [t["id"] for t in topics][:6]

    # Research summary via the LLM (optional; falls back to raw interests).
    summary = (user.research_interests or "").strip()
    from .quill import run_llm_once
    prompt = (
        "Summarize this researcher's focus in 2-3 sentences for matching them to "
        "professors. Be specific about methods and application domains. Output only "
        f"the summary.\n\nRESEARCH INTERESTS:\n{interests}\n\nDETAILS:\n{rich[:3000]}"
    )
    llm = await run_llm_once(db, user, prompt, workflow="discovery_summary")
    if llm.strip():
        summary = llm.strip()
    if not summary:
        summary = interests or rich[:300]

    embedding = None
    vecs = await embeddings.embed_texts([summary], settings=_settings(db, user), db=db, user_id=user.id)
    if vecs and vecs[0]:
        embedding = vecs[0]

    user.discovery_topic_ids = topic_ids
    user.discovery_summary = summary
    user.discovery_embedding = embedding
    user.discovery_profile_built_at = datetime.utcnow()
    db.commit()
    return {"topic_ids": topic_ids, "summary": summary, "embedding": embedding}


def _settings(db, user: models.User) -> models.Settings:
    s = db.query(models.Settings).filter_by(user_id=user.id).first()
    if not s:
        s = models.Settings(user_id=user.id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


# ───────────────────────────────────────────────────────────────────
# Phase B — retrieve candidates
# ───────────────────────────────────────────────────────────────────
def _upsert_university_v2(db, run_id: int, name: str, country_code: str | None, ror: str | None) -> models.DiscoveryUniversity:
    normalized = normalize_name(name)
    country = country_name(country_code.upper()) if country_code else (name or "")
    row = (
        db.query(models.DiscoveryUniversity)
        .filter(models.DiscoveryUniversity.run_id == run_id)
        .filter(models.DiscoveryUniversity.normalized_name == normalized)
        .filter(models.DiscoveryUniversity.country == country)
        .first()
    )
    if row:
        return row
    row = models.DiscoveryUniversity(
        run_id=run_id, name=name, normalized_name=normalized,
        country=country, country_code=(country_code or "").upper() or None,
        source="openalex", source_url=ror, status="checked", checked_at=datetime.utcnow(),
    )
    db.add(row)
    db.flush()
    return row


async def retrieve_candidates(db, run: models.DiscoveryRun, topic_ids: list[str]) -> int:
    """Query OpenAlex works, roll up to authors, upsert candidates. Returns count."""
    countries = [str(c).upper() for c in (run.target_countries or [])]
    country_set = {c.lower() for c in countries}
    from_date = f"{datetime.utcnow().year - RECENT_YEARS}-01-01"

    works = await openalex.works_for_topics(
        topic_ids, country_codes=countries, from_date=from_date, max_works=MAX_WORKS
    )
    _add_log(db, run.id, "info", "retrieve",
             f"Retrieved {len(works)} recent works across {len(topic_ids)} topic(s).",
             {"topics": topic_ids, "countries": countries})

    # author_id -> aggregate
    agg: dict[str, dict[str, Any]] = {}
    for w in works:
        year = w.get("year")
        for a in w.get("authors") or []:
            aid = a.get("id")
            name = a.get("name")
            if not aid or not name:
                continue
            # Prefer an institution in the target countries (seen ON this paper),
            # which is more current than the author's last_known_institution.
            inst = None
            for i in a.get("institutions") or []:
                if not country_set or (i.get("country_code") in country_set):
                    inst = i
                    break
            if country_set and inst is None:
                continue  # author on this paper isn't affiliated in a target country
            rec = agg.get(aid)
            if not rec:
                rec = agg[aid] = {
                    "id": aid, "name": name, "institution": inst,
                    "topic_match_count": 0, "last_pub_year": None, "titles": [],
                }
            rec["topic_match_count"] += 1
            if year and (rec["last_pub_year"] is None or year > rec["last_pub_year"]):
                rec["last_pub_year"] = year
            if inst and not rec["institution"]:
                rec["institution"] = inst
            if w.get("title") and len(rec["titles"]) < 5:
                rec["titles"].append(w["title"])

    ranked = sorted(agg.values(), key=lambda r: r["topic_match_count"], reverse=True)[:MAX_CANDIDATES]

    created = 0
    for rec in ranked:
        inst = rec.get("institution") or {}
        uni = _upsert_university_v2(db, run.id, inst.get("name") or "Unknown", inst.get("country_code"), inst.get("ror"))
        normalized = normalize_name(rec["name"])
        exists = (
            db.query(models.DiscoveryCandidate)
            .filter(models.DiscoveryCandidate.run_id == run.id)
            .filter(models.DiscoveryCandidate.normalized_name == normalized)
            .filter(models.DiscoveryCandidate.university_id == uni.id)
            .first()
        )
        if exists:
            continue
        db.add(models.DiscoveryCandidate(
            run_id=run.id,
            university_id=uni.id,
            university_name=inst.get("name"),
            country=uni.country,
            name=rec["name"],
            normalized_name=normalized,
            openalex_author_id=rec["id"],
            topic_match_count=rec["topic_match_count"],
            research_text=" · ".join(rec["titles"])[:2000] or None,
            verification_status="pending",
            raw_payload={"source": "openalex_works", "last_pub_year": rec["last_pub_year"], "titles": rec["titles"]},
        ))
        created += 1
    run.universities_total = db.query(func.count(models.DiscoveryUniversity.id)).filter(models.DiscoveryUniversity.run_id == run.id).scalar() or 0
    run.candidates_extracted = _count_candidates(db, run.id)
    db.commit()
    return created


# ───────────────────────────────────────────────────────────────────
# Phase C — enrich + rank
# ───────────────────────────────────────────────────────────────────
def _candidate_embed_text(c: models.DiscoveryCandidate, author: dict | None) -> str:
    parts = [c.name or ""]
    if author and author.get("topics"):
        parts.append("Topics: " + ", ".join(author["topics"][:6]))
    if c.research_text:
        parts.append(c.research_text)
    return "\n".join(p for p in parts if p)[:4000]


async def enrich_and_rank(db, run: models.DiscoveryRun, user: models.User, profile: dict) -> None:
    candidates = (
        db.query(models.DiscoveryCandidate)
        .filter(models.DiscoveryCandidate.run_id == run.id)
        .filter(models.DiscoveryCandidate.openalex_author_id.isnot(None))
        .all()
    )
    if not candidates:
        return

    authors = await openalex.authors_by_ids([c.openalex_author_id for c in candidates])
    now = datetime.utcnow()

    # Enrich from OpenAlex authors.
    for c in candidates:
        a = authors.get(c.openalex_author_id)
        if not a:
            continue
        c.orcid = (a.get("orcid") or "").rstrip("/").split("/")[-1] or None
        c.works_count = a.get("works_count")
        c.cited_by_count = a.get("cited_by_count")
        c.h_index = a.get("h_index")
        c.first_pub_year = a.get("earliest_year")
        c.career_stage = scoring.classify_career_stage(a.get("earliest_year"))
        if a.get("scholar_url"):
            c.scholar_url = a.get("scholar_url")
    db.commit()

    # Semantic scores via embeddings (optional).
    ctx = scoring.UserContext.from_db(db, user)
    user_emb = profile.get("embedding")
    if user_emb:
        texts = [_candidate_embed_text(c, authors.get(c.openalex_author_id)) for c in candidates]
        vecs = await embeddings.embed_texts(texts, settings=_settings(db, user), db=db, user_id=user.id)
        if vecs:
            for c, v in zip(candidates, vecs):
                if v:
                    c.semantic_score = max(0.0, embeddings.cosine(user_emb, v))
        db.commit()

    # Score every candidate.
    for c in candidates:
        payload = c.raw_payload if isinstance(c.raw_payload, dict) else {}
        cand = {
            "semantic_score": c.semantic_score,
            "text": c.research_text or "",
            "topic_match_count": c.topic_match_count or 0,
            "career_stage": c.career_stage,
            "works_count": c.works_count,
            "cited_by_count": c.cited_by_count,
            "h_index": c.h_index,
            "last_pub_year": payload.get("last_pub_year"),
            "has_contact": bool(c.email or c.profile_url),
        }
        score, breakdown, reasons = scoring.score_candidate(ctx, cand)
        c.match_score = score
        c.matched_reasons = reasons
        c.scored_at = now
    db.commit()

    await _llm_rerank(db, run, user, profile)


async def _llm_rerank(db, run: models.DiscoveryRun, user: models.User, profile: dict) -> None:
    """One LLM pass over the top shortlist for a 'why it matches you' reason."""
    shortlist = (
        db.query(models.DiscoveryCandidate)
        .filter(models.DiscoveryCandidate.run_id == run.id)
        .order_by(models.DiscoveryCandidate.match_score.desc().nullslast())
        .limit(SHORTLIST_SIZE)
        .all()
    )
    if not shortlist:
        return
    lines = []
    for idx, c in enumerate(shortlist):
        lines.append(
            f"{idx}. {c.name} — {c.university_name or '?'} | h-index {c.h_index or '?'} | "
            f"{c.career_stage or '?'}-career | {c.topic_match_count or 0} recent papers | {(c.research_text or '')[:160]}"
        )
    from .quill import run_llm_once
    prompt = (
        "You are matching a graduate/postdoc applicant to professors. Given the "
        "applicant summary and a numbered list of candidates, return ONLY a JSON "
        "array of objects {\"index\": <int>, \"reason\": \"<one concise sentence on "
        "why this professor fits the applicant>\"} for each candidate index. Keep "
        "reasons specific and grounded in the data.\n\n"
        f"APPLICANT:\n{profile.get('summary','')}\n\nCANDIDATES:\n" + "\n".join(lines)
    )
    raw = await run_llm_once(db, user, prompt, workflow="discovery_rerank", timeout_s=120)
    if not raw.strip():
        return
    reasons = _parse_rerank(raw)
    if not reasons:
        return
    for idx, c in enumerate(shortlist):
        r = reasons.get(idx)
        if r:
            existing = list(c.matched_reasons or [])
            c.matched_reasons = [r] + [x for x in existing if x != r]
    db.commit()


def _parse_rerank(raw: str) -> dict[int, str]:
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
    except Exception:  # noqa: BLE001
        return {}
    out: dict[int, str] = {}
    for item in data if isinstance(data, list) else []:
        if isinstance(item, dict) and isinstance(item.get("index"), int) and item.get("reason"):
            out[item["index"]] = str(item["reason"])[:300]
    return out


# ───────────────────────────────────────────────────────────────────
# Phase D — resolve contacts (shortlist only)
# ───────────────────────────────────────────────────────────────────
def _looks_academic(url: str, name: str) -> int:
    u = (url or "").lower()
    score = 0
    if any(t in u for t in (".edu", ".ac.", "univ", "faculty", "people", "~")):
        score += 2
    for tok in normalize_name(name).split():
        if tok and tok in u:
            score += 1
    if any(t in u for t in ("linkedin.com", "researchgate", "twitter.com", "facebook")):
        score -= 3
    return score


async def _orcid_homepage(orcid: str) -> Optional[str]:
    if not orcid:
        return None
    try:
        import httpx
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"https://pub.orcid.org/v3.0/{orcid}/researcher-urls",
                headers={"Accept": "application/json"},
            )
            r.raise_for_status()
            urls = r.json().get("researcher-url") or []
            for u in urls:
                val = (u.get("url") or {}).get("value")
                if val and "linkedin" not in val.lower():
                    return val
            if urls:
                return (urls[0].get("url") or {}).get("value")
    except Exception as exc:  # noqa: BLE001
        log.warning("ORCID lookup failed for %s: %s", orcid, exc)
    return None


async def resolve_contacts(db, run: models.DiscoveryRun, user: models.User) -> None:
    settings = _settings(db, user)
    shortlist = (
        db.query(models.DiscoveryCandidate)
        .filter(models.DiscoveryCandidate.run_id == run.id)
        .order_by(models.DiscoveryCandidate.match_score.desc().nullslast())
        .limit(SHORTLIST_SIZE)
        .all()
    )
    resolved = 0
    for c in shortlist:
        homepage = None
        if c.orcid:
            homepage = await _orcid_homepage(c.orcid)
        if not homepage and websearch.has_search(settings):
            results = await websearch.search(f"{c.name} {c.university_name or ''} faculty", count=4, settings=settings)
            best = None
            best_score = 0
            for r in results:
                s = _looks_academic(r.get("url") or "", c.name)
                if s > best_score:
                    best_score, best = s, r.get("url")
            homepage = best or (results[0].get("url") if results else None)

        if homepage:
            c.profile_url = homepage
            page = models.DiscoveryPage(
                run_id=run.id, university_id=c.university_id, url=homepage,
                normalized_url=homepage, final_url=homepage, page_type="profile",
                status="crawled", fetcher="scraper", last_crawled_at=datetime.utcnow(),
            )
            db.add(page)
            db.flush()
            c.source_page_id = page.id
            scraped = await scraper_client.scrape(homepage)
            if scraped and scraped.ok:
                emails = EMAIL_RE.findall(scraped.text or "")
                if emails:
                    c.email = emails[0]
                db.add(models.DiscoveryEvidence(
                    candidate_id=c.id, page_id=page.id, evidence_type="profile",
                    url=homepage, quote=(scraped.text or "")[:500], confidence=0.7,
                ))

        # Verified when we have a person + institution + a profile URL.
        if c.name and c.university_name and c.profile_url:
            c.verification_status = "verified"
            resolved += 1
        c.updated_at = datetime.utcnow()
        db.commit()

    # Re-score shortlist now that has_contact is known.
    ctx = scoring.UserContext.from_db(db, user)
    for c in shortlist:
        payload = c.raw_payload if isinstance(c.raw_payload, dict) else {}
        cand = {
            "semantic_score": c.semantic_score, "text": c.research_text or "",
            "topic_match_count": c.topic_match_count or 0, "career_stage": c.career_stage,
            "works_count": c.works_count, "cited_by_count": c.cited_by_count, "h_index": c.h_index,
            "last_pub_year": payload.get("last_pub_year"), "has_contact": bool(c.email or c.profile_url),
        }
        score, _b, reasons = scoring.score_candidate(ctx, cand)
        c.match_score = score
        # Preserve an LLM reason if it was placed first.
        existing = list(c.matched_reasons or [])
        llm_reason = existing[0] if existing else None
        merged = ([llm_reason] if llm_reason else []) + [r for r in reasons if r != llm_reason]
        c.matched_reasons = merged[:6]
    run.candidates_verified = (
        db.query(func.count(models.DiscoveryCandidate.id))
        .filter(models.DiscoveryCandidate.run_id == run.id)
        .filter(models.DiscoveryCandidate.verification_status == "verified")
        .scalar() or 0
    )
    db.commit()
    _add_log(db, run.id, "info", "contacts", f"Resolved contact info for {resolved} shortlisted candidate(s).")


# ───────────────────────────────────────────────────────────────────
# Orchestrator
# ───────────────────────────────────────────────────────────────────
async def _run_pipeline_async(run_id: int) -> None:
    with SessionLocal() as db:
        run = db.get(models.DiscoveryRun, run_id)
        if not run:
            return
        user = db.get(models.User, run.user_id) if run.user_id else None
        if not user:
            _fail(db, run, "Discovery run has no owning user.")
            return
        run.status = "running"
        run.started_at = run.started_at or datetime.utcnow()
        db.commit()

        try:
            _set_phase(db, run, "profile", "Building your research query profile…")
            profile = await build_query_profile(db, user)
            if not profile or not profile.get("topic_ids"):
                _fail(db, run, "Couldn't derive research topics. Add research interests, publications, or a CV to your profile, then retry.")
                return
            _add_log(db, run.id, "info", "profile",
                     f"Query profile ready: {len(profile['topic_ids'])} topic(s); embeddings={'on' if profile.get('embedding') else 'off (lexical)'}.")

            _set_phase(db, run, "retrieve", "Finding researchers publishing in your area…")
            created = await retrieve_candidates(db, run, profile["topic_ids"])
            if created == 0:
                _fail(db, run, "No matching researchers found for these topics/countries. Try broadening your target countries.")
                return

            _set_phase(db, run, "rank", "Enriching and ranking matches…")
            await enrich_and_rank(db, run, user, profile)

            _set_phase(db, run, "contacts", "Resolving contact details for top matches…")
            await resolve_contacts(db, run, user)

            run.status = "done"
            run.phase = "done"
            run.completed_at = datetime.utcnow()
            run.updated_at = datetime.utcnow()
            top = _count_candidates(db, run.id)
            run.summary = f"Found {top} matched researcher(s); top {min(SHORTLIST_SIZE, top)} enriched with contacts."
            db.commit()
            _add_log(db, run.id, "info", "done", run.summary)
        except Exception as exc:  # noqa: BLE001 - surface any unexpected failure on the run
            log.exception("discovery pipeline crashed for run %s", run_id)
            db.rollback()
            run2 = db.get(models.DiscoveryRun, run_id)
            if run2:
                _fail(db, run2, f"Discovery failed: {exc}")


def run_discovery_pipeline(run_id: int) -> None:
    """Sync entrypoint for the FastAPI background task."""
    asyncio.run(_run_pipeline_async(run_id))
