"""Admin-only account management: list users, adjust credit caps and admin
status. Every route requires `require_admin` — a non-admin caller gets a
plain 404, not a 403, so these endpoints don't announce their own existence.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import models
from .auth import require_admin
from .database import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _user_out(db: Session, u: models.User) -> dict:
    from .quill import _lifetime_ai_spend, DEFAULT_CREDIT_CAP_USD

    cap = DEFAULT_CREDIT_CAP_USD if u.credit_cap_usd is None else u.credit_cap_usd
    used = _lifetime_ai_spend(db, u.id)
    return {
        "id": u.id,
        "account_email": u.account_email,
        "name": u.name,
        "is_admin": u.is_admin,
        "is_active": u.is_active,
        "credit_cap_usd": None if u.is_admin else cap,
        "credit_used_usd": None if u.is_admin else round(used, 4),
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


@router.get("/users")
def list_users(_admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    users = db.query(models.User).order_by(models.User.id.asc()).all()
    return [_user_out(db, u) for u in users]


class UserPatchIn(BaseModel):
    credit_cap_usd: Optional[float] = None
    is_admin: Optional[bool] = None
    is_active: Optional[bool] = None


@router.patch("/users/{user_id}")
def patch_user(
    user_id: int,
    payload: UserPatchIn,
    admin: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = db.get(models.User, user_id)
    if not target:
        raise HTTPException(404, "User not found.")

    data = payload.model_dump(exclude_unset=True)
    if "credit_cap_usd" in data:
        cap = data["credit_cap_usd"]
        if cap is not None and cap < 0:
            raise HTTPException(400, "credit_cap_usd cannot be negative.")
        target.credit_cap_usd = cap
    if "is_admin" in data:
        if target.id == admin.id and data["is_admin"] is False:
            raise HTTPException(400, "You cannot remove your own admin status.")
        target.is_admin = data["is_admin"]
    if "is_active" in data:
        if target.id == admin.id and data["is_active"] is False:
            raise HTTPException(400, "You cannot deactivate your own account.")
        target.is_active = data["is_active"]

    db.commit()
    db.refresh(target)
    return _user_out(db, target)
