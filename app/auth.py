"""Web authentication: password hashing, signed session cookies, and the
`get_current_user` dependency every router uses to resolve the request's
account.

Desktop (Tauri) mode has no login at all — `get_current_user` transparently
returns the single local profile row (id=1, created on first access), exactly
matching the create-if-missing behavior this module replaces from
`user_profile.py::_user`. Only the web deployment enforces real accounts.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import models
from .database import get_db
from .runtime import is_desktop_mode

router = APIRouter(prefix="/api/auth", tags=["auth"])

WEB_AUTH_SECRET = (
    os.environ.get("POSTDOC_WEB_AUTH_SECRET")
    or os.environ.get("SECRET_KEY")
    or "quill-dev-web-secret"
)
WEB_AUTH_COOKIE = "quill_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14  # 14 days
BCRYPT_ROUNDS = 12

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ───────────────────────────────────────────────────────────────────
# Password hashing
# ───────────────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


# ───────────────────────────────────────────────────────────────────
# Session cookie — HMAC-signed `user_id:issued:nonce:sig`, 14-day expiry.
# ───────────────────────────────────────────────────────────────────
def _sign_session(user_id: int) -> str:
    issued = str(int(datetime.utcnow().timestamp()))
    nonce = secrets.token_urlsafe(16)
    payload = f"{user_id}:{issued}:{nonce}"
    sig = hmac.new(WEB_AUTH_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def _valid_session(value: Optional[str]) -> Optional[int]:
    """Returns the authenticated user_id if the cookie is valid, else None."""
    if not value:
        return None
    parts = value.split(":")
    if len(parts) != 4:
        return None
    user_id_str, issued, nonce, sig = parts
    payload = f"{user_id_str}:{issued}:{nonce}"
    expected = hmac.new(WEB_AUTH_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        user_id = int(user_id_str)
        age = int(datetime.utcnow().timestamp()) - int(issued)
    except ValueError:
        return None
    if not (0 <= age <= SESSION_MAX_AGE_SECONDS):
        return None
    return user_id


def _set_session_cookie(response: JSONResponse, user_id: int) -> None:
    response.set_cookie(
        WEB_AUTH_COOKIE,
        _sign_session(user_id),
        httponly=True,
        samesite="lax",
        secure=os.environ.get("POSTDOC_WEB_SECURE_COOKIE", "").lower() in {"1", "true", "yes"},
        max_age=SESSION_MAX_AGE_SECONDS,
        path="/",
    )


# ───────────────────────────────────────────────────────────────────
# Current-user resolution — the one dependency every router should use.
# ───────────────────────────────────────────────────────────────────
def _desktop_singleton_user(db: Session) -> models.User:
    """Preserves the pre-multi-user create-if-missing id=1 behavior."""
    u = db.get(models.User, 1)
    if not u:
        u = models.User(id=1, name="")
        db.add(u)
        db.commit()
        db.refresh(u)
    return u


def get_current_user(request: Request, db: Session = Depends(get_db)) -> models.User:
    if is_desktop_mode():
        return _desktop_singleton_user(db)
    user_id = _valid_session(request.cookies.get(WEB_AUTH_COOKIE))
    if not user_id:
        raise HTTPException(401, "Authentication required.")
    user = db.get(models.User, user_id)
    if not user or not user.is_active:
        raise HTTPException(401, "Authentication required.")
    return user


def require_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    """Dependency for admin-only routes. 404s (not 403) so the existence of
    admin-only endpoints isn't revealed to non-admin accounts."""
    if not current_user.is_admin:
        raise HTTPException(404, "Not found.")
    return current_user


# ───────────────────────────────────────────────────────────────────
# Middleware helper — coarse fast-fail 401 gate ahead of get_current_user.
# ───────────────────────────────────────────────────────────────────
def has_valid_session(request: Request) -> bool:
    return _valid_session(request.cookies.get(WEB_AUTH_COOKIE)) is not None


# ───────────────────────────────────────────────────────────────────
# Routes
# ───────────────────────────────────────────────────────────────────
class SignupBody(BaseModel):
    account_email: str = ""
    password: str = ""
    name: str = ""


class LoginBody(BaseModel):
    account_email: str = ""
    password: str = ""


@router.get("/status")
def auth_status(request: Request, db: Session = Depends(get_db)):
    if is_desktop_mode():
        return {"authenticated": True, "user_id": 1, "account_email": None}
    user_id = _valid_session(request.cookies.get(WEB_AUTH_COOKIE))
    if not user_id:
        return {"authenticated": False}
    user = db.get(models.User, user_id)
    if not user or not user.is_active:
        return {"authenticated": False}
    return {"authenticated": True, "user_id": user.id, "account_email": user.account_email}


@router.post("/signup", status_code=201)
def auth_signup(payload: SignupBody, db: Session = Depends(get_db)):
    if is_desktop_mode():
        raise HTTPException(404, "Not found.")
    if os.environ.get("POSTDOC_ALLOW_SIGNUP", "true").lower() in {"0", "false", "no"}:
        raise HTTPException(403, "Signups are currently disabled.")

    email = payload.account_email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    if len(payload.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")

    existing = db.query(models.User).filter(models.User.account_email == email).first()
    if existing:
        raise HTTPException(409, "An account with this email already exists.")

    user = models.User(
        account_email=email,
        password_hash=hash_password(payload.password),
        name=(payload.name or "").strip(),
        is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(models.Settings(user_id=user.id))
    db.commit()
    db.refresh(user)

    response = JSONResponse({"ok": True, "user_id": user.id, "account_email": user.account_email}, status_code=201)
    _set_session_cookie(response, user.id)
    return response


@router.post("/login")
def auth_login(payload: LoginBody, db: Session = Depends(get_db)):
    if is_desktop_mode():
        raise HTTPException(404, "Not found.")

    email = payload.account_email.strip().lower()
    user = db.query(models.User).filter(models.User.account_email == email).first()
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash or ""):
        raise HTTPException(401, "Invalid email or password.")

    response = JSONResponse({"ok": True, "user_id": user.id, "account_email": user.account_email})
    _set_session_cookie(response, user.id)
    return response


@router.post("/logout")
def auth_logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie(WEB_AUTH_COOKIE, path="/")
    return response
