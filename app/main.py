import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from . import models, schemas
from .seed import seed_if_empty
from .quill import router as quill_router
from .documents import router as documents_router
from .user_profile import router as user_router
from . import scoring
from .runtime import data_dir, db_path, documents_dir, is_desktop_mode

Base.metadata.create_all(bind=engine)


def _ensure_ai_run_recovery_columns() -> None:
    """Local SQLite DBs are often created via create_all(), not Alembic."""
    with engine.begin() as conn:
        existing = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(ai_runs)").fetchall()}
        additions = {
            "request_json": "JSON",
            "error_type": "VARCHAR",
            "error_message": "TEXT",
            "retry_of_run_id": "INTEGER",
        }
        for name, ddl in additions.items():
            if name not in existing:
                conn.exec_driver_sql(f"ALTER TABLE ai_runs ADD COLUMN {name} {ddl}")
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ai_runs_error_type ON ai_runs (error_type)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ai_runs_retry_of_run_id ON ai_runs (retry_of_run_id)"))


_ensure_ai_run_recovery_columns()
seed_if_empty()

app = FastAPI(title="Quill Research Assistant", version="1.0.0")
app.include_router(quill_router)
app.include_router(documents_router)
app.include_router(user_router)


@app.on_event("startup")
async def _start_reply_poller() -> None:
    if os.environ.get("POSTDOC_DISABLE_REPLY_POLLER") == "1":
        return
    from .gmail_inbox import start_poller
    start_poller()


@app.on_event("shutdown")
async def _stop_reply_poller() -> None:
    if os.environ.get("POSTDOC_DISABLE_REPLY_POLLER") == "1":
        return
    from .gmail_inbox import stop_poller
    stop_poller()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip()
        for o in os.environ.get(
            "POSTDOC_CORS_ORIGINS",
            "http://localhost:8000,http://127.0.0.1:8000,"
            "http://localhost:5173,http://127.0.0.1:5173",
        ).split(",")
        if o.strip()
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).parent / "static"


@app.get("/api/health")
def health():
    return {"ok": True, "time": datetime.utcnow().isoformat()}


@app.get("/api/desktop/status")
def desktop_status(db: Session = Depends(get_db)):
    """Runtime status used by the desktop shell and first-run setup."""
    from .quill import _select_provider_for, _settings
    import shutil

    settings = _settings(db)
    active = _select_provider_for(settings)
    return {
        "ok": True,
        "desktop_mode": is_desktop_mode(),
        "data_dir": str(data_dir()),
        "db_path": str(db_path()),
        "documents_dir": str(documents_dir()),
        "providers": {
            "selected_default": settings.ai_provider,
            "active": active.value if active else None,
            "claude_cli": {
                "available": bool(settings.claude_cli_path or shutil.which("claude")),
                "path": settings.claude_cli_path or shutil.which("claude"),
            },
            "codex_cli": {
                "available": bool(settings.codex_cli_path or shutil.which("codex")),
                "path": settings.codex_cli_path or shutil.which("codex"),
            },
            "anthropic_api": {"configured": bool(settings.anthropic_api_key)},
            "openai_api": {"configured": bool(settings.openai_api_key)},
        },
    }


@app.get("/api/professors", response_model=List[schemas.ProfessorOut])
def list_professors(
    tier: Optional[str] = None,
    status: Optional[str] = None,
    university: Optional[str] = None,
    category: Optional[str] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.Professor)
    if tier:
        query = query.filter(models.Professor.tier == tier)
    if status:
        query = query.filter(models.Professor.status == status)
    if university:
        query = query.filter(models.Professor.university == university)
    if category:
        query = query.filter(models.Professor.research_category == category)
    if q:
        like = f"%{q.lower()}%"
        query = query.filter(
            (models.Professor.name.ilike(like))
            | (models.Professor.dept_lab.ilike(like))
            | (models.Professor.notes.ilike(like))
            | (models.Professor.research_angle.ilike(like))
        )
    from sqlalchemy import case
    category_rank = case(
        {
            'renewable': 0, 'av': 1, 'adversarial': 2, 'robotics': 3,
            'rl': 4, 'or': 5, 'nlp': 6, 'cv': 7, 'medical': 8, 'theory': 9,
        },
        value=models.Professor.research_category,
        else_=99,
    )
    from sqlalchemy import desc, nullslast
    return query.order_by(
        nullslast(desc(models.Professor.relevance_score)),
        category_rank,
        models.Professor.tier.asc(),
        models.Professor.name.asc(),
    ).all()


@app.post("/api/professors/{pid}/score")
def compute_professor_score(pid: int, db: Session = Depends(get_db)):
    """Recompute relevance score for a single professor."""
    prof = db.get(models.Professor, pid)
    if not prof:
        raise HTTPException(404, "not found")
    score, breakdown = scoring.score_professor(db, prof)
    prof.relevance_score = score
    prof.relevance_breakdown = breakdown
    prof.relevance_scored_at = datetime.utcnow()
    db.commit()
    return {"id": pid, "relevance_score": score, "relevance_breakdown": breakdown}


@app.post("/api/professors/score-all")
def compute_all_professor_scores(db: Session = Depends(get_db)):
    """Recompute relevance scores for every professor."""
    count = scoring.score_all_professors(db)
    return {"updated": count}


@app.post("/api/professors", response_model=schemas.ProfessorOut, status_code=201)
def create_professor(p: schemas.ProfessorCreate, db: Session = Depends(get_db)):
    prof = models.Professor(**p.model_dump())
    db.add(prof)
    db.commit()
    db.refresh(prof)
    _log(db, f"Added professor: {prof.name}", professor_id=prof.id)
    return prof


@app.get("/api/professors/{pid}", response_model=schemas.ProfessorOut)
def get_professor(pid: int, db: Session = Depends(get_db)):
    prof = db.get(models.Professor, pid)
    if not prof:
        raise HTTPException(404, "not found")
    return prof


@app.get("/api/professors/{pid}/papers")
def get_professor_papers(pid: int, db: Session = Depends(get_db)):
    prof = db.get(models.Professor, pid)
    if not prof:
        raise HTTPException(404, "not found")
    papers = (
        db.query(models.ProfessorPaper)
        .filter_by(professor_id=pid)
        .order_by(models.ProfessorPaper.relevance_score.desc(), models.ProfessorPaper.year.desc())
        .all()
    )
    return [
        {
            "id": p.id,
            "title": p.title,
            "venue": p.venue,
            "year": p.year,
            "abstract": p.abstract,
            "url": p.url,
            "pdf_url": p.pdf_url,
            "relevance_score": p.relevance_score,
            "relevance_summary": p.relevance_summary,
            "fetched_at": p.fetched_at.isoformat() if p.fetched_at else None,
        }
        for p in papers
    ]


@app.patch("/api/professors/{pid}", response_model=schemas.ProfessorOut)
def update_professor(pid: int, patch: schemas.ProfessorUpdate, db: Session = Depends(get_db)):
    prof = db.get(models.Professor, pid)
    if not prof:
        raise HTTPException(404, "not found")
    data = patch.model_dump(exclude_unset=True)
    old_status = prof.status
    for k, v in data.items():
        setattr(prof, k, v)
    db.commit()
    db.refresh(prof)
    if "status" in data and data["status"] != old_status:
        _log(
            db,
            f"{prof.name}: {old_status} → {data['status']}",
            professor_id=prof.id,
        )
    return prof


@app.delete("/api/professors/{pid}", status_code=204)
def delete_professor(pid: int, db: Session = Depends(get_db)):
    prof = db.get(models.Professor, pid)
    if not prof:
        raise HTTPException(404, "not found")
    name = prof.name
    db.delete(prof)
    db.commit()
    _log(db, f"Deleted professor: {name}")


@app.get("/api/grants", response_model=List[schemas.GrantOut])
@app.get("/api/fellowships", response_model=List[schemas.GrantOut], include_in_schema=False)
def list_grants(db: Session = Depends(get_db)):
    return db.query(models.Grant).order_by(models.Grant.id.asc()).all()


@app.post("/api/grants", response_model=schemas.GrantOut, status_code=201)
@app.post("/api/fellowships", response_model=schemas.GrantOut, status_code=201, include_in_schema=False)
def create_grant(f: schemas.GrantBase, db: Session = Depends(get_db)):
    g = models.Grant(**f.model_dump())
    db.add(g)
    db.commit()
    db.refresh(g)
    return g


@app.patch("/api/grants/{gid}", response_model=schemas.GrantOut)
@app.patch("/api/fellowships/{gid}", response_model=schemas.GrantOut, include_in_schema=False)
def update_grant(gid: int, patch: schemas.GrantUpdate, db: Session = Depends(get_db)):
    g = db.get(models.Grant, gid)
    if not g:
        raise HTTPException(404, "not found")
    for k, v in patch.model_dump(exclude_unset=True).items():
        setattr(g, k, v)
    db.commit()
    db.refresh(g)
    return g


@app.delete("/api/grants/{gid}", status_code=204)
@app.delete("/api/fellowships/{gid}", status_code=204, include_in_schema=False)
def delete_grant(gid: int, db: Session = Depends(get_db)):
    g = db.get(models.Grant, gid)
    if not g:
        raise HTTPException(404, "not found")
    db.delete(g)
    db.commit()


@app.get("/api/drafts", response_model=List[schemas.DraftWithProfessor])
def list_drafts(professor_id: Optional[int] = None, q: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(models.EmailDraft).filter(models.EmailDraft.is_backup == False)
    if professor_id:
        query = query.filter(models.EmailDraft.professor_id == professor_id)
    if q:
        like = f"%{q.lower()}%"
        query = query.filter(
            (models.EmailDraft.subject.ilike(like)) | (models.EmailDraft.body.ilike(like))
        )
    drafts = query.all()
    category_order = {
        'renewable': 0, 'av': 1, 'adversarial': 2, 'robotics': 3,
        'rl': 4, 'or': 5, 'nlp': 6, 'cv': 7, 'medical': 8, 'theory': 9,
    }
    out = []
    for d in drafts:
        prof = d.professor
        out.append(
            schemas.DraftWithProfessor(
                id=d.id,
                professor_id=d.professor_id,
                subject=d.subject or "",
                body=d.body or "",
                created_at=d.created_at,
                updated_at=d.updated_at,
                professor_name=prof.name if prof else "",
                professor_university=prof.university if prof else "",
                professor_status=prof.status if prof else "",
                professor_email=prof.email if prof else "",
                professor_research_category=(prof.research_category or "") if prof else "",
                sent_at=d.sent_at,
                skipped_at=d.skipped_at,
                attachment_doc_ids=d.attachment_doc_ids,
            )
        )
    out.sort(key=lambda d: (category_order.get(d.professor_research_category, 99), d.professor_name.lower()))
    return out


@app.post("/api/drafts", response_model=schemas.DraftOut, status_code=201)
def create_draft(d: schemas.DraftBase, db: Session = Depends(get_db)):
    prof = db.get(models.Professor, d.professor_id)
    if not prof:
        raise HTTPException(404, "professor not found")
    existing = (
        db.query(models.EmailDraft)
        .filter(models.EmailDraft.professor_id == d.professor_id)
        .first()
    )
    if existing:
        return existing
    draft = models.EmailDraft(**d.model_dump())
    db.add(draft)
    db.commit()
    db.refresh(draft)
    _log(db, f"Started email draft for {prof.name}", professor_id=prof.id)
    return draft


@app.get("/api/drafts/{did}", response_model=schemas.DraftOut)
def get_draft(did: int, db: Session = Depends(get_db)):
    d = db.get(models.EmailDraft, did)
    if not d:
        raise HTTPException(404, "not found")
    return d


@app.patch("/api/drafts/{did}", response_model=schemas.DraftOut)
def update_draft(did: int, patch: schemas.DraftUpdate, db: Session = Depends(get_db)):
    d = db.get(models.EmailDraft, did)
    if not d:
        raise HTTPException(404, "not found")
    for k, v in patch.model_dump(exclude_unset=True).items():
        setattr(d, k, v)
    db.commit()
    db.refresh(d)
    return d


@app.delete("/api/drafts/{did}", status_code=204)
def delete_draft(did: int, db: Session = Depends(get_db)):
    d = db.get(models.EmailDraft, did)
    if not d:
        raise HTTPException(404, "not found")
    db.delete(d)
    db.commit()


@app.post("/api/drafts/{did}/mark_sent", response_model=schemas.ProfessorOut)
def mark_draft_sent(did: int, db: Session = Depends(get_db)):
    d = db.get(models.EmailDraft, did)
    if not d:
        raise HTTPException(404, "not found")
    prof = d.professor
    if not prof:
        raise HTTPException(404, "professor not found")
    old = prof.status
    now = datetime.utcnow()
    d.sent_at = now
    d.sent_via = "manual"
    d.send_error = None
    prof.status = "sent"
    prof.date_sent = date.today()
    db.commit()
    db.refresh(prof)
    _log(db, f"{prof.name}: {old} → sent (via draft)", professor_id=prof.id)
    return prof


@app.get("/api/professors/{pid}/draft", response_model=Optional[schemas.DraftOut])
def get_professor_draft(pid: int, db: Session = Depends(get_db)):
    d = (
        db.query(models.EmailDraft)
        .filter(models.EmailDraft.professor_id == pid, models.EmailDraft.is_backup == False)
        .order_by(models.EmailDraft.created_at.desc())
        .first()
    )
    return d


@app.get("/api/activity", response_model=List[schemas.ActivityOut])
def list_activity(limit: int = 100, db: Session = Depends(get_db)):
    return (
        db.query(models.Activity)
        .order_by(models.Activity.created_at.desc())
        .limit(limit)
        .all()
    )


@app.post("/api/activity", response_model=schemas.ActivityOut, status_code=201)
def create_activity(a: schemas.ActivityBase, db: Session = Depends(get_db)):
    act = models.Activity(**a.model_dump())
    if act.date is None:
        act.date = date.today()
    db.add(act)
    db.commit()
    db.refresh(act)
    return act


@app.get("/api/stats", response_model=schemas.Stats)
def stats(db: Session = Depends(get_db)):
    profs = db.query(models.Professor).all()
    total = len(profs)

    by_status, by_tier, by_university = {}, {}, {}
    for p in profs:
        by_status[p.status] = by_status.get(p.status, 0) + 1
        by_tier[p.tier] = by_tier.get(p.tier, 0) + 1
        by_university[p.university] = by_university.get(p.university, 0) + 1

    sent_statuses = {"sent", "replied", "interview", "offer", "rejected", "no_reply"}
    reply_statuses = {"replied", "interview", "offer", "rejected"}

    sent_count = sum(1 for p in profs if p.status in sent_statuses)
    reply_count = sum(1 for p in profs if p.status in reply_statuses)
    interview_count = by_status.get("interview", 0) + by_status.get("offer", 0)
    offer_count = by_status.get("offer", 0)
    response_rate = round((reply_count / sent_count) * 100, 1) if sent_count else 0.0

    threshold = date.today() - timedelta(days=14)
    pending_followups = sum(
        1
        for p in profs
        if p.status == "sent" and p.date_sent and p.date_sent <= threshold
    )

    return schemas.Stats(
        total=total,
        by_status=by_status,
        by_tier=by_tier,
        by_university=by_university,
        sent_count=sent_count,
        reply_count=reply_count,
        response_rate=response_rate,
        interview_count=interview_count,
        offer_count=offer_count,
        pending_followups=pending_followups,
    )


@app.get("/api/batches")
def get_batches(
    batch_size: int = 12,
    max_per_university: int = 2,
    start_date: Optional[str] = None,         # ISO yyyy-mm-dd
    weekdays: Optional[str] = None,           # CSV of 0-6 (Mon=0). Default "1,2,3"
    tiers: Optional[str] = None,              # CSV of T1,T2,T3
    categories: Optional[str] = None,         # CSV of renewable,av,...
    universities: Optional[str] = None,       # CSV of names (URL-encoded)
    db: Session = Depends(get_db),
):
    """Bin-pack drafts into batches that are safe to send the same day.

    Hard constraints per batch:
      - No two professors from the same dept_lab.
      - At most `max_per_university` professors from the same university.
      - Each batch size ≤ batch_size parameter.

    Soft preferences:
      - T1 first, then T2, T3.
      - Cycle through categories so each batch mixes research areas.
      - Per-category cap: max(2, ceil(cat_count / num_batches) + 1) per batch prevents spam-look.
      - Prefer earlier batches contain higher-priority drafts.

    Filtering (before batching):
      - Status = "drafting" only.
      - Must have email, subject, body.
      - Respects tier, category, university filters if provided.
      - Excludes skipped_by_user drafts.
    """
    tier_set = set(s.strip() for s in tiers.split(",")) if tiers else None
    cat_set = set(s.strip() for s in categories.split(",")) if categories else None
    uni_set = set(s.strip() for s in universities.split(",")) if universities else None

    drafts = (
        db.query(models.EmailDraft)
        .join(models.Professor)
        .filter(models.Professor.status == "drafting", models.EmailDraft.is_backup == False)
        .all()
    )

    eligible, skipped = [], []
    for d in drafts:
        p = d.professor
        if not p:
            continue
        reasons = []
        if d.skipped_at is not None:
            reasons.append("skipped by user")
        if not (p.email or "").strip():
            reasons.append("no email")
        if not (d.subject or "").strip():
            reasons.append("empty subject")
        if not (d.body or "").strip():
            reasons.append("empty body")
        if tier_set and p.tier not in tier_set:
            reasons.append("tier filter")
        if cat_set and (p.research_category or "") not in cat_set:
            reasons.append("category filter")
        if uni_set and p.university not in uni_set:
            reasons.append("university filter")
        if reasons:
            skipped.append({"draft_id": d.id, "professor_id": p.id, "name": p.name, "reasons": reasons})
        else:
            eligible.append((d, p))

    tier_order = {"T1": 0, "T2": 1, "T3": 2}
    cat_order = {
        "renewable": 0, "av": 1, "adversarial": 2, "robotics": 3,
        "rl": 4, "or": 5, "nlp": 6, "cv": 7, "medical": 8, "theory": 9,
    }
    # Stable rank: tier, then category-rotation index, then name
    by_cat = {}
    for d, p in eligible:
        by_cat.setdefault(p.research_category or "theory", []).append((d, p))
    for k in by_cat:
        by_cat[k].sort(key=lambda x: (tier_order.get(x[1].tier, 9), x[1].name.lower()))

    # Round-robin across categories so each batch gets a mix
    cat_counts = {c: len(by_cat[c]) for c in by_cat}
    interleaved = []
    cat_keys = sorted(by_cat.keys(), key=lambda c: cat_order.get(c, 99))
    while any(by_cat[c] for c in cat_keys):
        for c in cat_keys:
            if by_cat[c]:
                interleaved.append(by_cat[c].pop(0))

    # Pre-compute number of batches and per-category cap so a single area
    # cannot dominate one batch (avoids the "spam-to-all-renewable" look).
    import math
    num_batches = max(1, math.ceil(len(interleaved) / max(1, batch_size)))
    cat_cap = {c: max(2, math.ceil(cat_counts[c] / num_batches) + 1) for c in cat_counts}

    batches = []
    def _place(d, p, enforce_cat_cap):
        for b in batches:
            if p.dept_lab and any((op.dept_lab == p.dept_lab) for _, op in b):
                continue
            uni_count = sum(1 for _, op in b if op.university == p.university)
            if uni_count >= max_per_university:
                continue
            if enforce_cat_cap:
                cat_count = sum(1 for _, op in b if (op.research_category or "theory") == (p.research_category or "theory"))
                if cat_count >= cat_cap.get(p.research_category or "theory", batch_size):
                    continue
            if len(b) >= batch_size:
                continue
            b.append((d, p))
            return True
        return False

    for d, p in interleaved:
        if _place(d, p, enforce_cat_cap=True):
            continue
        if _place(d, p, enforce_cat_cap=False):
            continue
        batches.append([(d, p)])

    # Send-date scheduling: honor start_date and weekdays params.
    try:
        anchor = date.fromisoformat(start_date) if start_date else date.today()
    except ValueError:
        anchor = date.today()
    if weekdays:
        try:
            allowed_wd = sorted({int(s) for s in weekdays.split(",") if s.strip().isdigit()})
        except ValueError:
            allowed_wd = [1, 2, 3]
    else:
        allowed_wd = [1, 2, 3]
    if not allowed_wd:
        allowed_wd = [0, 1, 2, 3, 4]
    send_days, cursor = [], anchor
    while len(send_days) < len(batches) and len(send_days) < 200:
        if cursor.weekday() in allowed_wd:
            send_days.append(cursor)
        cursor += timedelta(days=1)

    out_batches = []
    for i, b in enumerate(batches):
        unis = sorted({p.university for _, p in b})
        tiers = sorted({p.tier for _, p in b})
        cats = sorted({p.research_category for _, p in b if p.research_category})
        out_batches.append({
            "batch_num": i + 1,
            "size": len(b),
            "send_date": send_days[i].isoformat() if i < len(send_days) else None,
            "send_weekday": send_days[i].strftime("%A") if i < len(send_days) else None,
            "universities": unis,
            "tier_mix": tiers,
            "category_mix": cats,
            "drafts": [
                {
                    "draft_id": d.id,
                    "professor_id": p.id,
                    "name": p.name,
                    "university": p.university,
                    "dept_lab": p.dept_lab,
                    "tier": p.tier,
                    "category": p.research_category or "",
                    "email": p.email,
                    "subject": d.subject,
                    "body": d.body,
                    "profile_url": p.profile_url or "",
                    "word_count": len((d.body or "").split()),
                    "attachment_doc_ids": d.attachment_doc_ids,
                    "sent_at": d.sent_at.isoformat() if d.sent_at else None,
                    "send_error": d.send_error,
                } for d, p in b
            ],
        })

    return {
        "batch_size": batch_size,
        "max_per_university": max_per_university,
        "total_eligible": len(eligible),
        "total_batches": len(out_batches),
        "skipped": skipped,
        "batches": out_batches,
    }


# ────────────────────────────────────────────────────────
# Per-draft skip toggle (excludes from batch packing)
# ────────────────────────────────────────────────────────
@app.post("/api/drafts/{did}/skip")
def skip_draft(did: int, db: Session = Depends(get_db)):
    d = db.get(models.EmailDraft, did)
    if not d:
        raise HTTPException(404, "Draft not found.")
    d.skipped_at = datetime.utcnow()
    db.commit()
    _log(db, f"Skipped draft for {d.professor.name if d.professor else did}",
         professor_id=d.professor_id)
    return {"ok": True, "draft_id": did, "skipped_at": d.skipped_at.isoformat()}


@app.post("/api/drafts/{did}/unskip")
def unskip_draft(did: int, db: Session = Depends(get_db)):
    d = db.get(models.EmailDraft, did)
    if not d:
        raise HTTPException(404, "Draft not found.")
    d.skipped_at = None
    db.commit()
    return {"ok": True, "draft_id": did}


# ────────────────────────────────────────────────────────
# Mark a batch as sent (flips professor.status and logs activity)
# ────────────────────────────────────────────────────────
class MarkSentBody(BaseModel):
    draft_ids: List[int]
    send_date: Optional[str] = None  # ISO; defaults to today
    sent_via: Optional[str] = "manual"


@app.post("/api/batches/mark-sent")
def mark_batch_sent(payload: MarkSentBody, db: Session = Depends(get_db)):
    try:
        sd = date.fromisoformat(payload.send_date) if payload.send_date else date.today()
    except ValueError:
        sd = date.today()
    flipped = 0
    for did in payload.draft_ids:
        d = db.get(models.EmailDraft, did)
        if not d or not d.professor:
            continue
        d.sent_via = "manual"
        d.sent_at = datetime.combine(sd, datetime.min.time())
        d.send_error = None
        p = d.professor
        p.status = "sent"
        p.date_sent = sd
        flipped += 1
        _log(db, f"Marked sent: {p.name}", professor_id=p.id)
    db.commit()
    return {"ok": True, "marked_sent": flipped, "send_date": sd.isoformat()}


# ────────────────────────────────────────────────────────
# Settings (read/patch)
# ────────────────────────────────────────────────────────
def _settings_row(db: Session) -> models.Settings:
    s = db.query(models.Settings).first()
    if not s:
        s = models.Settings()
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


@app.get("/api/settings")
def get_settings(db: Session = Depends(get_db)):
    s = _settings_row(db)
    return {
        "ai_provider": s.ai_provider,
        "claude_cli_path": s.claude_cli_path,
        "codex_cli_path": s.codex_cli_path,
        "anthropic_api_key_set": bool(s.anthropic_api_key),
        "openai_api_key_set": bool(s.openai_api_key),
        "default_provider_per_workflow": s.default_provider_per_workflow or {},
        "email_tone_rules": s.email_tone_rules or "",
        "daily_cost_cap_usd": s.daily_cost_cap_usd,
        "ui_density": s.ui_density,
        "batch_defaults": s.batch_defaults or {
            "batch_size": 12, "max_per_university": 2,
            "weekdays": [1, 2, 3], "tiers": [], "categories": [], "universities": [],
        },
        # Gmail block — never expose the encrypted password value over the API.
        "gmail_address": s.gmail_address or "",
        "gmail_send_name": s.gmail_send_name or "",
        "gmail_connected": bool(s.gmail_address and s.gmail_app_password_encrypted),
        "gmail_last_verified_at": s.gmail_last_verified_at.isoformat() if s.gmail_last_verified_at else None,
        # Auto reply-poller status
        "reply_check_enabled": bool(s.reply_check_enabled),
        "reply_check_interval_hours": s.reply_check_interval_hours or 4,
        "reply_check_last_run_at": s.reply_check_last_run_at.isoformat() if s.reply_check_last_run_at else None,
        "reply_check_last_status": s.reply_check_last_status,
        "reply_check_last_error": s.reply_check_last_error,
    }


@app.patch("/api/settings")
def patch_settings(payload: dict, db: Session = Depends(get_db)):
    from .gmail import encrypt_password

    s = _settings_row(db)
    for k in (
        "ai_provider", "claude_cli_path", "codex_cli_path",
        "anthropic_api_key", "openai_api_key", "email_tone_rules",
        "daily_cost_cap_usd", "ui_density", "default_provider_per_workflow",
        "batch_defaults",
        "gmail_address", "gmail_send_name",
        "reply_check_enabled", "reply_check_interval_hours",
    ):
        if k in payload:
            setattr(s, k, payload[k])

    # Clamp the interval to a sane range so a typo doesn't bury the inbox.
    if "reply_check_interval_hours" in payload:
        try:
            s.reply_check_interval_hours = max(1, min(168, int(s.reply_check_interval_hours or 4)))
        except (TypeError, ValueError):
            s.reply_check_interval_hours = 4

    # Special-case the password: encrypt on write, never round-trip plaintext.
    if "gmail_app_password" in payload:
        plain = (payload["gmail_app_password"] or "").strip()
        if plain == "":
            s.gmail_app_password_encrypted = None
        else:
            s.gmail_app_password_encrypted = encrypt_password(plain)

    db.commit()
    return get_settings(db)


@app.post("/api/gmail/test")
def test_gmail(db: Session = Depends(get_db)):
    """Try a SMTP login with the currently stored credentials."""
    from .gmail import decrypt_password, verify_credentials
    s = _settings_row(db)
    if not s.gmail_address or not s.gmail_app_password_encrypted:
        raise HTTPException(400, "Gmail is not configured. Save your address + app password first.")
    try:
        pw = decrypt_password(s.gmail_app_password_encrypted)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    ok, msg = verify_credentials(s.gmail_address, pw)
    if ok:
        from datetime import datetime as _dt
        s.gmail_last_verified_at = _dt.utcnow()
        db.commit()
    return {"ok": ok, "message": msg}


@app.post("/api/drafts/{did}/upload-attachment", status_code=201)
async def upload_draft_attachment(
    did: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload a file and attach it to this specific draft.

    Wraps the standard Documents upload (so the file lives in /api/documents
    and can be reused later), then prepends it to this draft's
    ``attachment_doc_ids`` list — initialising from the user's default CV if
    the draft hadn't been customised yet.
    """
    from .documents import upload_document
    draft = db.get(models.EmailDraft, did)
    if not draft:
        raise HTTPException(404, f"Draft {did} not found")

    # Save the upload via the existing documents pipeline as kind='other'
    # (covers anything the user wants to attach — papers, certificates, etc.).
    doc_dict = await upload_document(
        background_tasks=background_tasks,
        kind="other",
        title=file.filename or "attachment",
        is_default=False,
        file=file,
        db=db,
    )
    new_doc_id = doc_dict["id"]

    # Seed the draft's attachments from the default CV if it was still null
    user = db.get(models.User, 1)
    if draft.attachment_doc_ids is None:
        seed = [user.cv_doc_id] if user and user.cv_doc_id else []
        draft.attachment_doc_ids = seed
    # De-dup + append
    cur = list(draft.attachment_doc_ids or [])
    if new_doc_id not in cur:
        cur.append(new_doc_id)
        draft.attachment_doc_ids = cur
    db.commit()
    db.refresh(draft)

    return {
        "draft_id": draft.id,
        "uploaded_document": doc_dict,
        "attachment_doc_ids": draft.attachment_doc_ids,
    }


@app.post("/api/drafts/bulk-attach")
def bulk_attach(payload: dict, db: Session = Depends(get_db)):
    """Attach the given document IDs to every currently-active draft.

    Body: ``{"doc_ids": [int], "target": "drafting" | "all"}``

    - ``drafting`` (default) — only drafts whose professor is still in status
      ``drafting`` (i.e. not yet sent). Use this for "attach to every unsent
      draft".
    - ``all`` — every non-backup draft, regardless of professor status. Use
      sparingly.

    Existing attachment IDs on each draft are preserved; the new IDs are added
    without duplicates. Drafts whose ``attachment_doc_ids`` is NULL (using the
    default CV) get initialised to ``[default_cv_id]`` + the new IDs.
    """
    doc_ids = payload.get("doc_ids") or []
    if not isinstance(doc_ids, list) or not doc_ids:
        raise HTTPException(400, "doc_ids must be a non-empty list of integers.")
    doc_ids = [int(x) for x in doc_ids]

    # Validate the docs exist
    existing = {d.id for d in db.query(models.Document).filter(models.Document.id.in_(doc_ids)).all()}
    missing = [i for i in doc_ids if i not in existing]
    if missing:
        raise HTTPException(400, f"Unknown document IDs: {missing}")

    target = (payload.get("target") or "drafting").lower()
    q = db.query(models.EmailDraft).filter(models.EmailDraft.is_backup == False)  # noqa: E712
    if target == "drafting":
        q = q.join(models.Professor).filter(models.Professor.status == "drafting")
    drafts = q.all()

    user = db.get(models.User, 1)
    default_cv_id = user.cv_doc_id if user else None
    n_modified = 0
    for d in drafts:
        if d.attachment_doc_ids is None:
            cur = [default_cv_id] if default_cv_id else []
        else:
            cur = list(d.attachment_doc_ids)
        before = set(cur)
        for new_id in doc_ids:
            if new_id not in before:
                cur.append(new_id)
                before.add(new_id)
        d.attachment_doc_ids = cur
        n_modified += 1
    db.commit()
    return {"ok": True, "modified": n_modified, "target": target, "added_doc_ids": doc_ids}


@app.post("/api/drafts/{did}/send")
def send_draft_endpoint(did: int, db: Session = Depends(get_db)):
    """Send a draft via Gmail SMTP. Marks the draft sent + advances professor status."""
    from .gmail import send_draft, SendError
    try:
        result = send_draft(db, did)
    except SendError as exc:
        raise HTTPException(400, str(exc))
    return result


# ───────────────────────────────────────────────────────────────────
# Sent page — sent drafts + reply tracking
# ───────────────────────────────────────────────────────────────────

@app.get("/api/sent")
def list_sent(db: Session = Depends(get_db)):
    """Return every sent draft with its professor, reply count, and last reply.

    Used by the Sent page to show: who's been emailed, how long ago, current
    status, whether they've replied. Ordered by sent_at desc.
    """
    drafts = (
        db.query(models.EmailDraft)
        .join(models.Professor, models.Professor.id == models.EmailDraft.professor_id)
        .filter(
            models.EmailDraft.sent_at.isnot(None),
            models.EmailDraft.is_backup == False,  # noqa: E712
        )
        .order_by(models.EmailDraft.sent_at.desc())
        .all()
    )
    now = datetime.utcnow()

    # Compute batch_index: distinct send-date groups, earliest = #1.
    distinct_dates = sorted({d.sent_at.date() for d in drafts if d.sent_at})
    date_to_batch = {dt: i + 1 for i, dt in enumerate(distinct_dates)}

    out = []
    for d in drafts:
        p = d.professor
        if not p:
            continue
        # Oldest first, so the expanded thread reads top-to-bottom in
        # conversation order: original -> his reply -> your response -> ...
        replies = sorted(d.replies, key=lambda r: r.received_at or datetime.min)
        last_reply = replies[-1] if replies else None
        days_since = None
        if d.sent_at:
            days_since = (now - d.sent_at).days
        out.append({
            "draft_id": d.id,
            "professor_id": p.id,
            "professor_name": p.name,
            "professor_email": p.email,
            "university": p.university,
            "tier": p.tier,
            "research_category": p.research_category,
            "subject": d.subject,
            "body": d.body,
            "sent_at": d.sent_at.isoformat() if d.sent_at else None,
            "sent_via": d.sent_via,
            "days_since_sent": days_since,
            "batch_index": date_to_batch.get(d.sent_at.date()) if d.sent_at else None,
            "status": p.status,
            "reply_count": len(replies),
            "last_reply_at": last_reply.received_at.isoformat() if last_reply else None,
            "last_reply_snippet": last_reply.snippet if last_reply else None,
            "replies": [
                {
                    "id": r.id,
                    "received_at": r.received_at.isoformat() if r.received_at else None,
                    "from_email": r.from_email,
                    "from_name": r.from_name,
                    "subject": r.subject,
                    "snippet": r.snippet,
                    "body": r.body,
                    "read_at": r.read_at.isoformat() if r.read_at else None,
                    "dismissed_at": r.dismissed_at.isoformat() if r.dismissed_at else None,
                    "response_draft": r.response_draft,
                    "response_subject": r.response_subject,
                    "response_sent_at": r.response_sent_at.isoformat() if r.response_sent_at else None,
                    "meeting_request": r.meeting_request,
                }
                for r in replies
            ],
        })
    return out


@app.post("/api/sent/check-replies")
def check_replies_endpoint(db: Session = Depends(get_db)):
    """Poll Gmail IMAP for new replies. Updates statuses + stores reply rows."""
    from .gmail_inbox import check_replies, InboxError
    try:
        result = check_replies(db)
    except InboxError as exc:
        raise HTTPException(400, str(exc))
    if result.get("new_replies"):
        _log(db, f"Replies sync: {result['new_replies']} new across {result['checked']} sent drafts")
    return result


# ───────────────────────────────────────────────────────────────────
# Reply management — read/dismiss, AI-drafted responses, send
# ───────────────────────────────────────────────────────────────────
class ReplyDraftIn(BaseModel):
    instruction: str


class ReplyPatchIn(BaseModel):
    read: Optional[bool] = None
    dismissed: Optional[bool] = None
    response_draft: Optional[str] = None
    response_subject: Optional[str] = None


def _reply_out(r: models.EmailReply) -> dict:
    return {
        "id": r.id,
        "read_at": r.read_at.isoformat() if r.read_at else None,
        "dismissed_at": r.dismissed_at.isoformat() if r.dismissed_at else None,
        "response_draft": r.response_draft,
        "response_subject": r.response_subject,
        "response_sent_at": r.response_sent_at.isoformat() if r.response_sent_at else None,
    }


async def _draft_reply_response(db: Session, reply: models.EmailReply, instruction: str) -> dict:
    """Run the draft_reply Quill workflow to completion and return {subject, body}."""
    from .quill import _settings, _select_provider_for, _shim
    from ai.runner import (
        Workflow, RunRequest, Provider,
        stream as runner_stream, extract_json_payload,
    )

    settings = _settings(db)
    provider = _select_provider_for(settings)
    if provider is None:
        raise HTTPException(503, "No AI provider available. Configure Claude/Codex CLI or an API key in Settings.")
    cli_path = (
        settings.claude_cli_path if provider == Provider.CLAUDE_CLI else
        settings.codex_cli_path if provider == Provider.CODEX_CLI else None
    )

    user = db.get(models.User, 1)
    draft = reply.draft
    prof = draft.professor if draft else None
    params = {
        "user": _shim(user, default={
            "name": "the applicant", "current_role": "researcher",
            "research_interests": "(unknown)",
        }),
        "professor_name": prof.name if prof else (reply.from_name or ""),
        "original_subject": draft.subject if draft else "",
        "original_body": draft.body if draft else "",
        "reply_from": reply.from_name or reply.from_email or "the professor",
        "reply_subject": reply.subject or "",
        "reply_body": reply.body or reply.snippet or "",
        "instruction": instruction,
        "tone_rules": settings.email_tone_rules or "",
    }
    request = RunRequest(workflow=Workflow.DRAFT_REPLY, params=params, max_turns=4, timeout_s=180)

    parts: list[str] = []
    err: Optional[str] = None
    async for evt in runner_stream(request, provider=provider, cli_path=cli_path):
        if evt.kind == "text":
            parts.append(evt.data.get("text", ""))
        elif evt.kind == "error":
            err = evt.data.get("message") or evt.data.get("error") or "AI run failed"
    if err:
        raise HTTPException(502, f"Quill could not draft a reply: {err}")

    payload = extract_json_payload("".join(parts))
    if not payload or not (payload.get("body") or "").strip():
        raise HTTPException(502, "Quill returned no usable draft. Try rephrasing your instruction.")
    return payload


@app.post("/api/replies/{rid}/draft-response")
async def draft_reply_response(rid: int, payload: ReplyDraftIn, db: Session = Depends(get_db)):
    """Ask Quill to draft a response to an inbound reply, given the user's instruction."""
    reply = db.get(models.EmailReply, rid)
    if not reply:
        raise HTTPException(404, "Reply not found.")
    instruction = (payload.instruction or "").strip()
    if not instruction:
        raise HTTPException(400, "Tell Quill what the reply should say.")

    result = await _draft_reply_response(db, reply, instruction)
    reply.response_draft = (result.get("body") or "").strip()
    reply.response_subject = (result.get("subject") or reply.response_subject or "").strip() or None
    if reply.read_at is None:
        reply.read_at = datetime.utcnow()
    db.commit()
    return {
        "id": reply.id,
        "response_draft": reply.response_draft,
        "response_subject": reply.response_subject,
        "read_at": reply.read_at.isoformat() if reply.read_at else None,
    }


@app.patch("/api/replies/{rid}")
def patch_reply(rid: int, patch: ReplyPatchIn, db: Session = Depends(get_db)):
    """Mark a reply read/dismissed or save an edited response draft."""
    reply = db.get(models.EmailReply, rid)
    if not reply:
        raise HTTPException(404, "Reply not found.")
    now = datetime.utcnow()
    if patch.read is not None:
        reply.read_at = now if patch.read else None
    if patch.dismissed is not None:
        reply.dismissed_at = now if patch.dismissed else None
    if patch.response_draft is not None:
        reply.response_draft = patch.response_draft
    if patch.response_subject is not None:
        reply.response_subject = patch.response_subject or None
    db.commit()
    return _reply_out(reply)


@app.post("/api/replies/{rid}/send-response")
def send_reply_response(rid: int, db: Session = Depends(get_db)):
    """Send the composed response back to the professor via Gmail, threaded."""
    from .gmail import send_reply, SendError
    try:
        result = send_reply(db, rid)
    except SendError as exc:
        raise HTTPException(400, str(exc))
    _log(db, f"Reply sent to {result['to']}: {result['subject']}")
    return result


# ───────────────────────────────────────────────────────────────────
# Interview prep
# ───────────────────────────────────────────────────────────────────
class InterviewPrepGenerateIn(BaseModel):
    meeting_format: Optional[str] = None
    meeting_at: Optional[str] = None
    reply_id: Optional[int] = None


class InterviewPrepPatchIn(BaseModel):
    meeting_format: Optional[str] = None
    meeting_at: Optional[str] = None
    meeting_notes: Optional[str] = None
    briefing: Optional[dict] = None
    fit_analysis: Optional[dict] = None
    talking_points: Optional[list] = None
    likely_questions: Optional[list] = None
    questions_to_ask: Optional[list] = None
    logistics: Optional[list] = None
    status: Optional[str] = None


class MockTurnIn(BaseModel):
    answer: str


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00").replace("+00:00", ""))
    except ValueError:
        return None


_EMPTY_BRIEFING = {"key_facts": [], "summary": "", "what_to_expect": ""}
_EMPTY_FIT = {"strengths": [], "gaps": [], "verdict": ""}


def _prep_struct(raw, default: dict, legacy_key: str) -> dict:
    """Parse a stored JSON-string section, tolerating legacy plain-prose values."""
    if not raw:
        return dict(default)
    if isinstance(raw, dict):
        return {**default, **raw}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {**default, **parsed}
    except (ValueError, TypeError):
        pass
    return {**default, legacy_key: str(raw)}


def _norm_points(raw) -> list:
    """Normalize talking points to {point, detail}, tolerating legacy strings."""
    out = []
    for it in (raw or []):
        if isinstance(it, dict):
            out.append({"point": it.get("point") or "", "detail": it.get("detail") or ""})
        else:
            out.append({"point": str(it), "detail": ""})
    return out


def _prep_out(p: models.InterviewPrep) -> dict:
    prof = p.professor
    return {
        "id": p.id,
        "professor_id": p.professor_id,
        "professor_name": prof.name if prof else None,
        "university": prof.university if prof else None,
        "reply_id": p.reply_id,
        "position_type": p.position_type,
        "meeting_format": p.meeting_format,
        "meeting_at": p.meeting_at.isoformat() if p.meeting_at else None,
        "meeting_notes": p.meeting_notes,
        "briefing": _prep_struct(p.briefing, _EMPTY_BRIEFING, "summary"),
        "fit_analysis": _prep_struct(p.fit_analysis, _EMPTY_FIT, "verdict"),
        "talking_points": _norm_points(p.talking_points),
        "likely_questions": p.likely_questions or [],
        "questions_to_ask": p.questions_to_ask or [],
        "logistics": p.logistics or [],
        "status": p.status,
        "generated_at": p.generated_at.isoformat() if p.generated_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _mock_out(m: models.MockInterview) -> dict:
    return {
        "id": m.id,
        "prep_id": m.prep_id,
        "transcript": m.transcript or [],
        "status": m.status,
        "summary": m.summary,
    }


def _user_prompt_dict(user: Optional[models.User]) -> dict:
    if not user:
        return {"name": "the applicant", "current_role": "researcher", "research_interests": "(unknown)"}
    return {
        "name": user.name,
        "current_role": user.current_role,
        "headline": user.headline,
        "research_interests": user.research_interests,
        "datasets_created": user.datasets_created,
        "education": [
            {"degree_level": e.degree_level, "field": e.field,
             "institution": e.institution, "thesis_title": e.thesis_title}
            for e in user.education
        ],
        "publications": [
            {"title": p.title, "venue": p.venue_full_name or p.venue_short,
             "year": p.year, "status": p.status, "your_role": p.your_role}
            for p in user.publications
        ],
    }


def _prof_prompt_dict(prof: models.Professor) -> dict:
    return {
        "name": prof.name,
        "university": prof.university,
        "dept_lab": prof.dept_lab,
        "last_research_summary": prof.last_research_summary,
        "research_interests": prof.research_interests,
        "hiring_intel": prof.hiring_intel,
    }


async def _run_workflow_json(db: Session, workflow, params: dict,
                             max_turns: int = 6, timeout_s: int = 240) -> dict:
    """Run a Quill workflow to completion and return the parsed JSON payload."""
    from .quill import _settings, _select_provider_for
    from ai.runner import RunRequest, Provider, stream as runner_stream, extract_json_payload

    settings = _settings(db)
    provider = _select_provider_for(settings)
    if provider is None:
        raise HTTPException(503, "No AI provider available. Configure Claude/Codex CLI or an API key in Settings.")
    cli_path = (
        settings.claude_cli_path if provider == Provider.CLAUDE_CLI else
        settings.codex_cli_path if provider == Provider.CODEX_CLI else None
    )
    request = RunRequest(workflow=workflow, params=params, max_turns=max_turns, timeout_s=timeout_s)
    parts: list[str] = []
    err: Optional[str] = None
    async for evt in runner_stream(request, provider=provider, cli_path=cli_path):
        if evt.kind == "text":
            parts.append(evt.data.get("text", ""))
        elif evt.kind == "error":
            err = evt.data.get("message") or evt.data.get("error") or "AI run failed"
    if err:
        raise HTTPException(502, f"Quill run failed: {err}")
    payload = extract_json_payload("".join(parts))
    if not payload:
        raise HTTPException(502, "Quill returned no usable output. Try again.")
    return payload


def _build_thread(reply: Optional[models.EmailReply]) -> str:
    if not reply:
        return ""
    parts: list[str] = []
    draft = reply.draft
    if draft:
        parts.append(f"--- Applicant's outreach ---\nSubject: {draft.subject}\n\n{draft.body}")
    parts.append(
        f"--- Professor's reply ({reply.from_name or reply.from_email or 'professor'}) ---\n"
        f"Subject: {reply.subject or ''}\n\n{reply.body or reply.snippet or ''}"
    )
    return "\n\n".join(parts)


@app.get("/api/interview-prep")
def list_interview_preps(db: Session = Depends(get_db)):
    preps = (
        db.query(models.InterviewPrep)
        .order_by(models.InterviewPrep.updated_at.desc())
        .all()
    )
    return [_prep_out(p) for p in preps]


@app.get("/api/professors/{pid}/interview-prep")
def get_interview_prep(pid: int, db: Session = Depends(get_db)):
    prep = (
        db.query(models.InterviewPrep)
        .filter_by(professor_id=pid)
        .order_by(models.InterviewPrep.updated_at.desc())
        .first()
    )
    if not prep:
        raise HTTPException(404, "No interview prep for this professor yet.")
    return _prep_out(prep)


@app.post("/api/professors/{pid}/interview-prep")
async def generate_interview_prep(pid: int, payload: InterviewPrepGenerateIn,
                                  db: Session = Depends(get_db)):
    from ai.runner import Workflow

    prof = db.get(models.Professor, pid)
    if not prof:
        raise HTTPException(404, "Professor not found.")
    user = db.query(models.User).first()

    reply = None
    if payload.reply_id:
        reply = db.get(models.EmailReply, payload.reply_id)
    if reply is None:
        reply = (
            db.query(models.EmailReply)
            .filter_by(professor_id=pid)
            .order_by(models.EmailReply.received_at.desc())
            .first()
        )

    prep = db.query(models.InterviewPrep).filter_by(professor_id=pid).first()
    meeting_format = payload.meeting_format or (prep.meeting_format if prep else None) or "formal_interview"
    position_type = prof.position_type or (user.target_position_type if user else None) or "postdoc"

    papers = (
        db.query(models.ProfessorPaper)
        .filter_by(professor_id=pid)
        .order_by(models.ProfessorPaper.relevance_score.desc(),
                  models.ProfessorPaper.year.desc())
        .limit(5)
        .all()
    )
    params = {
        "user": _user_prompt_dict(user),
        "professor": _prof_prompt_dict(prof),
        "papers": [
            {"title": p.title, "venue": p.venue, "year": p.year,
             "relevance_summary": p.relevance_summary}
            for p in papers
        ],
        "thread": _build_thread(reply),
        "position_type": position_type,
        "meeting_format": meeting_format,
    }
    result = await _run_workflow_json(db, Workflow.PREPARE_INTERVIEW, params,
                                      max_turns=6, timeout_s=300)

    if prep is None:
        prep = models.InterviewPrep(professor_id=pid)
        db.add(prep)
    prep.reply_id = reply.id if reply else None
    prep.position_type = position_type
    prep.meeting_format = meeting_format
    if payload.meeting_at is not None:
        prep.meeting_at = _parse_dt(payload.meeting_at)
    prep.briefing = json.dumps(result.get("briefing") or _EMPTY_BRIEFING)
    prep.fit_analysis = json.dumps(result.get("fit_analysis") or _EMPTY_FIT)
    prep.talking_points = result.get("talking_points") or []
    prep.likely_questions = result.get("likely_questions") or []
    prep.questions_to_ask = result.get("questions_to_ask") or []
    prep.logistics = result.get("logistics") or []
    prep.status = "ready"
    prep.generated_at = datetime.utcnow()
    if prof.status not in ("interview", "offer", "rejected"):
        prof.status = "interview"
    db.commit()
    db.refresh(prep)
    _log(db, "interview_prep_generated", professor_id=pid,
         detail=f"Interview prep generated for {prof.name}")
    return _prep_out(prep)


@app.patch("/api/interview-prep/{prep_id}")
def patch_interview_prep(prep_id: int, patch: InterviewPrepPatchIn,
                         db: Session = Depends(get_db)):
    prep = db.get(models.InterviewPrep, prep_id)
    if not prep:
        raise HTTPException(404, "Interview prep not found.")
    data = patch.model_dump(exclude_unset=True)
    if "meeting_at" in data:
        prep.meeting_at = _parse_dt(data.pop("meeting_at"))
    for field in ("briefing", "fit_analysis"):
        if field in data:
            setattr(prep, field, json.dumps(data.pop(field) or {}))
    for field, value in data.items():
        setattr(prep, field, value)
    db.commit()
    db.refresh(prep)
    return _prep_out(prep)


@app.delete("/api/interview-prep/{prep_id}", status_code=204)
def delete_interview_prep(prep_id: int, db: Session = Depends(get_db)):
    prep = db.get(models.InterviewPrep, prep_id)
    if not prep:
        raise HTTPException(404, "Interview prep not found.")
    db.query(models.MockInterview).filter_by(prep_id=prep_id).delete()
    db.delete(prep)
    db.commit()


def _mock_params(db: Session, prep: models.InterviewPrep, transcript: list,
                 applicant_answer: str = "", finish: bool = False) -> dict:
    prof = prep.professor
    user = db.query(models.User).first()
    briefing = _prep_struct(prep.briefing, _EMPTY_BRIEFING, "summary")
    return {
        "user": _user_prompt_dict(user),
        "professor": _prof_prompt_dict(prof),
        "position_type": prep.position_type or "postdoc",
        "meeting_format": prep.meeting_format,
        "prep_briefing": briefing.get("summary") or "",
        "transcript": transcript,
        "applicant_answer": applicant_answer,
        "finish": finish,
    }


@app.post("/api/interview-prep/{prep_id}/mock/start")
async def start_mock_interview(prep_id: int, db: Session = Depends(get_db)):
    from ai.runner import Workflow

    prep = db.get(models.InterviewPrep, prep_id)
    if not prep:
        raise HTTPException(404, "Interview prep not found.")
    result = await _run_workflow_json(
        db, Workflow.MOCK_INTERVIEW,
        _mock_params(db, prep, transcript=[]),
        max_turns=4, timeout_s=180,
    )
    opener = (result.get("professor_message") or "").strip()
    if not opener:
        raise HTTPException(502, "Quill could not start the mock interview.")
    now = datetime.utcnow().isoformat()
    mock = models.MockInterview(
        prep_id=prep_id,
        transcript=[{"role": "professor", "text": opener, "at": now}],
        status="active",
    )
    db.add(mock)
    db.commit()
    db.refresh(mock)
    return _mock_out(mock)


@app.post("/api/mock/{mid}/turn")
async def mock_interview_turn(mid: int, payload: MockTurnIn, db: Session = Depends(get_db)):
    from ai.runner import Workflow

    mock = db.get(models.MockInterview, mid)
    if not mock:
        raise HTTPException(404, "Mock interview not found.")
    if mock.status != "active":
        raise HTTPException(400, "This mock interview is already finished.")
    answer = (payload.answer or "").strip()
    if not answer:
        raise HTTPException(400, "Type your answer first.")
    prep = db.get(models.InterviewPrep, mock.prep_id)

    transcript = list(mock.transcript or [])
    now = datetime.utcnow().isoformat()
    transcript.append({"role": "applicant", "text": answer, "at": now})

    result = await _run_workflow_json(
        db, Workflow.MOCK_INTERVIEW,
        _mock_params(db, prep, transcript=transcript, applicant_answer=answer),
        max_turns=4, timeout_s=180,
    )
    feedback = (result.get("feedback_on_last_answer") or "").strip()
    message = (result.get("professor_message") or "").strip()
    if feedback:
        transcript.append({"role": "feedback", "text": feedback, "at": now})
    if message:
        transcript.append({"role": "professor", "text": message, "at": now})
    mock.transcript = transcript
    if result.get("done"):
        mock.status = "completed"
        mock.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(mock)
    return _mock_out(mock)


@app.post("/api/mock/{mid}/finish")
async def finish_mock_interview(mid: int, db: Session = Depends(get_db)):
    from ai.runner import Workflow

    mock = db.get(models.MockInterview, mid)
    if not mock:
        raise HTTPException(404, "Mock interview not found.")
    prep = db.get(models.InterviewPrep, mock.prep_id)
    result = await _run_workflow_json(
        db, Workflow.MOCK_INTERVIEW,
        _mock_params(db, prep, transcript=list(mock.transcript or []), finish=True),
        max_turns=4, timeout_s=180,
    )
    mock.summary = (result.get("summary") or "").strip() or None
    mock.status = "completed"
    mock.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(mock)
    return _mock_out(mock)


_TTS_VOICE_RE = re.compile(r"^[A-Za-z0-9 ()]{1,40}$")


@app.get("/api/tts")
def text_to_speech(text: str, voice: str = ""):
    """Synthesize speech with the macOS `say` command and return a WAV.

    Used by the mock interview so the professor's questions can be heard.
    Runs `say` as a subprocess with list args (no shell), so the text and
    voice cannot inject commands.
    """
    text = (text or "").strip()
    if not text:
        raise HTTPException(400, "Nothing to speak.")
    text = text[:1500]

    if shutil.which("say") is None:
        raise HTTPException(501, "Text-to-speech is only available on macOS.")

    argv = ["say"]
    if voice and _TTS_VOICE_RE.match(voice):
        argv += ["-v", voice]

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        out_path = tmp.name
    try:
        argv += ["--file-format=WAVE", "--data-format=LEI16@22050",
                 "-o", out_path, text]
        proc = subprocess.run(argv, capture_output=True, timeout=30)
        if proc.returncode != 0:
            raise HTTPException(
                502, f"say failed: {proc.stderr.decode('utf-8', 'replace')[:200]}")
        audio = Path(out_path).read_bytes()
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Speech synthesis timed out.")
    finally:
        Path(out_path).unlink(missing_ok=True)

    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/tts/voices")
def tts_voices():
    """List installed macOS English voices for the mock interview voice picker."""
    if shutil.which("say") is None:
        return {"voices": []}
    proc = subprocess.run(["say", "-v", "?"], capture_output=True, timeout=10)
    voices = []
    for line in proc.stdout.decode("utf-8", "replace").splitlines():
        m = re.match(r"^(.+?)\s{2,}(en[_-]\w+)", line)
        if m:
            voices.append({"name": m.group(1).strip(), "locale": m.group(2)})
    return {"voices": voices}


@app.get("/api/export")
def export_all(db: Session = Depends(get_db)):
    return {
        "professors": [
            schemas.ProfessorOut.model_validate(p).model_dump(mode="json")
            for p in db.query(models.Professor).all()
        ],
        "grants": [
            schemas.GrantOut.model_validate(g).model_dump(mode="json")
            for g in db.query(models.Grant).all()
        ],
        "activity": [
            schemas.ActivityOut.model_validate(a).model_dump(mode="json")
            for a in db.query(models.Activity).all()
        ],
    }


@app.get("/api/profile")
def get_profile(db: Session = Depends(get_db)):
    u = db.query(models.User).first()
    if not u:
        u = models.User(name="")
        db.add(u)
        db.commit()
        db.refresh(u)
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "current_role": u.current_role,
        "affiliation": u.affiliation,
        "country": u.country,
        "research_interests": u.research_interests,
        "research_categories": u.research_categories,
        "orcid": u.orcid,
        "scholar_url": u.scholar_url,
        "github": u.github,
        "website": u.website,
        "twitter": u.twitter,
        "phd_year": u.phd_year,
        "phd_institution": u.phd_institution,
    }


@app.patch("/api/profile")
def patch_profile(payload: dict, db: Session = Depends(get_db)):
    u = db.query(models.User).first()
    if not u:
        u = models.User(name="")
        db.add(u)
        db.commit()
        db.refresh(u)
    allowed = {
        "name", "email", "current_role", "affiliation", "country",
        "research_interests", "research_categories", "orcid",
        "scholar_url", "github", "website", "twitter", "phd_year", "phd_institution",
    }
    for k, v in payload.items():
        if k in allowed:
            setattr(u, k, v)
    db.commit()
    db.refresh(u)
    return get_profile(db)


# ────────────────────────────────────────────────────────
# Calendar events
# ────────────────────────────────────────────────────────
class CalendarEventIn(BaseModel):
    title: str
    date: str                          # ISO yyyy-mm-dd
    time: Optional[str] = None
    end_time: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    kind: Optional[str] = "event"
    all_day: Optional[bool] = True

class CalendarEventPatch(BaseModel):
    title: Optional[str] = None
    date: Optional[str] = None
    time: Optional[str] = None
    end_time: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    kind: Optional[str] = None
    all_day: Optional[bool] = None


def _event_out(e: models.CalendarEvent) -> dict:
    return {
        "id": e.id,
        "title": e.title,
        "date": e.date.isoformat(),
        "time": e.time,
        "end_time": e.end_time,
        "description": e.description,
        "color": e.color,
        "kind": e.kind,
        "all_day": e.all_day,
        "created_at": e.created_at.isoformat(),
        "updated_at": e.updated_at.isoformat() if e.updated_at else e.created_at.isoformat(),
    }


@app.get("/api/calendar/events")
def list_calendar_events(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.CalendarEvent)
    if from_date:
        try:
            q = q.filter(models.CalendarEvent.date >= date.fromisoformat(from_date))
        except ValueError:
            pass
    if to_date:
        try:
            q = q.filter(models.CalendarEvent.date <= date.fromisoformat(to_date))
        except ValueError:
            pass
    return [_event_out(e) for e in q.order_by(models.CalendarEvent.date.asc()).all()]


@app.post("/api/calendar/events", status_code=201)
def create_calendar_event(payload: CalendarEventIn, db: Session = Depends(get_db)):
    try:
        event_date = date.fromisoformat(payload.date)
    except ValueError:
        raise HTTPException(400, "Invalid date format, use YYYY-MM-DD")
    e = models.CalendarEvent(
        title=payload.title,
        date=event_date,
        time=payload.time,
        end_time=payload.end_time,
        description=payload.description,
        color=payload.color,
        kind=payload.kind or "event",
        all_day=payload.all_day if payload.all_day is not None else True,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    _log(db, f"Added calendar event: {e.title}")
    return _event_out(e)


@app.patch("/api/calendar/events/{eid}")
def update_calendar_event(eid: int, patch: CalendarEventPatch, db: Session = Depends(get_db)):
    e = db.get(models.CalendarEvent, eid)
    if not e:
        raise HTTPException(404, "not found")
    data = patch.model_dump(exclude_unset=True)
    if "date" in data:
        try:
            data["date"] = date.fromisoformat(data["date"])
        except ValueError:
            raise HTTPException(400, "Invalid date format")
    for k, v in data.items():
        setattr(e, k, v)
    e.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(e)
    return _event_out(e)


@app.delete("/api/calendar/events/{eid}", status_code=204)
def delete_calendar_event(eid: int, db: Session = Depends(get_db)):
    e = db.get(models.CalendarEvent, eid)
    if not e:
        raise HTTPException(404, "not found")
    db.delete(e)
    db.commit()


def _log(db: Session, action: str, professor_id: Optional[int] = None, detail: str = ""):
    act = models.Activity(
        date=date.today(), action=action, detail=detail, professor_id=professor_id
    )
    db.add(act)
    db.commit()


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets"), check_dir=False), name="assets")


@app.get("/")
def index():
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/favicon.svg", include_in_schema=False)
def favicon():
    path = STATIC_DIR / "favicon.svg"
    if not path.exists():
        raise HTTPException(404, "not found")
    return FileResponse(str(path))


@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str):
    if full_path.startswith(("api/", "static/", "assets/")):
        raise HTTPException(404, "not found")
    return FileResponse(str(STATIC_DIR / "index.html"))
