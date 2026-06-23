"""User-profile API.

Single-user model: there is always exactly one row in `users` (id=1) seeded
on first boot. All endpoints operate on that singleton; the repeatables
(education / publications / experience / awards / references) hang off it.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models, schemas
from .database import get_db


router = APIRouter(prefix="/api/user", tags=["user"])


# ───────────────────────────────────────────────────────────────────
# Singleton helper
# ───────────────────────────────────────────────────────────────────
def _user(db: Session) -> models.User:
    u = db.get(models.User, 1)
    if not u:
        u = models.User(id=1, name="")
        db.add(u)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            u = db.get(models.User, 1)
            if not u:
                raise
            return u
        db.refresh(u)
    return u


# ───────────────────────────────────────────────────────────────────
# Profile (scalars + nested repeatables)
# ───────────────────────────────────────────────────────────────────
@router.get("", response_model=schemas.UserProfileOut)
def get_profile(db: Session = Depends(get_db)):
    return _user(db)


@router.patch("", response_model=schemas.UserProfileOut)
def patch_profile(patch: schemas.UserProfileUpdate, db: Session = Depends(get_db)):
    u = _user(db)
    data = patch.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(u, k, v)
    u.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(u)
    return u


# ───────────────────────────────────────────────────────────────────
# Field-level verification — marks a field as user-confirmed so the
# next extraction run leaves it alone.
# ───────────────────────────────────────────────────────────────────
@router.post("/field/{field_name}/verify")
def verify_field(field_name: str, db: Session = Depends(get_db)):
    u = _user(db)
    prov = dict(u.field_provenance or {})
    entry = dict(prov.get(field_name) or {})
    entry["verified_by_user"] = True
    entry["verified_at"] = datetime.utcnow().isoformat()
    prov[field_name] = entry
    u.field_provenance = prov
    db.commit()
    return {"ok": True, "field": field_name, "provenance": entry}


# ───────────────────────────────────────────────────────────────────
# CRUD factory for the five repeatable child tables.
# Each child gets POST /api/user/{kind}, PATCH /api/user/{kind}/{id},
# DELETE /api/user/{kind}/{id}, plus POST /api/user/{kind}/reorder.
# ───────────────────────────────────────────────────────────────────
_CHILD_REGISTRY: dict[str, tuple[type, type, type, type]] = {
    # path-segment  → (Model, InSchema, UpdateSchema, OutSchema)
    "education":   (models.UserEducation,   schemas.UserEducationIn,   schemas.UserEducationIn,   schemas.UserEducationOut),
    "publications":(models.UserPublication, schemas.UserPublicationIn, schemas.UserPublicationIn, schemas.UserPublicationOut),
    "experience":  (models.UserExperience,  schemas.UserExperienceIn,  schemas.UserExperienceIn,  schemas.UserExperienceOut),
    "awards":      (models.UserAward,       schemas.UserAwardIn,       schemas.UserAwardIn,       schemas.UserAwardOut),
    "references":  (models.UserReference,   schemas.UserReferenceIn,   schemas.UserReferenceIn,   schemas.UserReferenceOut),
}


def _register_child(kind: str, Model: type, InSchema: type, OutSchema: type) -> None:
    """Register the 4 endpoints for one child kind. Inline closures with
    explicit (non-generic) type annotations so Pydantic can resolve them.
    """
    def add_item(payload, db: Session = Depends(get_db)):
        u = _user(db)
        item = Model(user_id=u.id, **payload.model_dump(exclude_unset=True))
        db.add(item); db.commit(); db.refresh(item)
        return item
    add_item.__annotations__["payload"] = InSchema

    def patch_item(item_id: int, payload, db: Session = Depends(get_db)):
        item = db.get(Model, item_id)
        if not item or item.user_id != 1:
            raise HTTPException(404, f"{kind} item {item_id} not found")
        for k, v in payload.model_dump(exclude_unset=True).items():
            setattr(item, k, v)
        db.commit(); db.refresh(item)
        return item
    patch_item.__annotations__["payload"] = InSchema

    def delete_item(item_id: int, db: Session = Depends(get_db)):
        item = db.get(Model, item_id)
        if not item or item.user_id != 1:
            raise HTTPException(404, f"{kind} item {item_id} not found")
        db.delete(item); db.commit()
        return None

    def reorder_items(order: list[int], db: Session = Depends(get_db)):
        for idx, item_id in enumerate(order):
            item = db.get(Model, item_id)
            if item and item.user_id == 1:
                item.order_idx = idx
        db.commit()
        return {"ok": True, "count": len(order)}

    router.add_api_route(f"/{kind}",                add_item,    methods=["POST"],   status_code=201, response_model=OutSchema, name=f"add_{kind}")
    router.add_api_route(f"/{kind}/{{item_id}}",    patch_item,  methods=["PATCH"],  response_model=OutSchema, name=f"patch_{kind}")
    router.add_api_route(f"/{kind}/{{item_id}}",    delete_item, methods=["DELETE"], status_code=204, name=f"delete_{kind}")
    router.add_api_route(f"/{kind}/reorder",        reorder_items, methods=["POST"], name=f"reorder_{kind}")


for _kind, (_Model, _In, _UpdSchema, _Out) in _CHILD_REGISTRY.items():
    _register_child(_kind, _Model, _In, _Out)


# ───────────────────────────────────────────────────────────────────
# Trigger the full-profile extraction workflow.
#
# This is a thin wrapper around POST /api/ai/run — we resolve which
# documents to feed the prompt (CV + transcripts + personal page) here
# so the frontend just hits /api/user/extract with no body.
# ───────────────────────────────────────────────────────────────────
@router.post("/extract")
def extract_profile(request: Request, db: Session = Depends(get_db)):
    """Stream extraction events as SSE. Returns the run id in the first event."""
    from .quill import RunIn, run_workflow  # local import — circular at module level

    u = _user(db)
    if not u.cv_doc_id:
        raise HTTPException(400, "Upload a CV first — set users.cv_doc_id before extracting.")

    # Load document texts so we can pass them in `params`. The actual prompt
    # context-build for this workflow lives in quill._run_and_stream so the
    # heavy lifting happens inside the SSE generator, not on the request thread.
    return run_workflow(
        RunIn(
            workflow="extract_user_profile_full",
            params={},  # context is assembled in quill.py from cv_doc_id etc.
            document_id=u.cv_doc_id,
            timeout_s=720,
        ),
        request,
        db,
    )
