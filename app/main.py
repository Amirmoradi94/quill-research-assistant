from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from . import models, schemas
from .seed import seed_if_empty

Base.metadata.create_all(bind=engine)
seed_if_empty()

app = FastAPI(title="Postdoc Application Dashboard", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).parent / "static"


@app.get("/api/health")
def health():
    return {"ok": True, "time": datetime.utcnow().isoformat()}


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
    return query.order_by(
        category_rank,
        models.Professor.tier.asc(),
        models.Professor.name.asc(),
    ).all()


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
    query = db.query(models.EmailDraft)
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
        .filter(models.EmailDraft.professor_id == pid)
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
    db: Session = Depends(get_db),
):
    """Bin-pack drafts into batches that are safe to send the same day.

    Hard rules per batch:
      - No two professors from the same dept_lab.
      - At most `max_per_university` professors from the same university.
    Soft preferences within ranking:
      - T1 first, then T2, T3.
      - Cycle through categories so each batch mixes research areas.
      - Prefer earlier batches contain higher-priority drafts.
    """
    drafts = (
        db.query(models.EmailDraft)
        .join(models.Professor)
        .filter(models.Professor.status == "drafting")
        .all()
    )

    eligible, skipped = [], []
    for d in drafts:
        p = d.professor
        if not p:
            continue
        reasons = []
        if not (p.email or "").strip():
            reasons.append("no email")
        if not (d.subject or "").strip():
            reasons.append("empty subject")
        if not (d.body or "").strip():
            reasons.append("empty body")
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

    # Suggested send dates: next Tue/Wed/Thu, fall back to Mon/Fri, skip weekends
    today = date.today()
    send_days, cursor = [], today
    while len(send_days) < len(batches):
        cursor += timedelta(days=1)
        if cursor.weekday() in (1, 2, 3):
            send_days.append(cursor)
        elif cursor.weekday() in (0, 4) and len(send_days) >= 3:
            send_days.append(cursor)

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
                    "word_count": len((d.body or "").split()),
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


def _log(db: Session, action: str, professor_id: Optional[int] = None, detail: str = ""):
    act = models.Activity(
        date=date.today(), action=action, detail=detail, professor_id=professor_id
    )
    db.add(act)
    db.commit()


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index():
    return FileResponse(str(STATIC_DIR / "index.html"))
